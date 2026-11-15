// v0.2.0 Recipes logic: feed validation, scaling, whole packs, matching, cost range, sorts, steps.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as R from '../src/recipes.js';
import * as C from '../src/catalog.js';
import * as P from '../src/prices.js';

const item = (name, price, size, extra = {}) => ({ chain: 'wegmans', storeId: '90', name, price, size, ...extra });
const DOC = { schema: 'shopsmartr.prices/2', stores: [{ chain: 'wegmans', storeId: '90', name: 'W 90' }, { chain: 'wegmans', storeId: '91', name: 'W 91' }], items: [
  item('Wegmans Heavy Cream', 3.49, '16 fl oz', { sku: 'hc' }),
  item('Vanilla Ice Cream', 4.99, '48 fl oz', { sku: 'ic' }),
  item('Lemons', 0.79, '1 ea', { sku: 'le' }),
  item('Organic Lemons', 1.29, '1 ea', { sku: 'ole' }),
  item('Unsalted Butter', 4.29, '1 lb', { sku: 'bu' }),
  item('Green Bean Casserole Kit', 6.99, '24 oz', { sku: 'gbc' }),
  item('Green Beans', 2.49, '12 oz', { sku: 'gb' }),
  { chain: 'wegmans', storeId: '91', name: 'Heavy Cream', price: 2.99, size: '16 fl oz', sku: 'hc91' },
] };
const { catalog: cat, index } = C.prepare(DOC);
const mi = R.buildMatchIndex(cat, index);
const S90 = cat.stores.findIndex((s) => s.storeId === '90');

const ing = (base, qty, unit, extra = {}) => ({ text: `${qty ?? ''} ${unit ?? ''} ${base}`.trim(), base, qty, unit, ...extra });
const RDOC = { schema: R.RECIPES_SCHEMA, generatedAt: '2026-11-15T00:00:00Z', recipes: [
  { id: '1', title: 'Lemon Butter Beans', cat: 'side-dishes', servings: 4, times: { prep: 10, cook: 15 }, rating: 4.6, ratingCount: 12,
    ing: [ing('green beans', 0.75, 'lb'), ing('lemons', 1.5, 'whole'), ing('unsalted butter', 2, 'tbsp'), ing('salt', null, null), ing('black pepper', null, null)],
    steps: ['Boil the beans for 5 minutes.', 'Toss with butter and lemon.'] },
  { id: '2', title: 'Cream Sauce', cat: 'condiments-and-sauces', servings: 2, times: { total: 20 }, ing: [ing('heavy cream', 1, 'cup')], steps: ['Simmer 10-12 minutes.'] },
  { id: '3', title: 'Apple Thing', cat: 'desserts', servings: 2, times: {}, ing: [ing('dragonfruit', 1, 'whole')], steps: [] },
  { id: '3', title: 'Duplicate id', ing: [ing('x', 1, null)] },
  { id: '4', title: 'No ingredients', ing: [] },
  { title: 'No id', ing: [ing('x', 1, null)] },
] };

test('prepareRecipes: validates, drops bad rows, derives time / search / pantry', () => {
  const d = R.prepareRecipes(RDOC);
  assert.equal(d.count, 3);
  assert.deepEqual(d.categories, { 'side-dishes': 1, 'condiments-and-sauces': 1, desserts: 1 });
  const r = d.recipes[0];
  assert.equal(r.time, 25);
  assert.equal(r.n, 3, 'salt and pepper are pantry');
  assert.ok(R.matchesQuery(r, 'lemon bean'));
  assert.ok(!R.matchesQuery(r, 'chocolate'));
  assert.throws(() => R.prepareRecipes({ schema: 'x', recipes: [] }), /Not a recipe/);
});

