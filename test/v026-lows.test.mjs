// v0.2.6: Tester's Lows from the v0.2.5-alpha.1 gate (9f298dc): L53 list check vs flavoured fallback, L54 servings card.
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

test('L53: a flavoured product on the list does not count as the bare ingredient', () => {
  for (const [base, name] of [['oil', 'Coconut Oil'], ['oil', 'Sesame Oil'], ['juice', 'Apple Juice'], ['broth', 'Chicken Broth'], ['stock', 'Beef Stock'], ['jam', 'Strawberry Jam'], ['sausage', 'Pork Sausage']]) {
    assert.equal(onList(base, name), null, `${name} is not "${base}" for the list check`);
  }
});
test('L53: the plain or same food still counts', () => {
  assert.equal(onList('oil', 'Oil'), 'Oil');
  assert.equal(onList('oil', 'Vegetable Oil'), 'Vegetable Oil', 'the everyday oil (PLAIN) still counts');
  assert.equal(onList('coconut oil', 'Coconut Oil'), 'Coconut Oil');
  assert.equal(onList('apple juice', 'Apple Juice'), 'Apple Juice');
  assert.equal(onList('chicken broth', 'Low Sodium Chicken Broth'), 'Low Sodium Chicken Broth');
  assert.equal(onList('butter', 'Unsalted Butter'), 'Unsalted Butter');
  assert.equal(onList('ice cream', 'Vanilla Ice Cream'), 'Vanilla Ice Cream', 'L52 unchanged');
});
test('L53: product picks keep the flavoured fallback (L51 unchanged)', () => {
  assert.deepEqual(mini(['Chicken Broth'])('broth'), ['Chicken Broth']);
  assert.deepEqual(mini(['Apple Juice'])('juice'), ['Apple Juice']);
  assert.ok(mini(['Coconut Oil'])('oil').includes('Coconut Oil'));
});
test('L53: Cook coverage agrees (Coconut Oil on the list leaves "oil" missing)', () => {
  const r = { id: 'x', ing: [ing('oil'), ing('onion'), ing('rice')].map((i) => ({ ...i, k: i.base })) };
  const items = ['Coconut Oil', 'Onion', 'Rice'].map((name, i) => ({ id: `i${i}`, name, checked: false }));
  const c = R.coverageDetail(r, R.listIndex(items));
  assert.equal(c.have, 2); assert.deepEqual(c.missing.map((m) => m.base), ['oil']);
});
test('L54: the Servings card stacks its label above the stepper when it is narrow', () => {
  const css = read('style.css');
  assert.match(css, /\.serv \{ flex-wrap: wrap;/);
  assert.match(css, /\.serv \.l \{ flex: 1 1 9rem; \}/);
  assert.match(css, /\.serv \.stepper \{ flex: none;/);
});
