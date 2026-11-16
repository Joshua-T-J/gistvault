import type { ApiConfig } from './config';
import { OAUTH_COOKIE, SESSION_COOKIE, clearCookie, readCookie, serializeCookie } from './cookies';
import type { GitHubProfile, TokenSet } from './github-oauth';
import { Sealer } from './sealer';

const OAUTH_LIFETIME_MS = 10 * 60 * 1000;
/** A session left unused this long is dropped, even if its refresh token would last longer. */
export const IDLE_LIMIT_MS = 30 * 24 * 60 * 60 * 1000;
/** Re-issue the cookie (sliding the idle limit) at most this often. */
const TOUCH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface OAuthState {
  v: 1;
  state: string;
  verifier: string;
  returnTo: string;
  exp: number;
}

export interface Session {
  v: 1;
  /** Access token, refresh token and their expiry times (epoch ms). */
  at: string;
  rt: string;
  ae: number;
  re: number;
  uid: number;
  login: string;
  name: string | null;
  avatar: string;
  /** Last time the cookie was issued (epoch ms), for the idle limit. */
  seen: number;
}

/** What the browser may know about a session: never a token. */
export interface SessionView {
  login: string;
  name: string | null;
  avatarUrl: string;
  expiresAt: string;
  refreshExpiresAt: string;
}

function isOAuthState(value: unknown): value is OAuthState {
  const v = value as Partial<OAuthState> | null;
  return (
    !!v &&
    v.v === 1 &&
    typeof v.state === 'string' &&
    typeof v.verifier === 'string' &&
    typeof v.returnTo === 'string' &&
    typeof v.exp === 'number'
  );
}

function isSession(value: unknown): value is Session {
  const v = value as Partial<Session> | null;
  return (
    !!v &&
    v.v === 1 &&
    typeof v.at === 'string' &&
    typeof v.rt === 'string' &&
    typeof v.ae === 'number' &&
    typeof v.re === 'number' &&
    typeof v.uid === 'number' &&
    typeof v.login === 'string' &&
    (v.name === null || typeof v.name === 'string') &&
    typeof v.avatar === 'string' &&
    typeof v.seen === 'number'
  );
}

/** Reads and writes the two sealed cookies. The only place tokens are serialised. */
export class SessionStore {
  private constructor(
    private readonly oauthSealer: Sealer,
    private readonly sessionSealer: Sealer,
    private readonly now: () => number,
  ) {}

  static async create(config: ApiConfig, now: () => number): Promise<SessionStore> {
    const [oauth, session] = await Promise.all([
      Sealer.create(config.sessionSecret, 'oauth-state'),
      Sealer.create(config.sessionSecret, 'session'),
    ]);
    return new SessionStore(oauth, session, now);
  }

  async startOAuth(state: string, verifier: string, returnTo: string): Promise<string> {
    const value: OAuthState = {
      v: 1,
      state,
      verifier,
      returnTo,
      exp: this.now() + OAUTH_LIFETIME_MS,
    };
    return serializeCookie(
      OAUTH_COOKIE,
      await this.oauthSealer.seal(value),
      OAUTH_LIFETIME_MS / 1000,
    );
  }

  async readOAuth(request: Request): Promise<OAuthState | null> {
    const value = await this.oauthSealer.open(readCookie(request, OAUTH_COOKIE), isOAuthState);
    return value && value.exp > this.now() ? value : null;
  }

  clearOAuth(): string {
    return clearCookie(OAUTH_COOKIE);
  }

  async read(request: Request): Promise<Session | null> {
    const session = await this.sessionSealer.open(readCookie(request, SESSION_COOKIE), isSession);
    if (!session) return null;
    const now = this.now();
    if (session.re <= now || now - session.seen > IDLE_LIMIT_MS) return null;
    return session;
  }

  create(tokens: TokenSet, profile: GitHubProfile): Session {
    return {
      v: 1,
      at: tokens.accessToken,
      rt: tokens.refreshToken,
      ae: tokens.accessExpiresAt,
      re: tokens.refreshExpiresAt,
      uid: profile.id,
      login: profile.login,
      name: profile.name,
      avatar: profile.avatarUrl,
      seen: this.now(),
    };
  }

  withTokens(session: Session, tokens: TokenSet): Session {
    return {
      ...session,
      at: tokens.accessToken,
      rt: tokens.refreshToken || session.rt,
      ae: tokens.accessExpiresAt,
      re: tokens.refreshToken ? tokens.refreshExpiresAt : session.re,
      seen: this.now(),
    };
  }

  /** True when the cookie should be re-issued to slide the idle limit. */
  needsTouch(session: Session): boolean {
    return this.now() - session.seen > TOUCH_INTERVAL_MS;
  }

  touched(session: Session): Session {
    return { ...session, seen: this.now() };
  }

  async write(session: Session): Promise<string> {
    const lifetimeMs = Math.min(session.re - this.now(), IDLE_LIMIT_MS);
    return serializeCookie(
      SESSION_COOKIE,
      await this.sessionSealer.seal(session),
      lifetimeMs / 1000,
    );
  }

  clear(): string {
    return clearCookie(SESSION_COOKIE);
  }

  view(session: Session): SessionView {
    return {
      login: session.login,
      name: session.name,
      avatarUrl: session.avatar,
      expiresAt: new Date(session.ae).toISOString(),
      refreshExpiresAt: new Date(session.re).toISOString(),
    };
  }
}
