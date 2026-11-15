import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/list.js';
import * as S from '../src/storage.js';
import * as B from '../src/backup.js';
import * as F from '../src/favorites.js';
import { toText, toCSV } from '../src/export.js';

const priced = (p) => L.cleanPriced(p);
const W90 = { chain: 'wegmans', storeNo: '90', store: 'Wegmans #90' };
const W105 = { chain: 'wegmans', storeNo: '105', store: 'Wegmans #105' };
const DIR = {
  'wegmans-90': { id: 'wegmans-90', chain: 'wegmans', name: 'Wegmans Transit Rd.', address: '8270 Transit Road', city: 'Williamsville' },
  'tops-1': { id: 'tops-1', chain: 'tops', name: 'Tops Maple Rd.', address: '1 Maple Road', city: 'Amherst' },
};

// ---------- L19 ----------
test('L19: weight qty on a package item without a unit price counts whole packages from the size', () => {
  const rice = (size, qty, unit) => L.linePrice({ qty, unit, priced: priced({ each: 3.49, size }) });
  assert.deepEqual(rice('2 lb bag', 5, 'kg'), { total: 20.94, approx: true, regular: null, packs: 6 }, '5 kg = 11.02 lb -> 6 bags');
  assert.deepEqual(rice('5 lb', 5, 'lb'), { total: 3.49, approx: true, regular: null, packs: 1 }, 'exact fit is one package');
  assert.deepEqual(rice('5 lb', 5.5, 'lb'), { total: 6.98, approx: true, regular: null, packs: 2 });
  assert.deepEqual(rice('2 kg', 1, 'lb'), { total: 3.49, approx: true, regular: null, packs: 1 });
  assert.equal(rice('32 oz', 3, 'lb').packs, 2, '48 oz / 32 oz -> 2 packages');
  assert.equal(rice('32 oz', 3, 'lb').total, 6.98);
  assert.equal(rice('64 fl oz', 1, 'gal').packs, 2, 'volumes too');
});

test('L19: unreadable size -> no price for the line, and it is not counted in the total', () => {
  const eggs = { name: 'Eggs', qty: 3, unit: 'lb', priced: priced({ each: 2.99, size: '12 ct', store: 'Wegmans #90' }) };
  const milk = { name: 'Milk', qty: 1, unit: '', priced: priced({ each: 3.79 }) };
  assert.equal(L.linePrice(eggs), null);
  const t = L.totals([eggs, milk]);
  assert.equal(t.all, 3.79);
  assert.equal(t.priced, 1);
  assert.equal(t.unpriced, 1);
  assert.match(toCSV([eggs]), /Eggs,3,lb,.*,2\.99,,,/);
  assert.match(toText([eggs]), /\[ \] 3 lb Eggs — no price for this amount/);
});

test('parsePackSize reads common size texts', () => {
  assert.deepEqual(L.parsePackSize('5 lb bag'), { amount: 5, unit: 'lb' });
  assert.deepEqual(L.parsePackSize('2 kg'), { amount: 2, unit: 'kg' });
  assert.deepEqual(L.parsePackSize('32 oz'), { amount: 32, unit: 'oz' });
  assert.deepEqual(L.parsePackSize('16.9 Fl Oz'), { amount: 16.9, unit: 'floz' });
  assert.deepEqual(L.parsePackSize('6 x 12 oz'), { amount: 72, unit: 'oz' });
  assert.equal(L.parsePackSize('12 ct'), null);
  assert.equal(L.parsePackSize(null), null);
});

// ---------- L20 ----------
test('L20: the add sheet and the add bar share one quick-add parse', () => {
  assert.deepEqual(L.quickInput('2 lb apples', '1', ''), { name: 'apples', qty: 2, unit: 'lb' });
  assert.deepEqual(L.quickInput('10000 paper towels', '1', ''), { name: 'paper towels', qty: 10000, unit: '' });
  assert.throws(() => L.addItem(L.emptyState(), L.quickInput('10000 paper towels', '1', '')), /9999 or less/);
  assert.deepEqual(L.quickInput('milk', '2', 'gal'), { name: 'milk', qty: '2', unit: 'gal' }, 'fields used when the name has no amount');
  assert.deepEqual(L.quickInput('3 bananas', '', 'lb'), { name: 'bananas', qty: 3, unit: 'lb' });
  assert.deepEqual(L.quickInput('eggs', '', ''), { name: 'eggs', qty: null, unit: '' });
});

