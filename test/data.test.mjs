import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateStoresDoc, countByChain } from '../src/stores.js';

const doc = JSON.parse(readFileSync(new URL('../data/stores.json', import.meta.url)));

test('stores.json passes schema validation', () => {
  assert.deepEqual(validateStoresDoc(doc), []);
});

test('every chain present; weekly ad links are official https domains', () => {
  const counts = countByChain(doc.stores);
  for (const c of ['tops', 'wegmans', 'aldi', 'traderjoes']) assert.ok(counts[c] > 0, c);
  const allowed = { tops: 'topsmarkets.com', wegmans: 'wegmans.com', aldi: 'aldi.us', traderjoes: 'traderjoes.com' };
  for (const [c, host] of Object.entries(allowed)) {
    assert.ok(new URL(doc.chains[c].weeklyAd.url).hostname.endsWith(host), c);
    assert.ok(new URL(doc.chains[c].locatorUrl).hostname.endsWith(host), c);
  }
  for (const s of doc.stores) assert.ok(new URL(s.url).hostname.endsWith(allowed[s.chain]), s.id);
});

test('validator catches broken documents', () => {
  assert.ok(validateStoresDoc(null).length);
  const bad = structuredClone(doc);
  delete bad.asOf;
  bad.stores[0].zip = '123';
  bad.stores[1].lat = 999;
  bad.stores[2].id = bad.stores[3].id;
  delete bad.stores[4].url;
  bad.stores[5].chain = 'kroger';
  const errs = validateStoresDoc(bad).join('\n');
  for (const frag of ['asOf', 'zip must be', 'lat out of range', 'duplicate id', 'url missing', 'unknown chain']) assert.match(errs, new RegExp(frag));
});

test('no retailer-fetching code in the app', () => {
  for (const f of ['app.js', 'ui.js', 'geo.js', 'list.js', 'storage.js', 'export.js', 'stores.js', 'prices.js']) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /fetch\(\s*['"`]https?:/, `${f} fetches an absolute URL`);
    assert.doesNotMatch(src, /instacart|flipp|algolia/i, `${f} mentions a blocked source`);
  }
});
