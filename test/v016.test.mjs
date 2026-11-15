import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/list.js';
import * as B from '../src/backup.js';
import * as F from '../src/favorites.js';
import { toText, toCSV } from '../src/export.js';

const rice = { id: 'r', name: 'Brown Rice Bag', qty: 5, unit: 'kg', notes: '', storeId: 'wegmans-90', checked: false,
  priced: L.cleanPriced({ each: 3.49, chain: 'wegmans', storeNo: '90', store: 'Wegmans #90', size: 'family pack', aisle: 'Aisle 4' }) };
const base = (items) => ({ ...L.emptyState(), items });
const doc = (items, extra = {}) => B.makeBackup({ state: base(items), favs: F.emptyFavorites(), appVersion: '0.1.6-alpha', saveId: '11111111-2222-4333-8444-555555555555', ...extra });

// ---------- M5 ----------
test('M5: an unpriceable amount never throws; messages say "No price for 5 kg"', () => {
  assert.equal(L.linePrice(rice), null, 'precondition: 5 kg of a $3.49 each item with no size/unit price is unpriceable');
  assert.equal(L.addedText(rice), 'Added Brown Rice Bag (no price for 5 kg)');
  assert.equal(L.noPriceText(rice), 'No price for 5 kg');
  assert.equal(L.noPriceText({ ...rice, qty: null, unit: '' }), 'No price');
  assert.equal(L.addedText({ ...rice, qty: 2, unit: '' }), 'Added Brown Rice Bag ($6.98)');
  assert.equal(L.addedText({ id: 'x', name: 'Napkins', qty: 1, unit: '' }), 'Added Napkins (no price)');
  // every other linePrice consumer copes with null
  assert.doesNotThrow(() => L.totals([rice]));
  assert.deepEqual(L.totals([rice]).unpriced, 1);
  assert.doesNotThrow(() => L.sortItems([rice, { ...rice, id: 's', qty: 1, unit: '' }], { by: 'price', dir: 'desc' }));
  assert.doesNotThrow(() => L.storeSections([rice], {}));
  assert.match(toText([rice], {}), /no price for this amount/);
  assert.match(toCSV([rice], {}), /Brown Rice Bag,5,kg/);
});

// ---------- L21 ----------
test('L21: Produce aisles first, then natural order, no aisle last', () => {
  const list = ['Dairy 2', undefined, 'Aisle 10', 'Produce 6', 'Bakery', 'Aisle 2', 'Produce', 'Meat 1'];
  const rows = list.map((a, i) => ({ id: String(i), name: `n${i}`, priced: a ? L.cleanPriced({ each: 1, aisle: a }) : undefined }));
  assert.deepEqual(L.sortItems(rows, { by: 'aisle' }).map((r) => r.priced?.aisle ?? '-'),
    ['Produce', 'Produce 6', 'Aisle 2', 'Aisle 10', 'Bakery', 'Dairy 2', 'Meat 1', '-']);
});

// ---------- L22 ----------
test('L22: the sort choice is not saved, and a 0.1.5 file\'s sort is ignored on load (replace and merge)', () => {
  const d = doc([rice]);
  assert.equal(JSON.stringify(d).includes('listSort'), false);
  const old = { ...d, appVersion: '0.1.5-alpha', settings: { ...d.settings, listSort: { by: 'price', dir: 'asc' } } };
  const r = B.parseBackup(JSON.stringify(old));
  assert.equal(r.ok, true);
  const cur = { state: base([]), favs: F.emptyFavorites(), shopStore: '', listSort: { by: 'aisle', dir: 'desc' } };
  for (const mode of ['replace', 'merge']) assert.deepEqual(B.applyBackup(cur, r.backup, mode).listSort, { by: 'aisle', dir: 'desc' }, mode);
});

