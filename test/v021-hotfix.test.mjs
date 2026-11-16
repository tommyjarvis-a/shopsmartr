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

// ---------- v0.2.2-alpha hotfix: M9, L41 ----------
test('M9: a one-word ingredient matches products named after it with a generic class or cut word', () => {
  const m = mini('Parmesan Cheese', 'Ricotta Cheese', 'Sharp Cheddar Cheese', 'Avocados Hass', 'Boneless Skinless Chicken Breast', 'Chicken Thighs Bone-In',
    'Garlic Bulb', 'Garlic Ham', 'Fresh Ice Cream Value Pack', 'Chicken Noodle Soup', 'Potato Chips', 'Fresh Turkey Slices');
  assert.deepEqual(m('parmesan'), ['Parmesan Cheese']);
  assert.deepEqual(m('ricotta'), ['Ricotta Cheese']);
  assert.deepEqual(m('cheddar'), ['Sharp Cheddar Cheese']);
  assert.deepEqual(m('avocado'), ['Avocados Hass']);
  assert.deepEqual(m('avocados'), ['Avocados Hass']);
  assert.deepEqual(m('chicken').sort(), ['Boneless Skinless Chicken Breast', 'Chicken Thighs Bone-In']);
  assert.deepEqual(m('turkey'), ['Fresh Turkey Slices']);
  assert.deepEqual(m('garlic'), ['Garlic Bulb']);
  assert.deepEqual(m('ice'), []);
  assert.deepEqual(m('potatoes'), []);
});

test('L41: one wording for the toast and the button', async () => {
  const { addedText } = await import('../src/rx.js');
  assert.equal(addedText(3, 0), 'Added 3 items');
  assert.equal(addedText(1, 0), 'Added 1 item');
  assert.equal(addedText(0, 3), 'Updated 3 items');
  assert.equal(addedText(0, 1), 'Updated 1 item');
  assert.equal(addedText(2, 1), 'Added 2, updated 1');
});

// ---------- v0.2.3: a different-food modifier before the head is penalized, not rejected ----------
test('a bare "cream" prefers Heavy / Whipping Cream over Ice Cream; Ice Cream stays offered lower', () => {
  const m = mini('Ice Cream', 'Heavy Cream', 'Sour Cream', 'Bagged Ice');
  assert.equal(m('cream')[0], 'Heavy Cream');
  const n = mini('Ice Cream', 'Sour Cream', 'Bagged Ice')('cream');
  assert.deepEqual(n, ['Sour Cream', 'Ice Cream'], 'penalized below Sour Cream, not rejected');
  assert.deepEqual(mini('Ice Cream', 'Bagged Ice')('cream'), ['Ice Cream'], 'still offered when it is all there is');
  assert.equal(mini('Ice Cream', 'Heavy Whipping Cream', 'Bagged Ice')('cream')[0], 'Heavy Whipping Cream');
});

test('a bare "bread" prefers plain or sandwich bread over Banana Bread', () => {
  assert.equal(mini('Banana Bread', 'Sandwich Bread', 'Bananas')('bread')[0], 'Sandwich Bread');
  assert.equal(mini('Banana Bread', 'Sourdough Bread', 'Bananas')('bread')[0], 'Sourdough Bread');
  assert.deepEqual(mini('Banana Bread', 'Bananas')('bread'), ['Banana Bread'], 'still offered when nothing better exists');
});

test('the M9 set is unchanged by the modifier penalty', () => {
  const m = mini('Parmesan Cheese', 'Ricotta Cheese', 'Sharp Cheddar Cheese', 'Avocados Hass', 'Boneless Skinless Chicken Breast', 'Garlic Bulb', 'Garlic Ham', 'Fresh Ice Cream Value Pack', 'Cheese Pizza');
  assert.deepEqual(m('parmesan'), ['Parmesan Cheese']);
  assert.deepEqual(m('ricotta'), ['Ricotta Cheese']);
  assert.deepEqual(m('cheddar'), ['Sharp Cheddar Cheese']);
  assert.deepEqual(m('avocado'), ['Avocados Hass']);
  assert.deepEqual(m('chicken'), ['Boneless Skinless Chicken Breast']);
  assert.deepEqual(m('garlic'), ['Garlic Bulb']);
  assert.deepEqual(m('ice'), []);
});

test('a bare "cream" stays off Cream Cheese', () => {
  assert.equal(mini('Cream Cheese', 'Heavy Cream', 'Ice Cream', 'Bagged Ice')('cream')[0], 'Heavy Cream');
  assert.ok(!mini('Cream Cheese', 'Heavy Cream')('cream').includes('Cream Cheese'));
  assert.equal(mini('Cream Cheese', 'Heavy Whipping Cream')('cream')[0], 'Heavy Whipping Cream');
  assert.equal(mini('Cream Cheese', 'Sour Cream')('cream')[0], 'Sour Cream');
});

test('L43: celery hearts, pineapple chunks and corn on the cob are the same food', () => {
  assert.deepEqual(mini('Celery Hearts', 'Celery Salt Seasoning')('celery'), ['Celery Hearts']);
  assert.deepEqual(mini('Pineapple Chunks', 'Pineapple Juice')('pineapple'), ['Pineapple Chunks']);
  assert.deepEqual(mini('Corn on the Cob', 'Corn Chips')('corn').slice(0, 1), ['Corn on the Cob']);
});

test('L44: plain forms rank above processed ones, even when the processed name is shorter or cheaper', () => {
  const m = mini('Chicken Nuggets', 'Boneless Skinless Chicken Breast', 'Chicken Patties');
  assert.equal(m('chicken')[0], 'Boneless Skinless Chicken Breast');
  assert.ok(m('chicken').includes('Chicken Nuggets'), 'processed forms stay as Swap alternatives');
  const p = mini('Potato Wedges', 'Russet Potatoes Bag', 'Potato Fries');
  assert.equal(p('potato')[0], 'Russet Potatoes Bag');
  // through lineOptions (price order within a level): the plain form still leads
  const { catalog, index } = C.prepare({ schema: 'shopsmartr.prices/2', stores: [{ chain: 'wegmans', storeId: '90', name: 'W' }], items: [
    { chain: 'wegmans', storeId: '90', name: 'Chicken Nuggets', price: 1.99, size: '1 ea', sku: 'n' },
    { chain: 'wegmans', storeId: '90', name: 'Chicken Breast', price: 9.99, size: '1 ea', sku: 'b' }] });
  const mi = R.buildMatchIndex(catalog, index);
  const ing = { text: '1 chicken', base: 'chicken', qty: 1, unit: 'whole', k: 'chicken' };
  const cands = new Map([['chicken', R.matchRows(mi, 'chicken', 0)]]);
  const opts = R.lineOptions(mi, cands, ing, 1);
  assert.deepEqual(opts.map((o) => o.it.sku), ['b', 'n']);
});
