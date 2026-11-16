const encoder = new TextEncoder();

export function utf8(text: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(text);
}

export function byteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Decodes standard or URL-safe base64. Throws on malformed input. */
export function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const normalised = text.trim().replace(/-/g, '+').replace(/_/g, '/');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalised)) throw new Error('Invalid base64');
  const padded = normalised.padEnd(Math.ceil(normalised.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A URL-safe random string with `bytes` bytes of entropy. */
export function randomToken(bytes = 32): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256Base64Url(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(text));
  return toBase64Url(new Uint8Array(digest));
}

/** Compares two strings in time that depends only on their length. */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = utf8(a);
  const right = utf8(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}
