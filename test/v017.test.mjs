import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/list.js';
import * as F from '../src/favorites.js';
import * as B from '../src/backup.js';

const W90 = { chain: 'wegmans', storeNo: '90', store: 'Wegmans #90' };
const row = (o) => ({ id: o.id ?? 'r', name: 'Whole Milk', qty: 1, unit: 'gal', notes: '', storeId: 'wegmans-90', checked: false, ...o });

test('favorite identity: normalized name + store (v0.1.8 L30: unit is not identity); list merge keeps the unit', () => {
  const a = row({});
  assert.equal(F.favKey(a), 'whole milk|wegmans-90');
  assert.equal(F.favKey({ ...a, name: '  WHOLE   milk ', unit: 'gallon' }), F.favKey(a), 'name folded');
  assert.equal(F.favKey({ ...a, name: 'Crème Fraîche' }), F.favKey({ ...a, name: 'creme fraiche' }), 'accents folded');
  assert.equal(F.favKey({ ...a, unit: 'qt' }), F.favKey(a), 'unit is an amount, not identity (L30)');
  assert.notEqual(F.favKey({ ...a, storeId: 'tops-451' }), F.favKey(a), 'store matters');
  assert.equal(F.favKey({ ...a, storeId: '', priced: L.cleanPriced({ each: 1, ...W90 }) }), F.favKey(a), 'no chosen store: the price source store');
  assert.equal(B.lineKey(a), 'whole milk|gal|wegmans-90', 'list lines still merge on name + unit + store (quantities add)');
  assert.equal(B.lineKey({ ...a, unit: 'gallon' }), B.lineKey(a), 'unit alias normalized');
  assert.notEqual(B.lineKey({ ...a, unit: 'qt' }), B.lineKey(a));
  assert.equal(F.favKey({ name: 'Napkins' }), 'napkins|');
});

test('star on adds immediately (once); star off removes only that identity', () => {
  let favs = F.emptyFavorites();
  const milk = row({});
  const shopMilk = { name: 'Whole Milk', qty: null, unit: '', storeId: '', priced: L.cleanPriced({ each: 3.79, chain: 'wegmans', storeNo: '105', store: 'Wegmans #105' }) };
  favs = F.starFavorite(favs, milk, 'f1');
  assert.deepEqual(favs.items, [{ id: 'f1', name: 'Whole Milk', qty: 1, unit: 'gal', storeId: 'wegmans-90', notes: '' }]);
  assert.equal(F.isFavorite(favs, milk), true);
  assert.equal(F.starFavorite(favs, { ...milk, name: 'whole milk' }), favs, 'already a favorite: unchanged');
  assert.equal(F.isFavorite(favs, shopMilk), false, 'different store/unit is a different favorite');
  favs = F.starFavorite(favs, shopMilk, 'f2');
  assert.equal(favs.items[1].storeId, 'wegmans-105', 'a Shop result keeps its source store');
  assert.equal(F.isFavorite(favs, shopMilk), true);
  favs = F.createMeal(favs, 'Breakfast', [{ name: 'Whole Milk', unit: 'gal', storeId: 'wegmans-90' }], { id: 'm1' });
  const off = F.unstarFavorite(favs, milk);
  assert.deepEqual(off.items.map((i) => i.id), ['f2']);
  assert.equal(off.meals.length, 1, 'meals are never touched');
  assert.equal(F.findFavorite(off, milk), null);
  // A favorite made on the Favorites tab lights the star for the same list row
  const tab = F.addFavorite(F.emptyFavorites(), { name: 'whole milk', qty: 2, unit: 'gal', storeId: 'wegmans-90' }, 'f9');
  assert.equal(F.isFavorite(tab, milk), true);
});

test('Check all / Uncheck all with Undo restoring each line\'s prior done state', () => {
  const s = { ...L.emptyState(), items: [row({ id: 'a', checked: true }), row({ id: 'b', name: 'Eggs' }), row({ id: 'c', name: 'Bread' })] };
  const snap = L.checkedSnapshot(s);
  assert.deepEqual(snap, { a: true, b: false, c: false });
  const all = L.checkAll(s);
  assert.ok(all.items.every((i) => i.checked));
  assert.equal(all.items[0], s.items[0], 'already-checked lines untouched');
  assert.deepEqual(L.restoreChecked(all, snap).items.map((i) => i.checked), [true, false, false]);
  const none = L.uncheckAll(s);
  assert.ok(none.items.every((i) => !i.checked));
  assert.deepEqual(L.restoreChecked(none, snap).items.map((i) => i.checked), [true, false, false]);
  // lines removed or added since the snapshot are left alone
  const later = { ...all, items: [...all.items.slice(1), row({ id: 'd', name: 'Jam', checked: true })] };
  assert.deepEqual(L.restoreChecked(later, snap).items.map((i) => [i.id, i.checked]), [['b', false], ['c', false], ['d', true]]);
});

test('Clear checked items keeps unchecked lines, stores and zip (favorites are a separate store)', () => {
  const s = { ...L.emptyState(), items: [row({ id: 'a', checked: true }), row({ id: 'b', name: 'Eggs' })], selectedStoreIds: ['wegmans-90'], zip: '14221' };
  const c = L.clearChecked(s);
  assert.deepEqual(c.items.map((i) => i.id), ['b']);
  assert.deepEqual(c.selectedStoreIds, ['wegmans-90']);
  assert.equal(c.zip, '14221');
});

test('L27: a file loaded with Replace is remembered, so merging it later is refused', () => {
  const id = '12345678-aaaa-4bbb-8ccc-1234567890ab';
  const m = B.recordSaveId({}, id, 'replaced', Date.parse('2026-11-15T19:00:00Z'));
  assert.equal(m[id].how, 'replaced');
  assert.equal(B.repeatMergeText(m, id), 'This file was already loaded on Nov 15, 2026');
  const mem = new Map(); const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  B.saveMerged(m, st);
  assert.deepEqual(B.loadMerged(st), m, 'replaced records survive storage');
  B.saveMerged({}, st);
  assert.equal(B.repeatMergeText(B.loadMerged(st), id), null, 'Undo (restoring the previous map) forgets it');
});
