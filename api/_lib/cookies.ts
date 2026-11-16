export const OAUTH_COOKIE = '__Host-gv_oauth';
export const SESSION_COOKIE = '__Host-gv_session';

/** Browsers drop cookies over about 4 KB; stay well under. */
export const MAX_COOKIE_VALUE = 3800;

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

/** `__Host-` cookies must be Secure, Path=/ and have no Domain, so they can't be set by subdomains. */
export function serializeCookie(name: string, value: string, maxAgeSeconds: number): string {
  if (value.length > MAX_COOKIE_VALUE) throw new Error(`Cookie ${name} is too large`);
  const maxAge = Math.max(0, Math.floor(maxAgeSeconds));
  return `${name}=${value}; Max-Age=${maxAge}; Path=/; Secure; HttpOnly; SameSite=Lax`;
}

export function clearCookie(name: string): string {
  return `${name}=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax`;
}
