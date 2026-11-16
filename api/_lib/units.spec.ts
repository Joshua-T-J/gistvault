import { describe, expect, it } from 'vitest';
import { readConfig } from './config';
import { isTrustedAppRequest } from './csrf';
import { timingSafeEqual } from './encoding';
import { ProxyAllowlist } from './proxy-allowlist';
import { safeReturnTo } from './return-to';
import { Sealer } from './sealer';

const SECRET = new Uint8Array(32).fill(7);
const isAny = (v: unknown): v is unknown => true;

describe('Sealer', () => {
  it('round-trips a value', async () => {
    const sealer = await Sealer.create(SECRET, 'session');
    const sealed = await sealer.seal({ hello: 'world' });
    expect(sealed.startsWith('v1.')).toBe(true);
    expect(sealed).not.toContain('world');
    expect(await sealer.open(sealed, isAny)).toEqual({ hello: 'world' });
  });

  it('rejects tampering, other purposes and other keys', async () => {
    const session = await Sealer.create(SECRET, 'session');
    const oauth = await Sealer.create(SECRET, 'oauth-state');
    const otherKey = await Sealer.create(new Uint8Array(32).fill(9), 'session');
    const sealed = await session.seal({ a: 1 });
    // Flip a character in the middle: the last one can carry unused padding bits.
    const i = Math.floor(sealed.length / 2);
    const tampered = sealed.slice(0, i) + (sealed[i] === 'A' ? 'B' : 'A') + sealed.slice(i + 1);
    expect(await session.open(tampered, isAny)).toBeNull();
    expect(await oauth.open(sealed, isAny)).toBeNull();
    expect(await otherKey.open(sealed, isAny)).toBeNull();
    expect(await session.open('garbage', isAny)).toBeNull();
    expect(await session.open(undefined, isAny)).toBeNull();
  });
});

describe('safeReturnTo', () => {
  it.each([
    ['/app', '/app'],
    ['/app/connect?x=1', '/app/connect?x=1'],
    ['/c/abc123', '/c/abc123'],
    ['/explore#top', '/explore#top'],
  ])('keeps %s', (input, expected) => expect(safeReturnTo(input)).toBe(expected));

  it.each([
    null,
    '',
    'https://evil.com/app',
    '//evil.com/app',
    '/\\evil.com',
    '/%2F%2Fevil.com',
    '/%5Cevil.com',
    '/app/../admin',
    '/app/%2e%2e/x',
    '/privacy',
    '/apple',
    '/app\nSet-Cookie: x',
    `/app/${'a'.repeat(600)}`,
  ])('rejects %s', (input) => expect(safeReturnTo(input)).toBe('/app'));
});

describe('ProxyAllowlist', () => {
  const allowlist = new ProxyAllowlist();
  const q = (s = '') => new URLSearchParams(s);

  it('allows the documented endpoints', () => {
    expect(allowlist.match('GET', '/user', q())?.upstreamPath).toBe('/user');
    expect(allowlist.match('POST', '/gists', q())?.route.kind).toBe('gists');
    expect(allowlist.match('PATCH', '/gists/abc123', q())?.upstreamPath).toBe('/gists/abc123');
    expect(allowlist.match('PUT', '/gists/abc123/star', q())?.route.kind).toBe('gist-star');
    expect(allowlist.match('GET', '/gists/starred', q())?.route.kind).toBe('starred');
    expect(allowlist.match('GET', '/users/octo-cat/gists', q())?.route.kind).toBe('user-gists');
  });

  it('refuses everything else, including path tricks', () => {
    for (const [method, path] of [
      ['GET', '/user/repos'],
      ['DELETE', '/user'],
      ['GET', '/gists/../user/repos'],
      ['GET', '/gists/%2e%2e/user'],
      ['GET', '//gists'],
      ['GET', '/gists/abc/commits'],
      ['GET', '/repos/a/b'],
      ['POST', '/gists/abc123'],
      ['GET', '/users/-bad/gists'],
      ['GET', '/gists/abc.json'],
    ] as const) {
      expect(allowlist.match(method, path, q()), `${method} ${path}`).toBeNull();
    }
  });

  it('keeps only known, valid query parameters', () => {
    expect(allowlist.match('GET', '/gists', q('per_page=100&page=2&evil=1'))?.upstreamQuery).toBe(
      '?per_page=100&page=2',
    );
    expect(allowlist.match('GET', '/gists', q('per_page=1000&page=-1'))?.upstreamQuery).toBe('');
  });
});

describe('isTrustedAppRequest', () => {
  const origin = 'https://gistvault.vercel.app';
  const req = (method: string, headers: Record<string, string>) =>
    new Request(`${origin}/api/x`, { method, headers });

  it('needs the custom header', () => {
    expect(isTrustedAppRequest(req('GET', {}), origin)).toBe(false);
    expect(isTrustedAppRequest(req('GET', { 'x-gistvault': '1' }), origin)).toBe(true);
  });

  it('needs a matching Origin for writes and refuses cross-site fetches', () => {
    expect(isTrustedAppRequest(req('POST', { 'x-gistvault': '1' }), origin)).toBe(false);
    expect(
      isTrustedAppRequest(req('POST', { 'x-gistvault': '1', origin: 'https://evil.com' }), origin),
    ).toBe(false);
    expect(isTrustedAppRequest(req('POST', { 'x-gistvault': '1', origin }), origin)).toBe(true);
    expect(
      isTrustedAppRequest(
        req('GET', { 'x-gistvault': '1', 'sec-fetch-site': 'cross-site' }),
        origin,
      ),
    ).toBe(false);
  });
});

describe('config and helpers', () => {
  it('reports missing settings without echoing values', () => {
    const result = readConfig({ GH_CLIENT_SECRET: 'shh', SESSION_SECRET: 'short' });
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain('shh');
  });

  it('rejects a plain-http production origin', () => {
    const base = {
      GH_CLIENT_ID: 'id',
      GH_CLIENT_SECRET: 's',
      SESSION_SECRET: btoa('x'.repeat(32)),
    };
    expect(readConfig({ ...base, APP_ORIGIN: 'http://gistvault.app' }).ok).toBe(false);
    expect(readConfig({ ...base, APP_ORIGIN: 'http://localhost:4200' }).ok).toBe(true);
  });

  it('compares strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});
