// v0.1.8-alpha regressions: L28 menu above the toast, L29 Save list double tap, L30 one favorite
// identity for Shop and list (+ migration), L31 "Favorites" capitalized in user-facing copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as L from '../src/list.js';
import * as S from '../src/storage.js';
import * as B from '../src/backup.js';
import * as F from '../src/favorites.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const W90 = { chain: 'wegmans', storeNo: '90', store: 'Wegmans #90' };

// ---------- L28 ----------
test('L28: every menu layer sits above the Undo toast (last z-index rule wins)', () => {
  const css = read('style.css');
  const z = (sel) => {
    const re = new RegExp(`(^|[},\\s])${sel.replace('.', '\\.')}\\s*(,[^{]*)?\\{[^}]*z-index:\\s*(\\d+)`, 'gm');
    const all = [...css.matchAll(re)].map((m) => Number(m[3]));
    assert.ok(all.length, `${sel} has a z-index`);
    return all[all.length - 1];
  };
  const toast = z('.toast');
  assert.ok(z('.menu') > toast, `.menu (${z('.menu')}) > .toast (${toast})`);
  assert.ok(z('.sort-menu') > toast, `.sort-menu (${z('.sort-menu')}) > .toast (${toast})`);
});

// ---------- L29 ----------
test('L29: Save list runs once for a double tap, once while in flight, again after the guard window', async () => {
  let t = 0; let runs = 0;
  const g = B.makeSaveGuard(async () => { runs += 1; return `file-${runs}.json`; }, { ms: 800, now: () => t });
  const [a, b] = await Promise.all([g(), g()]);
  assert.equal(runs, 1, 'second call while the first is in flight shares it');
  assert.deepEqual([a, b], ['file-1.json', 'file-1.json']);
  t = 300;
  assert.equal(await g(), 'file-1.json', 'a tap 300 ms later (reopened confirm) does not save again');
  assert.equal(runs, 1);
  t = 900;
  assert.equal(await g(), 'file-2.json', 'a deliberate save after the window still works');
  assert.equal(runs, 2);
  // a cancelled save (null) does not start the guard window
  let n = 0;
  const c = B.makeSaveGuard(async () => { n += 1; return n === 1 ? null : 'x.json'; }, { ms: 800, now: () => 0 });
  assert.equal(await c(), null);
  assert.equal(await c(), 'x.json');
  // an error releases the in-flight lock
  let e = 0;
  const d = B.makeSaveGuard(async () => { e += 1; if (e === 1) throw new Error('boom'); return 'y.json'; }, { now: () => 0 });
  await assert.rejects(d());
  assert.equal(await d(), 'y.json');
});

