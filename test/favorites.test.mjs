import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/list.js';
import * as F from '../src/favorites.js';
import { memoryStorage } from '../src/storage.js';
import { favoritesToCSV, favoritesToText, toText, FAVORITES_CSV_HEADER, CSV_BOM } from '../src/export.js';

function sample() {
  let f = F.emptyFavorites();
  f = F.addFavorite(f, { name: 'Milk', qty: 1, unit: 'gal', storeId: 'wegmans-83' }, 'f1');
  f = F.addFavorite(f, { name: 'Bananas' }, 'f2');
  f = F.createMeal(f, '  Taco   night ', [{ name: 'Tortillas', qty: 1, unit: 'pack' }, { name: 'Cheese, shredded' }], { id: 'm1' });
  return f;
}

test('favorite items: add, edit, remove', () => {
  let f = sample();
  assert.deepEqual(f.items.map((i) => i.name), ['Milk', 'Bananas']);
  assert.deepEqual(f.items[0], { id: 'f1', name: 'Milk', qty: 1, unit: 'gal', storeId: 'wegmans-83', notes: '' });
  f = F.updateFavorite(f, 'f2', { qty: 6, unit: 'ea', storeId: 'aldi-1' });
  assert.equal(f.items[1].qty, 6);
  assert.equal(f.items[1].storeId, 'aldi-1');
  assert.throws(() => F.updateFavorite(f, 'f2', { name: '  ' }), /required/);
  assert.throws(() => F.addFavorite(f, { name: 'x', qty: -1 }), /positive/);
  f = F.removeFavorite(f, 'f1');
  assert.deepEqual(f.items.map((i) => i.id), ['f2']);
});

test('meals: create, rename, edit items, delete', () => {
  let f = sample();
  assert.equal(f.meals[0].name, 'Taco night');
  assert.equal(f.meals[0].items.length, 2);
  f = F.renameMeal(f, 'm1', 'Taco Tuesday');
  assert.equal(f.meals[0].name, 'Taco Tuesday');
  assert.throws(() => F.renameMeal(f, 'm1', ' '), /required/);
  f = F.addMealItem(f, 'm1', { name: 'Salsa', qty: 1, unit: 'jar' }, 'mi3');
  f = F.updateMealItem(f, 'm1', 'mi3', { qty: 2 });
  assert.equal(f.meals[0].items[2].qty, 2);
  f = F.removeMealItem(f, 'm1', f.meals[0].items[0].id);
  assert.deepEqual(f.meals[0].items.map((i) => i.name), ['Cheese, shredded', 'Salsa']);
  f = F.deleteMeal(f, 'm1');
  assert.equal(f.meals.length, 0);
});

test('add to list skips names already on the list unchecked, and in-batch repeats', () => {
  let s = L.emptyState();
  s = L.addItem(s, { name: '  milk ' }, 'a');           // unchecked: blocks "Milk"
  s = L.addItem(s, { name: 'Bananas' }, 'b');
  s = L.toggleItem(s, 'b', true);                       // checked: does NOT block
  const res = F.addFavoritesToList(s, [...sample().items, { name: 'BANANAS' }, { name: 'Crème fraîche' }, { name: 'creme fraiche' }]);
  assert.equal(res.added, 2);
  assert.equal(res.skipped, 3);
  assert.deepEqual(res.state.items.map((i) => i.name), ['milk', 'Bananas', 'Bananas', 'Crème fraîche']);
  const added = res.state.items[2];
  assert.equal(added.checked, false);
  // Re-running adds nothing.
  const again = F.addFavoritesToList(res.state, sample().items);
  assert.equal(again.added, 0);
  assert.equal(again.state, res.state);
  assert.equal(F.addedMessage(again, 'Favorites'), 'Favorites: already on your list');
  assert.equal(F.addedMessage(res), 'Added 2 items (3 already on the list)');
  assert.equal(F.addedMessage({ added: 1, skipped: 0 }), 'Added 1 item');
});

test('adding a meal keeps qty, unit and store', () => {
  const f = sample();
  const res = F.addFavoritesToList(L.emptyState(), f.meals[0].items);
  assert.equal(res.added, 2);
  assert.deepEqual(res.state.items.map(({ name, qty, unit }) => ({ name, qty, unit })),
    [{ name: 'Tortillas', qty: 1, unit: 'pack' }, { name: 'Cheese, shredded', qty: null, unit: '' }]);
  const one = F.addFavoritesToList(L.emptyState(), [f.items[0]]);
  assert.equal(one.state.items[0].storeId, 'wegmans-83');
});

test('nameKey is case, space and accent insensitive', () => {
  assert.equal(F.nameKey('  Crème   Fraîche '), 'creme fraiche');
  assert.equal(F.nameKey('MILK'), F.nameKey('milk'));
});

test('persistence round-trip and defensive load', () => {
  const store = memoryStorage();
  const f = sample();
  assert.equal(F.saveFavorites(f, store), true);
  assert.deepEqual(F.loadFavorites(store), f);
  store.setItem(F.FAVORITES_KEY, '{not json');
  assert.deepEqual(F.loadFavorites(store), F.emptyFavorites());
  store.setItem(F.FAVORITES_KEY, JSON.stringify({ version: 1, items: [{ id: 'ok', name: 'Eggs' }, { id: 'x', name: '' }, null, { id: 3 }],
    meals: [{ id: 'm', name: 'Soup', items: [{ id: 'i', name: 'Broth', qty: -2 }, { id: 'j', name: 'Noodles' }] }, { id: 'bad', name: '' }] }));
  const got = F.loadFavorites(store);
  assert.deepEqual(got.items.map((i) => i.name), ['Eggs']);
  assert.deepEqual(got.meals.map((m) => [m.name, m.items.map((i) => i.name)]), [['Soup', ['Noodles']]]);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.deepEqual(F.loadFavorites(broken), F.emptyFavorites());
  assert.equal(F.saveFavorites(f, broken), false);
});

