// v0.2.6-alpha.3: Tester's gate fe087b6 — L60 (a backup Merge keeps recipe + covers on combined lines).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../src/recipes.js';
import * as L from '../src/list.js';
import * as B from '../src/backup.js';
import * as F from '../src/favorites.js';
import { VERSION } from '../src/version.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const NOW = new Date('2026-11-21T12:00:00Z');
const ing = (base) => ({ text: `1 ${base}`, base, qty: 1, unit: null, k: base });
const link = { id: 'r1', title: 'Glazed Salmon' };

test('version 0.2.6-alpha.3 in version.js, package.json and the CHANGELOG', () => {
  assert.equal(VERSION, '0.2.6-alpha.3');
  assert.equal(JSON.parse(read('package.json')).version, VERSION);
  assert.match(read('CHANGELOG.md'), /## \[0\.2\.6-alpha\.3\]/);
});

test('L60: combineLines copies recipe and covers when the existing line lacks them, keeps its own otherwise', () => {
  const a = { id: 'a', name: 'Orange Juice', qty: 1, unit: '', checked: false };
  const b = { id: 'b', name: 'Orange Juice', qty: 1, unit: '', checked: false, recipe: link, covers: 'juice' };
  const out = B.combineLines(a, b);
  assert.equal(out.qty, 2); assert.deepEqual(out.recipe, link); assert.equal(out.covers, 'juice');
  const own = B.combineLines({ ...a, recipe: { id: 'r0', title: 'Mine' }, covers: 'orange juice' }, b);
  assert.equal(own.recipe.id, 'r0'); assert.equal(own.covers, 'orange juice');
  assert.equal(B.combineLines(a, { ...b, recipe: undefined, covers: undefined }).covers, undefined);
});

test('L60: Merge restore into a list with a plain Orange Juice keeps juice covered (no 2 -> 3 bump)', () => {
  const recipe = { id: 'r1', ing: ['juice', 'onion'].map(ing) };
  const fileState = L.addOrMergeItem(L.emptyState(), { name: 'Orange Juice', qty: 1, unit: '', recipe: link, covers: 'juice' }).state;
  const b = B.parseBackup(B.backupJSON(B.makeBackup({ state: fileState, favs: F.emptyFavorites(), appVersion: VERSION, now: NOW })));
  const curState = L.addOrMergeItem(L.emptyState(), { name: 'Orange Juice', qty: 1, unit: '' }).state;
  const cur = { state: curState, favs: F.emptyFavorites(), shopStore: '', listSort: L.cleanSort(null), prefs: {}, userRecipes: [] };
  const res = B.applyBackup(cur, b.backup, 'merge');
  assert.equal(res.state.items.length, 1);
  assert.equal(res.state.items[0].qty, 2);
  assert.equal(res.state.items[0].covers, 'juice');
  const m = R.detailModel(recipe, { servings: 4, listItems: res.state.items });
  assert.deepEqual(m.missing.map((l) => l.ing.base), ['onion']);
});
