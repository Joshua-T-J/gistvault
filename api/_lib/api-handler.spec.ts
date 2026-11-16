import { beforeEach, describe, expect, it } from 'vitest';
import { ApiHandler, createApiHandler } from './api-handler';

const ORIGIN = 'https://gistvault.vercel.app';
const ENV = {
  GH_CLIENT_ID: 'Iv1.test',
  GH_CLIENT_SECRET: 'client-secret',
  SESSION_SECRET: btoa('k'.repeat(32)),
  APP_ORIGIN: ORIGIN,
};
const HOUR = 3600 * 1000;

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

/** A fake GitHub: records every call and answers like the real endpoints. */
class FakeGitHub {
  calls: Call[] = [];
  tokenCounter = 0;
  refreshRejects = false;
  gistDescription = 'GistVault collection: tools [gistvault-collection:v1]';

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    const headers = new Headers(init.headers);
    const body = init.body === undefined || init.body === null ? '' : String(init.body);
    const method = init.method ?? 'GET';
    this.calls.push({ url, method, headers, body });

    if (url === 'https://github.com/login/oauth/access_token') {
      const params = new URLSearchParams(body);
      if (params.get('grant_type') === 'refresh_token' && this.refreshRejects) {
        return Response.json({ error: 'bad_refresh_token' });
      }
      if (params.get('code') === 'bad') return Response.json({ error: 'bad_verification_code' });
      this.tokenCounter++;
      return Response.json({
        access_token: `ghu_access${this.tokenCounter}`,
        expires_in: 28800,
        refresh_token: `ghr_refresh${this.tokenCounter}`,
        refresh_token_expires_in: 15897600,
      });
    }
    if (url === 'https://api.github.com/user') {
      return Response.json({
        id: 42,
        login: 'octocat',
        name: 'Octo Cat',
        avatar_url: 'https://avatars.githubusercontent.com/u/42',
      });
    }
    if (url.startsWith('https://api.github.com/applications/'))
      return new Response(null, { status: 204 });
    if (url.startsWith('https://api.github.com/gists/abc123') && method === 'GET') {
      return Response.json(
        { id: 'abc123', description: this.gistDescription },
        {
          headers: {
            etag: 'W/"1"',
            'x-ratelimit-remaining': '4999',
            'set-cookie': 'gh=1',
            'content-encoding': 'gzip',
          },
        },
      );
    }
    return Response.json({ ok: true, method }, { status: method === 'POST' ? 201 : 200 });
  };
}

function cookieJar(res: Response, jar: Map<string, string>): Map<string, string> {
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const [name, ...rest] = (pair ?? '').split('=');
    const value = rest.join('=');
    if (!name) continue;
    if (/Max-Age=0/.test(line)) jar.delete(name);
    else jar.set(name, value);
  }
  return jar;
}

const cookieHeader = (jar: Map<string, string>) => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');