test('phase-2 hook: starring a recipe creates one meal and updates it on re-star', () => {
  let f = F.emptyFavorites();
  const recipe = { id: 42, title: 'Chili', url: 'https://example.invalid/chili', ingredients: [{ name: 'Beans', qty: 2, unit: 'can' }, { name: '' }] };
  f = F.starRecipe(f, recipe);
  assert.equal(f.meals.length, 1);
  assert.deepEqual(f.meals[0].source, { type: 'recipe', id: '42', url: 'https://example.invalid/chili' });
  assert.deepEqual(f.meals[0].items.map((i) => i.name), ['Beans']);
  f = F.starRecipe(f, { ...recipe, title: 'Chili (mild)', ingredients: [{ name: 'Beans' }, { name: 'Onion' }] });
  assert.equal(f.meals.length, 1);
  assert.equal(f.meals[0].name, 'Chili (mild)');
  assert.equal(f.meals[0].items.length, 2);
  const round = F.deserializeFavorites(F.serializeFavorites(f));
  assert.deepEqual(round.meals[0].source, f.meals[0].source);
  assert.equal(F.createMeal(F.emptyFavorites(), 'x', [], { source: { type: 'recipe', id: 1, url: 'javascript:alert(1)' } }).meals[0].source.url, undefined);
});

test('favorites CSV export', () => {
  const stores = { 'wegmans-83': { name: 'Wegmans Sheridan Dr.' } };
  let f = sample();
  f = F.createMeal(f, 'Empty', [], { id: 'm2' });
  f = F.addFavorite(f, { name: '=1+1', notes: 'say "hi"' }, 'f3');
  const csv = favoritesToCSV(f, stores);
  const lines = csv.trimEnd().split('\r\n');
  assert.equal(lines[0], FAVORITES_CSV_HEADER.join(','));
  assert.equal(lines[1], 'staple,,Milk,1,gal,Wegmans Sheridan Dr.,');
  assert.equal(lines[2], 'staple,,Bananas,,,,');
  assert.equal(lines[3], `staple,,'=1+1,,,,"say ""hi"""`);
  assert.equal(lines[4], 'meal,Taco night,Tortillas,1,pack,,');
  assert.equal(lines[5], 'meal,Taco night,"Cheese, shredded",,,,');
  assert.equal(lines[6], 'meal,Empty,,,,,');
  assert.ok(favoritesToCSV(f, stores, { bom: true }).startsWith(CSV_BOM + 'Type,'));
});

test('text export gains a Favorites section only when there are favorites', () => {
  const stores = { 'wegmans-83': { name: 'Wegmans Sheridan Dr.' } };
  const f = sample();
  const txt = favoritesToText(f, stores);
  assert.match(txt, /^== Favorites ==\n\nStaples:\n- 1 gal Milk @ Wegmans Sheridan Dr\.\n- Bananas\n\nMeal: Taco night\n- 1 pack Tortillas\n- Cheese, shredded\n$/);
  assert.equal(favoritesToText(F.emptyFavorites()), '');
  const list = toText([], {}, { date: '2026-11-14' });
  assert.equal(toText([], {}, { date: '2026-11-14', favorites: F.emptyFavorites() }), list);
  assert.equal(toText([], stores, { date: '2026-11-14', favorites: f }), `${list}\n${txt}`);
});

test('L8: unreadable favorites are backed up and reported, not silently overwritten', () => {
  for (const raw of ['{broken', JSON.stringify({ version: 2, items: [] }), '"just a string"', 'null']) {
    const store = memoryStorage();
    store.setItem(F.FAVORITES_KEY, raw);
    const r = F.loadFavoritesWithStatus(store);
    assert.equal(r.problem, 'unreadable', raw);
    assert.equal(r.backedUp, true);
    assert.equal(store.getItem(F.FAVORITES_BACKUP_KEY), raw);
    assert.deepEqual(r.favorites, F.emptyFavorites());
    // Saving new favorites afterwards leaves the backup intact.
    F.saveFavorites(F.addFavorite(r.favorites, { name: 'Milk' }), store);
    assert.equal(store.getItem(F.FAVORITES_BACKUP_KEY), raw);
  }
  const fresh = memoryStorage();
  assert.deepEqual(F.loadFavoritesWithStatus(fresh), { favorites: F.emptyFavorites(), problem: null, backedUp: false });
  const saved = sample();
  F.saveFavorites(saved, fresh);
  const ok = F.loadFavoritesWithStatus(fresh);
  assert.equal(ok.problem, null);
  assert.deepEqual(ok.favorites, saved);
  assert.equal(fresh.getItem(F.FAVORITES_BACKUP_KEY), null);
  const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('x'); } };
  assert.equal(F.loadFavoritesWithStatus(blocked).problem, 'unavailable');
  const noBackup = { getItem: () => '{broken', setItem() { throw new Error('QuotaExceeded'); } };
  assert.deepEqual(F.loadFavoritesWithStatus(noBackup), { favorites: F.emptyFavorites(), problem: 'unreadable', backedUp: false });
});