// ---------- L23 ----------
test('L23: saveId per file; a merged or self-saved file is recognised; others are not', () => {
  const r = B.parseBackup(B.backupJSON(doc([rice])));
  assert.equal(r.backup.saveId, '11111111-2222-4333-8444-555555555555');
  const now = Date.parse('2026-11-15T17:00:00Z');
  let m = {};
  assert.equal(B.repeatMergeText(m, r.backup.saveId), null);
  m = B.recordSaveId(m, r.backup.saveId, 'merged', now);
  assert.equal(B.repeatMergeText(m, r.backup.saveId), 'This file was already merged on Nov 15, 2026');
  assert.equal(B.recordSaveId(m, r.backup.saveId, 'saved', now + 5)[r.backup.saveId].how, 'merged', 'first record wins');
  const s = B.recordSaveId({}, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', 'saved', now);
  assert.match(B.repeatMergeText(s, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'), /^This file was saved from this list on Nov 15, 2026/);
  assert.equal(B.repeatMergeText(m, 'ffffffff-0000-4000-8000-000000000000'), null);
  // files without a saveId (0.1.5) or with junk never match
  assert.equal(B.parseBackup(JSON.stringify({ ...doc([rice]), saveId: undefined })).backup.saveId, '');
  assert.equal(B.parseBackup(JSON.stringify({ ...doc([rice]), saveId: '<script>' })).backup.saveId, '');
  assert.equal(B.repeatMergeText(m, ''), null);
  // storage round trip, junk dropped, capped
  const mem = new Map(); const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  B.saveMerged({ ...m, 'bad id!': { at: 'x', how: 'merged' } }, st);
  assert.deepEqual(B.loadMerged(st), m);
  mem.set(B.MERGED_KEY, '{nope'); assert.deepEqual(B.loadMerged(st), {});
  let big = {};
  for (let i = 0; i < 250; i += 1) big = B.recordSaveId(big, `id-${String(i).padStart(6, '0')}`, 'merged', now + i);
  assert.equal(Object.keys(big).length, 200);
  assert.ok(big['id-000249'] && !big['id-000000'], 'keeps the newest 200');
});

// ---------- L24 ----------
test('L24: files over 5,000 items or about 5 MB are refused with a clear message', () => {
  const row = (i) => ({ id: `i${i}`, name: `item ${i}`, qty: 1, unit: '', notes: '', storeId: '', checked: false });
  const ok = B.parseBackup(JSON.stringify({ ...doc([]), list: { items: Array.from({ length: 5000 }, (_, i) => row(i)) } }));
  assert.equal(ok.ok, true);
  assert.equal(ok.summary.items, 5000);
  const many = B.parseBackup(JSON.stringify({ ...doc([]), list: { items: Array.from({ length: 5001 }, (_, i) => row(i)) } }));
  assert.equal(many.ok, false);
  assert.equal(many.error, 'That file has 5,001 items. Load list takes up to 5,000.');
  const big = B.parseBackup(JSON.stringify({ ...doc([]), pad: 'x'.repeat(B.MAX_LOAD_BYTES) }));
  assert.equal(big.error, 'That file is too large to be a ShopSmartR list (over 5 MB).');
  assert.equal(B.MAX_LOAD_BYTES, 5 * 1024 * 1024);
});

// ---------- L25 ----------
test('L25: duplicate ids in a file: exact copies dropped, conflicting rows get new unique ids', () => {
  const a = { id: 'dup', name: 'Milk', qty: 1, unit: 'gal', notes: '', storeId: '', checked: false };
  const b = { ...a, name: 'Eggs', unit: '' };
  const c = { id: 'solo', name: 'Bread', qty: 1, unit: '', notes: '', storeId: '', checked: false };
  const d = doc([a, a, b, c, b]);
  const r = B.parseBackup(JSON.stringify(d));
  assert.equal(r.ok, true);
  const items = r.backup.state.items;
  assert.deepEqual(items.map((i) => i.name), ['Milk', 'Eggs', 'Bread']);
  assert.equal(new Set(items.map((i) => i.id)).size, 3, 'all ids unique');
  assert.equal(items[0].id, 'dup');
  assert.notEqual(items[1].id, 'dup');
  assert.equal(r.summary.duplicates, 2);
  assert.equal(r.summary.renewedIds, 1);
  // Replace then remove one row removes only that row
  const rep = B.applyBackup({ state: base([]), favs: F.emptyFavorites(), shopStore: '', listSort: L.cleanSort() }, r.backup, 'replace');
  assert.equal(L.removeItem(rep.state, items[0].id).items.length, 2);
  // favorites and meals too
  let favs = F.addFavorite(F.emptyFavorites(), { name: 'Coffee' }, 'f1');
  const fd = B.makeBackup({ state: base([]), favs, appVersion: '0.1.6-alpha' });
  fd.favorites.items.push({ ...fd.favorites.items[0], name: 'Tea' });
  const fr = B.parseBackup(JSON.stringify(fd));
  assert.deepEqual(fr.backup.favs.items.map((x) => x.name), ['Coffee', 'Tea']);
  assert.equal(new Set(fr.backup.favs.items.map((x) => x.id)).size, 2);
});
