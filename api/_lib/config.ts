import { fromBase64 } from './encoding';

export interface ApiConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly sessionSecret: Uint8Array<ArrayBuffer>;
  /** Exact origin the app is served from, e.g. https://gistvault.vercel.app. */
  readonly appOrigin: string;
}

export type ConfigResult = { ok: true; config: ApiConfig } | { ok: false; problems: string[] };

export type Env = Readonly<Record<string, string | undefined>>;

const MIN_SECRET_BYTES = 32;

/** Reads and validates the function's environment. Never echoes secret values. */
export function readConfig(env: Env): ConfigResult {
  const problems: string[] = [];
  const clientId = env['GH_CLIENT_ID']?.trim() ?? '';
  const clientSecret = env['GH_CLIENT_SECRET']?.trim() ?? '';
  const rawSecret = env['SESSION_SECRET']?.trim() ?? '';
  const appOrigin = normaliseOrigin(env['APP_ORIGIN']);

  if (!clientId) problems.push('GH_CLIENT_ID is not set');
  if (!clientSecret) problems.push('GH_CLIENT_SECRET is not set');
  if (!appOrigin) problems.push('APP_ORIGIN must be an https origin (or http://localhost)');

  let sessionSecret = new Uint8Array(0);
  try {
    sessionSecret = fromBase64(rawSecret);
  } catch {
    // Reported below.
  }
  if (sessionSecret.byteLength < MIN_SECRET_BYTES) {
    problems.push(`SESSION_SECRET must be at least ${MIN_SECRET_BYTES} random bytes, base64`);
  }

  if (problems.length || !appOrigin) return { ok: false, problems };
  return { ok: true, config: { clientId, clientSecret, sessionSecret, appOrigin } };
}

function normaliseOrigin(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw.trim());
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) return null;
    return url.origin;
  } catch {
    return null;
  }
}
