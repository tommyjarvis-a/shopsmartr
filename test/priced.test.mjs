import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/list.js';
import { toCSV, toText, CSV_HEADER } from '../src/export.js';
import { serialize, deserialize, memoryStorage, loadShopStore, saveShopStore, SHOP_STORE_KEY } from '../src/storage.js';

const P = (each, extra = {}) => ({ each, approx: false, store: 'Wegmans #90', chain: 'wegmans', storeNo: '90', sku: '1001', aisle: 'Dairy 2', unitPriceText: '$3.79/gallon', asOf: '2026-11-14T12:00:00Z', ...extra });
function list() {
  let s = L.emptyState();
  s = L.addItem(s, { name: 'Milk', qty: 2, storeId: 'wegmans-90', priced: P(3.79) }, 'a');
  s = L.addItem(s, { name: 'Apples', storeId: 'wegmans-90', priced: P(4.98, { approx: true, sku: '1003' }) }, 'b');
  s = L.addItem(s, { name: 'Paper towels' }, 'c');
  s = L.addItem(s, { name: 'Bagels', priced: P(3.29, { store: 'Wegmans #105', storeNo: '105', sku: '2001' }) }, 'd');
  return L.toggleItem(s, 'd', true);
}

test('cleanPriced validates and keeps the source store', () => {
  assert.equal(L.cleanPriced(null), null);
  assert.equal(L.cleanPriced({ each: -1 }), null);
  assert.equal(L.cleanPriced({ each: 'x' }), null);
  const p = L.cleanPriced({ each: 3.456, regular: 3, onSale: true, chain: 'wegmans', storeNo: 90, sku: 1001 });
  assert.equal(p.each, 3.46);
  assert.equal(p.regular, null, 'regular not above price is dropped');
  assert.equal(p.storeNo, '90');
  assert.equal(p.sku, '1001');
});

test('totals: qty x price over priced items, remaining vs in cart, estimates', () => {
  const t = L.totals(list().items);
  assert.equal(t.all, 15.85);
  assert.equal(t.remaining, 12.56);
  assert.equal(t.inCart, 3.29);
  assert.equal(t.priced, 3);
  assert.equal(t.unpriced, 1);
  assert.equal(t.approx, true);
  assert.equal(t.approxRemaining, true);
  assert.equal(L.lineTotal({ priced: { each: 1.1 }, qty: 3 }), 3.3);
  assert.equal(L.lineTotal({ name: 'x' }), null);
  assert.equal(L.priceText(4.98, true), '~$4.98');
  assert.equal(L.priceText(NaN), '');
  assert.deepEqual(L.totals([]), { all: 0, remaining: 0, inCart: 0, priced: 0, unpriced: 0, approx: false, approxRemaining: false });
});

test('editing a priced item keeps its price; unpriced items still work', () => {
  let s = list();
  s = L.updateItem(s, 'a', { name: 'Whole milk', qty: '3', unit: '', storeId: 'wegmans-90', notes: 'cold' });
  const a = s.items.find((i) => i.id === 'a');
  assert.equal(a.priced.each, 3.79);
  assert.equal(L.lineTotal(a), 11.37);
  assert.equal(s.items.find((i) => i.id === 'c').priced, undefined);
});

test('priced items survive a save/reload round-trip, legacy rows load unchanged', () => {
  const s = list();
  const back = deserialize(serialize(s));
  assert.deepEqual(back.items, s.items);
  const legacy = JSON.stringify({ version: 1, items: [{ id: 'x', name: 'Eggs', qty: null, unit: '', notes: '', storeId: '', checked: false }] });
  assert.deepEqual(deserialize(legacy).items, [{ id: 'x', name: 'Eggs', qty: null, unit: '', notes: '', storeId: '', checked: false }]);
  const bad = JSON.stringify({ version: 1, items: [{ id: 'y', name: 'Eggs', priced: { each: 'free' } }] });
  assert.equal(deserialize(bad).items[0].priced, undefined);
});

