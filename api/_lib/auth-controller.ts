import type { ApiConfig } from './config';
import { isTrustedAppRequest } from './csrf';
import { randomToken, sha256Base64Url, timingSafeEqual } from './encoding';
import { GitHubOAuthClient, OAuthError } from './github-oauth';
import { errorJson, json, redirect } from './responses';
import { safeReturnTo } from './return-to';
import type { SessionStore } from './session-store';

/** Requests whose access token has less than this left are refreshed first. */
export const REFRESH_WINDOW_MS = 5 * 60 * 1000;

type SignInProblem = 'denied' | 'expired' | 'failed';

/** /api/auth/*: login, callback, session, refresh and logout. */
export class AuthController {
  constructor(
    private readonly config: ApiConfig,
    private readonly sessions: SessionStore,
    private readonly github: GitHubOAuthClient,
    private readonly now: () => number,
  ) {}

  async login(url: URL): Promise<Response> {
    const state = randomToken();
    const verifier = randomToken(48);
    const challenge = await sha256Base64Url(verifier);
    const returnTo = safeReturnTo(url.searchParams.get('returnTo'));
    const cookie = await this.sessions.startOAuth(state, verifier, returnTo);
    return redirect(this.github.authorizeUrl(state, challenge), [cookie]);
  }

  async callback(request: Request, url: URL): Promise<Response> {
    const clearOAuth = this.sessions.clearOAuth();
    const pending = await this.sessions.readOAuth(request);
    const state = url.searchParams.get('state') ?? '';

    if (!pending) return this.#signInFailed('expired', [clearOAuth]);
    if (!state || !timingSafeEqual(state, pending.state)) {
      return this.#signInFailed('failed', [clearOAuth]);
    }
    if (url.searchParams.get('error') === 'access_denied') {
      return this.#signInFailed('denied', [clearOAuth]);
    }

    const code = url.searchParams.get('code');
    if (!code || code.length > 256) return this.#signInFailed('failed', [clearOAuth]);

    try {
      const tokens = await this.github.exchangeCode(code, pending.verifier);
      const profile = await this.github.getProfile(tokens.accessToken);
      const session = this.sessions.create(tokens, profile);
      const cookie = await this.sessions.write(session);
      return redirect(`${this.config.appOrigin}${pending.returnTo}`, [clearOAuth, cookie]);
    } catch (err) {
      console.error('auth.callback', err instanceof OAuthError ? err.code : 'unexpected');
      return this.#signInFailed('failed', [clearOAuth]);
    }
  }

  async session(request: Request): Promise<Response> {
    const session = await this.sessions.read(request);
    if (!session) return errorJson(401, 'signed_out', [this.sessions.clear()]);
    if (!this.sessions.needsTouch(session)) return json(200, this.sessions.view(session));
    const touched = this.sessions.touched(session);
    return json(200, this.sessions.view(touched), [await this.sessions.write(touched)]);
  }

  async refresh(request: Request): Promise<Response> {
    if (!isTrustedAppRequest(request, this.config.appOrigin)) return errorJson(403, 'forbidden');
    const session = await this.sessions.read(request);
    if (!session) return errorJson(401, 'signed_out', [this.sessions.clear()]);

    const force = (await this.#readJson(request))['force'] === true;
    // Another tab may have refreshed already: rotate only when it's actually needed.
    if (!force && session.ae - this.now() > REFRESH_WINDOW_MS) {
      return json(200, this.sessions.view(session));
    }
    if (!session.rt) return errorJson(401, 'refresh_failed');

    try {
      const updated = this.sessions.withTokens(session, await this.github.refresh(session.rt));
      return json(200, this.sessions.view(updated), [await this.sessions.write(updated)]);
    } catch (err) {
      const reason = err instanceof OAuthError ? err.reason : 'upstream';
      console.error('auth.refresh', err instanceof OAuthError ? err.code : 'unexpected');
      // Don't clear the cookie: a parallel refresh may just have replaced it with a good one.
      return reason === 'rejected' ? errorJson(401, 'refresh_failed') : errorJson(502, 'upstream');
    }
  }

  async logout(request: Request): Promise<Response> {
    if (!isTrustedAppRequest(request, this.config.appOrigin)) return errorJson(403, 'forbidden');
    const session = await this.sessions.read(request);
    let revoked = false;
    if (session && (await this.#readJson(request))['revoke'] === true) {
      try {
        revoked = await this.github.revoke(session.at);
      } catch (err) {
        console.error('auth.revoke', err instanceof OAuthError ? err.code : 'unexpected');
      }
    }
    return json(200, { revoked }, [this.sessions.clear()]);
  }

  #signInFailed(problem: SignInProblem, cookies: string[]): Response {
    return redirect(`${this.config.appOrigin}/app/connect?signin=${problem}`, cookies);
  }

  async #readJson(request: Request): Promise<Record<string, unknown>> {
    try {
      const text = await request.text();
      if (!text || text.length > 1024) return {};
      const value: unknown = JSON.parse(text);
      return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
}
