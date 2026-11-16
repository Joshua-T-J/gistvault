import { REFRESH_WINDOW_MS } from './auth-controller';
import type { ApiConfig } from './config';
import { isTrustedAppRequest } from './csrf';
import { byteLength } from './encoding';
import { GITHUB_API, GITHUB_API_VERSION, USER_AGENT } from './github-oauth';
import { ProxyAllowlist } from './proxy-allowlist';
import { baseHeaders, errorJson } from './responses';
import type { SessionStore } from './session-store';

/** Stays under Vercel's 4.5 MB request limit, with room for headers. */
export const MAX_BODY_BYTES = 4 * 1024 * 1024;
export const COLLECTION_MARKER = '[gistvault-collection:v1]';

const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'etag',
  'last-modified',
  'link',
  'retry-after',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'x-ratelimit-used',
  'x-ratelimit-resource',
  'x-accepted-github-permissions',
  'x-github-request-id',
] as const;

const BODY_METHODS = new Set(['POST', 'PATCH', 'PUT']);
const API_VERSION = /^\d{4}-\d{2}-\d{2}$/;

type FetchFn = typeof fetch;

/** /api/gh/*: forwards allowlisted calls to api.github.com with the session's token. */
export class GitHubProxy {
  readonly #allowlist = new ProxyAllowlist();

  constructor(
    private readonly config: ApiConfig,
    private readonly sessions: SessionStore,
    private readonly fetchFn: FetchFn,
    private readonly now: () => number,
  ) {}

  async handle(request: Request, path: string, query: URLSearchParams): Promise<Response> {
    if (!isTrustedAppRequest(request, this.config.appOrigin)) return errorJson(403, 'forbidden');

    const session = await this.sessions.read(request);
    if (!session) return errorJson(401, 'signed_out', [this.sessions.clear()]);
    if (session.ae - this.now() < REFRESH_WINDOW_MS) return errorJson(401, 'token_expired');

    const match = this.#allowlist.match(request.method, path, query);
    if (!match) return errorJson(404, 'not_found');

    const body = await this.#readBody(request);
    if (body instanceof Response) return body;

    if (request.method === 'DELETE' && match.route.kind === 'gist') {
      const allowed = await this.#isCollection(match.route.gistId, session.at);
      if (allowed !== true)
        return allowed === false ? errorJson(403, 'delete_not_allowed') : allowed;
    }

    let upstream: Response;
    try {
      upstream = await this.fetchFn(`${GITHUB_API}${match.upstreamPath}${match.upstreamQuery}`, {
        method: request.method,
        headers: this.#upstreamHeaders(request, session.at, body !== undefined),
        body,
        redirect: 'manual',
      });
    } catch {
      return errorJson(502, 'upstream');
    }
    return this.#relay(upstream);
  }

  async #readBody(request: Request): Promise<string | undefined | Response> {
    if (!BODY_METHODS.has(request.method)) return undefined;
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES) return errorJson(413, 'too_large');
    const text = await request.text();
    if (byteLength(text) > MAX_BODY_BYTES) return errorJson(413, 'too_large');
    if (!text) return undefined;
    const type = request.headers.get('content-type') ?? '';
    if (!type.toLowerCase().startsWith('application/json')) return errorJson(415, 'json_only');
    return text;
  }

  /**
   * Only gists published as GistVault collections may be deleted through the proxy,
   * so an injected script can't wipe the user's other gists.
   */
  async #isCollection(gistId: string, token: string): Promise<boolean | Response> {
    try {
      const res = await this.fetchFn(`${GITHUB_API}/gists/${gistId}`, {
        headers: this.#baseUpstreamHeaders(token),
        redirect: 'manual',
      });
      if (!res.ok) return this.#relay(res);
      const gist = (await res.json()) as { description?: unknown };
      return typeof gist.description === 'string' && gist.description.includes(COLLECTION_MARKER);
    } catch {
      return errorJson(502, 'upstream');
    }
  }

  #baseUpstreamHeaders(token: string, version = GITHUB_API_VERSION): Headers {
    return new Headers({
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': version,
      'User-Agent': USER_AGENT,
    });
  }

  #upstreamHeaders(request: Request, token: string, hasBody: boolean): Headers {
    const requested = request.headers.get('x-github-api-version') ?? '';
    const headers = this.#baseUpstreamHeaders(
      token,
      API_VERSION.test(requested) ? requested : undefined,
    );
    const etag = request.headers.get('if-none-match');
    if (etag && etag.length < 200) headers.set('If-None-Match', etag);
    if (hasBody) headers.set('Content-Type', 'application/json');
    return headers;
  }

  #relay(upstream: Response): Response {
    const headers = baseHeaders();
    for (const name of FORWARD_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    const empty = upstream.status === 204 || upstream.status === 304;
    return new Response(empty ? null : upstream.body, { status: upstream.status, headers });
  }
}