test('cleanRecipeManifest: shape, file name, counts', () => {
  const m = R.cleanRecipeManifest({ schema: 'shopsmartr.recipefeed/1', available: true, file: '../evil', itemCount: 1344, categories: { soups: 120, 'Bad Slug': 3 }, dataSchema: R.RECIPES_SCHEMA });
  assert.equal(m.file, 'recipes.enc');
  assert.equal(m.itemCount, 1344);
  assert.deepEqual(m.categories, { soups: 120 });
  assert.equal(R.cleanRecipeManifest({ schema: 'shopsmartr.pricefeed/1', available: true }), null);
});

test('amounts: fractions and scaling', () => {
  assert.equal(R.formatAmount(0.75), '¾');
  assert.equal(R.formatAmount(1.5), '1½');
  assert.equal(R.formatAmount(0.333), '⅓');
  const r = R.prepareRecipes(RDOC).recipes[0];
  const f = R.scaleFactor(r, 6);
  assert.equal(f, 1.5);
  assert.match(R.amountText(r.ing[0], f), /^1⅛ lb/);
  assert.equal(R.scaleFactor({ servings: null }, 6), 1, 'no servings given: amounts as written');
});

test('pantry line lists the basics', () => {
  const r = R.prepareRecipes(RDOC).recipes[0];
  assert.deepEqual(R.pantryLabels(r.ing.filter((i) => i.pantry)), ['salt', 'black pepper']);
});

test('matching: heavy cream never prices as ice cream; casserole ranks below beans; store scoped', () => {
  const hc = R.matchRows(mi, 'heavy cream', S90).map((c) => cat.cols.name[c.row]);
  assert.deepEqual(hc, ['Wegmans Heavy Cream']);
  const gb = R.matchRows(mi, 'green beans', S90).map((c) => cat.cols.name[c.row]);
  assert.equal(gb[0], 'Green Beans');
  assert.ok(!gb.includes('Green Bean Casserole Kit') || gb.indexOf('Green Bean Casserole Kit') > 0);
  assert.deepEqual(R.matchRows(mi, 'dragonfruit', S90), []);
});

test('buying whole packs: ¾ lb of beans is one 12 oz bag; 1½ lemons buys 2', () => {
  const r = R.prepareRecipes(RDOC).recipes[0];
  const beans = C.getItem(cat, R.matchRows(mi, 'green beans', S90)[0].row);
  const b = R.buyFor(r.ing[0], 1, beans);
  assert.equal(b.packs, 1);   // 12 oz covers ¾ lb exactly
  const lem = C.getItem(cat, R.matchRows(mi, 'lemons', S90)[0].row);
  const l = R.buyFor(r.ing[1], 1, lem);
  assert.equal(l.packs, 2);
  assert.equal(l.buys, 'Buys 2', '1½ lemons shows "Buys 2"');
  const butter = C.getItem(cat, R.matchRows(mi, 'unsalted butter', S90)[0].row);
  assert.equal(R.buyFor(r.ing[2], 1, butter).packs, 1, '2 tbsp of butter is one 1 lb pack');
  assert.equal(R.buyFor(r.ing[0], 3, beans).packs, 3, '2¼ lb of beans is 3 x 12 oz');
});

test('cost range: low = cheapest match, high = dearest, pantry excluded, unpriced counted', () => {
  const d = R.prepareRecipes(RDOC);
  const { cands } = R.precomputeCandidates(mi, d.recipes, S90);
  const c = R.recipeCost(d.recipes[0], { mi, cands, factor: 1 });
  assert.equal(c.priced, 3);
  assert.equal(c.unpriced, 0);
  assert.ok(c.low <= c.high);
  // lemons 2 x 0.79 / 2 x 1.29; beans 2.49; butter 4.29
  assert.equal(c.low, Math.floor(2 * 0.79 + 2.49 + 4.29));
  assert.equal(c.high, Math.ceil(2 * 1.29 + 2.49 + 4.29));
  assert.equal(R.costText(c).text, `$${c.low}–$${c.high}`);
  assert.match(R.costText(c).aria, /^\d+ to \d+ dollars to buy$/);
  assert.equal(R.recipeCost(d.recipes[2], { mi, cands, factor: 1 }), null);
});

