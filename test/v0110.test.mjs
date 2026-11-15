// v0.1.10-alpha regressions: M6 every favorite add/edit goes through the identity check and the
// L30 combine is idempotent (one notice, its backup never overwritten), L32 the confirm ignores
// backdrop clicks right after it opens, L33 Favorites/favorite copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as S from '../src/storage.js';
import * as B from '../src/backup.js';
import * as F from '../src/favorites.js';
import { emptyState } from '../src/list.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const rawFavs = (items) => JSON.stringify({ version: 1, items, meals: [] });

test('M6: the Favorites-tab add refuses a second favorite with the same name + store', () => {
  let fav = F.addFavorite(F.emptyFavorites(), { name: 'Milk', qty: 1, unit: 'gal' }, 'a');
  assert.throws(() => F.addFavorite(fav, { name: 'milk', qty: 3 }, 'b'), (e) => e instanceof F.DuplicateFavoriteError && e.existing.id === 'a' && /Milk is already in your Favorites/.test(e.message));
  assert.throws(() => F.addFavorite(fav, { name: '  MILK ' }), F.DuplicateFavoriteError, 'case and spaces fold');
  fav = F.addFavorite(fav, { name: 'Milk', storeId: 'tops-451' }, 'c');   // another store is another favorite
  assert.deepEqual(fav.items.map((i) => i.id), ['a', 'c']);
  assert.equal(F.dedupeFavorites(fav).merged, 0, 'nothing for the migration to combine');
});

test('M6: an edit (rename or store change) into an existing identity is refused; other edits work', () => {
  let fav = F.addFavorite(F.emptyFavorites(), { name: 'Milk' }, 'a');
  fav = F.addFavorite(fav, { name: 'Eggs' }, 'b');
  fav = F.addFavorite(fav, { name: 'Milk', storeId: 'tops-451' }, 'c');
  assert.throws(() => F.updateFavorite(fav, 'b', { name: 'milk' }), (e) => e instanceof F.DuplicateFavoriteError && e.existing.id === 'a');
  assert.throws(() => F.updateFavorite(fav, 'c', { storeId: '' }), F.DuplicateFavoriteError);
  const ok = F.updateFavorite(fav, 'a', { name: 'MILK', qty: 2, unit: 'gal' });   // same item, new amount
  assert.equal(ok.items[0].qty, 2);
  assert.equal(F.updateFavorite(fav, 'zz', { name: 'x' }), fav, 'unknown id: unchanged');
});

test('M6: every staple add path keeps one favorite per identity (star, Shop star, Load merge, Load replace)', () => {
  let fav = F.addFavorite(F.emptyFavorites(), { name: 'Bread', storeId: 'wegmans-90' }, 'a');
  fav = F.starFavorite(fav, { name: 'bread', storeId: 'wegmans-90', qty: 2, unit: 'loaf' });
  fav = F.starFavorite(fav, { name: 'Bread', priced: { chain: 'wegmans', storeNo: '90' } });
  assert.equal(fav.items.length, 1);
  const doc = B.makeBackup({ state: emptyState(), favs: F.deserializeFavorites(rawFavs([{ id: 'x', name: 'BREAD', storeId: 'wegmans-90' }, { id: 'y', name: 'bread ', storeId: 'wegmans-90' }])), appVersion: '0.1.10-alpha' });
  const r = B.parseBackup(B.backupJSON(doc));
  const cur = { state: emptyState(), favs: fav, shopStore: '', listSort: null };
  assert.equal(B.applyBackup(cur, r.backup, 'merge').favs.items.length, 1, 'merge skips both copies');
  assert.equal(B.applyBackup(cur, r.backup, 'replace').favs.items.length, 1, 'replace combines the file\'s copies');
});

