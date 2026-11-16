export type ProxyRoute =
  | { kind: 'user' }
  | { kind: 'gists' }
  | { kind: 'gist'; gistId: string }
  | { kind: 'gist-star'; gistId: string }
  | { kind: 'starred' }
  | { kind: 'user-gists'; login: string };

export interface ProxyMatch {
  route: ProxyRoute;
  /** Path on api.github.com, rebuilt from validated parts only. */
  upstreamPath: string;
  /** Query string with only known, validated parameters ('' when none). */
  upstreamQuery: string;
}

interface Rule {
  pattern: RegExp;
  methods: ReadonlySet<string>;
  build(match: RegExpExecArray): { route: ProxyRoute; upstreamPath: string };
}

const GIST_ID = '([A-Za-z0-9]{1,64})';
const LOGIN = '([A-Za-z0-9](?:[A-Za-z0-9-]{0,38}))';
/** Plain segments of letters, digits, '-' and '_' only: no dots, percent signs or empty segments. */
const SAFE_PATH = /^(?:\/[A-Za-z0-9_-]+)+$/;

const RULES: readonly Rule[] = [
  {
    pattern: /^\/user$/,
    methods: new Set(['GET']),
    build: () => ({ route: { kind: 'user' }, upstreamPath: '/user' }),
  },
  {
    pattern: /^\/gists$/,
    methods: new Set(['GET', 'POST']),
    build: () => ({ route: { kind: 'gists' }, upstreamPath: '/gists' }),
  },
  {
    pattern: /^\/gists\/starred$/,
    methods: new Set(['GET']),
    build: () => ({ route: { kind: 'starred' }, upstreamPath: '/gists/starred' }),
  },
  {
    pattern: new RegExp(`^/gists/${GIST_ID}/star$`),
    methods: new Set(['GET', 'PUT', 'DELETE']),
    build: (m) => {
      const gistId = m[1] ?? '';
      return { route: { kind: 'gist-star', gistId }, upstreamPath: `/gists/${gistId}/star` };
    },
  },
  {
    pattern: new RegExp(`^/gists/${GIST_ID}$`),
    methods: new Set(['GET', 'PATCH', 'DELETE']),
    build: (m) => {
      const gistId = m[1] ?? '';
      return { route: { kind: 'gist', gistId }, upstreamPath: `/gists/${gistId}` };
    },
  },
  {
    pattern: new RegExp(`^/users/${LOGIN}/gists$`),
    methods: new Set(['GET']),
    build: (m) => {
      const login = m[1] ?? '';
      return { route: { kind: 'user-gists', login }, upstreamPath: `/users/${login}/gists` };
    },
  },
];

const QUERY_RULES: Readonly<Record<string, RegExp>> = {
  per_page: /^(?:[1-9]|[1-9][0-9]|100)$/,
  page: /^[1-9][0-9]{0,3}$/,
  since: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/,
};

/**
 * The only GitHub endpoints the proxy forwards. Everything else is a 404, so the function
 * can't be used as an open proxy to the rest of the GitHub API with the user's token.
 */
export class ProxyAllowlist {
  match(method: string, path: string, query: URLSearchParams): ProxyMatch | null {
    if (!SAFE_PATH.test(path)) return null;
    for (const rule of RULES) {
      const found = rule.pattern.exec(path);
      if (!found) continue;
      if (!rule.methods.has(method)) return null;
      return { ...rule.build(found), upstreamQuery: this.#cleanQuery(query) };
    }
    return null;
  }

  #cleanQuery(query: URLSearchParams): string {
    const kept = new URLSearchParams();
    for (const [name, rule] of Object.entries(QUERY_RULES)) {
      const value = query.get(name);
      if (value !== null && rule.test(value)) kept.set(name, value);
    }
    const text = kept.toString();
    return text ? `?${text}` : '';
  }
}
