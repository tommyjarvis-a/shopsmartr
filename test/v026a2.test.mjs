// v0.2.6-alpha.2: Tester's gate 7525179 — L59 (a flavoured fallback pick added by Add missing covers its bare line).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../src/recipes.js';
import * as L from '../src/list.js';
import * as B from '../src/backup.js';
import * as F from '../src/favorites.js';
import { VERSION } from '../src/version.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const ing = (base) => ({ text: `1 ${base}`, base, qty: 1, unit: null, k: base });
const link = { id: 'r1', title: 'Glazed Salmon' };

test('version 0.2.6-alpha.2+ in version.js, package.json and the CHANGELOG', () => {
  assert.match(VERSION, /^0\.2\.6-alpha\.([2-9]|[1-9]\d+)$/);
  assert.equal(JSON.parse(read('package.json')).version, VERSION);
  assert.match(read('CHANGELOG.md'), /## \[0\.2\.6-alpha\.2\]/);
});

test('L59: Orange Juice added for "juice" covers the line; a second Add missing adds nothing', () => {
  const recipe = { id: 'r1', ing: ['juice', 'oil', 'onion'].map(ing) };
  let s = L.emptyState();
  s = L.addOrMergeItem(s, { name: 'Organic Orange Juice', qty: 1, unit: '', recipe: link, covers: 'juice' }).state;
  s = L.addOrMergeItem(s, { name: 'Coconut Oil', qty: 1, unit: '', recipe: link, covers: 'oil' }).state;
  const m = R.detailModel(recipe, { servings: 4, listItems: s.items });
  assert.deepEqual(m.missing.map((l) => l.ing.base), ['onion']);
  const c = R.coverageDetail(recipe, R.listIndex(s.items));
  assert.equal(c.have, 2);
  assert.deepEqual(c.missing.map((x) => x.base), ['onion']);
});

test('L59: typed flavoured items stay strict (L53/L55 unchanged)', () => {
  const items = ['Apple Juice', 'Coconut Oil'].map((name, i) => ({ id: `i${i}`, name, qty: 1, unit: '', checked: false }));
  const c = R.coverageDetail({ id: 'x', ing: ['juice', 'oil'].map(ing) }, R.listIndex(items));
  assert.equal(c.have, 0);
  // covers for another ingredient doesn't leak
  const other = [{ id: 'a', name: 'Orange Juice', qty: 1, unit: '', checked: false, covers: 'orange juice' }];
  assert.equal(R.onListItem(ing('juice'), R.listIndex(other)), null);
});

test('L59: covers is sanitized, kept on merge, saved, restored, and dropped on rename', () => {
  assert.equal(L.cleanItemInput({ name: 'X', covers: '  Juice ' }).covers, 'juice');
  for (const bad of ['<img>', 'a'.repeat(0), 42, null, 'juice;drop', ' ']) assert.equal(L.cleanItemInput({ name: 'X', covers: bad }).covers, undefined);
  let s = L.addOrMergeItem(L.emptyState(), { name: 'Orange Juice', qty: 1, unit: '' }).state;
  const r = L.addOrMergeItem(s, { name: 'Orange Juice', qty: 1, unit: '', recipe: link, covers: 'juice' });
  s = r.state;
  assert.equal(s.items.length, 1);
  assert.equal(s.items[0].qty, 2);
  assert.equal(s.items[0].covers, 'juice');
  const p = B.parseBackup(B.backupJSON(B.makeBackup({ state: s, favs: F.emptyFavorites(), appVersion: VERSION, now: new Date('2026-11-21T12:00:00Z') })));
  assert.ok(JSON.stringify(p).includes('"covers":"juice"'), 'backup carries covers');
  const kept = L.updateItem(s, s.items[0].id, { qty: 3 });
  assert.equal(kept.items[0].covers, 'juice');
  const renamed = L.updateItem(s, s.items[0].id, { name: 'Apple Juice' });
  assert.equal(renamed.items[0].covers, undefined);
});