test('M6: the combine on load is idempotent: one notice, and its backup is never overwritten', () => {
  const st = S.memoryStorage();
  const v1 = rawFavs([{ id: 'a', name: 'Milk' }, { id: 'b', name: 'milk', qty: 3 }]);
  st.setItem(F.FAVORITES_KEY, v1);
  const r1 = F.loadFavoritesWithStatus(st, new Date('2026-11-15T21:00:00Z'));
  assert.equal(r1.merged, 1); assert.equal(r1.notice, true);
  assert.equal(st.getItem(F.FAVORITES_DEDUPE_BAK_KEY), v1);
  const r2 = F.loadFavoritesWithStatus(st);
  assert.equal(r2.merged, 0); assert.equal(r2.notice, false, 'reload: nothing to do, no notice');
  // Old duplicates arriving later (e.g. written by an older tab) are combined again, silently,
  // into a timestamped copy; the first copy the notice named is untouched.
  for (let i = 0; i < 5; i += 1) {
    st.setItem(F.FAVORITES_KEY, rawFavs([{ id: 'a', name: 'Milk' }, { id: `d${i}`, name: 'MILK' }]));
    const r = F.loadFavoritesWithStatus(st, new Date(Date.UTC(2026, 10, 16, 12, i)));
    assert.equal(r.merged, 1); assert.equal(r.notice, false, `later combine ${i}: no repeat notice`);
    assert.notEqual(r.bakKey, F.FAVORITES_DEDUPE_BAK_KEY);
    assert.equal(st.getItem(F.FAVORITES_DEDUPE_BAK_KEY), v1, 'first copy never overwritten');
  }
  const meta = JSON.parse(st.getItem(F.FAVORITES_DEDUPE_META_KEY));
  assert.equal(meta.extra.length, F.MAX_EXTRA_DEDUPE_BAKS, 'only the newest few timestamped copies are kept');
  for (const k of meta.extra) assert.match(k, /^shopsmartr:favorites:v1\.predupe\.[0-9TZ]+(\.\d+)?\.bak$/);
  assert.ok(meta.extra.every((k) => st.getItem(k)), 'listed copies exist');
});

test('M6: same-millisecond combines get distinct copies; a v0.1.8 copy already present means no notice', () => {
  const st = S.memoryStorage();
  st.setItem(F.FAVORITES_DEDUPE_BAK_KEY, 'v0.1.8 original');
  const t = new Date('2026-11-16T00:00:00Z');
  const keys = [];
  for (let i = 0; i < 2; i += 1) {
    st.setItem(F.FAVORITES_KEY, rawFavs([{ id: 'a', name: 'Eggs' }, { id: 'b', name: 'eggs' }]));
    const r = F.loadFavoritesWithStatus(st, t);
    assert.equal(r.notice, false);
    keys.push(r.bakKey);
  }
  assert.notEqual(keys[0], keys[1]);
  assert.equal(st.getItem(F.FAVORITES_DEDUPE_BAK_KEY), 'v0.1.8 original');
});

test('L32: confirm backdrop clicks are ignored while unarmed and for 300 ms after opening', () => {
  const app = read('src/app.js');
  assert.match(app, /const BACKDROP_GRACE_MS = 300;/);
  assert.match(app, /dlg\.dataset\.armed === 'false' \|\| performance\.now\(\) - \(dlg\._openedAt \?\? 0\) < BACKDROP_GRACE_MS\) return;/);
  assert.match(app, /dlg\._openedAt = performance\.now\(\);\s*dlg\.showModal\(\);/);
});

test('L33: plural "Favorites" (the collection), singular "favorite"', () => {
  assert.equal(B.summaryText({ items: 2, favorites: 3, meals: 1, stores: 1 }), '2 list items · 3 Favorites · 1 meal · 1 store');
  assert.equal(B.summaryText({ items: 1, favorites: 1, meals: 0, stores: 2 }), '1 list item · 1 favorite · 0 meals · 2 stores');
  const app = read('src/app.js');
  assert.ok(!/n\('favorites', 'favorite'\)/.test(app), 'Load pill no longer lowercase plural');
  assert.match(app, /'1 duplicate favorite' : `\$\{favLoaded\.merged\} duplicate Favorites`/);
  assert.ok(!/duplicate Favorite\$\{/.test(app));
  assert.ok(!/5\.2:1 light, filled star/.test(read('style.css')), 'stale contrast comment updated');
});
