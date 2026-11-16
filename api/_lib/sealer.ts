import { fromBase64, toBase64Url, utf8 } from './encoding';

const VERSION = 'v1';
const IV_BYTES = 12;
const SALT = utf8('gistvault/cookie-seal/v1');

/**
 * Encrypts and authenticates small JSON values for cookies (AES-256-GCM).
 * Each purpose gets its own HKDF-derived key and is bound as associated data,
 * so a value sealed for one cookie can never be opened as another.
 */
export class Sealer {
  private constructor(
    private readonly key: CryptoKey,
    private readonly purpose: string,
  ) {}

  static async create(secret: Uint8Array<ArrayBuffer>, purpose: string): Promise<Sealer> {
    const base = await crypto.subtle.importKey('raw', secret, 'HKDF', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: SALT, info: utf8(purpose) },
      base,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    );
    return new Sealer(key, purpose);
  }

  async seal(value: unknown): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
    const cipher = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv, additionalData: utf8(this.purpose) },
      this.key,
      utf8(JSON.stringify(value)),
    );
    const out = new Uint8Array(IV_BYTES + cipher.byteLength);
    out.set(iv);
    out.set(new Uint8Array(cipher), IV_BYTES);
    return `${VERSION}.${toBase64Url(out)}`;
  }

  /** Returns the value only if it decrypts, authenticates and passes `guard`; otherwise null. */
  async open<T>(
    sealed: string | undefined,
    guard: (value: unknown) => value is T,
  ): Promise<T | null> {
    if (!sealed?.startsWith(`${VERSION}.`)) return null;
    try {
      const bytes = fromBase64(sealed.slice(VERSION.length + 1));
      if (bytes.byteLength <= IV_BYTES) return null;
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: bytes.slice(0, IV_BYTES), additionalData: utf8(this.purpose) },
        this.key,
        bytes.slice(IV_BYTES),
      );
      const value: unknown = JSON.parse(new TextDecoder().decode(plain));
      return guard(value) ? value : null;
    } catch {
      return null;
    }
  }
}
