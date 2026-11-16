// v0.2.0-alpha: L34 Load pill count, saved recipes in Favorites, recipe back-link on list items.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as B from '../src/backup.js';
import * as F from '../src/favorites.js';
import * as L from '../src/list.js';

test('L34: the Load summary counts Favorites after the duplicate combine', () => {
  const fav = { version: 1, meals: [], items: [
    { id: 'a', name: 'Milk', qty: 1, unit: 'gal', storeId: '' },
    { id: 'b', name: 'milk', qty: 2, unit: 'gal', storeId: '' },
    { id: 'c', name: 'Eggs', qty: 12, unit: '', storeId: '' },
  ] };
  const b = { state: L.emptyState(), favs: fav, appVersion: '0.2.0-alpha', createdAt: new Date().toISOString() };
  assert.equal(B.summarize(b).favorites, 2);
  assert.equal(B.summarize(b).favorites, F.dedupeFavorites(fav).favorites.items.length);
});

test('saved recipes: star, no duplicates, unstar, newest first, round-trip', () => {
  let f = F.emptyFavorites();
  f = F.saveRecipe(f, { id: 'r1', title: 'Soup', image: 'https://x.example/a.jpg' }, new Date('2026-11-01'));
  f = F.saveRecipe(f, { id: 'r2', title: 'Tacos', image: 'javascript:alert(1)' }, new Date('2026-11-02'));
  f = F.saveRecipe(f, { id: 'r1', title: 'Soup' });
  assert.equal(f.recipes.length, 2);
  assert.equal(F.savedRecipes(f)[0].id, 'r2');
  assert.equal(f.recipes.find((r) => r.id === 'r2').image, null);
  assert.ok(F.isRecipeSaved(f, 'r1'));
  const back = F.deserializeFavorites(F.serializeFavorites(f));
  assert.deepEqual(back.recipes, f.recipes);
  assert.equal(F.unsaveRecipe(f, 'r1').recipes.length, 1);
  assert.deepEqual(F.deserializeFavorites(JSON.stringify({ version: 1, items: [], meals: [] })).recipes, []);
});

test('Replace from a backup/1 file keeps this device\'s saved recipes', () => {
  const cur = { state: L.emptyState(), favs: F.saveRecipe(F.emptyFavorites(), { id: 'r1', title: 'Soup' }), shopStore: '', listSort: { by: 'name', dir: 'asc' } };
  const file = B.makeBackup({ state: L.emptyState(), favs: F.emptyFavorites(), appVersion: '0.2.0-alpha' });
  const parsed = B.parseBackup(JSON.stringify({ ...file, schema: 'shopsmartr.backup/1', favorites: { items: [], meals: [] } }));
  assert.ok(parsed.ok);
  const out = B.applyBackup(cur, parsed.backup, 'replace');
  assert.equal(out.favs.recipes.length, 1);
});

test('list items keep a recipe back-link', () => {
  const s = L.addItem(L.emptyState(), { name: 'Lemons', qty: 2, recipe: { id: 'r9', title: 'Lemon Chicken' } });
  assert.deepEqual(s.items[0].recipe, { id: 'r9', title: 'Lemon Chicken' });
  assert.equal(L.addItem(L.emptyState(), { name: 'x', recipe: { id: '', title: 'y' } }).items[0].recipe, undefined);
});

test('household size: default 3, clamps bad values', async () => {
  const { loadHousehold, HOUSEHOLD_KEY } = await import('../src/rx.js');
  const { memoryStorage } = await import('../src/storage.js');
  const s = memoryStorage();
  assert.equal(loadHousehold(s), 3);
  s.setItem(HOUSEHOLD_KEY, '5'); assert.equal(loadHousehold(s), 5);
  s.setItem(HOUSEHOLD_KEY, '0'); assert.equal(loadHousehold(s), 3);
  s.setItem(HOUSEHOLD_KEY, 'x'); assert.equal(loadHousehold(s), 3);
});