test('L29: app wires the guard and arms the reopened Clear confirm', () => {
  const app = read('src/app.js');
  assert.match(app, /const saveList = Bk\.makeSaveGuard\(saveListNow/);
  assert.match(app, /armMs: status \? \d+ : 0/, 'reopened after Save list first: armed delay');
  assert.match(app, /if \(performance\.now\(\) >= armedAt\) finish\(a\.value\)/, 'buttons ignore taps before armed');
});

// ---------- L30 ----------
const chickenList = { name: 'Boneless Chicken', qty: 2, unit: 'lb', storeId: '', priced: L.cleanPriced({ each: 4.99, unitPrice: 4.99, unit: 'lb', ...W90 }) };
const chickenShop = { name: 'Boneless Chicken', qty: null, unit: '', storeId: 'wegmans-90' };   // catalogFavSource shape

test('L30: a weight line starred on the list is the same favorite as its Shop result', () => {
  assert.equal(F.favKey(chickenList), F.favKey(chickenShop));
  let favs = F.starFavorite(F.emptyFavorites(), chickenList, 'f1');
  assert.equal(F.isFavorite(favs, chickenShop), true, 'Shop star shows filled');
  assert.equal(F.starFavorite(favs, chickenShop, 'f2'), favs, 'Shop star cannot add a second copy');
  assert.deepEqual(favs.items.map((i) => [i.qty, i.unit, i.storeId]), [[2, 'lb', 'wegmans-90']], 'keeps the amount the user starred');
  favs = F.unstarFavorite(favs, chickenShop);
  assert.equal(favs.items.length, 0, 'unstar from Shop removes it');
  // other stores stay separate
  assert.notEqual(F.favKey({ ...chickenShop, storeId: 'tops-451' }), F.favKey(chickenList));
});

test('L30: dedupeFavorites keeps the first, fills blanks, joins notes, never touches meals; idempotent', () => {
  // Old (pre-v0.1.10) data could hold duplicates; addFavorite now refuses them (M6), so build it raw.
  const raw = [
    { id: 'a', name: 'Boneless Chicken', qty: 2, unit: 'lb', storeId: 'wegmans-90', notes: '' },
    { id: 'b', name: 'Bread', storeId: 'wegmans-90' },
    { id: 'c', name: 'boneless chicken', storeId: 'wegmans-90', notes: 'thin cut' },
    { id: 'd', name: 'Bread', qty: 1, unit: 'loaf', storeId: 'wegmans-90', notes: 'rye' },
    { id: 'e', name: 'Bread', storeId: 'wegmans-90', notes: 'seeded' },
    { id: 'f', name: 'Bread', storeId: 'tops-451' },
  ];
  let fav = F.deserializeFavorites(JSON.stringify({ version: 1, items: raw, meals: [] }));
  fav = F.createMeal(fav, 'Dinner', [{ name: 'Bread' }, { name: 'bread' }], { id: 'm' });
  const r = F.dedupeFavorites(fav);
  assert.equal(r.merged, 3);
  assert.deepEqual(r.favorites.items.map((i) => [i.id, i.qty, i.unit, i.notes, i.storeId]), [
    ['a', 2, 'lb', 'thin cut', 'wegmans-90'],
    ['b', 1, 'loaf', 'rye · seeded', 'wegmans-90'],
    ['f', null, '', '', 'tops-451'],
  ]);
  assert.deepEqual(r.favorites.meals, fav.meals, 'meals untouched');
  const again = F.dedupeFavorites(r.favorites);
  assert.equal(again.merged, 0);
  assert.equal(again.favorites, r.favorites);
});

test('L30: load migrates old duplicates once, after copying the old set aside', () => {
  const st = S.memoryStorage();
  const old = JSON.stringify({ version: 1, meals: [], items: [
    { id: 'a', name: 'Boneless Chicken', qty: 2, unit: 'lb', storeId: 'wegmans-90', notes: '' },
    { id: 'b', name: 'Boneless Chicken', qty: null, unit: '', storeId: 'wegmans-90', notes: '' },
  ] });
  st.setItem(F.FAVORITES_KEY, old);
  const r = F.loadFavoritesWithStatus(st);
  assert.equal(r.merged, 1);
  assert.deepEqual(r.favorites.items.map((i) => i.id), ['a']);
  assert.equal(st.getItem(F.FAVORITES_DEDUPE_BAK_KEY), old, 'old set kept byte-identical');
  assert.deepEqual(JSON.parse(st.getItem(F.FAVORITES_KEY)).items.map((i) => i.id), ['a'], 'combined set saved');
  const r2 = F.loadFavoritesWithStatus(st);
  assert.equal(r2.merged, 0, 'second load: nothing to do');
  // if the copy can't be written, nothing changes
  const ro = S.memoryStorage();
  ro.setItem(F.FAVORITES_KEY, old);
  const setItem = ro.setItem;
  ro.setItem = () => { throw new Error('quota'); };
  const r3 = F.loadFavoritesWithStatus(ro);
  ro.setItem = setItem;
  assert.equal(r3.merged, 0);
  assert.equal(r3.favorites.items.length, 2, 'loaded unchanged');
  assert.equal(ro.getItem(F.FAVORITES_KEY), old);
  assert.equal(ro.getItem(F.FAVORITES_DEDUPE_BAK_KEY), null);
});

test('L30: Load list uses the same favorite identity; list lines still need the same unit', () => {
  const favs = F.addFavorite(F.emptyFavorites(), { name: 'Boneless Chicken', qty: 2, unit: 'lb', storeId: 'wegmans-90' }, 'a');
  const fileFavs = { version: 1, meals: [], items: [{ id: 'x', name: 'boneless chicken', qty: null, unit: '', storeId: 'wegmans-90', notes: '' }, { id: 'y', name: 'Boneless Chicken', qty: 3, unit: 'lb', storeId: 'wegmans-90', notes: '' }] };
  const cur = { state: L.emptyState(), favs, shopStore: '', listSort: null };
  const b = { state: { ...L.emptyState(), items: [] }, favs: fileFavs, shopStore: '' };
  const merged = B.applyBackup(cur, b, 'merge');
  assert.deepEqual(merged.favs.items.map((i) => i.id), ['a'], 'merge: same name + store skipped, whatever the unit');
  const replaced = B.applyBackup(cur, b, 'replace');
  assert.deepEqual(replaced.favs.items.map((i) => i.id), ['x'], 'replace: an older file\'s duplicates are combined');
  const l1 = { id: '1', name: 'Boneless Chicken', qty: 2, unit: 'lb', storeId: 'wegmans-90', notes: '', checked: false };
  const l2 = { ...l1, id: '2', qty: 3, unit: 'ct' };
  assert.notEqual(B.lineKey(l1), B.lineKey(l2), '2 lb + 3 ct never add into "5 lb"');
});

// ---------- L31 ----------
test('L31: "Favorites" is capitalized in user-facing copy (plural); keys, ids and code are exempt', () => {
  const offenders = [];
  for (const f of ['src/app.js', 'src/ui.js', 'src/backup.js', 'src/favorites.js', 'src/export.js', 'src/list.js', 'src/prices.js', 'src/storage.js']) {
    read(f).split('\n').forEach((line, i) => {
      const t = line.trim();
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return;
      for (const m of line.matchAll(/(['`"])((?:(?!\1).)*)\1/g)) {
        const s = m[2];
        if (/^shopsmartr[:-]|^\$\{FILE_STEM\}-|^\.\/|^#|^[a-z]+$/.test(s)) continue;   // storage keys, file names (v0.2.4), imports, ids/route names
        if (/\bfavorites\b/.test(s.replace(/shopsmartr[:-]favorites[\w:.-]*/g, '').replace(/\$\{[^}]*\}/g, ''))) offenders.push(`${f}:${i + 1}: ${s}`);
      }
    });
  }
  const html = read('index.html').replace(/<[^>]*>/g, '\n').replace(/<!--[\s\S]*?-->/g, '');
  for (const t of html.split('\n')) if (/\bfavorites\b/.test(t)) offenders.push(`index.html: ${t.trim()}`);
  assert.deepEqual(offenders, []);
  assert.match(read('src/app.js'), /Removed \$\{it\.name\} from Favorites/);
  assert.match(read('src/ui.js'), /`Remove \$\{it\.name\} from Favorites`/);
  assert.equal(B.summaryText({ items: 2, favorites: 4, meals: 1, stores: 1 }), '2 list items · 4 Favorites · 1 meal · 1 store');
});
