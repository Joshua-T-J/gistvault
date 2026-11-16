import type { ApiConfig } from './config';

export const GITHUB_WEB = 'https://github.com';
export const GITHUB_API = 'https://api.github.com';
export const GITHUB_API_VERSION = '2026-03-10';
export const USER_AGENT = 'GistVault';

const AVATAR_ORIGIN = 'https://avatars.githubusercontent.com/';
/** Used when the GitHub App has token expiry switched off. */
const NON_EXPIRING_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;

export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
}

export interface GitHubProfile {
  id: number;
  login: string;
  name: string | null;
  avatarUrl: string;
}

/** `rejected` = GitHub refused the code or refresh token; `upstream` = GitHub was unreachable or broken. */
export class OAuthError extends Error {
  constructor(
    readonly reason: 'rejected' | 'upstream',
    readonly code: string,
  ) {
    super(`GitHub OAuth ${reason}: ${code}`);
    this.name = 'OAuthError';
  }
}

type FetchFn = typeof fetch;

/** Talks to GitHub's OAuth endpoints for a GitHub App's user access tokens. */
export class GitHubOAuthClient {
  constructor(
    private readonly config: ApiConfig,
    private readonly fetchFn: FetchFn,
    private readonly now: () => number,
  ) {}

  get callbackUrl(): string {
    return `${this.config.appOrigin}/api/auth/callback`;
  }

  authorizeUrl(state: string, codeChallenge: string): string {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.callbackUrl,
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      allow_signup: 'true',
    });
    return `${GITHUB_WEB}/login/oauth/authorize?${params}`;
  }

  exchangeCode(code: string, codeVerifier: string): Promise<TokenSet> {
    return this.#tokenRequest({
      code,
      code_verifier: codeVerifier,
      redirect_uri: this.callbackUrl,
    });
  }

  refresh(refreshToken: string): Promise<TokenSet> {
    return this.#tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken });
  }

  async getProfile(accessToken: string): Promise<GitHubProfile> {
    const res = await this.#safeFetch(`${GITHUB_API}/user`, {
      headers: this.#apiHeaders({ Authorization: `Bearer ${accessToken}` }),
    });
    if (!res.ok)
      throw new OAuthError(res.status === 401 ? 'rejected' : 'upstream', `user_${res.status}`);
    const body = (await res.json()) as Record<string, unknown>;
    const id = body['id'];
    const login = body['login'];
    if (typeof id !== 'number' || typeof login !== 'string') {
      throw new OAuthError('upstream', 'user_shape');
    }
    const name = typeof body['name'] === 'string' ? body['name'].slice(0, 100) : null;
    const avatar = typeof body['avatar_url'] === 'string' ? body['avatar_url'] : '';
    return { id, login, name, avatarUrl: avatar.startsWith(AVATAR_ORIGIN) ? avatar : '' };
  }

  /** Removes the app's authorization for this user, invalidating every token it issued. */
  async revoke(accessToken: string): Promise<boolean> {
    const basic = btoa(`${this.config.clientId}:${this.config.clientSecret}`);
    const res = await this.#safeFetch(
      `${GITHUB_API}/applications/${encodeURIComponent(this.config.clientId)}/grant`,
      {
        method: 'DELETE',
        headers: this.#apiHeaders({
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/json',
        }),
        body: JSON.stringify({ access_token: accessToken }),
      },
    );
    return res.status === 204 || res.status === 404;
  }

  async #tokenRequest(params: Record<string, string>): Promise<TokenSet> {
    const res = await this.#safeFetch(`${GITHUB_WEB}/login/oauth/access_token`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
      },
      body: new URLSearchParams({
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        ...params,
      }),
    });
    if (!res.ok) throw new OAuthError('upstream', `token_${res.status}`);

    const body = (await res.json()) as Record<string, unknown>;
    if (typeof body['error'] === 'string')
      throw new OAuthError('rejected', body['error'].slice(0, 64));

    const accessToken = body['access_token'];
    if (typeof accessToken !== 'string' || !accessToken)
      throw new OAuthError('upstream', 'token_shape');

    const now = this.now();
    const expiresIn = Number(body['expires_in']);
    const refreshExpiresIn = Number(body['refresh_token_expires_in']);
    const refreshToken = typeof body['refresh_token'] === 'string' ? body['refresh_token'] : '';
    const accessExpiresAt = expiresIn > 0 ? now + expiresIn * 1000 : now + NON_EXPIRING_LIFETIME_MS;
    const refreshExpiresAt =
      refreshToken && refreshExpiresIn > 0 ? now + refreshExpiresIn * 1000 : accessExpiresAt;

    return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt };
  }

  async #safeFetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await this.fetchFn(url, { ...init, redirect: 'manual' });
    } catch {
      throw new OAuthError('upstream', 'network');
    }
  }

  #apiHeaders(extra: Record<string, string>): Record<string, string> {
    return {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': GITHUB_API_VERSION,
      'User-Agent': USER_AGENT,
      ...extra,
    };
  }
}
