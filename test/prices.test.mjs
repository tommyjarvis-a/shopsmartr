import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { checkEnvelope, deriveKey, decryptEnvelope, fetchEnvelope, loadPrices } from '../src/prices.js';

const subtle = webcrypto.subtle;
const b64 = (u8) => Buffer.from(u8).toString('base64');

// Test-only fixture: synthetic data and a throwaway passphrase, generated at runtime.
async function makeEnvelope(obj, pass) {
  const salt = webcrypto.getRandomValues(new Uint8Array(16));
  const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const env = { v: 1, kdf: 'PBKDF2-SHA256', iter: 100000, salt: b64(salt), iv: b64(iv) };
  const key = await deriveKey(pass, env, subtle);
  const base = await subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveKey']);
  const encKey = await subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: env.iter }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, encKey, new TextEncoder().encode(JSON.stringify(obj))));
  return { env: { ...env, ct: b64(ct) }, key };
}

test('envelope shape checks', () => {
  assert.equal(checkEnvelope({ v: 1, kdf: 'PBKDF2-SHA256', iter: 100000, salt: 'a', iv: 'b', ct: 'c' }), '');
  assert.match(checkEnvelope({ v: 2 }), /version/);
  assert.match(checkEnvelope({ v: 1, kdf: 'PBKDF2-SHA256', iter: 10, salt: 'a', iv: 'b', ct: 'c' }), /iteration/);
  assert.match(checkEnvelope(null), /object/);
});

test('decrypts with the right passphrase, fails with the wrong one', async () => {
  const sample = { asOf: '2000-01-01', note: 'synthetic test data' };
  const { env } = await makeEnvelope(sample, 'test-only-passphrase');
  const good = await deriveKey('test-only-passphrase', env, subtle);
  assert.deepEqual(await decryptEnvelope(env, good, subtle), sample);
  const bad = await deriveKey('wrong', env, subtle);
  await assert.rejects(decryptEnvelope(env, bad, subtle));
});

test('absent or malformed file yields null (nothing shown)', async () => {
  const notFound = async () => ({ ok: false, status: 404, json: async () => ({}) });
  assert.equal(await fetchEnvelope('data/prices.enc', notFound), null);
  const garbage = async () => ({ ok: true, json: async () => ({ hello: 1 }) });
  assert.equal(await fetchEnvelope('data/prices.enc', garbage), null);
  const offline = async () => { throw new Error('offline'); };
  assert.equal(await loadPrices({ fetchFn: offline }), null);
});
