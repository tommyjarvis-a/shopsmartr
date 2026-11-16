// v0.2.3-alpha: backup/2 (saved recipes), Missing / Already on your list, swaps fix the cost range.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../src/backup.js';
import * as F from '../src/favorites.js';
import * as L from '../src/list.js';
import * as R from '../src/recipes.js';
import * as C from '../src/catalog.js';
import { cleanSwaps, loadSwaps, RX_SWAPS_KEY } from '../src/rx.js';
import { memoryStorage } from '../src/storage.js';

const favsWith = (...ids) => ids.reduce((f, id) => F.saveRecipe(f, { id, title: `Recipe ${id}` }), F.emptyFavorites());

test('backup/2: Save list includes saved recipes and loads them back', () => {
  const doc = B.makeBackup({ state: L.emptyState(), favs: favsWith('r1', 'r2'), appVersion: '0.2.1-alpha' });
  assert.equal(doc.schema, 'shopsmartr.backup/2');
  assert.deepEqual(doc.favorites.recipes.map((r) => r.id).sort(), ['r1', 'r2']);
  const p = B.parseBackup(B.backupJSON(doc));
  assert.ok(p.ok);
  assert.equal(p.summary.recipes, 2);
  assert.match(B.summaryText(p.summary), /2 saved recipes/);
  assert.equal(p.backup.hasRecipes, true);
});

test('backup/1 files still load; Replace keeps this device\'s recipes, a /2 Replace takes the file\'s', () => {
  const cur = { state: L.emptyState(), favs: favsWith('mine'), shopStore: '', listSort: { by: 'name', dir: 'asc' } };
  const v2 = B.makeBackup({ state: L.emptyState(), favs: favsWith('theirs'), appVersion: '0.2.1-alpha' });
  const v1 = { ...v2, schema: 'shopsmartr.backup/1', appVersion: '0.1.10-alpha', favorites: { items: [], meals: [] } };
  const p1 = B.parseBackup(JSON.stringify(v1));
  assert.ok(p1.ok);
  assert.equal(p1.backup.hasRecipes, false);
  assert.deepEqual(B.applyBackup(cur, p1.backup, 'replace').favs.recipes.map((r) => r.id), ['mine']);
  const p2 = B.parseBackup(JSON.stringify(v2));
  assert.deepEqual(B.applyBackup(cur, p2.backup, 'replace').favs.recipes.map((r) => r.id), ['theirs']);
  assert.deepEqual(B.applyBackup(cur, p2.backup, 'merge').favs.recipes.map((r) => r.id).sort(), ['mine', 'theirs']);
  assert.deepEqual(B.applyBackup(cur, p1.backup, 'merge').favs.recipes.map((r) => r.id), ['mine']);
});

test('backup/2: damaged or oversized recipes are refused; bad rows are dropped', () => {
  const doc = B.makeBackup({ state: L.emptyState(), favs: F.emptyFavorites(), appVersion: '0.2.1-alpha' });
  assert.equal(B.parseBackup(JSON.stringify({ ...doc, favorites: { items: [], meals: [], recipes: 'x' } })).ok, false);
  const ok = B.parseBackup(JSON.stringify({ ...doc, favorites: { items: [], meals: [], recipes: [{ id: 'a', title: 'A' }, { id: '', title: 'no id' }, { id: 'a', title: 'dup' }, null] } }));
  assert.deepEqual(ok.backup.favs.recipes.map((r) => r.id), ['a']);
  assert.match(B.parseBackup(JSON.stringify({ ...doc, schema: 'shopsmartr.backup/3' })).error, /newer/);
});

test('swaps: cleaned and loaded per ingredient + store', () => {
  assert.deepEqual(cleanSwaps({ 'heavy cream|wegmans:90': 'sku1', bad: 'x', 'a|b:c': 5, 'x|y': 'z' }), { 'heavy cream|wegmans:90': 'sku1' });
  const s = memoryStorage();
  s.setItem(RX_SWAPS_KEY, '{"lemon|wegmans:90":"ole"}');
  assert.deepEqual(loadSwaps(s), { 'lemon|wegmans:90': 'ole' });
  s.setItem(RX_SWAPS_KEY, 'not json');
  assert.deepEqual(loadSwaps(s), {});
});

