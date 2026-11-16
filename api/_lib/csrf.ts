export const CSRF_HEADER = 'x-gistvault';
const SAFE_METHODS = new Set(['GET', 'HEAD']);

/**
 * Every call the app makes to /api/gh and to state-changing /api/auth routes carries
 * `X-GistVault: 1`. A cross-site form or image can't set a custom header, and a cross-site
 * fetch that sets one needs a CORS preflight this function never approves.
 * State-changing requests must also come from the app's own origin.
 */
export function isTrustedAppRequest(request: Request, appOrigin: string): boolean {
  if (request.headers.get(CSRF_HEADER) !== '1') return false;

  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;

  if (SAFE_METHODS.has(request.method)) return true;
  return request.headers.get('origin') === appOrigin;
}
