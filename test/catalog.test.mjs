import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as C from '../src/catalog.js';
import * as P from '../src/prices.js';

const V2 = JSON.parse(readFileSync(new URL('./fixtures/prices-v2-fake.enc.json', import.meta.url)));
const doc = await P.decryptJSON(V2, 'throwaway-fake-v2-fixture-passphrase');
const { catalog: cat, index } = C.prepare(doc);
const names = (r) => r.items.map((i) => i.name);
const A = 'wegmans:90';
const B = 'wegmans:999';

test('tokenize folds case, accents and &', () => {
  assert.deepEqual(C.tokenize('Crème Fraîche 8-oz'), ['creme', 'fraiche', '8', 'oz']);
  assert.deepEqual(C.tokenize('Mac & Cheese'), ['mac', 'and', 'cheese']);
  assert.deepEqual(C.tokenize(null), []);
});

test('normalizeDoc: v2 columns, drops nameless and duplicate rows', () => {
  assert.equal(cat.n, 7);
  assert.ok(cat.cols.price instanceof Float64Array);
  assert.equal(cat.cols.name.length, 7);
  const spaghetti = C.search(cat, index, 'spaghetti').items;
  assert.equal(spaghetti.length, 1);
  assert.equal(spaghetti[0].price, 1.29, 'first row wins over a duplicate SKU');
  assert.throws(() => C.normalizeDoc({ schema: 'other/1', items: [] }), /Unsupported/);
  assert.throws(() => C.normalizeDoc({}), /Not a price/);
  const v1 = C.normalizeDoc({ schema: 'shopsmartr.prices/v1', stores: [{ chain: 'x', storeId: '1', name: 'X' }], items: [{ chain: 'x', storeId: '1', staple: 'milk', name: 'Milk', price: '2.5' }] });
  assert.equal(v1.n, 1);
  assert.equal(v1.cols.price[0], 2.5);
});

test('getItem materialises sale, regular, by-weight fields', () => {
  const almond = C.search(cat, index, 'almondmilk').items[0];
  assert.equal(almond.onSale, true);
  assert.equal(almond.regularPrice, 3.99);
  assert.equal(almond.aisle, 'Dairy 2');
  const apples = C.search(cat, index, 'apples').items[0];
  assert.equal(apples.soldByWeight, true);
  assert.deepEqual(C.estimate(apples), { each: 4.98, approx: true });
  assert.deepEqual(C.estimate({ price: 2, soldByWeight: true }), { each: 2, approx: true });
  assert.deepEqual(C.estimate({ price: 2 }), { each: 2, approx: false });
});

test('search: prefix, AND, ranking, accents, department, paging', () => {
  assert.deepEqual(names(C.search(cat, index, 'mi', { store: A })).sort(), ['Fake Almondmilk Unsweetened', 'Fake Whole Milk']);
  assert.equal(C.search(cat, index, 'milk', { store: A }).items[0].name, 'Fake Whole Milk', 'exact name token ranks first');
  assert.equal(C.search(cat, index, 'creme', { store: A }).items[0].name, 'Fake Crème Fraîche');
  assert.equal(C.search(cat, index, 'fake whole', { store: A }).total, 1);
  assert.equal(C.search(cat, index, 'zzz').total, 0);
  const dairy = C.search(cat, index, '', { department: 'Dairy', store: A });
  assert.equal(dairy.total, 3);
  assert.deepEqual(names(dairy), ['Fake Almondmilk Unsweetened', 'Fake Crème Fraîche', 'Fake Whole Milk']);
  const page = C.search(cat, index, '', { store: A, offset: 2, limit: 2 });
  assert.equal(page.total, 5);
  assert.equal(page.items.length, 2);
  assert.equal(C.search(cat, index, 'fake', { department: 'Nope' }).total, 0);
  assert.equal(C.search(cat, index, 'brand', { store: A }).items[0].name, 'Fake Spaghetti', 'brand tokens match');
});