// ---------- per-store sections ----------
const items = [
  { id: 'a', name: 'Bananas', qty: 2, unit: '', storeId: 'wegmans-90', priced: priced({ each: 1.48, approx: true, aisle: 'Produce', ...W90 }) },
  { id: 'b', name: 'paper towels', qty: null, unit: '', storeId: '' },
  { id: 'c', name: 'Bread', qty: 1, unit: '', storeId: '', priced: priced({ each: 2.5, aisle: 'Aisle 10', ...W105 }) },
  { id: 'd', name: 'Coffee', qty: null, unit: '', storeId: 'tops-1' },
  { id: 'e', name: 'Milk', qty: 1, unit: '', storeId: 'wegmans-90', priced: priced({ each: 3.79, aisle: 'Dairy 2', ...W90 }) },
];

test('storeSections: keyed by chain + store id, address, subtotal, Any store last', () => {
  const s = L.storeSections(items, DIR);
  assert.deepEqual(s.map((x) => x.key), ['wegmans-90', 'wegmans-105', 'tops-1', '']);
  assert.deepEqual(s.map((x) => x.name), ['Wegmans Transit Rd.', 'Wegmans #105', 'Tops Maple Rd.', 'Any store']);
  assert.equal(s[0].address, '8270 Transit Road, Williamsville');
  assert.equal(s[1].address, '', 'a price-only store has no directory address');
  assert.deepEqual(s.map((x) => x.total.all), [6.75, 2.5, 0, 0]);
  assert.equal(s[0].total.approx, true);
  assert.deepEqual(s[3].items.map((i) => i.id), ['b'], 'manual item with no store goes to Any store');
  assert.deepEqual(s[2].items.map((i) => i.id), ['d'], 'manual item with a chosen store goes in that section');
  assert.equal(L.totals(items).all, 9.25, 'grand total is the sum of the sections');
  assert.equal(L.storeKeyOf({ priced: { chain: 'aldi', storeNo: '77' } }), 'aldi-77', 'scales to other chains');
});

