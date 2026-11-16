import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { DOCUMENT, Injectable, inject, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { SIGN_IN_ENABLED } from '../site.config';
import { AuthStrategy, LoginInput } from './auth-strategy';

export const BFF_API_BASE = '/api/gh';
export const CSRF_HEADER = 'X-GistVault';
const REFRESH_LOCK = 'gistvault-refresh';
/** Matches the function: tokens with less than this left are refreshed. */
const REFRESH_WINDOW_MS = 5 * 60 * 1000;

/** `unknown` until /api/auth/session has answered once. */
export type SignInAvailability = 'unknown' | 'available' | 'unavailable';

export interface BffSession {
  login: string;
  name: string | null;
  avatarUrl: string;
  expiresAt: Date;
  refreshExpiresAt: Date;
}

interface SessionDto {
  login: string;
  name: string | null;
  avatarUrl: string;
  expiresAt: string;
  refreshExpiresAt: string;
}

/**
 * Sign in with GitHub through the Vercel function (backend-for-frontend).
 * The GitHub token lives in an encrypted HttpOnly cookie; this class never sees it.
 */
@Injectable()
export class BffAuthStrategy implements AuthStrategy {
  readonly kind = 'bff' as const;
  readonly apiBase = BFF_API_BASE;
  readonly withCredentials = true;

  readonly #http = inject(HttpClient);
  readonly #document = inject(DOCUMENT);
  readonly #availability = signal<SignInAvailability>(SIGN_IN_ENABLED ? 'unknown' : 'unavailable');
  readonly #session = signal<BffSession | null>(null);

  readonly availability = this.#availability.asReadonly();
  readonly session = this.#session.asReadonly();

  authHeaders(): Record<string, string> {
    return { [CSRF_HEADER]: '1' };
  }

  /** Leaves the app for GitHub; the function brings the user back to `returnTo`. */
  async login({ returnTo = '/app' }: LoginInput = {}): Promise<void> {
    const target = `/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
    this.#document.defaultView?.location.assign(target);
  }

  async restore(): Promise<boolean> {
    return (await this.probe()) !== null;
  }

  /**
   * Asks the function who is signed in. Anything other than a JSON answer (for example the
   * SPA's index.html on a host without the function) marks sign-in as unavailable.
   */
  async probe(): Promise<BffSession | null> {
    if (!SIGN_IN_ENABLED) return null;
    try {
      const dto: unknown = await firstValueFrom(this.#http.get<unknown>('/api/auth/session'));
      if (!isSessionDto(dto)) throw new Error('Unexpected answer from /api/auth/session');
      this.#availability.set('available');
      return this.#setSession(dto);
    } catch (err) {
      const signedOut = err instanceof HttpErrorResponse && err.status === 401 && isApiError(err);
      this.#availability.set(signedOut ? 'available' : 'unavailable');
      this.#session.set(null);
      return null;
    }
  }

  /**
   * Called by the auth interceptor after a 401. Several tabs share one cookie and GitHub
   * invalidates a refresh token once it's used, so refreshes are serialised with a
   * browser-wide Web Lock, and a tab first checks whether another tab already refreshed.
   */
  async tryRefresh(): Promise<boolean> {
    const knownExpiry = this.#session()?.expiresAt.getTime() ?? null;
    return this.#withLock(async () => {
      const current = await this.probe();
      if (!current) return false;
      const fresh = current.expiresAt.getTime() - Date.now() > REFRESH_WINDOW_MS;
      // Another tab rotated the token since our request was sent: just retry.
      if (fresh && current.expiresAt.getTime() !== knownExpiry) return true;
      // Still fresh but GitHub said 401: the token may have been revoked, so force a rotation.
      return this.#refresh(fresh);
    });
  }

  async logout({ revoke = false }: { revoke?: boolean } = {}): Promise<void> {
    try {
      await firstValueFrom(
        this.#http.post('/api/auth/logout', { revoke }, { headers: this.authHeaders() }),
      );
    } finally {
      this.#session.set(null);
    }
  }

  async #refresh(force: boolean): Promise<boolean> {
    try {
      const dto: unknown = await firstValueFrom(
        this.#http.post<unknown>('/api/auth/refresh', { force }, { headers: this.authHeaders() }),
      );
      if (!isSessionDto(dto)) return false;
      this.#setSession(dto);
      return true;
    } catch {
      return false;
    }
  }

  async #withLock<T>(task: () => Promise<T>): Promise<T> {
    const locks = this.#document.defaultView?.navigator.locks;
    if (!locks) return task();
    return locks.request(REFRESH_LOCK, task);
  }

  #setSession(dto: SessionDto): BffSession {
    const session: BffSession = {
      login: dto.login,
      name: typeof dto.name === 'string' ? dto.name : null,
      avatarUrl: typeof dto.avatarUrl === 'string' ? dto.avatarUrl : '',
      expiresAt: new Date(dto.expiresAt),
      refreshExpiresAt: new Date(dto.refreshExpiresAt),
    };
    this.#session.set(session);
    return session;
  }
}

function isSessionDto(value: unknown): value is SessionDto {
  const v = value as Partial<SessionDto> | null;
  return (
    !!v &&
    typeof v.login === 'string' &&
    typeof v.expiresAt === 'string' &&
    typeof v.refreshExpiresAt === 'string' &&
    !Number.isNaN(Date.parse(v.expiresAt))
  );
}

function isApiError(err: HttpErrorResponse): boolean {
  const body: unknown = err.error;
  return (
    !!body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
  );
}