test('store scoping: list, pick, departments, search and suggestions', () => {
  assert.deepEqual(C.priceStores(cat).map((s) => [s.key, s.label, s.count]), [[A, 'Wegmans #90', 5], [B, 'Wegmans #999', 2]]);
  assert.equal(C.pickStore(cat, B), B);
  assert.equal(C.pickStore(cat, 'tops:1'), A, 'unknown saved store falls back to the first');
  assert.equal(C.pickStore(cat, ''), A);
  assert.equal(C.pickStore(null, A), null);
  assert.deepEqual(C.storeDepartments(cat, B).map((d) => [d.name, d.count]), [['Bakery', 1], ['Dairy', 1]]);
  assert.deepEqual(C.storeDepartments(cat, A).map((d) => d.name), ['Dairy', 'Grocery', 'Produce & Floral']);
  const milkB = C.search(cat, index, 'whole milk', { store: B }).items;
  assert.equal(milkB.length, 1);
  assert.equal(milkB[0].price, 4.19);
  assert.equal(C.search(cat, index, 'bagels', { store: A }).total, 0);
  assert.equal(C.search(cat, index, '', { store: B, department: 'Bakery' }).total, 1);
  assert.deepEqual(C.suggest(cat, index, 'milk', { store: B }).map((i) => i.price), [4.19]);
  assert.equal(C.suggest(cat, index, 'm', { store: A }).length, 0, 'needs 2 characters');
  assert.ok(C.suggest(cat, index, 'fake', { store: A, limit: 2 }).length === 2);
  assert.equal(C.search(cat, index, '', { store: 'tops:1' }).total, 0);
});

test('one-store feeds still list that store', () => {
  const one = C.normalizeDoc({ schema: 'shopsmartr.prices/2', stores: [], items: [{ chain: 'wegmans', storeId: '90', name: 'X', price: 1 }] });
  assert.deepEqual(C.priceStores(one).map((s) => s.key), ['wegmans:90']);
  assert.equal(C.pickStore(one, 'wegmans:105'), 'wegmans:90');
});

test('pricedFields keeps the source store, sku and estimate', () => {
  const apples = C.search(cat, index, 'apples').items[0];
  const f = C.pricedFields(cat, apples, { 'wegmans-90': { id: 'wegmans-90' } });
  assert.equal(f.storeId, 'wegmans-90');
  assert.deepEqual(f.priced, { each: 4.98, approx: true, regular: null, onSale: false, unitPriceText: '$2.49/lb', size: '1 lb.', aisle: null, sku: '1003', store: 'Wegmans #90', chain: 'wegmans', storeNo: '90', asOf: '2026-11-14T12:00:00Z' });
  const b = C.pricedFields(cat, C.search(cat, index, 'bagels', { store: B }).items[0], { 'wegmans-90': {} });
  assert.equal(b.storeId, '', 'stores not in the directory go to Any store');
  assert.equal(b.priced.store, 'Wegmans #999');
});

test('index is structured-cloneable (Worker transfer)', () => {
  const copy = structuredClone({ cat, index });
  assert.equal(C.search(copy.cat, copy.index, 'milk', { store: A }).items[0].name, 'Fake Whole Milk');
});

test('33k-scale synthetic: search stays fast', () => {
  const items = [];
  for (let i = 0; i < 33000; i += 1) items.push({ chain: 'wegmans', storeId: '90', sku: String(i), name: `Item ${i % 977} thing ${i}`, price: 1 + (i % 50), department: `D${i % 11}` });
  const big = C.prepare({ schema: 'shopsmartr.prices/2', items });
  const t0 = performance.now();
  const r = C.search(big.catalog, big.index, 'item 9', { store: 'wegmans:90' });
  assert.ok(r.total > 0);
  assert.ok(performance.now() - t0 < 200);
  assert.equal(C.search(big.catalog, big.index, '', { department: 'D3', limit: 50 }).items.length, 50);
});