describe('API handler', () => {
  let github: FakeGitHub;
  let now: number;
  let handle: ApiHandler;
  let jar: Map<string, string>;

  const request = (path: string, init: RequestInit & { headers?: Record<string, string> } = {}) =>
    handle(
      new Request(`${ORIGIN}${path}`, {
        ...init,
        headers: { cookie: cookieHeader(jar), ...init.headers },
      }),
    );
  const appHeaders = { 'x-gistvault': '1', origin: ORIGIN };

  async function signIn(): Promise<void> {
    const login = await request('/api/auth/login?returnTo=%2Fc%2Fabc');
    cookieJar(login, jar);
    const state = new URL(login.headers.get('location') ?? '').searchParams.get('state');
    const callback = await request(`/api/auth/callback?code=good&state=${state}`);
    cookieJar(callback, jar);
    expect(callback.headers.get('location')).toBe(`${ORIGIN}/c/abc`);
  }

  beforeEach(() => {
    github = new FakeGitHub();
    now = Date.UTC(2026, 10, 14, 9);
    jar = new Map();
    handle = createApiHandler({ env: ENV, fetch: github.fetch, now: () => now });
  });

  it('starts sign-in with state, PKCE S256 and a sealed short-lived cookie', async () => {
    const res = await request('/api/auth/login?returnTo=//evil.com');
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '');
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize');
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(location.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/api/auth/callback`);
    const cookie = res.headers.getSetCookie()[0] ?? '';
    expect(cookie).toMatch(/^__Host-gv_oauth=v1\./);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Max-Age=600');
  });

  it('completes sign-in and never exposes tokens to the browser', async () => {
    await signIn();
    const exchange = github.calls.find((c) => c.url.endsWith('/access_token'));
    const params = new URLSearchParams(exchange?.body);
    expect(params.get('code_verifier')).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(params.get('client_secret')).toBe('client-secret');
    expect(jar.has('__Host-gv_oauth')).toBe(false);
    expect(jar.get('__Host-gv_session')).not.toContain('ghu_');

    const session = await request('/api/auth/session');
    const text = await session.text();
    expect(session.status).toBe(200);
    expect(text).not.toContain('ghu_');
    expect(text).not.toContain('ghr_');
    expect(JSON.parse(text)).toMatchObject({ login: 'octocat', name: 'Octo Cat' });
  });

  it('rejects a callback whose state does not match', async () => {
    cookieJar(await request('/api/auth/login'), jar);
    const res = await request('/api/auth/callback?code=good&state=forged');
    expect(res.headers.get('location')).toBe(`${ORIGIN}/app/connect?signin=failed`);
    expect(github.calls.some((c) => c.url.endsWith('/access_token'))).toBe(false);
  });

  it('reports an expired or missing sign-in attempt and a denied one', async () => {
    expect((await request('/api/auth/callback?code=x&state=y')).headers.get('location')).toContain(
      'signin=expired',
    );
    const login = await request('/api/auth/login');
    cookieJar(login, jar);
    const state = new URL(login.headers.get('location') ?? '').searchParams.get('state');
    const denied = await request(`/api/auth/callback?error=access_denied&state=${state}`);
    expect(denied.headers.get('location')).toContain('signin=denied');
  });

  it('answers 401 for the session when signed out', async () => {
    const res = await request('/api/auth/session');
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'signed_out' });
  });

  describe('proxy', () => {
    beforeEach(signIn);

    it('forwards allowlisted calls with the token and strips unsafe headers', async () => {
      const res = await request('/api/gh/gists/abc123', {
        headers: { 'x-gistvault': '1', 'if-none-match': 'W/"0"' },
      });
      expect(res.status).toBe(200);
      const call = github.calls.at(-1);
      expect(call?.url).toBe('https://api.github.com/gists/abc123');
      expect(call?.headers.get('authorization')).toBe('Bearer ghu_access1');
      expect(call?.headers.get('if-none-match')).toBe('W/"0"');
      expect(call?.headers.get('cookie')).toBeNull();
      expect(res.headers.get('etag')).toBe('W/"1"');
      expect(res.headers.get('x-ratelimit-remaining')).toBe('4999');
      expect(res.headers.get('set-cookie')).toBeNull();
      expect(res.headers.get('content-encoding')).toBeNull();
      expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it('supports the rewrite passing the path as a query parameter', async () => {
      const res = await request('/api?__path=gh/user', { headers: { 'x-gistvault': '1' } });
      expect(res.status).toBe(200);
      expect(github.calls.at(-1)?.url).toBe('https://api.github.com/user');
    });

    it('refuses requests without the app header or from another origin', async () => {
      expect((await request('/api/gh/user')).status).toBe(403);
      const res = await request('/api/gh/gists', {
        method: 'POST',
        body: '{}',
        headers: {
          'x-gistvault': '1',
          origin: 'https://evil.com',
          'content-type': 'application/json',
        },
      });
      expect(res.status).toBe(403);
    });

    it('returns 404 for endpoints outside the allowlist', async () => {
      const res = await request('/api/gh/user/repos', { headers: { 'x-gistvault': '1' } });
      expect(res.status).toBe(404);
      expect(github.calls.some((c) => c.url.includes('/repos'))).toBe(false);
    });

    it('refuses bodies over 4 MB and non-JSON bodies', async () => {
      const big = await request('/api/gh/gists/abc123', {
        method: 'PATCH',
        body: JSON.stringify({ x: 'a'.repeat(4 * 1024 * 1024) }),
        headers: { ...appHeaders, 'content-type': 'application/json' },
      });
      expect(big.status).toBe(413);
      const form = await request('/api/gh/gists', {
        method: 'POST',
        body: 'a=1',
        headers: { ...appHeaders, 'content-type': 'application/x-www-form-urlencoded' },
      });
      expect(form.status).toBe(415);
    });

    it('deletes only gists that are GistVault collections', async () => {
      const ok = await request('/api/gh/gists/abc123', { method: 'DELETE', headers: appHeaders });
      expect(ok.status).toBe(200);
      expect(github.calls.at(-1)?.method).toBe('DELETE');

      github.gistDescription = 'My dotfiles';
      const before = github.calls.length;
      const blocked = await request('/api/gh/gists/abc123', {
        method: 'DELETE',
        headers: appHeaders,
      });
      expect(blocked.status).toBe(403);
      expect(github.calls.slice(before).some((c) => c.method === 'DELETE')).toBe(false);
    });

    it('asks the app to refresh when the token is about to expire', async () => {
      now += 8 * HOUR - 4 * 60 * 1000;
      const res = await request('/api/gh/user', { headers: { 'x-gistvault': '1' } });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'token_expired' });
    });
  });

  describe('refresh', () => {
    beforeEach(signIn);

    it('does not rotate a token that still has time left', async () => {
      const res = await request('/api/auth/refresh', { method: 'POST', headers: appHeaders });
      expect(res.status).toBe(200);
      expect(github.tokenCounter).toBe(1);
      expect(res.headers.getSetCookie()).toHaveLength(0);
    });

    it('rotates near expiry and the new token is used afterwards', async () => {
      now += 8 * HOUR - 60 * 1000;
      const res = await request('/api/auth/refresh', { method: 'POST', headers: appHeaders });
      expect(res.status).toBe(200);
      cookieJar(res, jar);
      const refreshCall = github.calls.find((c) => c.body.includes('grant_type=refresh_token'));
      expect(new URLSearchParams(refreshCall?.body).get('refresh_token')).toBe('ghr_refresh1');

      await request('/api/gh/user', { headers: { 'x-gistvault': '1' } });
      expect(github.calls.at(-1)?.headers.get('authorization')).toBe('Bearer ghu_access2');
    });

    it('rotates on demand with force', async () => {
      const res = await request('/api/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ force: true }),
        headers: { ...appHeaders, 'content-type': 'application/json' },
      });
      expect(res.status).toBe(200);
      expect(github.tokenCounter).toBe(2);
    });

    it('keeps the cookie when GitHub rejects the refresh token', async () => {
      now += 8 * HOUR;
      github.refreshRejects = true;
      const res = await request('/api/auth/refresh', { method: 'POST', headers: appHeaders });
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'refresh_failed' });
      expect(res.headers.getSetCookie()).toHaveLength(0);
    });

    it('needs the CSRF header and origin', async () => {
      const res = await request('/api/auth/refresh', { method: 'POST' });
      expect(res.status).toBe(403);
    });
  });

  it('drops a session left unused for over 30 days', async () => {
    await signIn();
    now += 31 * 24 * HOUR;
    expect((await request('/api/auth/session')).status).toBe(401);
  });

  it('signs out, optionally revoking the authorization on GitHub', async () => {
    await signIn();
    const res = await request('/api/auth/logout', {
      method: 'POST',
      body: JSON.stringify({ revoke: true }),
      headers: { ...appHeaders, 'content-type': 'application/json' },
    });
    expect(await res.json()).toEqual({ revoked: true });
    const revoke = github.calls.find((c) => c.url.includes('/applications/'));
    expect(revoke?.method).toBe('DELETE');
    expect(JSON.parse(revoke?.body ?? '{}')).toEqual({ access_token: 'ghu_access1' });
    cookieJar(res, jar);
    expect(jar.has('__Host-gv_session')).toBe(false);
  });

  it('reports a missing configuration instead of failing obscurely', async () => {
    const unconfigured = createApiHandler({ env: {}, fetch: github.fetch, now: () => now });
    const res = await unconfigured(new Request(`${ORIGIN}/api/auth/session`));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: 'not_configured' });
  });

  it('returns 404 for unknown routes and 405 for wrong methods', async () => {
    expect((await request('/api/nope')).status).toBe(404);
    expect((await request('/api/auth/logout')).status).toBe(405);
  });
});
