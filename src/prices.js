// Optional encrypted price feed. Must stay byte-compatible with decryptJSON() in the private
// shopsmartr-data repo (src/crypto.mjs). Nothing here contains price data or a passphrase.
//
// data/prices.enc is a JSON envelope (all binary fields standard base64):
//   v1: { v: 1, kdf: "PBKDF2-SHA256", iter: 600000, alg: "AES-GCM-256",
//         aad: "shopsmartr.prices.enc/v1", salt: <16 bytes>, iv: <12 bytes>, ct: <ciphertext + 16-byte tag> }
//   v2: { v: 2, ..., z: "gzip", aad: "shopsmartr.prices.enc/v2;z=gzip", ... }: the plaintext is
//       gzip(UTF-8 JSON) and is inflated with DecompressionStream('gzip') after decryption.
//       The aad binds the compression flag, so changing or stripping "z" fails authentication.
// Key = PBKDF2-SHA256(passphrase.normalize('NFC'), salt, iter) -> AES-GCM 256.
// Decrypt = AES-GCM(iv, additionalData = UTF-8(aad || default), tagLength 128).
// The plaintext is UTF-8 JSON (schema "shopsmartr.prices/v1" or the full-catalog "shopsmartr.prices/2").
//
// Device cache (IndexedDB, CryptoKey objects are stored non-extractable, never the passphrase):
//   - "base": the PBKDF2 key imported from the passphrase, so a refreshed feed (new salt) can be
//     unlocked without asking again;
//   - "aes":  the derived AES key plus the salt/iter it belongs to, so normal loads skip the
//     600k-iteration derivation.
// data/prices.json is a small committed manifest, always present:
//   { "schema": "shopsmartr.pricefeed/1", "available": false|true, "file": "prices.enc", "updated": ISO|null }
// The app only requests prices.enc when available === true, so a missing feed never produces a
// 404 (and no red console entry). The publisher (shopsmartr-data publish.sh) sets it to true.
// If the manifest or the envelope is missing or malformed, loadFeed() returns null and the UI stays hidden.

export const PRICES_URL = 'data/prices.enc';
export const MANIFEST_URL = 'data/prices.json';
export const DEFAULT_AAD = 'shopsmartr.prices.enc/v1';
export const AAD = { 1: 'shopsmartr.prices.enc/v1', 2: 'shopsmartr.prices.enc/v2;z=gzip' };
export const MIN_ITER = 600000;
const enc = new TextEncoder();
const dec = new TextDecoder();
const subtleOf = (s) => s || globalThis.crypto.subtle;
export const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** The envelope authenticated but its contents can't be read (corrupt gzip or JSON). */
export class FeedFormatError extends Error {
  constructor(what) { super(`The price file is damaged (${what})`); this.name = 'FeedFormatError'; }
}

export class WrongPassphraseError extends Error {
  constructor() { super('Wrong passphrase'); this.name = 'WrongPassphraseError'; }
}

/** Returns '' when the envelope is usable, otherwise the reason. */
export function checkEnvelope(env) {
  if (!env || typeof env !== 'object') return 'not an object';
  if (env.kdf !== 'PBKDF2-SHA256' || !(env.v === 1 || (env.v === 2 && env.z === 'gzip'))) return 'Unsupported envelope';
  if (env.v === 1 && env.z !== undefined) return 'Unsupported envelope';
  if (env.z === 'gzip' && typeof globalThis.DecompressionStream !== 'function') return 'gzip not supported in this browser';
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

/**
 * Decrypts with an AES key. Throws WrongPassphraseError on an authentication failure.
 * Pass an object as ms to receive step timings { decrypt, gunzip, parse } in milliseconds.
 */
export async function decryptWithKey(env, key, subtle, ms = null) {
  const now = () => globalThis.performance?.now() ?? Date.now();
  let pt;
  let t = now();
  try {
    pt = await subtleOf(subtle).decrypt(
      { name: 'AES-GCM', iv: unb64(env.iv), additionalData: enc.encode(env.aad || AAD[env.v] || DEFAULT_AAD), tagLength: 128 },
      key, unb64(env.ct),
    );
  } catch { throw new WrongPassphraseError(); }
  if (ms) { ms.decrypt = now() - t; t = now(); }
  let bytes;
  try { bytes = env.z === 'gzip' ? await gunzip(new Uint8Array(pt)) : new Uint8Array(pt); } catch { throw new FeedFormatError('gzip'); }
  if (ms) { ms.gunzip = now() - t; t = now(); }
  let doc;
  try { doc = JSON.parse(dec.decode(bytes)); } catch { throw new FeedFormatError('JSON'); }
  if (ms) ms.parse = now() - t;
  return doc;
}

/** Inflates gzip bytes with the Compression Streams API (browsers and Node 18+). */
export async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
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

/** Reads the manifest; returns { available, file, updated } or null. */
export async function loadManifest(url = MANIFEST_URL, fetchFn = globalThis.fetch) {
  try {
    const r = await fetchFn(url, { cache: 'no-cache' });
    if (!r.ok) return null;
    const m = await r.json();
    if (!m || m.schema !== 'shopsmartr.pricefeed/1' || typeof m.available !== 'boolean') return null;
    const file = typeof m.file === 'string' && /^[\w.-]+\.enc$/.test(m.file) ? m.file : 'prices.enc';
    return { available: m.available, file, updated: typeof m.updated === 'string' ? m.updated : null };
  } catch { return null; }
}

/** Manifest first; fetches the envelope only when the manifest says a feed exists. */
export async function loadFeed(fetchFn = globalThis.fetch, manifestUrl = MANIFEST_URL) {
  const m = await loadManifest(manifestUrl, fetchFn);
  if (!m || !m.available) return null;
  const base = manifestUrl.slice(0, manifestUrl.lastIndexOf('/') + 1);
  return loadEnvelope(base + m.file, fetchFn);
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

/**
 * Tries cached keys only (no prompt). Returns the decoded result, or null if a passphrase is needed.
 * decode(env, key) defaults to decryptWithKey; the app passes one that decrypts, inflates, parses
 * and indexes in a Worker. It must throw WrongPassphraseError when authentication fails.
 */
export async function unlockWithCache(env, cache = idbKeyCache(), subtle, decode = (e, k) => decryptWithKey(e, k, subtle)) {
  const aes = await cache.get('aes');
  if (sameParams(aes, env)) {
    try { return await decode(env, aes.key); } catch (err) { if (!(err instanceof WrongPassphraseError)) throw err; }
  }
  const base = await cache.get('base');
  if (base) {
    try {
      const key = await deriveFromBase(base, env, subtle);
      const doc = await decode(env, key);
      await cache.set('aes', { key, salt: env.salt, iter: env.iter });
      return doc;
    } catch (err) {
      if (!(err instanceof WrongPassphraseError)) throw err;
      await cache.clear();
    }
  }
  return null;
}

/** Unlocks with a typed passphrase; caches keys on success. Throws WrongPassphraseError. */
export async function unlockWithPassphrase(env, passphrase, cache = idbKeyCache(), subtle, decode = (e, k) => decryptWithKey(e, k, subtle)) {
  if (!passphrase) throw new WrongPassphraseError();
  const base = await importPassphrase(passphrase, subtle);
  const key = await deriveFromBase(base, env, subtle);
  const doc = await decode(env, key);
  await cache.set('base', base);
  await cache.set('aes', { key, salt: env.salt, iter: env.iter });
  return doc;
}

export const forgetKeys = (cache = idbKeyCache()) => cache.clear();