// ---------- matcher: subsequence, typos, fields, ranking ----------
const mk = (items) => C.prepare({ schema: 'shopsmartr.prices/2', items: items.map((x, i) => ({ chain: 'wegmans', storeId: '90', sku: String(i), price: 1, ...x })) });
const M = mk([
  { name: 'Boneless Skinless Chicken Breast', brand: 'Fixture Farms', department: 'Meat' },
  { name: 'Chicken Thighs', brand: 'Fixture Farms', department: 'Meat' },
  { name: 'Bananas', brand: null, department: 'Produce & Floral' },
  { name: 'Banana Bread', brand: 'Demo Bakery', department: 'Bakery' },
  { name: 'Bandana Print Napkins', department: 'Household' },
  { name: 'Organic Spinach', brand: 'Acme Test Co', department: 'Produce & Floral' },
  { name: 'Cherry Tomatoes', brand: 'Acme Test Co', department: 'Produce & Floral' },
  { name: 'Wild Salmon', department: 'Seafood' },
  { chain: 'wegmans', storeId: '105', name: 'Chicken Breast Store B', department: 'Meat' },
]);
const q = (text, opts = {}) => C.search(M.catalog, M.index, text, { store: 'wegmans:90', ...opts }).items.map((i) => i.name);

test('helpers: editDistance1 and isSubsequence', () => {
  assert.ok(C.editDistance1('bananna', 'banana'));
  assert.ok(C.editDistance1('banan', 'banana'));
  assert.ok(C.editDistance1('chikcen', 'chicken') === false, 'a transposition is 2 edits');
  assert.ok(C.editDistance1('salmom', 'salmon'));
  assert.ok(!C.editDistance1('milk', 'milk'));
  assert.ok(C.isSubsequence('chkn', 'chicken'));
  assert.ok(C.isSubsequence('brst', 'breast'));
  assert.ok(!C.isSubsequence('hkn', 'chicken'), 'first letter must match');
});

test("subsequence: 'chkn brst' finds chicken breast", () => {
  assert.deepEqual(q('chkn brst'), ['Boneless Skinless Chicken Breast']);
  assert.deepEqual(q('chkn'), ['Chicken Thighs', 'Boneless Skinless Chicken Breast']);
});

test("typos: 'banan' and 'bananna' find bananas; exact/prefix rank above fuzzy", () => {
  const a = q('banan');
  assert.deepEqual(a.slice(0, 2).sort(), ['Banana Bread', 'Bananas']);
  const b = q('bananna');
  assert.ok(b.includes('Bananas') || b.includes('Banana Bread'));
  assert.deepEqual(q('salmom'), ['Wild Salmon']);
  assert.deepEqual(q('banana'), ['Banana Bread', 'Bananas', 'Bandana Print Napkins'], 'exact, then prefix, then fuzzy');
  assert.equal(q('bana')[2], 'Bandana Print Napkins', 'subsequence after prefix');
  assert.deepEqual(q('qqqq'), []);
});

test('brand-only and department-only queries', () => {
  assert.deepEqual(q('acme'), ['Cherry Tomatoes', 'Organic Spinach']);
  assert.deepEqual(q('fixture farms'), ['Chicken Thighs', 'Boneless Skinless Chicken Breast']);
  assert.deepEqual(q('seafood'), ['Wild Salmon']);
  assert.deepEqual(q('produce').sort(), ['Bananas', 'Cherry Tomatoes', 'Organic Spinach']);
  assert.equal(q('bakery')[0], 'Banana Bread');
});

test('name matches outrank brand and department matches', () => {
  const R = mk([{ name: 'Plain Crackers', brand: 'Meat Co', department: 'Snacks' }, { name: 'Meat Sauce', department: 'Grocery' }, { name: 'Pork Chops', department: 'Meat' }]);
  assert.deepEqual(C.search(R.catalog, R.index, 'meat').items.map((i) => i.name), ['Meat Sauce', 'Plain Crackers', 'Pork Chops']);
});

test('matcher is store-scoped', () => {
  assert.deepEqual(q('chicken breast'), ['Boneless Skinless Chicken Breast']);
  assert.deepEqual(q('chkn brst', { store: 'wegmans:105' }), ['Chicken Breast Store B']);
  assert.deepEqual(C.suggest(M.catalog, M.index, 'chkn', { store: 'wegmans:105' }).map((i) => i.name), ['Chicken Breast Store B']);
  assert.deepEqual(q('chkn', { department: 'Bakery' }), []);
});

test('onSale lists only real sale items of the selected store', () => {
  assert.deepEqual(C.onSale(cat, index, A).map((i) => i.name), ['Fake Almondmilk Unsweetened']);
  assert.deepEqual(C.onSale(cat, index, B), []);
});
