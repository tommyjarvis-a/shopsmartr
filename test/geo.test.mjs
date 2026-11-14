import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { haversineMiles, normalizeZip, lookupZip, storesNear, nearestPerChain } from '../src/geo.js';

const stores = JSON.parse(readFileSync(new URL('../data/stores.json', import.meta.url))).stores;
const zips = JSON.parse(readFileSync(new URL('../data/zips.json', import.meta.url))).zips;

test('haversine: known distance and symmetry', () => {
  const buffalo = { lat: 42.8864, lon: -78.8784 };
  const rochester = { lat: 43.1566, lon: -77.6088 };
  const d = haversineMiles(buffalo, rochester);
  assert.ok(d > 63 && d < 69, `got ${d}`);
  assert.equal(haversineMiles(buffalo, buffalo), 0);
  assert.ok(Math.abs(d - haversineMiles(rochester, buffalo)) < 1e-9);
});

test('normalizeZip accepts 5 and 9 digit forms only', () => {
  assert.equal(normalizeZip(' 14221 '), '14221');
  assert.equal(normalizeZip('14221-1234'), '14221');
  for (const bad of ['1422', '142211', 'abcde', '', null, undefined, '14221-12']) assert.equal(normalizeZip(bad), null);
});

test('lookupZip returns centroid or null', () => {
  const o = lookupZip('14221', zips);
  assert.equal(o.zip, '14221');
  assert.ok(o.lat > 42.9 && o.lat < 43.1 && o.lon < -78.6 && o.lon > -78.8);
  assert.equal(lookupZip('90210', zips), null);
  assert.equal(lookupZip('nope', zips), null);
});

test('14221 within 10 mi has every chain, sorted by distance', () => {
  const near = storesNear(stores, lookupZip('14221', zips), 10);
  const chains = new Set(near.map((s) => s.chain));
  for (const c of ['tops', 'wegmans', 'aldi', 'traderjoes']) assert.ok(chains.has(c), `missing ${c}`);
  for (let i = 1; i < near.length; i++) assert.ok(near[i - 1].distanceMi <= near[i].distanceMi);
  assert.ok(near.every((s) => s.distanceMi <= 10));
  const first = nearestPerChain(near);
  assert.equal(first.traderjoes.id, 'traderjoes-575');
});

test('radius and chain filters', () => {
  const o = lookupZip('14221', zips);
  const r5 = storesNear(stores, o, 5);
  const r25 = storesNear(stores, o, 25);
  assert.ok(r5.length < r25.length);
  const onlyAldi = storesNear(stores, o, 25, ['aldi']);
  assert.ok(onlyAldi.length > 0 && onlyAldi.every((s) => s.chain === 'aldi'));
  assert.equal(storesNear(stores, o, 0.01).length, 0);
  // Jamestown is far from Williamsville
  assert.ok(!r25.some((s) => s.id === 'wegmans-88'));
  assert.ok(storesNear(stores, lookupZip('14701', zips), 10).some((s) => s.id === 'wegmans-88'));
});

test('stores without coordinates are skipped', () => {
  const o = { lat: 43, lon: -78.7 };
  const out = storesNear([{ id: 'x', chain: 'tops', name: 'x', lat: null, lon: null }, { id: 'y', chain: 'tops', name: 'y', lat: 43, lon: -78.7 }], o, 1);
  assert.deepEqual(out.map((s) => s.id), ['y']);
});
