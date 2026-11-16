// v0.2.4: Happy Wife Helper rename, App icon, key registry + full backup, hidden chains (flag on and off).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import * as B from '../src/backup.js';
import * as K from '../src/keys.js';
import * as I from '../src/appicon.js';
import * as C from '../src/catalog.js';
import * as R from '../src/recipes.js';
import * as L from '../src/list.js';
import * as F from '../src/favorites.js';
import { HIDDEN_CHAINS, withHiddenChains, shownChains, shownStores, isShownChain, HIDE_NON_WEGMANS } from '../src/stores.js';
import { memoryStorage } from '../src/storage.js';
import { APP_NAME, SHORT_NAME, REPO_URL, LIVE_URL, isStandalone } from '../src/brand.js';
import { VERSION } from '../src/version.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');

// ---------- rename ----------
test('rename: user-facing name is Happy Wife Helper; repo, keys, feeds and format ids keep shopsmartr', () => {
  const html = read('index.html');
  assert.match(html, /<title>Happy Wife Helper<\/title>/);
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Happy Wife">/);
  assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/);
  const visible = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]*>/g, '\n');
  assert.ok(!/ShopSmart/.test(visible), 'no ShopSmartR in visible HTML text');
  for (const f of ['src/app.js', 'src/backup.js', 'src/export.js', 'src/ui.js']) {
    const code = read(f).split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
    assert.ok(!/ShopSmartR/.test(code), `${f}: no ShopSmartR in user-facing strings`);
  }
  assert.equal(APP_NAME, 'Happy Wife Helper');
  assert.equal(SHORT_NAME, 'Happy Wife');
  assert.equal(B.BACKUP_SCHEMA, 'shopsmartr.backup/2', 'backup format id unchanged');
  assert.equal(B.backupFilename('2026-11-15'), 'happy-wife-helper-backup-2026-11-15.json');
  assert.match(read('src/prices.js'), /'shopsmartr\.prices\.enc\/v2;z=gzip'/, 'encryption AAD unchanged');
  assert.match(read('src/recipes.js') + read('src/rx.js'), /shopsmartr\.recipes|recipes\.enc/, 'recipe feed names unchanged');
  assert.equal(JSON.parse(read('package.json')).name, 'shopsmartr', 'package/repo name unchanged');
  assert.equal(JSON.parse(read('package.json')).version, VERSION);
  assert.match(VERSION, /^0\.2\.\d+-alpha$/);   // v0.2.5: exact version is checked in v025.test.mjs
});

test('manifest: Happy Wife Helper, short name, tomato theme, fixed id, Love Basket icons that exist', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.name, 'Happy Wife Helper');
  assert.equal(m.short_name, 'Happy Wife');
  assert.equal(m.id, './');
  assert.equal(m.start_url, './');
  assert.equal(m.display, 'standalone');
  assert.equal(m.theme_color, '#C8321F');
  assert.equal(m.icons.length, 4);
  for (const i of m.icons) {
    assert.match(i.src, /^icons\/love-basket\//);
    assert.ok(existsSync(new URL(`../${i.src}`, import.meta.url)), i.src);
  }
  assert.deepEqual([...new Set(m.icons.map((i) => i.purpose))].sort(), ['any', 'maskable']);
});

// ---------- app icon ----------
test('app icon: 5 approved icons, Love Basket default, every picker file shipped, choice saved per device', () => {
  assert.equal(I.APP_ICONS.length, 5);
  assert.equal(I.DEFAULT_APP_ICON, 'love-basket');
  assert.equal(I.APP_ICON_KEY, 'shopsmartr:appIcon:v1');
  for (const [id] of I.APP_ICONS) {
    for (const f of ['icon-64.png', 'favicon.svg', 'favicon-32.png', 'favicon-16.png', 'favicon.ico', 'apple-touch-icon-180.png']) {
      assert.ok(existsSync(new URL(`../icons/${id}/${f}`, import.meta.url)), `icons/${id}/${f}`);
    }
  }
  const st = memoryStorage();
  assert.equal(I.loadAppIcon(st), 'love-basket');
  I.saveAppIcon('heart-whisk', st);
  assert.equal(I.loadAppIcon(st), 'heart-whisk');
  st.setItem(I.APP_ICON_KEY, '../../evil');
  assert.equal(I.loadAppIcon(st), 'love-basket', 'junk falls back to the default');
  assert.deepEqual(I.iconHrefs('tomato-heart'), { svg: 'icons/tomato-heart/favicon.svg', png32: 'icons/tomato-heart/favicon-32.png', png16: 'icons/tomato-heart/favicon-16.png', ico: 'icons/tomato-heart/favicon.ico', apple: 'icons/tomato-heart/apple-touch-icon-180.png', logo: 'icons/tomato-heart/icon-64.png' });
  // the <head> boot script knows exactly the non-default ids
  const boot = /\^\(([^)]*)\)\$/.exec(read('index.html'))[1].split('|').sort();
  assert.deepEqual(boot, I.APP_ICONS.map(([id]) => id).filter((id) => id !== 'love-basket').sort());
});