test('sorts: time, A-Z, rating (unrated last), price asc/desc; Rating falls back when nothing is rated', () => {
  const d = R.prepareRecipes(RDOC).recipes;
  assert.deepEqual(R.sortRecipes(d, { by: 'time' }).map((r) => r.id), ['2', '1', '3']);
  assert.deepEqual(R.sortRecipes(d, { by: 'name' }).map((r) => r.id), ['3', '2', '1']);
  assert.deepEqual(R.sortRecipes(d, { by: 'rating' }).map((r) => r.id), ['1', '3', '2']);
  const cost = { 1: { low: 8 }, 2: { low: 3 }, 3: null };
  assert.deepEqual(R.sortRecipes(d, { by: 'price', dir: 'asc' }, { costOf: (r) => cost[r.id] }).map((r) => r.id), ['2', '1', '3']);
  assert.deepEqual(R.sortRecipes(d, { by: 'price', dir: 'desc' }, { costOf: (r) => cost[r.id] }).map((r) => r.id), ['1', '2', '3']);
  assert.equal(R.effectiveSort({ by: 'rating' }, d.filter((r) => r.id !== '1')).by, 'time');
  assert.equal(R.effectiveSort({ by: 'rating' }, d).by, 'rating');
  assert.deepEqual(R.cleanRxSort({ by: 'bogus' }), { by: 'time', dir: 'asc' });
});

test('rating text and slot rules', () => {
  const d = R.prepareRecipes(RDOC).recipes;
  assert.ok(R.hasRating(d[0]));
  assert.ok(!R.hasRating(d[1]));
  assert.equal(R.ratingAria(d[0]), 'Rated 4.6 out of 5 from 12 reviews');
});

test('steps: long steps split by sentence, timers read', () => {
  const long = `${'Stir the sauce well. '.repeat(20)}Bake approx. 25 min.`;
  const out = R.splitSteps([long, 'Short.']);
  assert.ok(out.length > 2);
  assert.ok(out.every((s) => s.length <= 300));
  assert.equal(R.stepTimer('Bake 25 minutes, then rest 10 minutes.'), '25 + 10 min');
  assert.equal(R.stepTimer('Simmer 10-12 minutes.'), '10–12 min');
  assert.equal(R.stepTimer('Serve.'), '');
});

test('quick picks and list coverage', () => {
  const d = R.prepareRecipes(RDOC).recipes;
  assert.ok(R.QUICK.quick.test(d[0]));
  assert.ok(R.QUICK.few.test(d[0]));
  const lidx = R.listIndex([{ name: 'Green beans' }, { name: 'Lemons' }]);
  assert.deepEqual(R.coverage(d[0], lidx), { have: 2, total: 3 });
  assert.ok(R.usesList(R.coverage(d[0], lidx)));
});

test('detailModel: lines, pantry, cost', () => {
  const d = R.prepareRecipes(RDOC);
  const { cands } = R.precomputeCandidates(mi, d.recipes, S90);
  const m = R.detailModel(d.recipes[0], { servings: 4, mi, cands });
  assert.equal(m.lines.length, 3);
  assert.deepEqual(m.pantry, ['salt', 'black pepper']);
  assert.ok(m.cost);
  assert.ok(m.lines.every((l) => l.opts[0]));
  const none = R.detailModel(d.recipes[0], { servings: 4 });
  assert.equal(none.cost, null);
});

test('recipes key slot: a wrong base for recipes does not forget the price keys', async () => {
  const cache = P.memoryKeyCache();
  await cache.set('base', { fake: true });
  await cache.set('aes', { key: 'k', salt: 's', iter: 1 });
  const env = { salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iter: 600000 };
  const fakeSubtle = { deriveKey: async () => 'derived' };
  const res = await P.unlockWithCache(env, cache, fakeSubtle, async () => { throw new P.WrongPassphraseError(); }, 'aes-recipes');
  assert.equal(res, null);
  assert.ok(await cache.get('aes'), 'price key kept');
});