test('CSV has price columns; text export shows prices and the total', () => {
  const s = list();
  const stores = { 'wegmans-90': { id: 'wegmans-90', name: 'Wegmans Transit Rd.', address: '8270 Transit Rd', city: 'Williamsville', state: 'NY', zip: '14221' } };
  const csv = toCSV(s.items, stores).split('\r\n');
  assert.equal(csv[0], CSV_HEADER.join(','));
  assert.ok(CSV_HEADER.includes('Price each') && CSV_HEADER.includes('Line total') && CSV_HEADER.includes('SKU'));
  assert.match(csv[1], /,3\.79,7\.58,no,\$3\.79\/gallon,Dairy 2,1001,Wegmans #90,2026-11-14T12:00:00Z$/);
  assert.match(csv[2], /,4\.98,4\.98,yes,/);
  assert.match(csv[3], /,,,,,,,,$/, 'unpriced row has empty price cells');
  assert.match(csv[4], /Wegmans #105/);
  const txt = toText(s.items, stores);
  assert.match(txt, /\[ \] 2 Milk — \$7\.58 \(Wegmans #90, Dairy 2\)/);
  assert.match(txt, /Apples — ~\$4\.98/);
  assert.match(txt, /\[ \] Paper towels\n/);
  assert.match(txt, /Estimated total: ~\$15\.85 \(3 priced items, 1 without a price\)/);
  assert.match(txt, /In cart \$3\.29 · ~\$12\.56 left/);
  assert.doesNotMatch(toText([{ id: 'z', name: 'Eggs', qty: null, unit: '', notes: '', storeId: '', checked: false }]), /Estimated/);
});

test('shop store choice persists per device and rejects junk', () => {
  const st = memoryStorage();
  assert.equal(loadShopStore(st), '');
  assert.ok(saveShopStore('wegmans:105', st));
  assert.equal(st.getItem(SHOP_STORE_KEY), 'wegmans:105');
  assert.equal(loadShopStore(st), 'wegmans:105');
  st.setItem(SHOP_STORE_KEY, '<script>');
  assert.equal(loadShopStore(st), '');
  assert.equal(loadShopStore(null), '');
});

test('L10: export file names use the local date', async () => {
  const { localDateStamp } = await import('../src/export.js');
  assert.equal(localDateStamp(new Date(2026, 10, 14, 23, 30)), '2026-11-14');
  assert.equal(localDateStamp(new Date(2026, 0, 5, 0, 1)), '2026-01-05');
});

// ---------- v0.1.4: M2 line totals honour the unit ----------
const BW = { each: 6.38, approx: true, shelf: 3.99, unitPrice: 3.99, unitOf: 'lb', byWeight: true, store: 'Wegmans #90' };
const PKG = { each: 8.49, approx: false, shelf: 8.49, unitPrice: 5.66, unitOf: 'lb', byWeight: false };
const OZ = { each: 1.29, approx: false, shelf: 1.29, unitPrice: 0.08, unitOf: 'oz', byWeight: false };
const line = (priced, qty, unit = '') => L.linePrice({ priced: L.cleanPriced(priced), qty, unit });

test('M2: sold by weight, 2 lb = 2 x $3.99/lb (not 2 x the piece estimate)', () => {
  assert.deepEqual(line(BW, 2, 'lb'), { total: 7.98, approx: false, regular: null });
  assert.deepEqual(line(BW, 32, 'oz'), { total: 7.98, approx: false, regular: null });
  assert.deepEqual(line(BW, 1, 'kg'), { total: 8.8, approx: false, regular: null });
  assert.deepEqual(line(BW, 500, 'g'), { total: 4.4, approx: false, regular: null });
  assert.deepEqual(line(BW, 2), { total: 12.76, approx: true, regular: null }, 'a count of pieces uses the estimate');
});

test('M2: package item with a lb qty uses the per-lb price, marked as an estimate', () => {
  assert.deepEqual(line(PKG, 2, 'lb'), { total: 11.32, approx: true, regular: null });
  assert.deepEqual(line(PKG, 2, 'pounds'), { total: 11.32, approx: true, regular: null });
});

test('M2: oz qty converts against a per-oz unit price; no usable unit price means "~" one package', () => {
  assert.deepEqual(line(OZ, 32, 'oz'), { total: 2.56, approx: true, regular: null });
  assert.deepEqual(line(OZ, 1, 'lb'), { total: 1.28, approx: true, regular: null });
  // L19: no compatible unit price and no readable size -> no price rather than one package
  assert.equal(line({ each: 4.29, unitPrice: 0.07, unitOf: 'ea' }, 2, 'lb'), null);
  assert.equal(line({ each: 4.29 }, 2, 'lb'), null, 'v0.1.3 rows without a unit price');
  assert.deepEqual(line({ each: 3.79, unitPrice: 3.79, unitOf: 'gal' }, 2, 'qt'), { total: 1.9, approx: true, regular: null });
});

test('M2: plain count and package-style units multiply the package price', () => {
  assert.deepEqual(line(PKG, 3), { total: 25.47, approx: false, regular: null });
  assert.deepEqual(line(PKG, 2, 'pack'), { total: 16.98, approx: false, regular: null });
  assert.deepEqual(line(PKG, null), { total: 8.49, approx: false, regular: null });
  assert.equal(L.linePrice({ name: 'x' }), null);
});

test('M2 + L12: the regular (struck) price follows the same line rule', () => {
  const sale = { ...BW, onSale: true, regular: 4.49 };
  assert.deepEqual(line(sale, 2, 'lb'), { total: 7.98, approx: false, regular: 8.98 });
  assert.deepEqual(line(sale, 1), { total: 6.38, approx: true, regular: 7.18 }, 'piece estimate x regular/shelf, not the per-lb price');
});

test('M2: totals, CSV and text export use the same line rule', async () => {
  const { toCSV, toText } = await import('../src/export.js');
  let s = L.emptyState();
  s = L.addItem(s, { name: 'Chicken', qty: 2, unit: 'lb', priced: { ...PKG, sku: 'c1', store: 'Wegmans #90' } }, 'a');
  s = L.addItem(s, { name: 'Bananas', qty: 2, unit: 'lb', priced: { ...BW, sku: 'b1' } }, 'b');
  const t = L.totals(s.items);
  assert.equal(t.all, 19.3);
  assert.equal(t.approx, true);
  const csv = toCSV(s.items).split('\r\n');
  assert.match(csv[1], /,8\.49,11\.32,yes,/);
  assert.match(csv[2], /,6\.38,7\.98,no,/);
  const txt = toText(s.items);
  assert.match(txt, /2 lb Chicken — ~\$11\.32/);
  assert.match(txt, /2 lb Bananas — \$7\.98/);
  assert.match(txt, /Estimated total: ~\$19\.30/);
});

test('L14: big prices survive, money has separators, qty is capped', () => {
  assert.equal(L.cleanPriced({ each: 123456.78 }).each, 123456.78);
  assert.equal(L.cleanPriced({ each: 2e6 }), null);
  assert.equal(L.money(123456.78), '$123,456.78');
  assert.equal(L.priceText(1234.5, true), '~$1,234.50');
  assert.throws(() => L.cleanItemInput({ name: 'eggs', qty: 10000 }), /9999 or less/);
  assert.equal(L.cleanItemInput({ name: 'flour', qty: 1000, unit: 'g' }).qty, 1000);
});

test('units: normUnit and convert', () => {
  assert.equal(L.normUnit('Pounds'), 'lb');
  assert.equal(L.normUnit('lb.'), 'lb');
  assert.equal(L.normUnit('fl oz'), 'floz');
  assert.equal(L.normUnit('Each'), 'ea');
  assert.equal(L.normUnit('bunch'), '');
  assert.equal(L.convert('oz', 'lb'), 1 / 16);
  assert.equal(L.convert('lb', 'ml'), null);
  assert.ok(Math.abs(L.convert('oz', 'floz') - 1) < 1e-9, 'oz of a liquid priced per fl oz');
});
