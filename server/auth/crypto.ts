const enc = new TextEncoder();

export function bytesToB64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function randomId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Length-independent equality. An empty expected token never matches. */
export function safeEqual(a: string, b: string): boolean {
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const hmacKeys = new Map<string, Promise<CryptoKey>>();

/** One imported HMAC key per secret, reused for the life of the isolate. */
export function hmacKey(secret: string): Promise<CryptoKey> {
  let pending = hmacKeys.get(secret);
  if (!pending) {
    pending = crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
    hmacKeys.set(secret, pending);
  }
  return pending;
}

export async function hmacB64url(secret: string, data: string): Promise<string> {
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), enc.encode(data));
  return bytesToB64url(new Uint8Array(sig));
}

/** Better Auth session cookies: standard base64 (padded) HMAC-SHA256, checked with WebCrypto verify. */
export async function hmacVerifyB64(secret: string, data: string, signatureB64: string): Promise<boolean> {
  let bytes: Uint8Array;
  try {
    const bin = atob(signatureB64);
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch {
    return false;
  }
  return crypto.subtle.verify('HMAC', await hmacKey(secret), bytes, enc.encode(data));
}

/** Salted SHA-256 hex. The raw IP is an input only and is not part of the result. */
export async function saltedHash(salt: string, value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', enc.encode(`${salt}:${value}`));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