test('app icon: applyAppIcon swaps favicons, apple-touch-icon and logos', () => {
  const nodes = {}; const imgs = [{ attrs: {} }, { attrs: {} }];
  const node = () => ({ attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, getAttribute(k) { return this.attrs[k] ?? null; } });
  for (const id of ['fav-ico', 'fav-svg', 'fav-32', 'fav-16', 'apple-icon']) nodes[`#${id}`] = node();
  for (const i of imgs) { i.setAttribute = function (k, v) { this.attrs[k] = v; }; i.getAttribute = function (k) { return this.attrs[k] ?? null; }; }
  const doc = { querySelector: (s) => nodes[s] ?? null, querySelectorAll: () => imgs, documentElement: { dataset: {} } };
  I.applyAppIcon('happy-bag', doc);
  assert.equal(nodes['#apple-icon'].attrs.href, 'icons/happy-bag/apple-touch-icon-180.png');
  assert.equal(nodes['#fav-svg'].attrs.href, 'icons/happy-bag/favicon.svg');
  assert.equal(nodes['#fav-32'].attrs.href, 'icons/happy-bag/favicon-32.png');
  assert.ok(imgs.every((i) => i.attrs.src === 'icons/happy-bag/icon-64.png'));
  assert.equal(doc.documentElement.dataset.appIcon, 'happy-bag');
  let writes = 0; for (const n of Object.values(nodes)) n.setAttribute = () => { writes += 1; };
  I.applyAppIcon('happy-bag', doc);
  assert.equal(writes, 0, 'unchanged hrefs are not rewritten (no aborted favicon fetch)');
});