const item = (name, price, size, sku) => ({ chain: 'wegmans', storeId: '90', name, price, size, sku });
const { catalog: cat, index } = C.prepare({ schema: 'shopsmartr.prices/2', stores: [{ chain: 'wegmans', storeId: '90', name: 'W' }], items: [
  item('Lemons', 0.79, '1 ea', 'le'), item('Organic Lemons', 1.29, '1 ea', 'ole'), item('Green Beans', 2.49, '12 oz', 'gb'), item('Unsalted Butter', 4.29, '1 lb', 'bu'),
] });
const mi = R.buildMatchIndex(cat, index);
const ing = (base, qty, unit) => ({ text: `${qty} ${unit} ${base}`, base, qty, unit });
const recipe = R.prepareRecipes({ schema: R.RECIPES_SCHEMA, recipes: [{ id: '1', title: 'Beans', servings: 4, ing: [ing('green beans', 0.75, 'lb'), ing('lemons', 1.5, 'whole'), ing('unsalted butter', 2, 'tbsp'), { text: 'salt', base: 'salt' }] }] }).recipes[0];
const { cands } = R.precomputeCandidates(mi, [recipe], 0);

test('Missing / Already on your list: same normalizer, checked items count, pantry excluded', () => {
  const list = [{ id: 'x', name: 'Fresh green beans', checked: true }, { id: 'y', name: 'Salted butter', checked: false }, { id: 'z', name: 'Butter, unsalted', checked: false }];
  const m = R.detailModel(recipe, { servings: 4, listItems: list, mi, cands });
  assert.deepEqual(m.have.map((l) => l.ing.base), ['green beans', 'unsalted butter']);
  assert.equal(m.have[1].onList.id, 'z', '"Butter, unsalted" covers unsalted butter; "Salted butter" does not');
  assert.equal(m.have[0].onList.id, 'x', 'a checked item counts');
  assert.deepEqual(m.missing.map((l) => l.ing.base), ['lemons']);
  assert.deepEqual(m.pantry, ['salt']);
});

test('a user swap fixes both ends of the cost range and leads the options', () => {
  const free = R.recipeCost(recipe, { mi, cands, factor: 1 });
  assert.ok(free.high > free.low);
  const swapOf = (k) => (k === 'lemon' ? 'ole' : null);
  const fixed = R.recipeCost(recipe, { mi, cands, factor: 1, swapOf });
  // lemons pinned to Organic (2 x 1.29) at both ends; beans and butter have one product each.
  assert.equal(fixed.low, Math.floor(2 * 1.29 + 2.49 + 4.29));
  assert.equal(fixed.high, Math.ceil(2 * 1.29 + 2.49 + 4.29));
  const opts = R.lineOptions(mi, cands, recipe.ing[1], 1, 'ole');
  assert.equal(opts[0].it.sku, 'ole');
  assert.ok(opts.length <= 5, 'matched one + up to 4 alternatives');
  const m = R.detailModel(recipe, { servings: 4, mi, cands, swapOf });
  assert.equal(m.missing.find((l) => l.ing.base === 'lemons').opts[0].it.sku, 'ole');
});

test('backup/2 is additive: optional sections a later version adds are ignored, not refused', () => {
  const doc = B.makeBackup({ state: L.emptyState(), favs: favsWith('r1'), appVersion: '0.2.3-alpha' });
  const later = { ...doc, appVersion: '0.2.4-alpha', settings: { theme: 'dark', household: 4 }, prefs: { 'shopsmartr:x': 1 }, favorites: { ...doc.favorites, extra: [1, 2] } };
  const p = B.parseBackup(JSON.stringify(later));
  assert.ok(p.ok, p.error);
  assert.deepEqual(p.backup.favs.recipes.map((r) => r.id), ['r1']);
  assert.equal(p.summary.recipes, 1);
});

test('iOS focus ring: rings are :focus-visible only, no tap highlight, pointer mode drops rings', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  assert.match(css, /-webkit-tap-highlight-color:\s*transparent/);
  assert.match(css, /html\[data-input="pointer"\][^{]*\{\s*outline:\s*none !important/);
  // any plain :focus rule may only remove the outline, never draw one
  for (const m of css.matchAll(/([^{}]*:focus(?![-\w])[^{]*)\{([^}]*)\}/g)) {
    assert.doesNotMatch(m[2], /outline:\s*(?!none)\S/, `ring drawn on plain :focus: ${m[1].trim()}`);
  }
  const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(app, /bindInputModality\(\);/);
});
