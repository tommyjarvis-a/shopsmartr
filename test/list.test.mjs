import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/list.js';

const add = (s, input, id) => L.addItem(s, input, id);

test('add trims and validates', () => {
  let s = L.emptyState();
  s = add(s, { name: '  Milk ', qty: '2', unit: 'gal', notes: ' 2% ', storeId: 'wegmans-83' }, 'a');
  assert.deepEqual(s.items[0], { id: 'a', name: 'Milk', qty: 2, unit: 'gal', notes: '2%', storeId: 'wegmans-83', checked: false });
  s = add(s, { name: 'Eggs' }, 'b');
  assert.equal(s.items[1].qty, null);
  assert.throws(() => add(s, { name: '   ' }), /name is required/);
  assert.throws(() => add(s, { name: 'x', qty: -1 }), /positive/);
  assert.throws(() => add(s, { name: 'x', qty: 'abc' }), /positive/);
});

test('functions are pure (input state untouched)', () => {
  const s0 = add(L.emptyState(), { name: 'A' }, 'a');
  const snap = JSON.stringify(s0);
  L.toggleItem(s0, 'a'); L.removeItem(s0, 'a'); L.updateItem(s0, 'a', { name: 'B' }); L.clearChecked(s0); L.uncheckAll(s0);
  assert.equal(JSON.stringify(s0), snap);
});

test('edit, check off (stays in place), uncheck all, remove, clear checked', () => {
  let s = L.emptyState();
  for (const [id, name] of [['a', 'A'], ['b', 'B'], ['c', 'C']]) s = add(s, { name }, id);
  s = L.updateItem(s, 'b', { name: 'Bread', qty: 1, unit: 'loaf' });
  assert.equal(s.items[1].name, 'Bread');
  assert.throws(() => L.updateItem(s, 'b', { name: '' }));
  s = L.toggleItem(s, 'b');
  assert.deepEqual(s.items.map((i) => i.id), ['a', 'b', 'c']);
  assert.equal(s.items[1].checked, true);
  assert.deepEqual(L.summary(s), { total: 3, done: 1, remaining: 2 });
  s = L.toggleItem(s, 'b', true);
  assert.equal(s.items[1].checked, true);
  assert.equal(L.uncheckAll(s).items.some((i) => i.checked), false);
  s = L.toggleItem(L.toggleItem(s, 'a'), 'b');
  s = L.clearChecked(s);
  assert.deepEqual(s.items.map((i) => i.id), ['b', 'c']);
  s = L.removeItem(s, 'c');
  assert.deepEqual(s.items.map((i) => i.id), ['b']);
});

test('groupByStore keeps order and puts "any store" last', () => {
  let s = L.emptyState();
  s = add(s, { name: 'x' }, '1');
  s = add(s, { name: 'y', storeId: 'aldi-1' }, '2');
  s = add(s, { name: 'z', storeId: 'tops-41' }, '3');
  s = add(s, { name: 'w', storeId: 'aldi-1' }, '4');
  const g = L.groupByStore(s.items);
  assert.deepEqual(g.map((x) => x.storeId), ['aldi-1', 'tops-41', '']);
  assert.deepEqual(g[0].items.map((i) => i.id), ['2', '4']);
});

test('selected stores are de-duplicated; formatQty', () => {
  assert.deepEqual(L.setSelectedStores(L.emptyState(), ['a', 'b', 'a']).selectedStoreIds, ['a', 'b']);
  assert.equal(L.formatQty({ qty: 2, unit: 'lb' }), '2 lb');
  assert.equal(L.formatQty({ qty: 3, unit: '' }), '3');
  assert.equal(L.formatQty({ qty: null, unit: '' }), '');
});

test('parseQuick handles numbers, fractions and units', () => {
  const cases = {
    '2 lb apples': { name: 'apples', qty: 2, unit: 'lb' },
    '1 1/2 cups flour': { name: 'flour', qty: 1.5, unit: 'cup' },
    '1/2 gal milk': { name: 'milk', qty: 0.5, unit: 'gal' },
    '3 bananas': { name: 'bananas', qty: 3, unit: '' },
    '2 pounds of ground beef': { name: 'ground beef', qty: 2, unit: 'lb' },
    'paper towels': { name: 'paper towels', qty: null, unit: '' },
    '7': { name: '7', qty: null, unit: '' },
  };
  for (const [input, want] of Object.entries(cases)) assert.deepEqual(L.parseQuick(input), want, input);
});

test('ids are unique', () => {
  const ids = new Set(Array.from({ length: 500 }, () => L.newId(1)));
  assert.equal(ids.size, 500);
});