test('About + picker copy: links, steps, back-up-first, never promises data is safe', () => {
  const html = read('index.html');
  const about = html.slice(html.indexOf('id="about-sheet"'), html.indexOf('</dialog>', html.indexOf('id="about-sheet"')));
  assert.match(about, /Made by Steven Moran/);
  assert.ok(about.includes(`href="${REPO_URL}"`) && about.includes(`href="${LIVE_URL}"`));
  for (const a of about.match(/<a [^>]*href="https:[^>]*>/g)) assert.match(a, /target="_blank" rel="noopener"/);
  assert.match(about, /Safari[\s\S]*Share[\s\S]*Add to Home Screen/);
  assert.match(about, /Back up first/);
  assert.match(about, /id="about-copy"/);
  const icon = html.slice(html.indexOf('id="icon-sheet"'), html.indexOf('</dialog>', html.indexOf('id="icon-sheet"')));
  assert.match(icon, /Back up first[\s\S]*data-backup-now[\s\S]*Add to Home Screen[\s\S]*Restore/);
  assert.match(icon, /may erase/);
  assert.ok(!/(is|stays|will be) safe|won't lose|safe to remove/i.test(about + icon), 'never says the data is safe');
  assert.equal(isStandalone({ navigator: { standalone: true } }), true);
  assert.equal(isStandalone({ navigator: {}, matchMedia: (q) => ({ matches: q === '(display-mode: standalone)' }) }), true);
  assert.equal(isStandalone({ navigator: {}, matchMedia: () => ({ matches: false }) }), false);
});

test('global menu: v2 layout; no Clear list, My stores or Save & export; Theme row present', () => {
  const html = read('index.html');
  const m = html.slice(html.indexOf('id="export-menu"'), html.indexOf('<div class="menu sort-menu" id="sort-menu"'));
  const acts = [...m.matchAll(/data-action="(\w+)"/g)].map((x) => x[1]);
  for (const a of ['save', 'load', 'household', 'ads', 'appicon', 'about', 'export', 'checkall', 'uncheck', 'clear']) assert.ok(acts.includes(a), a);
  assert.ok(m.indexOf('class="love"') < m.indexOf('data-action'), 'love note on top');
  assert.ok(!/Clear list|My stores|Save &amp; export/.test(m));
  assert.match(m, /data-action="theme"/);   // v0.2.5: the Theme row is shown (v025.test.mjs checks it isn't hidden)
  assert.ok(!/only-list" data-menu-toggle/.test(html), 'the ⋮ button is on every tab');
  assert.match(html, /class="nav more" data-menu-toggle/, 'desktop side-nav More opens the same menu');
});

// ---------- key registry ----------
test('key registry: every shopsmartr:* key used in src/ is classified (fails on a new unclassified key)', () => {
  const found = new Set();
  for (const f of readdirSync(new URL('../src/', import.meta.url))) {
    if (!f.endsWith('.js')) continue;
    for (const m of read(`src/${f}`).matchAll(/['"`](shopsmartr:[^'"`$]*)/g)) found.add(m[1]);
  }
  assert.ok(found.size >= 20, `found ${found.size} keys`);
  const un = [...found].filter((k) => !K.classifyKey(k));
  assert.deepEqual(un, [], `unclassified: ${un.join(', ')}`);
  assert.equal(K.classifyKey('shopsmartr:brandNew:v1'), null, 'an unknown key is unclassified');
  assert.equal(K.classifyKey('shopsmartr:favorites:v1.predupe.20261115T120000Z.bak'), 'exclude');
  for (const k of ['shopsmartr:v1', 'shopsmartr:favorites:v1', 'shopsmartr:shopStore:v1', 'shopsmartr:rxSwaps:v1']) assert.equal(K.classifyKey(k), 'backup', k);
  for (const k of ['shopsmartr:listSort:v1', 'shopsmartr:household:v1', 'shopsmartr:appIcon:v1', 'shopsmartr:rxStore:v1', 'shopsmartr:theme:v1', 'shopsmartr:mode:v1']) assert.equal(K.classifyKey(k), 'settings', k);
  for (const k of ['shopsmartr:v1.bak', 'shopsmartr:beforeLoad:v1.bak', 'shopsmartr:beforeClear:v1.bak', 'shopsmartr:mergedSaves:v1', 'shopsmartr:backupMeta:v1', 'shopsmartr:notes:v1']) assert.equal(K.classifyKey(k), 'exclude', k);
  assert.deepEqual(K.EXCLUDED_STORES.map((s) => s.indexedDB), ['shopsmartr-keys']);
  assert.match(read('src/prices.js'), /const DB = 'shopsmartr-keys'/, 'derived keys live in that IndexedDB only');
});

// ---------- full backup ----------
const STATE = { ...L.emptyState(), zip: '14221', radiusMi: 10, selectedStoreIds: ['wegmans-82', 'tops-451'], items: [
  { id: 'w1', name: 'Bananas', qty: 2, unit: 'lb', notes: '', storeId: 'wegmans-82', checked: false },
  { id: 't1', name: 'Tops bread', qty: 1, unit: '', notes: '', storeId: 'tops-451', checked: false },
] };
const FAVS = { ...F.emptyFavorites(), items: [{ id: 'f1', name: 'Tops coffee', qty: null, unit: '', notes: '', storeId: 'tops-451' }], recipes: [{ id: 'r1', title: 'Soup', savedAt: '2026-11-10T12:00:00.000Z' }] };

function device() {
  const st = memoryStorage();
  st.setItem('shopsmartr:household:v1', '5');
  st.setItem('shopsmartr:appIcon:v1', 'heart-whisk');
  st.setItem('shopsmartr:listSort:v1', JSON.stringify({ by: 'price', dir: 'asc' }));
  st.setItem('shopsmartr:rxStore:v1', 'wegmans:90');
  st.setItem('shopsmartr:rxSwaps:v1', JSON.stringify({ 'milk|wegmans:90': '123' }));
  st.setItem('shopsmartr:rxSort:browse:v1', JSON.stringify({ by: 'rating' }));
  st.setItem('shopsmartr:theme:v1', 'blueberry-lemon');
  // things that must never travel
  st.setItem('shopsmartr:beforeLoad:v1.bak', '{"list":"secret-old-copy"}');
  st.setItem('shopsmartr:mergedSaves:v1', '{}');
  st.setItem('shopsmartr:notes:v1', '{"i":3}');
  st.setItem('shopsmartr:collapsed:v1', '["any"]');
  return st;
}

test('full backup round trip: list, Favorites, saved recipes, stores and settings; excluded keys never travel', () => {
  const st = device();
  const prefs = K.collectPrefs(st);
  assert.deepEqual(Object.keys(prefs).sort(), ['appIcon', 'household', 'listSort', 'rxSort', 'rxStore', 'rxSwaps', 'theme']);
  const doc = B.makeBackup({ state: STATE, favs: FAVS, shopStore: 'wegmans:90', appVersion: VERSION, prefs, now: new Date('2026-11-15T20:00:00Z'), saveId: '11111111-2222-4333-8444-555555555555' });
  const text = B.backupJSON(doc);
  for (const bad of ['secret-old-copy', 'mergedSaves', 'notes:v1', 'collapsed', 'passphrase', 'shopsmartr-keys', '"salt"', '"ct"']) assert.ok(!text.includes(bad), bad);
  const r = B.parseBackup(text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.backup.prefs, prefs);
  assert.equal(r.summary.settings, 7);
  assert.equal(r.summary.createdAt, '2026-11-15T20:00:00.000Z');
  assert.deepEqual(r.backup.state.items, STATE.items, 'hidden-chain lines travel untouched');
  assert.deepEqual(r.backup.state.selectedStoreIds, ['wegmans-82', 'tops-451']);
  assert.equal(r.backup.favs.recipes.length, 1);
  // restore onto a fresh device: replace writes every setting
  const fresh = memoryStorage();
  const cur = { state: L.emptyState(), favs: F.emptyFavorites(), shopStore: '', listSort: L.cleanSort(null), prefs: K.collectPrefs(fresh) };
  const rep = B.applyBackup(cur, r.backup, 'replace');
  assert.deepEqual(rep.listSort, { by: 'price', dir: 'asc' });
  assert.deepEqual(K.writePrefs(rep.prefs, fresh).sort(), Object.keys(prefs).sort());
  assert.deepEqual(K.collectPrefs(fresh), prefs, 'settings round-trip exactly');
  assert.equal(rep.state.items.length, 2);
  // merge only fills settings the device lacks
  const other = memoryStorage(); other.setItem('shopsmartr:household:v1', '2');
  const mer = B.applyBackup({ ...cur, prefs: K.collectPrefs(other) }, r.backup, 'merge');
  assert.equal('household' in mer.prefs, false, 'merge keeps this device\'s household size');
  assert.equal(mer.prefs.appIcon, 'heart-whisk');
});

test('full backup: junk in a file\'s prefs is dropped; v1 and v2 files without prefs still load and change no settings', () => {
  const doc = B.makeBackup({ state: STATE, favs: FAVS, appVersion: VERSION });
  const evil = { ...doc, prefs: { household: 999, appIcon: '../x', listSort: 'nope', theme: 'Bad Theme!', mode: 'dark', passphrase: 'hunter2', rxSwaps: { 'bad key': 1 } } };
  const r = B.parseBackup(JSON.stringify(evil));
  assert.deepEqual(r.backup.prefs, { mode: 'dark' });
  const v2 = { ...doc }; delete v2.prefs; v2.appVersion = '0.2.3-alpha';
  const v1 = { ...v2, schema: 'shopsmartr.backup/1', appVersion: '0.1.6-alpha', favorites: { items: [], meals: [] } };
  for (const f of [v1, v2]) {
    const p = B.parseBackup(JSON.stringify(f));
    assert.equal(p.ok, true, f.schema);
    assert.deepEqual(p.backup.prefs, {});
    assert.equal(p.summary.settings, 0);
    const rep = B.applyBackup({ state: L.emptyState(), favs: F.emptyFavorites(), shopStore: '', listSort: { by: 'aisle', dir: 'desc' }, prefs: {} }, p.backup, 'replace');
    assert.deepEqual(rep.prefs, {});
    assert.deepEqual(rep.listSort, { by: 'aisle', dir: 'desc' }, 'an old file leaves the sort alone');
  }
  assert.match(B.parseBackup(JSON.stringify({ ...doc, schema: 'shopsmartr.backup/3' })).error, /newer Happy Wife Helper/);
});

// ---------- hidden chains ----------
const DOC = {
  schema: 'shopsmartr.prices/v1',
  stores: [{ chain: 'wegmans', storeId: '90', name: 'W90' }, { chain: 'tops', storeId: '1', name: 'T1' }],
  items: [
    { chain: 'wegmans', storeId: '90', staple: 'milk', name: 'Wegmans Whole Milk', price: 3.49, department: 'Dairy', sku: 'w1' },
    { chain: 'tops', storeId: '1', staple: 'milk', name: 'Tops Whole Milk', price: 2.99, department: 'Dairy', sku: 't1' },
    { chain: 'tops', storeId: '1', staple: 'bread', name: 'Tops White Bread', price: 1.99, regularPrice: 2.49, onSale: true, department: 'Bakery', sku: 't2' },
  ],
};
const { catalog: cat, index } = C.prepare(DOC);

test('hidden chains flag: on by default, Wegmans only', () => {
  assert.equal(HIDE_NON_WEGMANS, true);
  assert.deepEqual([...HIDDEN_CHAINS].sort(), ['aldi', 'tops', 'traderjoes']);
  assert.deepEqual(shownChains(), ['wegmans']);
  assert.equal(isShownChain('wegmans'), true);
  assert.deepEqual(shownStores([{ chain: 'tops' }, { chain: 'wegmans' }, null]), [{ chain: 'wegmans' }]);
  withHiddenChains([], () => assert.deepEqual(shownChains(), ['tops', 'wegmans', 'aldi', 'traderjoes']));
  assert.deepEqual([...HIDDEN_CHAINS].sort(), ['aldi', 'tops', 'traderjoes'], 'restored after the test helper');
});

test('hidden chains: Shop stores, store pick, all-store search, suggestions and sale list (flag on and off)', () => {
  withHiddenChains(['tops', 'aldi', 'traderjoes'], () => {
    assert.deepEqual(C.priceStores(cat).map((s) => s.key), ['wegmans:90']);
    assert.equal(C.pickStore(cat, 'tops:1'), 'wegmans:90', 'a saved Tops store falls back to Wegmans');
    assert.deepEqual(C.search(cat, index, 'milk').items.map((i) => i.chain), ['wegmans']);
    assert.equal(C.search(cat, index, '').total, 1, 'all-store browse skips Tops');
    assert.deepEqual(C.suggest(cat, index, 'milk').map((i) => i.chain), ['wegmans']);
    assert.equal(C.onSale(cat, index, '').length, 0);
  });
  withHiddenChains([], () => {
    assert.deepEqual(C.priceStores(cat).map((s) => s.key), ['wegmans:90', 'tops:1']);
    assert.equal(C.pickStore(cat, 'tops:1'), 'tops:1');
    assert.deepEqual(C.search(cat, index, 'milk').items.map((i) => i.chain).sort(), ['tops', 'wegmans']);
    assert.equal(C.search(cat, index, '').total, 3);
    assert.equal(C.onSale(cat, index, '').length, 1);
  });
});

test('hidden chains: recipe matching never picks a hidden-chain product (flag on and off)', () => {
  const mi = R.buildMatchIndex(cat, index);
  const chains = () => R.matchRows(mi, 'whole milk', -1).map((c) => C.getItem(cat, c.row).chain).sort();
  withHiddenChains(['tops'], () => assert.deepEqual(chains(), ['wegmans']));
  withHiddenChains([], () => assert.deepEqual(chains(), ['tops', 'wegmans']));
});

test('hidden chains: list lines and Favorites tied to Tops are kept and grouped, and come back with the flag off', () => {
  const DIR = { 'wegmans-82': { id: 'wegmans-82', chain: 'wegmans', name: 'Wegmans Alberta Dr.' }, 'tops-451': { id: 'tops-451', chain: 'tops', name: 'Tops Albion' } };
  const on = withHiddenChains(['tops', 'aldi', 'traderjoes'], () => L.storeSections(STATE.items, DIR, null, STATE.selectedStoreIds));
  assert.deepEqual(on.map((g) => [g.key, g.hidden]), [['wegmans-82', false], ['tops-451', true]]);
  assert.equal(on.flatMap((g) => g.items).length, 2);
  const off = withHiddenChains([], () => L.storeSections(STATE.items, DIR, null, ['tops-451', 'wegmans-82']));
  assert.deepEqual(off.map((g) => [g.key, g.hidden]), [['tops-451', false], ['wegmans-82', false]], 'flag off: original order back');
  // nothing in the data model filters by chain: toggling an item keeps the Tops line and pick
  const next = withHiddenChains(['tops'], () => L.toggleItem(STATE, 'w1', true));
  assert.deepEqual(next.items.map((i) => i.storeId), ['wegmans-82', 'tops-451']);
  assert.deepEqual(next.selectedStoreIds, ['wegmans-82', 'tops-451']);
  assert.ok(F.isFavorite(FAVS, { name: 'Tops coffee', storeId: 'tops-451' }));
});
