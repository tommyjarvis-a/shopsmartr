// v0.2.1-alpha hotfix: M7 merge on Add all, M8 tap guard, L35 typos, L38 fl oz, L39 modifier-only matches.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/list.js';
import * as R from '../src/recipes.js';
import * as C from '../src/catalog.js';
import { TAP_GUARD_MS } from '../src/rx.js';

const limes = (qty, extra = {}) => ({ name: 'Limes', qty, unit: '', storeId: 'wegmans:90', notes: `${qty} limes`, ...extra });

test('M7: two recipes with limes give one Limes line; Undo data restores it exactly', () => {
  let s = L.emptyState();
  const a = L.addOrMergeItem(s, limes(1, { recipe: { id: 'bowl', title: 'Black Bean Bowl' } }), 'i1');
  assert.equal(a.prev, null);
  s = a.state;
  const before = s.items[0];
  const b = L.addOrMergeItem(s, limes(2, { recipe: { id: 'mojito', title: 'Mojito' } }), 'i2');
  assert.equal(b.id, 'i1');
  assert.deepEqual(b.prev, before);
  assert.equal(b.state.items.length, 1);
  const line = b.state.items[0];
  assert.equal(line.qty, 3);
  assert.equal(line.recipe.id, 'bowl', 'keeps the first recipe link');
  assert.equal(line.notes, '1 limes; 2 limes');
  // Undo restores by value
  const undone = b.state.items.map((i) => (i.id === b.id ? b.prev : i));
  assert.deepEqual(undone, s.items);
});

test('M7: merges only same name + store + unit on an open line', () => {
  let s = L.addOrMergeItem(L.emptyState(), limes(1), 'i1').state;
  assert.equal(L.addOrMergeItem(s, limes(1, { storeId: 'wegmans:80' }), 'x').state.items.length, 2, 'other store');
  assert.equal(L.addOrMergeItem(s, limes(1, { unit: 'lb' }), 'x').state.items.length, 2, 'other unit');
  assert.equal(L.addOrMergeItem(s, limes(1, { name: '  limes ' }), 'x').state.items.length, 1, 'name compare ignores case and spaces');
  s = L.toggleItem(s, 'i1', true);
  assert.equal(L.addOrMergeItem(s, limes(1), 'x').state.items.length, 2, 'a checked (bought) line is left alone');
  // count lines without a quantity count as 1; measured lines without one don't sum
  const t = L.addOrMergeItem(L.emptyState(), { name: 'Cilantro', qty: null }, 'c').state;
  assert.equal(L.addOrMergeItem(t, { name: 'Cilantro', qty: null }, 'd').state.items[0].qty, null);
  assert.equal(L.addOrMergeItem(t, { name: 'Cilantro', qty: 2 }, 'd').state.items[0].qty, 3);
  const w = L.addOrMergeItem(L.emptyState(), { name: 'Beef', qty: null, unit: 'lb' }, 'b').state;
  assert.equal(L.addOrMergeItem(w, { name: 'Beef', qty: 1, unit: 'lb' }, 'e').state.items.length, 2);
  const lb = L.addOrMergeItem(L.emptyState(), { name: 'Beef', qty: 1.25, unit: 'lb' }, 'b').state;
  assert.equal(L.addOrMergeItem(lb, { name: 'Beef', qty: 0.5, unit: 'lb' }, 'e').state.items[0].qty, 1.75);
  assert.equal(L.addOrMergeItem(L.addOrMergeItem(L.emptyState(), limes(9000), 'a').state, limes(5000), 'b').state.items[0].qty, L.MAX_QTY);
});

test('M8: the tap guard is about 400–600 ms', () => {
  assert.ok(TAP_GUARD_MS >= 400 && TAP_GUARD_MS <= 600);
});

const rec = (id, title, ...bases) => ({ id, title, ing: bases.map((b) => ({ text: b, base: b })), steps: ['x'] });
const { recipes } = R.prepareRecipes({ schema: R.RECIPES_SCHEMA, recipes: [rec('1', 'Spaghetti Marinara', 'spaghetti', 'marinara sauce'), rec('2', 'Rice Bowl', 'rice', 'beans')] });

test('L35: recipe search tolerates one typo in 5+ letter words, like Shop search', () => {
  const find = (q) => recipes.filter((r) => R.matchesQuery(r, q)).map((r) => r.id);
  assert.deepEqual(find('spagetti'), ['1']);
  assert.deepEqual(find('marinera'), ['1']);
  assert.deepEqual(find('spagett'), ['1'], 'a typo inside a word start');
  assert.deepEqual(find('spagh'), ['1'], 'prefixes still work');
  assert.deepEqual(find('rcie'), [], 'no typo tolerance under 5 letters');
  assert.deepEqual(find('spagetti rice'), [], 'every word must still match');
  assert.deepEqual(find('xxxxxxxx'), []);
});

test('L38: fl oz reads "fl oz", never "flozs"', () => {
  assert.equal(R.unitLabel('floz', 2), 'fl oz');
  assert.equal(R.unitLabel('floz', 1), 'fl oz');
  assert.equal(R.amountText({ qty: 2, unit: 'floz' }), '2 fl oz');
});

const item = (name, sku) => ({ chain: 'wegmans', storeId: '90', name, price: 3.49, size: '1 ea', sku });
function mini(...names) {
  const { catalog, index } = C.prepare({ schema: 'shopsmartr.prices/2', stores: [{ chain: 'wegmans', storeId: '90', name: 'W' }], items: names.map((n, i) => item(n, `s${i}`)) });
  const mi = R.buildMatchIndex(catalog, index);
  return (q) => R.matchRows(mi, q, 0).map((c) => catalog.cols.name[c.row]);
}

test('L39: a one-word ingredient that is only a modifier is not offered', () => {
  const m = mini('Fresh Ice Cream Value Pack', 'Garlic Ham', 'Garlic Bulb', 'Bagged Ice', 'Lemon Pepper Seasoning', 'Butter Chicken');
  assert.deepEqual(m('ice'), ['Bagged Ice']);
  assert.deepEqual(m('garlic'), ['Garlic Bulb'], 'a pack/form word at the end still counts as garlic');
  assert.deepEqual(m('lemon'), []);
  assert.deepEqual(m('butter'), []);
  assert.deepEqual(mini('Fresh Ice Cream Value Pack', 'Garlic Ham')('garlic'), []);
});

test('L39: head-noun matches win; multi-word lines keep the softer rule', () => {
  const m = mini('Green Bean Casserole', 'Green Beans', 'Garlic Powder', 'Garlic');
  assert.deepEqual(m('green beans'), ['Green Beans']);
  assert.deepEqual(mini('Green Bean Casserole')('green beans'), ['Green Bean Casserole'], 'a multi-word line still gets the lower-level match when nothing better exists');
  assert.equal(m('garlic')[0], 'Garlic');
  assert.ok(!m('garlic').includes('Garlic Powder'));
  assert.equal(R.headOf(['garlic', 'bulb']), 'garlic');
  assert.equal(R.headOf(['ice', 'cream']), 'cream');
});
