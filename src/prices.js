// Optional encrypted price feed. Must stay byte-compatible with decryptJSON() in the private
// shopsmartr-data repo (src/crypto.mjs). Nothing here contains price data or a passphrase.
//
// data/prices.enc is a JSON envelope (all binary fields standard base64):
//   { v: 1, kdf: "PBKDF2-SHA256", iter: 600000, alg: "AES-GCM-256",
//     aad: "shopsmartr.prices.enc/v1", salt: <16 bytes>, iv: <12 bytes>, ct: <ciphertext + 16-byte tag> }
// Key = PBKDF2-SHA256(passphrase.normalize('NFC'), salt, iter) -> AES-GCM 256.
// Decrypt = AES-GCM(iv, additionalData = UTF-8(aad || default), tagLength 128).
// The plaintext is UTF-8 JSON (schema "shopsmartr.prices/v1").
//
// Device cache (IndexedDB, CryptoKey objects are stored non-extractable, never the passphrase):
//   - "base": the PBKDF2 key imported from the passphrase, so a refreshed feed (new salt) can be
//     unlocked without asking again;
//   - "aes":  the derived AES key plus the salt/iter it belongs to, so normal loads skip the
//     600k-iteration derivation.
// If data/prices.enc is absent (404) or malformed, loadEnvelope() returns null and the UI stays hidden.

export const PRICES_URL = 'data/prices.enc';
export const DEFAULT_AAD = 'shopsmartr.prices.enc/v1';
export const MIN_ITER = 600000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const subtleOf = (s) => s || globalThis.crypto.subtle;
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export class WrongPassphraseError extends Error {
  constructor() { super('Wrong passphrase'); this.name = 'WrongPassphraseError'; }
}

/** Returns '' when the envelope is usable, otherwise the reason. */
export function checkEnvelope(env) {
  if (!env || typeof env !== 'object') return 'not an object';
  if (env.v !== 1 || env.kdf !== 'PBKDF2-SHA256') return 'Unsupported envelope';
  if (env.alg !== undefined && env.alg !== 'AES-GCM-256') return 'unsupported alg';
  if (!Number.isInteger(env.iter) || env.iter < MIN_ITER) return 'iteration count too low';
  if (env.aad !== undefined && typeof env.aad !== 'string') return 'bad aad';
  for (const k of ['salt', 'iv', 'ct']) if (typeof env[k] !== 'string' || !env[k]) return `${k} missing`;
  try {
    if (unb64(env.salt).length < 16) return 'salt too short';
    if (unb64(env.iv).length !== 12) return 'iv must be 12 bytes';
    if (unb64(env.ct).length < 17) return 'ct too short';
  } catch { return 'bad base64'; }
  return '';
}

export function importPassphrase(passphrase, subtle) {
  return subtleOf(subtle).importKey('raw', enc.encode(String(passphrase).normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
}

export function deriveFromBase(baseKey, env, subtle) {
  return subtleOf(subtle).deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: unb64(env.salt), iterations: env.iter },
    baseKey, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
}

export async function deriveKey(passphrase, env, subtle) {
  return deriveFromBase(await importPassphrase(passphrase, subtle), env, subtle);
}

/** Decrypts with an AES key. Throws WrongPassphraseError on an authentication failure. */
export async function decryptWithKey(env, key, subtle) {
  let pt;
  try {
    pt = await subtleOf(subtle).decrypt(
      { name: 'AES-GCM', iv: unb64(env.iv), additionalData: enc.encode(env.aad || DEFAULT_AAD), tagLength: 128 },
      key, unb64(env.ct),
    );
  } catch { throw new WrongPassphraseError(); }
  return JSON.parse(dec.decode(pt));
}

/** Same contract as the reference decryptJSON(env, passphrase). */
export async function decryptJSON(env, passphrase, subtle) {
  const why = checkEnvelope(env);
  if (why) throw new Error(why);
  return decryptWithKey(env, await deriveKey(passphrase, env, subtle), subtle);
}

/** Fetches the envelope; null when absent (404 etc.), unreachable, or malformed. */
export async function loadEnvelope(url = PRICES_URL, fetchFn = globalThis.fetch) {
  try {
    const r = await fetchFn(url, { cache: 'no-cache' });
    if (!r.ok) return null;
    const env = await r.json();
    return checkEnvelope(env) ? null : env;
  } catch { return null; }
}

// ---------- device key cache ----------
const DB = 'shopsmartr-keys';
const STORE = 'keys';

/** IndexedDB-backed cache; pass memoryKeyCache() in tests. All methods fail soft. */
export function idbKeyCache(idb = globalThis.indexedDB) {
  const run = (mode, fn) => new Promise((resolve) => {
    if (!idb) { resolve(null); return; }
    let open;
    try { open = idb.open(DB, 1); } catch { resolve(null); return; }
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => resolve(null);
    open.onsuccess = () => {
      try {
        const tx = open.result.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => { open.result.close(); resolve(req?.result ?? null); };
        tx.onerror = () => { open.result.close(); resolve(null); };
      } catch { open.result.close(); resolve(null); }
    };
  });
  return {
    get: (k) => run('readonly', (s) => s.get(k)),
    set: (k, v) => run('readwrite', (s) => s.put(v, k)),
    clear: () => run('readwrite', (s) => s.clear()),
  };
}

export function memoryKeyCache() {
  const m = new Map();
  return { get: async (k) => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); }, clear: async () => { m.clear(); } };
}

const sameParams = (a, env) => a && a.salt === env.salt && a.iter === env.iter;

/** Tries cached keys only (no prompt). Returns the document, or null if a passphrase is needed. */
export async function unlockWithCache(env, cache = idbKeyCache(), subtle) {
  const aes = await cache.get('aes');
  if (sameParams(aes, env)) {
    try { return await decryptWithKey(env, aes.key, subtle); } catch { /* stale; fall through */ }
  }
  const base = await cache.get('base');
  if (base) {
    try {
      const key = await deriveFromBase(base, env, subtle);
      const doc = await decryptWithKey(env, key, subtle);
      await cache.set('aes', { key, salt: env.salt, iter: env.iter });
      return doc;
    } catch { await cache.clear(); }
  }
  return null;
}

/** Unlocks with a typed passphrase; caches keys on success. Throws WrongPassphraseError. */
export async function unlockWithPassphrase(env, passphrase, cache = idbKeyCache(), subtle) {
  if (!passphrase) throw new WrongPassphraseError();
  const base = await importPassphrase(passphrase, subtle);
  const key = await deriveFromBase(base, env, subtle);
  const doc = await decryptWithKey(env, key, subtle);
  await cache.set('base', base);
  await cache.set('aes', { key, salt: env.salt, iter: env.iter });
  return doc;
}

export const forgetKeys = (cache = idbKeyCache()) => cache.clear();

/** Pure helper for the UI: items grouped by store, cheapest first within a staple. */
export function groupPrices(doc) {
  const stores = new Map((doc?.stores ?? []).map((s) => [`${s.chain}:${s.storeId}`, s]));
  const groups = new Map();
  for (const it of Array.isArray(doc?.items) ? doc.items : []) {
    const k = `${it.chain}:${it.storeId}`;
    if (!groups.has(k)) groups.set(k, { store: stores.get(k) ?? { chain: it.chain, storeId: it.storeId, name: `${it.chain} ${it.storeId}` }, items: [] });
    groups.get(k).items.push(it);
  }
  for (const g of groups.values()) g.items.sort((a, b) => String(a.staple ?? a.name).localeCompare(String(b.staple ?? b.name)));
  return [...groups.values()];
}
