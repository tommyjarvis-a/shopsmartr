// Stub for a later, optional encrypted price feed (phase 2). Nothing here ships real prices.
//
// data/prices.enc (absent in this repo) is a JSON envelope:
//   { "v": 1, "kdf": "PBKDF2-SHA256", "iter": <int>, "salt": <b64>, "iv": <b64>, "ct": <b64> }
// ct is AES-256-GCM ciphertext (tag appended, WebCrypto layout) of a UTF-8 JSON document.
// The key is derived from a household passphrase with PBKDF2-SHA256. The derived key is cached on
// this device (IndexedDB, as a non-extractable CryptoKey) so the passphrase is asked for once.
// When the file is absent or anything fails, callers get null and the UI shows nothing.
// Never commit real price data or a passphrase to this repo.

export const PRICES_URL = 'data/prices.enc';
const DB_NAME = 'shopsmartr-keys';
const STORE = 'keys';
const KEY_ID = 'prices-v1';
const MIN_ITER = 100000;

const b64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** Checks the envelope shape; returns an error string or '' when valid. */
export function checkEnvelope(env) {
  if (!env || typeof env !== 'object') return 'not an object';
  if (env.v !== 1) return 'unsupported version';
  if (env.kdf !== 'PBKDF2-SHA256') return 'unsupported kdf';
  if (!Number.isInteger(env.iter) || env.iter < MIN_ITER) return 'iteration count too low';
  for (const k of ['salt', 'iv', 'ct']) if (typeof env[k] !== 'string' || !env[k]) return `${k} missing`;
  return '';
}

export async function deriveKey(passphrase, env, subtle = globalThis.crypto.subtle) {
  const base = await subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: b64(env.salt), iterations: env.iter },
    base, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
}

export async function decryptEnvelope(env, key, subtle = globalThis.crypto.subtle) {
  const pt = await subtle.decrypt({ name: 'AES-GCM', iv: b64(env.iv) }, key, b64(env.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

/** Fetches the envelope; null when the file is absent or malformed. */
export async function fetchEnvelope(url = PRICES_URL, fetchFn = globalThis.fetch) {
  try {
    const r = await fetchFn(url, { cache: 'no-cache' });
    if (!r.ok) return null;
    const env = await r.json();
    return checkEnvelope(env) ? null : env;
  } catch { return null; }
}

// --- device key cache (IndexedDB holds the CryptoKey object; it is not extractable) ---
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { resolve(null); return; }
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => { open.result.close(); resolve(req?.result ?? null); };
      tx.onerror = () => { open.result.close(); reject(tx.error); };
    };
  });
}
export const getCachedKey = () => idb('readonly', (s) => s.get(KEY_ID)).catch(() => null);
export const cacheKey = (key) => idb('readwrite', (s) => s.put(key, KEY_ID)).catch(() => null);
export const forgetKey = () => idb('readwrite', (s) => s.delete(KEY_ID)).catch(() => null);

/**
 * Loads prices if available. askPassphrase() is only called when the file exists and no cached key
 * works. Returns the decrypted document, or null (file absent, cancelled, or wrong passphrase).
 */
export async function loadPrices({ askPassphrase, url = PRICES_URL, fetchFn } = {}) {
  const env = await fetchEnvelope(url, fetchFn);
  if (!env) return null;
  const cached = await getCachedKey();
  if (cached) {
    try { return await decryptEnvelope(env, cached); } catch { await forgetKey(); }
  }
  if (typeof askPassphrase !== 'function') return null;
  const pass = await askPassphrase();
  if (!pass) return null;
  try {
    const key = await deriveKey(pass, env);
    const doc = await decryptEnvelope(env, key);
    await cacheKey(key);
    return doc;
  } catch { return null; }
}
