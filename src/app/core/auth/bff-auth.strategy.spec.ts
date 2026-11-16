import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { BffAuthStrategy } from './bff-auth.strategy';

const HOUR = 3600 * 1000;
const session = (expiresInMs: number) => ({
  login: 'octocat',
  name: 'Octo Cat',
  avatarUrl: '',
  expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  refreshExpiresAt: new Date(Date.now() + 1000 * HOUR).toISOString(),
});

/** Lets pending promise callbacks run so the next HTTP request is issued. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('BffAuthStrategy', () => {
  let strategy: BffAuthStrategy;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), BffAuthStrategy],
    });
    strategy = TestBed.inject(BffAuthStrategy);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends the CSRF header and never a token', () => {
    expect(strategy.authHeaders()).toEqual({ 'X-GistVault': '1' });
    expect(strategy.apiBase).toBe('/api/gh');
  });

  it('marks sign-in available and restores a session', async () => {
    const restored = strategy.restore();
    http.expectOne('/api/auth/session').flush(session(8 * HOUR));
    expect(await restored).toBe(true);
    expect(strategy.availability()).toBe('available');
    expect(strategy.session()?.login).toBe('octocat');
  });

  it('treats a JSON 401 as signed out but available', async () => {
    const restored = strategy.restore();
    http
      .expectOne('/api/auth/session')
      .flush({ error: 'signed_out' }, { status: 401, statusText: 'Unauthorized' });
    expect(await restored).toBe(false);
    expect(strategy.availability()).toBe('available');
  });

  it('treats an HTML page (no function on this host) as unavailable', async () => {
    const probe = strategy.probe();
    http.expectOne('/api/auth/session').flush('<!doctype html><html></html>');
    expect(await probe).toBeNull();
    expect(strategy.availability()).toBe('unavailable');
  });

  it('treats a missing configuration as unavailable', async () => {
    const probe = strategy.probe();
    http
      .expectOne('/api/auth/session')
      .flush({ error: 'not_configured' }, { status: 503, statusText: 'Unavailable' });
    await probe;
    expect(strategy.availability()).toBe('unavailable');
  });

  it('just retries when another tab already refreshed the token', async () => {
    const restored = strategy.restore();
    http.expectOne('/api/auth/session').flush(session(2 * 60 * 1000));
    await restored;

    const refreshed = strategy.tryRefresh();
    await settle();
    http.expectOne('/api/auth/session').flush(session(8 * HOUR));
    expect(await refreshed).toBe(true);
    http.expectNone('/api/auth/refresh');
  });

  it('refreshes when the token is about to expire', async () => {
    const refreshed = strategy.tryRefresh();
    await settle();
    http.expectOne('/api/auth/session').flush(session(60 * 1000));
    await settle();
    const req = http.expectOne('/api/auth/refresh');
    expect(req.request.headers.get('X-GistVault')).toBe('1');
    expect(req.request.body).toEqual({ force: false });
    req.flush(session(8 * HOUR));
    expect(await refreshed).toBe(true);
  });

  it('forces a rotation when GitHub rejects a token that should still be valid', async () => {
    const restored = strategy.restore();
    const current = session(6 * HOUR);
    http.expectOne('/api/auth/session').flush(current);
    await restored;

    const refreshed = strategy.tryRefresh();
    await settle();
    http.expectOne('/api/auth/session').flush(current);
    await settle();
    const req = http.expectOne('/api/auth/refresh');
    expect(req.request.body).toEqual({ force: true });
    req.flush({ error: 'refresh_failed' }, { status: 401, statusText: 'Unauthorized' });
    expect(await refreshed).toBe(false);
  });

  it('reports failure when signed out', async () => {
    const refreshed = strategy.tryRefresh();
    await settle();
    http
      .expectOne('/api/auth/session')
      .flush({ error: 'signed_out' }, { status: 401, statusText: 'Unauthorized' });
    expect(await refreshed).toBe(false);
  });

  it('signs out with the CSRF header and an optional revoke', async () => {
    const done = strategy.logout({ revoke: true });
    const req = http.expectOne('/api/auth/logout');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ revoke: true });
    expect(req.request.headers.get('X-GistVault')).toBe('1');
    req.flush({ revoked: true });
    await done;
    expect(strategy.session()).toBeNull();
  });
});
