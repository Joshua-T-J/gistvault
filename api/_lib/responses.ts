const BASE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
};

export function baseHeaders(cookies: readonly string[] = []): Headers {
  const headers = new Headers(BASE_HEADERS);
  for (const cookie of cookies) headers.append('Set-Cookie', cookie);
  return headers;
}

export function json(status: number, body: unknown, cookies: readonly string[] = []): Response {
  const headers = baseHeaders(cookies);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  return new Response(JSON.stringify(body), { status, headers });
}

export function redirect(location: string, cookies: readonly string[] = []): Response {
  const headers = baseHeaders(cookies);
  headers.set('Location', location);
  return new Response(null, { status: 302, headers });
}

export function errorJson(
  status: number,
  error: string,
  cookies: readonly string[] = [],
): Response {
  return json(status, { error }, cookies);
}
