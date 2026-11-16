import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { GitHubError } from '../github/github-errors';
import {
  apiVersionInterceptor,
  authInterceptor,
  errorInterceptor,
  rateLimitInterceptor,
} from '../http/interceptors';
import { ActiveAuthStrategy } from './active-auth.strategy';
import { AUTH_STRATEGY } from './auth-strategy';
import { AuthStore } from './auth.store';
import { BffAuthStrategy } from './bff-auth.strategy';
import { PatAuthStrategy } from './pat-auth.strategy';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const HOUR = 3600 * 1000;
const sessionDto = (expiresInMs: number) => ({
  login: 'octocat',
  name: null,
  avatarUrl: '',
  expiresAt: new Date(Date.now() + expiresInMs).toISOString(),
  refreshExpiresAt: new Date(Date.now() + 1000 * HOUR).toISOString(),
});

describe('ActiveAuthStrategy with the interceptors', () => {
  let active: ActiveAuthStrategy;
  let http: HttpTestingController;
  let client: HttpClient;
  let store: AuthStore;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(
          withInterceptors([
            apiVersionInterceptor,
            errorInterceptor,
            authInterceptor,
            rateLimitInterceptor,
          ]),
        ),
        provideHttpClientTesting(),
        PatAuthStrategy,
        BffAuthStrategy,
        ActiveAuthStrategy,
        { provide: AUTH_STRATEGY, useExisting: ActiveAuthStrategy },
      ],
    });
    active = TestBed.inject(ActiveAuthStrategy);
    http = TestBed.inject(HttpTestingController);
    client = TestBed.inject(HttpClient);
    store = TestBed.inject(AuthStore);
  });

  afterEach(() => http.verify());

  async function restoreGitHubSession(): Promise<void> {
    const restored = active.restore();
    await settle();
    http.expectOne('/api/auth/session').flush(sessionDto(6 * HOUR));
    expect(await restored).toBe(true);
  }

  it('prefers a token remembered for this tab', async () => {
    sessionStorage.setItem('gistvault.pat', 'github_pat_' + 'a'.repeat(30));
    expect(await active.restore()).toBe(true);
    expect(active.kind).toBe('pat');
    expect(active.apiBase).toBe('https://api.github.com');
  });

  it('switches to the GitHub session and routes requests through the proxy', async () => {
    await restoreGitHubSession();
    expect(active.kind).toBe('bff');

    const user = firstValueFrom(client.get('/api/gh/user'));
    const req = http.expectOne('/api/gh/user');
    expect(req.request.headers.get('X-GistVault')).toBe('1');
    expect(req.request.headers.has('Authorization')).toBe(false);
    expect(req.request.headers.get('X-GitHub-Api-Version')).toBe('2026-03-10');
    req.flush({ login: 'octocat' });
    expect(await user).toEqual({ login: 'octocat' });
  });

  it('refreshes once on 401 and retries the request', async () => {
    await restoreGitHubSession();
    const user = firstValueFrom(client.get('/api/gh/user'));
    http
      .expectOne('/api/gh/user')
      .flush({ error: 'token_expired' }, { status: 401, statusText: 'Unauthorized' });
    await settle();
    // Another tab already refreshed: the session now has a later expiry.
    http.expectOne('/api/auth/session').flush(sessionDto(8 * HOUR));
    await settle();
    http.expectOne('/api/gh/user').flush({ login: 'octocat' });
    expect(await user).toEqual({ login: 'octocat' });
    expect(store.expired()).toBe(false);
  });

  it('marks the session expired when the retry is also refused', async () => {
    await restoreGitHubSession();
    const user = firstValueFrom(client.get('/api/gh/user'));
    http.expectOne('/api/gh/user').flush({}, { status: 401, statusText: 'Unauthorized' });
    await settle();
    http.expectOne('/api/auth/session').flush(sessionDto(8 * HOUR));
    await settle();
    http.expectOne('/api/gh/user').flush({}, { status: 401, statusText: 'Unauthorized' });

    const err = await user.catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect((err as GitHubError).message).toContain('sign in again');
    expect(store.expired()).toBe(true);
  });

  it('maps 413 from the proxy to a clear message', async () => {
    await restoreGitHubSession();
    const save = firstValueFrom(client.patch('/api/gh/gists/abc', {}));
    http
      .expectOne('/api/gh/gists/abc')
      .flush({ error: 'too_large' }, { status: 413, statusText: 'Too Large' });
    const err = (await save.catch((e: unknown) => e)) as GitHubError;
    expect(err.kind).toBe('too-large');
  });

  it('goes back to the token path after signing out', async () => {
    await restoreGitHubSession();
    const done = active.logout();
    http.expectOne('/api/auth/logout').flush({ revoked: false });
    await done;
    expect(active.kind).toBe('pat');
  });
});
