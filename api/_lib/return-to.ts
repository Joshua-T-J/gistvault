export const DEFAULT_RETURN_TO = '/app';

const MAX_LENGTH = 512;
const ALLOWED_PREFIX = /^\/(?:app|c|explore)(?:[/?#]|$)/;
const CONTROL_OR_BACKSLASH = /[\\\x00-\x1f\x7f]/;
const PROBE_ORIGIN = 'https://return-to.invalid';

/**
 * Only same-site paths under /app, /c/ or /explore survive; anything else becomes /app.
 * Blocks open redirects such as //evil.com, /\evil.com and their percent-encoded forms.
 */
export function safeReturnTo(raw: string | null | undefined): string {
  if (!raw || raw.length > MAX_LENGTH) return DEFAULT_RETURN_TO;
  if (!raw.startsWith('/') || raw.startsWith('//') || CONTROL_OR_BACKSLASH.test(raw)) {
    return DEFAULT_RETURN_TO;
  }

  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return DEFAULT_RETURN_TO;
  }
  if (
    decoded.startsWith('//') ||
    CONTROL_OR_BACKSLASH.test(decoded) ||
    /(^|\/)\.\.?(\/|$)/.test(decoded)
  ) {
    return DEFAULT_RETURN_TO;
  }

  let url: URL;
  try {
    url = new URL(raw, PROBE_ORIGIN);
  } catch {
    return DEFAULT_RETURN_TO;
  }
  if (url.origin !== PROBE_ORIGIN) return DEFAULT_RETURN_TO;

  const path = `${url.pathname}${url.search}${url.hash}`;
  return ALLOWED_PREFIX.test(path) ? path : DEFAULT_RETURN_TO;
}