test('text export lists aisle tags and per-store subtotals', () => {
  const t = toText(items, DIR);
  assert.match(t, /== Wegmans Transit Rd\. — 8270 Transit Road, Williamsville ==/);
  assert.match(t, /2 Bananas — ~\$2\.96 \(Wegmans #90, Produce\)/);
  assert.match(t, /Subtotal: ~\$6\.75/);
  assert.match(t, /Estimated total: ~\$9\.25/);
  assert.match(toCSV(items, DIR).split('\r\n')[0], /Aisle/);
});

// ---------- sort ----------
const names = (list) => list.map((i) => i.name);
test('sort: Produce first, then natural aisle order (Aisle 2 before Aisle 10), no aisle last (L21)', () => {
  const mk = (name, aisle) => ({ name, priced: aisle === undefined ? undefined : priced({ each: 1, aisle }) });
  const list = [mk('k', 'Aisle 10'), mk('a', 'Dairy 10'), mk('b', 'Aisle 2'), mk('n', undefined), mk('c', 'Dairy 2'), mk('d', 'Produce'), mk('z', 'Aisle 2'), mk('e', 'aisle 3')];
  assert.deepEqual(names(L.sortItems(list, { by: 'aisle' })), ['d', 'b', 'z', 'e', 'k', 'c', 'a', 'n']);
  assert.ok(L.compareAisles('Produce 6', 'Aisle 1') < 0 && L.compareAisles('Produce 6', 'Bakery') < 0, 'Produce before every other aisle');
  assert.ok(L.compareAisles('Produce 2', 'Produce 10') < 0 && L.compareAisles('produce', 'Produce 1') < 0, 'natural order inside Produce');
  assert.ok(L.compareAisles('Produce', null) < 0, 'no aisle still last');
  assert.ok(L.compareAisles('Bakery', 'Dairy 2') < 0 && L.compareAisles('Dairy 9', 'Dairy 12') < 0);
  assert.ok(L.compareAisles('Aisle 2', 'Aisle 10') < 0);
  assert.ok(L.compareAisles('Dairy 2', 'Aisle 10') > 0);
  assert.ok(L.compareAisles(null, 'Aisle 1') > 0);
});

test('sort: price high/low by line total; unpriced and unpriceable lines last both ways', () => {
  const list = [
    { name: 'cheap', qty: 1, priced: priced({ each: 1 }) },
    { name: 'manual' },
    { name: 'pricey', qty: 1, priced: priced({ each: 9 }) },
    { name: 'mid x3', qty: 3, priced: priced({ each: 2 }) },
    { name: 'eggs by lb', qty: 3, unit: 'lb', priced: priced({ each: 2.99, size: '12 ct' }) },
    { name: 'Another manual' },
  ];
  assert.deepEqual(names(L.sortItems(list, { by: 'price', dir: 'desc' })), ['pricey', 'mid x3', 'cheap', 'Another manual', 'eggs by lb', 'manual']);
  assert.deepEqual(names(L.sortItems(list, { by: 'price', dir: 'asc' })), ['cheap', 'mid x3', 'pricey', 'Another manual', 'eggs by lb', 'manual']);
});

test('sort: A-Z (the default) is case-insensitive locale order; name breaks ties', () => {
  const list = [{ name: 'banana' }, { name: 'Apple' }, { name: 'éclair' }, { name: 'apple' }, { name: 'Zucchini' }, { name: 'Eggs 12' }, { name: 'Eggs 2' }];
  assert.deepEqual(names(L.sortItems(list, { by: 'name' })), ['Apple', 'apple', 'banana', 'éclair', 'Eggs 2', 'Eggs 12', 'Zucchini']);
  assert.deepEqual(names(L.sortItems(list, null)), names(L.sortItems(list, { by: 'name' })), 'A-Z is the default');
  const checked = list.map((x, i) => ({ ...x, checked: i % 2 === 0 }));
  assert.deepEqual(names(L.sortItems(checked, { by: 'name' })), names(L.sortItems(list, { by: 'name' })), 'checking never moves an item');
  const same = [{ name: 'b', qty: 1, priced: priced({ each: 2 }) }, { name: 'a', qty: 1, priced: priced({ each: 2 }) }];
  assert.deepEqual(names(L.sortItems(same, { by: 'price' })), ['a', 'b']);
  assert.deepEqual(names(L.storeSections(items, DIR, { by: 'name' })[0].items), ['Bananas', 'Milk'], 'sorted within each section');
});

test('sort choice persists on the device and bad values fall back', () => {
  const st = S.memoryStorage();
  assert.deepEqual(S.loadListSort(st), { by: 'name', dir: 'desc' }, 'default A-Z; Price starts high to low');
  S.saveListSort({ by: 'price', dir: 'asc' }, st);
  assert.equal(st.getItem(S.LIST_SORT_KEY), '{"by":"price","dir":"asc"}');
  assert.deepEqual(S.loadListSort(st), { by: 'price', dir: 'asc' });
  st.setItem(S.LIST_SORT_KEY, '{"by":"rm -rf"}');
  assert.deepEqual(S.loadListSort(st), { by: 'name', dir: 'desc' });
  st.setItem(S.LIST_SORT_KEY, 'not json');
  assert.deepEqual(S.loadListSort(st), { by: 'name', dir: 'desc' });
});

// ---------- Save list / Load list ----------
const state = { ...L.emptyState(), items: items.map((i) => ({ ...i, notes: '', checked: i.id === 'e' })), selectedStoreIds: ['wegmans-90', 'tops-1'], zip: '14221', radiusMi: 15, chains: ['wegmans'] };
let favs = F.addFavorite(F.emptyFavorites(), { name: 'Coffee', qty: 1, unit: 'bag', storeId: 'tops-1' }, 'f1');
favs = F.createMeal(favs, 'Taco night', [{ name: 'Tortillas' }, { name: 'Salsa' }], { id: 'm1' });
const SAVE_ID = '0b7c2f0e-7d1a-4c55-9a2e-5f1d3c9b8a71';
const doc = B.makeBackup({ state, favs, shopStore: 'wegmans:90', appVersion: '0.1.6-alpha', now: new Date('2026-11-15T16:00:00Z'), saveId: SAVE_ID });

test('Save list: versioned document with list, favorites, store picks and settings', () => {
  assert.equal(doc.schema, 'shopsmartr.backup/1');
  assert.equal(doc.appVersion, '0.1.6-alpha');
  assert.equal(doc.saveId, SAVE_ID);
  assert.match(B.makeBackup({ state, favs, appVersion: '0.1.6-alpha' }).saveId, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/, 'random UUID by default');
  assert.notEqual(B.makeBackup({ state, appVersion: '0.1.6-alpha' }).saveId, B.makeBackup({ state, appVersion: '0.1.6-alpha' }).saveId);
  assert.equal(doc.createdAt, '2026-11-15T16:00:00.000Z');
  assert.equal(doc.list.items.length, 5);
  assert.deepEqual(doc.favorites.items.map((i) => i.name), ['Coffee']);
  assert.deepEqual(doc.favorites.meals.map((m) => m.name), ['Taco night']);
  assert.deepEqual(doc.stores, { shopStore: 'wegmans:90', selectedStoreIds: ['wegmans-90', 'tops-1'] });
  assert.deepEqual(doc.settings, { zip: '14221', radiusMi: 15, chains: ['wegmans'] }, 'L22: the sort choice is device-only and not saved');
  assert.equal(B.backupFilename('2026-11-15'), 'shopsmartr-list-2026-11-15.json');
});

test('Save list: the file contains no passphrase, key or ciphertext material', () => {
  const leaky = { ...state, passphrase: 'hunter2-household', key: { k: 'secret' }, priceEnv: { salt: 'c2FsdA==', iv: 'aXY=', ct: 'Y3Q=' } };
  const leakyFavs = { ...favs, rawKey: 'AAAAkey' };
  leaky.items = leaky.items.map((i) => ({ ...i, passphrase: 'x', jwk: { kty: 'oct', k: 'abc' } }));
  const text = B.backupJSON(B.makeBackup({ state: leaky, favs: leakyFavs, shopStore: 'wegmans:90', appVersion: '0.1.5-alpha' }));
  for (const bad of ['hunter2', 'passphrase', 'secret', 'AAAAkey', '"jwk"', '"kty"', '"salt"', '"iv"', '"ct"', 'c2FsdA', 'CryptoKey', 'PBKDF2', 'AES-GCM', 'shopsmartr-keys']) {
    assert.ok(!text.includes(bad), `backup must not contain ${bad}`);
  }
  const keysUsed = new Set();
  JSON.parse(text, (k, v) => { keysUsed.add(k); return v; });
  assert.ok(![...keysUsed].some((k) => /pass|key|secret|salt|^iv$|^ct$|jwk/i.test(k)), [...keysUsed].join(','));
});

test('Load list: round trip, validation of schema, version and shape', () => {
  const r = B.parseBackup(B.backupJSON(doc));
  assert.equal(r.ok, true);
  assert.deepEqual(r.summary, { items: 5, listStores: 3, priced: 3, favorites: 1, meals: 1, stores: 2, dropped: 0, appVersion: '0.1.6-alpha', createdAt: '2026-11-15T16:00:00.000Z', duplicates: 0, renewedIds: 0 });
  assert.equal(r.backup.saveId, SAVE_ID);
  assert.equal(B.summaryText(r.summary), '5 list items · 1 favorite · 1 meal · 2 stores');
  assert.deepEqual(r.backup.state.items, state.items);
  assert.deepEqual(r.backup.favs, favs);
  assert.equal(r.backup.shopStore, 'wegmans:90');
  assert.equal('listSort' in r.backup, false, 'L22: a sort in the file is ignored');
  const bad = (x) => B.parseBackup(typeof x === 'string' ? x : JSON.stringify(x));
  assert.equal(bad('nope').error, "That file isn't a ShopSmartR list");
  assert.equal(bad({ version: 1, items: [] }).error, "That file isn't a ShopSmartR list", 'the live list format is not a saved list file');
  assert.equal(bad({ ...doc, schema: 'other/1' }).error, "That file isn't a ShopSmartR list");
  assert.match(bad({ ...doc, schema: 'shopsmartr.backup/2' }).error, /newer ShopSmartR/);
  assert.match(bad({ ...doc, appVersion: undefined }).error, /app version/);
  assert.match(bad({ ...doc, createdAt: 'yesterday' }).error, /date/);
  assert.match(bad({ ...doc, list: { items: 'x' } }).error, /no list items/);
  assert.match(bad({ ...doc, favorites: { items: 3 } }).error, /Favorites/);
  const partial = bad({ ...doc, list: { items: [...doc.list.items, { id: 'z', name: '' }, null] } });
  assert.equal(partial.ok, true);
  assert.equal(partial.summary.dropped, 2, 'invalid rows are dropped and counted');
  assert.equal(B.parseBackup(`\uFEFF${B.backupJSON(doc)}`).ok, true, 'BOM tolerated');
});

test('Load list: replace takes the file; merge combines lines with the same name + unit + source store', () => {
  const r = B.parseBackup(B.backupJSON(doc)).backup;
  const cur = {
    state: { ...L.emptyState(), items: [
      { id: 'a', name: 'bananas ', qty: 5, unit: '', storeId: 'wegmans-90', checked: false },
      { id: 'x', name: 'Milk', qty: 1, unit: 'gal', storeId: 'wegmans-90', checked: false },
      { id: 'y', name: 'Bread', qty: 1, unit: '', storeId: '', checked: false },
    ], selectedStoreIds: ['aldi-1'], zip: '14051', radiusMi: 5 },
    favs: F.addFavorite(F.emptyFavorites(), { name: 'coffee', unit: 'bag', storeId: 'tops-1' }, 'f9'),
    shopStore: '', listSort: { by: 'name', dir: 'desc' },
  };
  const rep = B.applyBackup(cur, r, 'replace');
  assert.deepEqual(rep.state, r.state);
  assert.deepEqual(rep.favs, r.favs);
  assert.deepEqual(rep.listSort, { by: 'name', dir: 'desc' }, 'L22: Replace keeps this device\'s sort');
  const m = B.applyBackup(cur, r, 'merge');
  // Bananas@wegmans-90 matches (name fold): combined. Milk '' vs gal differ by unit; Bread differs by source store (wegmans-105 vs Any).
  assert.equal(m.combined, 1);
  assert.equal(m.added, 4);
  assert.deepEqual(m.state.items.map((i) => i.name), ['bananas ', 'Milk', 'Bread', 'paper towels', 'Bread', 'Coffee', 'Milk']);
  assert.equal(new Set(m.state.items.map((i) => i.id)).size, 7, 'ids stay unique');
  const ban = m.state.items.find((i) => i.id === 'a');
  assert.equal(ban.qty, 7, 'quantities add: 5 + 2');
  assert.equal(ban.priced.each, 1.48, 'the file had a price and the current line had none: it is kept');
  assert.deepEqual(m.state.selectedStoreIds, ['aldi-1', 'wegmans-90', 'tops-1']);
  assert.equal(m.state.zip, '14051');
  assert.deepEqual(m.favs.items.map((i) => i.name), ['coffee'], 'favorite Coffee/bag/tops-1 deduped');
  assert.deepEqual(m.favs.meals.map((x) => x.name), ['Taco night']);
  assert.equal(m.shopStore, 'wegmans:90');
  assert.deepEqual(m.listSort, { by: 'name', dir: 'desc' }, 'merge keeps this device\'s sort');
  assert.throws(() => B.applyBackup(cur, r, 'other'), /merge or replace/);
});

test('merge: combineLines adds quantities and keeps the newer price', () => {
  const old = { id: 'x', name: 'Milk', qty: 1, unit: 'gal', notes: '', priced: priced({ each: 3.49, asOf: '2026-11-01T00:00:00Z' }) };
  const neu = { id: 'y', name: 'milk', qty: 2, unit: 'gal', notes: 'organic', priced: priced({ each: 3.79, asOf: '2026-11-14T00:00:00Z' }) };
  assert.deepEqual(B.combineLines(old, neu), { ...old, qty: 3, notes: 'organic', priced: neu.priced, checked: false });
  assert.equal(B.combineLines(neu, old).priced.each, 3.79, 'newer wins whichever side it is on');
  assert.equal(B.combineLines({ ...old, qty: null, priced: undefined }, { ...neu, qty: null, priced: undefined }).qty, null);
  assert.equal(B.combineLines({ ...old, qty: 9000 }, { ...neu, qty: 9000 }).qty, 9999, 'capped');
  assert.equal(B.lineKey(old), B.lineKey(neu));
  assert.notEqual(B.lineKey(old), B.lineKey({ ...neu, unit: 'qt' }));
});

test('nudge: 7+ days since the last save, or never saved and the list is 3+ days old; hide for 7 days', () => {
  const now = Date.parse('2026-11-20T12:00:00Z');
  const d = (n) => new Date(now - n * 86400000).toISOString();
  assert.equal(B.nudgeText({ lastSavedAt: d(8) }, 3, now), 'Last saved 8 days ago');
  assert.equal(B.nudgeText({ lastSavedAt: d(7) }, 3, now), 'Last saved 7 days ago');
  assert.equal(B.nudgeText({ lastSavedAt: d(6.9) }, 3, now), null);
  assert.equal(B.nudgeText({ lastSavedAt: d(30) }, 0, now), null, 'empty list: no nudge');
  assert.equal(B.nudgeText({ firstSeenAt: d(3) }, 2, now), 'Not saved to a file yet');
  assert.equal(B.nudgeText({ firstSeenAt: d(2.9) }, 2, now), null);
  assert.match(B.savedLine({ lastSavedAt: d(12) }, 16, now), /^16 items · last saved to a file Nov 8 \(12 days ago\)$/);
  assert.equal(B.savedLine({}, 1, now), '1 item · never saved to a file');
  const hidden = B.hideNudge({ lastSavedAt: d(8) }, now);
  assert.equal(B.nudgeText(hidden, 3, now + 6 * 86400000), null);
  assert.equal(B.nudgeText(hidden, 3, now + 7.1 * 86400000), 'Last saved 15 days ago');
  assert.equal(B.nudgeText(B.markSaved(hidden, now), 3, now + 86400000), null);
  const st = S.memoryStorage();
  B.saveMeta(B.markSaved({}, now), st);
  assert.equal(B.loadMeta(st).lastSavedAt, new Date(now).toISOString());
  st.setItem(B.BACKUP_META_KEY, '{bad');
  assert.deepEqual(B.loadMeta(st), { lastSavedAt: null, nudgeHiddenUntil: null, firstSeenAt: null });
});

test('storage persistence label', () => {
  assert.equal(B.storageText(true), 'Storage: persistent');
  assert.equal(B.storageText(false), 'Storage: may be cleared by the browser');
  assert.equal(B.storageText(null), 'Storage: browser default');
});

test('storeSections: follows the Stores-tab order first, then first appearance, Any store always last', () => {
  const rows = [
    { id: 'a', name: 'Paper towels', qty: null, unit: '', notes: '', storeId: '', checked: false },
    { id: 'b', name: 'Milk', qty: 1, unit: '', notes: '', storeId: 'wegmans-90', checked: false },
    { id: 'c', name: 'Bread', qty: 1, unit: '', notes: '', storeId: 'tops-1', checked: false },
    { id: 'd', name: 'IPA', qty: 1, unit: '', notes: '', storeId: '', checked: false, priced: priced({ each: 5, ...W105 }) },
  ];
  const keys = (order) => L.storeSections(rows, DIR, undefined, order).map((g) => g.key);
  assert.deepEqual(keys(['tops-1', 'wegmans-90']), ['tops-1', 'wegmans-90', 'wegmans-105', '']);
  assert.deepEqual(keys([]), ['wegmans-90', 'tops-1', 'wegmans-105', '']);
  assert.deepEqual(keys(['gone-1', 'wegmans-90']), ['wegmans-90', 'tops-1', 'wegmans-105', ''], 'unknown order keys are ignored');
});

test('collapsed sections persist per device and ignore junk', () => {
  const mem = new Map();
  const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  assert.equal(S.loadCollapsed(st).size, 0);
  S.saveCollapsed(new Set(['wegmans-90', 'any']), st);
  assert.deepEqual([...S.loadCollapsed(st)], ['wegmans-90', 'any']);
  mem.set(S.COLLAPSED_KEY, '{bad');
  assert.equal(S.loadCollapsed(st).size, 0);
  mem.set(S.COLLAPSED_KEY, JSON.stringify(['ok', 7, null]));
  assert.deepEqual([...S.loadCollapsed(st)], ['ok']);
});

test('merge: done state is OR-ed across matching lines; non-matching lines are added as new rows', () => {
  const line = (id, checked, extra = {}) => ({ id, name: 'Milk', qty: 1, unit: 'gal', notes: '', storeId: 'wegmans-90', checked, ...extra });
  assert.equal(B.combineLines(line('a', false), line('b', true)).checked, true, 'file done, current not');
  assert.equal(B.combineLines(line('a', true), line('b', false)).checked, true, 'current done, file not');
  assert.equal(B.combineLines(line('a', false), line('b', false)).checked, false);
  const cur = { state: { version: 1, items: [line('a', false)], selectedStoreIds: [], zip: '', radiusMi: 10, chains: [] }, favs: F.emptyFavorites(), shopStore: '', listSort: L.cleanSort() };
  const file = { state: { ...cur.state, items: [line('b', true, { name: ' MILK ' }), line('c', true, { unit: 'qt' })] }, favs: F.emptyFavorites(), shopStore: '', listSort: L.cleanSort() };
  const m = B.applyBackup(cur, file, 'merge');
  assert.equal(m.combined, 1);
  assert.equal(m.added, 1);
  assert.equal(m.state.items.length, 2);
  assert.deepEqual(m.state.items.map((i) => [i.unit, i.qty, i.checked]), [['gal', 2, true], ['qt', 1, true]]);
});
