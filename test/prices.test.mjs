import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as P from '../src/prices.js';

// Fixture made with the reference encryptJSON() from shopsmartr-data, using a THROWAWAY passphrase
// and a FAKE payload (no real prices). It proves this module decrypts the real envelope format.
const FIXTURE = JSON.parse(readFileSync(new URL('./fixtures/prices-fake.enc.json', import.meta.url)));
const THROWAWAY = 'throwaway-fake-fixture-passphrase';

test('fixture has the final envelope shape', () => {
  assert.deepEqual(Object.keys(FIXTURE), ['v', 'kdf', 'iter', 'alg', 'aad', 'salt', 'iv', 'ct']);
  assert.equal(FIXTURE.iter, 600000);
  assert.equal(FIXTURE.alg, 'AES-GCM-256');
  assert.equal(FIXTURE.aad, 'shopsmartr.prices.enc/v1');
  assert.equal(P.checkEnvelope(FIXTURE), '');
});

test('decrypts the reference envelope (with AAD)', async () => {
  const doc = await P.decryptJSON(FIXTURE, THROWAWAY);
  assert.equal(doc.schema, 'shopsmartr.prices/v1');
  assert.match(doc.note, /FAKE/);
  assert.equal(doc.items.length, 2);
});

test('wrong passphrase, wrong AAD, and tampering all fail as WrongPassphraseError', async () => {
  await assert.rejects(P.decryptJSON(FIXTURE, THROWAWAY + 'x'), P.WrongPassphraseError);
  await assert.rejects(P.decryptJSON({ ...FIXTURE, aad: 'other' }, THROWAWAY), P.WrongPassphraseError);
  const ct = P.unb64(FIXTURE.ct); ct[0] ^= 1;
  await assert.rejects(P.decryptJSON({ ...FIXTURE, ct: Buffer.from(ct).toString('base64') }, THROWAWAY), P.WrongPassphraseError);
});

test('NFC normalisation matches the reference', async () => {
  // Encrypt (as the reference does) with precomposed "é", decrypt with e + combining accent.
  const subtle = globalThis.crypto.subtle;
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const b64 = (u) => Buffer.from(u).toString('base64');
  const env = { v: 1, kdf: 'PBKDF2-SHA256', iter: 600000, alg: 'AES-GCM-256', aad: P.DEFAULT_AAD, salt: b64(salt), iv: b64(iv) };
  const base = await subtle.importKey('raw', new TextEncoder().encode('throwaway caf\u00e9 test'), 'PBKDF2', false, ['deriveKey']);
  const key = await subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 600000 }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = await subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(P.DEFAULT_AAD), tagLength: 128 }, key, new TextEncoder().encode('{"fake":true}'));
  env.ct = b64(new Uint8Array(ct));
  assert.deepEqual(await P.decryptJSON(env, 'throwaway cafe\u0301 test'), { fake: true });
});

test('envelope validation', () => {
  assert.match(P.checkEnvelope({ ...FIXTURE, v: 2 }), /Unsupported/);
  assert.match(P.checkEnvelope({ ...FIXTURE, iter: 1000 }), /iteration/);
  assert.match(P.checkEnvelope({ ...FIXTURE, alg: 'AES-CBC' }), /alg/);
  assert.match(P.checkEnvelope({ ...FIXTURE, iv: 'AAAA' }), /iv/);
  assert.match(P.checkEnvelope(null), /object/);
});

test('unlock flow: prompt once, then cached keys (also across a new salt)', async () => {
  const cache = P.memoryKeyCache();
  assert.equal(await P.unlockWithCache(FIXTURE, cache), null, 'nothing cached yet');
  await assert.rejects(P.unlockWithPassphrase(FIXTURE, 'nope-wrong-passphrase', cache), P.WrongPassphraseError);
  assert.equal(await cache.get('base'), null, 'failed attempt caches nothing');
  const doc = await P.unlockWithPassphrase(FIXTURE, THROWAWAY, cache);
  assert.equal(doc.items.length, 2);
  assert.ok(await cache.get('base'));
  assert.equal((await cache.get('aes')).salt, FIXTURE.salt);
  assert.equal((await P.unlockWithCache(FIXTURE, cache)).items.length, 2, 'cached AES key works');
  // Simulate a refreshed feed: different salt, so the cached AES key no longer applies.
  await cache.set('aes', { ...(await cache.get('aes')), salt: 'stale' });
  assert.equal((await P.unlockWithCache(FIXTURE, cache)).items.length, 2, 're-derived from cached base key');
  await P.forgetKeys(cache);
  assert.equal(await P.unlockWithCache(FIXTURE, cache), null);
});

test('absent or malformed file => null (price UI stays hidden)', async () => {
  assert.equal(await P.loadEnvelope('data/prices.enc', async () => ({ ok: false, status: 404 })), null);
  assert.equal(await P.loadEnvelope('x', async () => ({ ok: true, json: async () => ({ hello: 1 }) })), null);
  assert.equal(await P.loadEnvelope('x', async () => { throw new Error('offline'); }), null);
  assert.deepEqual(await P.loadEnvelope('x', async () => ({ ok: true, json: async () => FIXTURE })), FIXTURE);
});

test('groupPrices groups by store and sorts by staple', async () => {
  const doc = await P.decryptJSON(FIXTURE, THROWAWAY);
  const g = P.groupPrices(doc);
  assert.equal(g.length, 1);
  assert.equal(g[0].store.name, 'Example Store (fake)');
  assert.deepEqual(g[0].items.map((i) => i.staple), ['eggs', 'milk']);
  assert.deepEqual(P.groupPrices(null), []);
});

test('L1: manifest gates the envelope fetch, so no feed means no 404', async () => {
  const calls = [];
  const respond = (body, ok = true) => ({ ok, status: ok ? 200 : 404, json: async () => body });
  const fakeFetch = (files) => async (url) => { calls.push(url); return url in files ? respond(files[url]) : respond(null, false); };
  const committed = JSON.parse(readFileSync(new URL('../data/prices.json', import.meta.url)));
  assert.deepEqual(committed, { schema: 'shopsmartr.pricefeed/1', available: false, file: 'prices.enc', updated: null });

  calls.length = 0;
  assert.equal(await P.loadFeed(fakeFetch({ 'data/prices.json': committed })), null);
  assert.deepEqual(calls, ['data/prices.json']);           // prices.enc never requested

  calls.length = 0;
  const live = { ...committed, available: true, updated: '2026-11-14T15:00Z' };
  const env = await P.loadFeed(fakeFetch({ 'data/prices.json': live, 'data/prices.enc': FIXTURE }));
  assert.deepEqual(calls, ['data/prices.json', 'data/prices.enc']);
  assert.deepEqual(env, FIXTURE);

  calls.length = 0;
  assert.equal(await P.loadFeed(fakeFetch({})), null);      // manifest missing
  assert.equal(await P.loadFeed(fakeFetch({ 'data/prices.json': { available: 'yes' } })), null);
  assert.deepEqual(await P.loadManifest('data/prices.json', fakeFetch({ 'data/prices.json': { ...live, file: '../evil.js' } })),
    { available: true, file: 'prices.enc', updated: '2026-11-14T15:00Z' });
});
