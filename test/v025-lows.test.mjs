// v0.2.5: Tester's Lows from the v0.2.4 gate (26ec923): L50 Replace copy, L51 bare broth/stock/jam/
// sausage/oil match their own products, L52 Brown Sugar / Green Beans / Vanilla Ice Cream edges.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../src/recipes.js';
import * as C from '../src/catalog.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const ing = (base, qty = 1, unit = null) => ({ text: `${qty} ${unit ?? ''} ${base}`, base, qty, unit });
const onList = (base, ...names) => R.onListItem(ing(base), R.listIndex(names.map((name, i) => ({ id: `i${i}`, name, checked: false }))))?.name ?? null;
function mini(items) {
  const rows = items.map((name, i) => ({ chain: 'wegmans', storeId: '90', price: 3.49, size: '1 ea', sku: `s${i}`, name }));
  const { catalog, index } = C.prepare({ schema: 'shopsmartr.prices/2', stores: [{ chain: 'wegmans', storeId: '90', name: 'W' }], items: rows });
  const mi = R.buildMatchIndex(catalog, index);
  return (q) => R.matchRows(mi, q, 0).map((c) => catalog.cols.name[c.row]);
}

test('L50: Replace description reads "Favorites and store picks" without settings, a list of three with', async () => {
  // v0.2.6-alpha.1 (L56): the wording moved to backup.js replaceText(), which also names imported recipes.
  const { replaceText } = await import('../src/backup.js');
  assert.equal(replaceText({ settings: 0 }), 'Favorites and store picks are replaced too.');
  assert.equal(replaceText({ settings: 3 }), 'Favorites, store picks and settings are replaced too.');
  assert.ok(read('src/app.js').includes('Bk.replaceText(sm)'));
});

test('L51: bare broth / stock / jam / sausage match their own products instead of nothing', () => {
  assert.ok(mini(['Vegetable Broth', 'Beef Broth', 'Chicken Broth'])('broth').includes('Chicken Broth'));
  assert.equal(mini(['Vegetable Broth', 'Beef Broth', 'Chicken Broth'])('broth').length, 3);
  assert.deepEqual(mini(['Chicken Stock'])('stock'), ['Chicken Stock']);
  assert.deepEqual(mini(['Strawberry Jam'])('jam'), ['Strawberry Jam']);
  assert.deepEqual(mini(['Chicken Sausage'])('sausage'), ['Chicken Sausage']);
});

test('L51: a plain product still wins; the modified ones only fill in when nothing plainer exists', () => {
  assert.deepEqual(mini(['Chicken Broth', 'Broth'])('broth'), ['Broth']);
  assert.deepEqual(mini(['Chicken Broth', 'Low Sodium Broth'])('broth'), ['Low Sodium Broth']);
});

test('L51: "oil" offers Vegetable Oil as well as Canola', () => {
  const got = mini(['Canola Oil', 'Vegetable Oil', 'Garlic Salt'])('oil');
  assert.ok(got.includes('Vegetable Oil') && got.includes('Canola Oil'), got.join(' | '));
});

test('L51: the M10 look-alikes stay out (no fallback for cream, butter, bread, milk)', () => {
  assert.deepEqual(mini(['Vanilla Ice Cream', 'Sour Cream'])('cream'), []);
  assert.deepEqual(mini(['Peanut Butter'])('butter'), []);
  assert.deepEqual(mini(['Banana Bread'])('bread'), []);
  assert.deepEqual(mini(['Almond Milk'])('milk'), []);
  assert.equal(onList('broth', 'Chicken Broth'), 'Chicken Broth', 'L55 (v0.2.6-alpha.1): a flavoured broth counts as broth on the list again');
  assert.equal(onList('chicken', 'Chicken Broth'), null, 'M10 pair unchanged');
});

test('L52: Brown Sugar and Sugar do not cover each other; Green Beans do not cover beans', () => {
  assert.equal(onList('sugar', 'Brown Sugar'), null);
  assert.equal(onList('brown sugar', 'Sugar'), null);
  assert.equal(onList('beans', 'Green Beans'), null);
  assert.equal(onList('sugar', 'Granulated Sugar'), 'Granulated Sugar');
  assert.equal(onList('brown sugar', 'Light Brown Sugar'), 'Light Brown Sugar');
  assert.equal(onList('green beans', 'Green Beans'), 'Green Beans');
  assert.equal(onList('beans', 'Black Beans'), 'Black Beans');
  assert.ok(!mini(['Brown Sugar', 'Granulated Sugar'])('sugar').includes('Brown Sugar'));
});

test('L52: Vanilla Ice Cream on the list counts for "ice cream", so Add missing no longer bumps it', () => {
  assert.equal(onList('ice cream', 'Vanilla Ice Cream'), 'Vanilla Ice Cream');
  assert.equal(onList('cream', 'Vanilla Ice Cream'), null, 'bare cream still is not ice cream');
  const r = R.prepareRecipes({ schema: R.RECIPES_SCHEMA, recipes: [{ id: 'l52', title: 'Sundae', servings: 2, ing: ['ice cream', 'sugar', 'beans'].map((b) => ing(b)) }] }).recipes[0];
  const list = ['Vanilla Ice Cream', 'Brown Sugar', 'Green Beans'].map((name, i) => ({ id: `l${i}`, name, checked: false }));
  const m = R.detailModel(r, { servings: 2, listItems: list });
  assert.deepEqual(m.have.map((l) => l.ing.base), ['ice cream']);
  assert.deepEqual(m.missing.map((l) => l.ing.base).sort(), ['beans', 'sugar']);
});
