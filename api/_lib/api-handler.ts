import { AuthController } from './auth-controller';
import { ApiConfig, Env, readConfig } from './config';
import { GitHubOAuthClient } from './github-oauth';
import { GitHubProxy } from './github-proxy';
import { errorJson, json, redirect } from './responses';
import { SessionStore } from './session-store';

export interface ApiDeps {
  env: Env;
  fetch: typeof fetch;
  now: () => number;
}

export type ApiHandler = (request: Request) => Promise<Response>;

/** Query parameter the vercel.json rewrite uses to pass the original path, if the platform hides it. */
export const PATH_PARAM = '__path';

interface Controllers {
  auth: AuthController;
  proxy: GitHubProxy;
}

/**
 * The single entry point for /api/*. Routes by path; everything not listed is a 404.
 * Built once per function instance, then reused across requests.
 */
export function createApiHandler(deps: ApiDeps): ApiHandler {
  const result = readConfig(deps.env);
  if (!result.ok) {
    console.error('api.config', result.problems.join('; '));
    return async (request) => notConfigured(request);
  }

  let controllers: Promise<Controllers> | null = null;
  const build = (config: ApiConfig): Promise<Controllers> =>
    (controllers ??= SessionStore.create(config, deps.now).then((sessions) => ({
      auth: new AuthController(
        config,
        sessions,
        new GitHubOAuthClient(config, deps.fetch, deps.now),
        deps.now,
      ),
      proxy: new GitHubProxy(config, sessions, deps.fetch, deps.now),
    })));

  return async (request) => {
    try {
      const { auth, proxy } = await build(result.config);
      const { route, query } = resolveRoute(new URL(request.url));
      const method = request.method;

      if (route.startsWith('/gh/')) return await proxy.handle(request, route.slice(3), query);

      switch (route) {
        case '/auth/login':
          return method === 'GET'
            ? await auth.login(withQuery(request.url, query))
            : notAllowed('GET');
        case '/auth/callback':
          return method === 'GET'
            ? await auth.callback(request, withQuery(request.url, query))
            : notAllowed('GET');
        case '/auth/session':
          return method === 'GET' ? await auth.session(request) : notAllowed('GET');
        case '/auth/refresh':
          return method === 'POST' ? await auth.refresh(request) : notAllowed('POST');
        case '/auth/logout':
          return method === 'POST' ? await auth.logout(request) : notAllowed('POST');
        default:
          return errorJson(404, 'not_found');
      }
    } catch (err) {
      console.error('api.unhandled', err instanceof Error ? err.name : 'unknown');
      return errorJson(500, 'internal');
    }
  };
}

/** Works whether the platform passes the original path or only the rewrite's `__path` parameter. */
export function resolveRoute(url: URL): { route: string; query: URLSearchParams } {
  const query = new URLSearchParams(url.search);
  const passed = query.get(PATH_PARAM);
  query.delete(PATH_PARAM);
  if (url.pathname.startsWith('/api/')) return { route: url.pathname.slice(4), query };
  return { route: passed ? `/${passed.replace(/^\/+/, '')}` : '/', query };
}

function withQuery(requestUrl: string, query: URLSearchParams): URL {
  const url = new URL(requestUrl);
  url.search = query.toString();
  return url;
}

function notAllowed(allow: string): Response {
  const res = errorJson(405, 'method_not_allowed');
  res.headers.set('Allow', allow);
  return res;
}

function notConfigured(request: Request): Response {
  const { route } = resolveRoute(new URL(request.url));
  if (route === '/auth/login') return redirect('/app/connect?signin=unavailable');
  return json(503, { error: 'not_configured' });
}
