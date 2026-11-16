// v0.2.4-alpha: Tester's gate on v0.2.3 (5c67b97): M10 list over-match, L45 processed words in
// front, L46 cream look-alikes, L47 count vs weight pack, L48 focus after Add/Undo, L49 #ads URL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as R from '../src/recipes.js';
import * as C from '../src/catalog.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const ing = (base, qty = 1, unit = null) => ({ text: `${qty} ${unit ?? ''} ${base}`, base, qty, unit });
const onList = (base, ...names) => R.onListItem(ing(base), R.listIndex(names.map((name, i) => ({ id: `i${i}`, name, checked: false }))))?.name ?? null;

function mini(items) {
  const rows = items.map((x, i) => (typeof x === 'string' ? { name: x } : x)).map((x, i) => ({ chain: 'wegmans', storeId: '90', price: 3.49, size: '1 ea', sku: `s${i}`, ...x }));
  const { catalog, index } = C.prepare({ schema: 'shopsmartr.prices/2', stores: [{ chain: 'wegmans', storeId: '90', name: 'W' }], items: rows });
  const mi = R.buildMatchIndex(catalog, index);
  return { mi, catalog, names: (q) => R.matchRows(mi, q, 0).map((c) => catalog.cols.name[c.row]) };
}

// ---------- M10 ----------
const FALSE_PAIRS = [
  ['butter', 'Peanut Butter'], ['chicken', 'Chicken Broth'], ['cream', 'Cream Cheese'], ['bread', 'Banana Bread'],
  ['corn', 'Corn Tortillas'], ['garlic', 'Garlic Salt'], ['pineapple', 'Pineapple Juice'], ['cream', 'Vanilla Ice Cream'],
  ['ice', 'Vanilla Ice Cream'], ['cream', 'Sour Cream'], ['cream', 'Whipped Cream'], ['milk', 'Almond Milk'], ['chicken', 'Chicken Nuggets'],
  ['chicken', 'Popcorn Chicken'],
];
for (const [base, name] of FALSE_PAIRS) {
  test(`M10: "${name}" on the list does NOT cover "${base}"`, () => assert.equal(onList(base, name), null));
}
const TRUE_PAIRS = [
  ['butter', 'Unsalted Butter'], ['chicken', 'Chicken Breast'], ['chicken', 'Boneless Skinless Chicken Thighs'], ['cream', 'Heavy Cream'],
  ['cream', 'Heavy Whipping Cream'], ['bread', 'Sandwich Bread'], ['garlic', 'Garlic Bulb'], ['potato', 'Russet Potatoes'],
  ['onion', 'Yellow Onions'], ['olive oil', 'Extra Virgin Olive Oil'], ['unsalted butter', 'Butter, unsalted'], ['chicken thighs', 'chicken thighs'],
  ['unsalted butter', 'butter'], ['peas', 'Frozen Peas'], ['corn', 'Sweet Corn'], ['parmesan', 'Parmesan Cheese'],
];
for (const [base, name] of TRUE_PAIRS) {
  test(`M10: "${name}" on the list covers "${base}"`, () => assert.equal(onList(base, name), name));
}

test('M10: one shared rule — the list check and product matching agree on every pair', () => {
  for (const [base, name] of [...FALSE_PAIRS, ...TRUE_PAIRS]) {
    const [b, n] = [R.normName(base).core, R.normName(name).core];
    const covered = onList(base, name) !== null;
    // covered <=> the shared rule says same food in one direction (a plainer list name covers a more exact line)
    assert.equal(covered, !R.foodRelation(b, n).other && (!R.foodRelation(b, n).processed || R.foodRelation(b, n).soft) || !R.foodRelation(n, b).other && n.at(-1) === b.at(-1), `${base} / ${name}`);
  }
  for (const [base, name] of FALSE_PAIRS.filter(([b]) => b !== 'ice')) {
    const rel = R.foodRelation(R.normName(base).core, R.normName(name).core);
    assert.ok(rel.other || (rel.processed && !rel.soft), `${base} / ${name} is another food or a processed form`);
    // product matching: another food is never offered; a processed form only behind the plain one (L44/L45)
    if (rel.other) assert.ok(!mini([name]).names(base).includes(name), `matchRows offers ${name} for ${base}`);
    else assert.equal(mini([name, base[0].toUpperCase() + base.slice(1)]).names(base)[0].toLowerCase(), base, `${name} ranks behind plain ${base}`);
  }
  assert.equal(read('src/recipes.js').match(/foodRelation\(/g).length >= 3, true, 'matchRows and onListItem both go through foodRelation');
});

test('M10: recipe detail — Add missing no longer skips butter/chicken/corn/pineapple/cream/bread/garlic', () => {
  const r = R.prepareRecipes({ schema: R.RECIPES_SCHEMA, recipes: [{ id: 'qa9', title: 'QA', servings: 2, ing: ['butter', 'chicken', 'corn', 'pineapple', 'cream', 'bread', 'garlic', 'limes', 'celery'].map((b) => ing(b)) }] }).recipes[0];
  const list = ['Peanut Butter', 'Vanilla Ice Cream', 'Chicken Broth', 'Corn Tortillas', 'Pineapple Juice', 'Cream Cheese', 'Banana Bread', 'Garlic Salt', 'Limes']
    .map((name, i) => ({ id: `l${i}`, name, checked: name === 'Limes' }));
  const m = R.detailModel(r, { servings: 2, listItems: list });
  assert.deepEqual(m.have.map((l) => l.ing.base), ['limes'], 'only the (checked) Limes line covers anything');
  assert.equal(R.coverage(r, R.listIndex(list)).have, 1);
  assert.deepEqual(m.missing.map((l) => l.ing.base).sort(), ['bread', 'butter', 'celery', 'chicken', 'corn', 'cream', 'garlic', 'pineapple']);
});

// ---------- L45 ----------
test('L45: Popcorn / Rotisserie Chicken rank below real cuts for a bare "chicken"', () => {
  const { names } = mini(['Popcorn Chicken', 'Chicken Thighs', 'Boneless Skinless Chicken Breast', 'Rotisserie Chicken', 'Chicken Nuggets']);
  const got = names('chicken');
  assert.ok(['Chicken Thighs', 'Boneless Skinless Chicken Breast'].includes(got[0]), got.join(' | '));
  const pos = (n) => (got.indexOf(n) < 0 ? 99 : got.indexOf(n));
  for (const cut of ['Chicken Thighs', 'Boneless Skinless Chicken Breast']) for (const proc of ['Popcorn Chicken', 'Rotisserie Chicken']) assert.ok(pos(cut) < pos(proc), `${cut} before ${proc}: ${got.join(' | ')}`);
  assert.deepEqual(mini(['Popcorn Chicken', 'Chicken']).names('chicken')[0], 'Chicken');
});

// ---------- L46 ----------
test('L46: Ice / Sour / Whipped Cream are never Swap options for "cream" and never set its cost range', () => {
  const { mi, names } = mini([{ name: 'Heavy Cream', price: 3.99, size: '16 fl oz' }, { name: 'Fresh Ice Cream Value Pack', price: 9.99, size: '48 fl oz' },
    { name: 'Sour Cream', price: 2.49, size: '16 oz' }, { name: 'Whipped Cream', price: 3.29, size: '7 oz' }, { name: 'Heavy Whipping Cream', price: 4.49, size: '16 fl oz' }]);
  assert.deepEqual(names('cream').sort(), ['Heavy Cream', 'Heavy Whipping Cream'], 'no bagged ice needed in the catalog');
  const r = R.prepareRecipes({ schema: R.RECIPES_SCHEMA, recipes: [{ id: 'c', title: 'C', servings: 1, ing: [ing('cream', 1, 'cup')] }] }).recipes[0];
  const { cands } = R.precomputeCandidates(mi, [r], 0);
  const opts = R.lineOptions(mi, cands, r.ing[0], 1).map((o) => o.it.name);
  assert.ok(opts.every((n) => /^Heavy/.test(n)), opts.join(' | '));
  const cost = R.recipeCost(r, { mi, cands });
  assert.ok(cost.high <= 5, `high end ${cost.high} comes from heavy cream, not ice cream`);
});

// ---------- L47 ----------
test('L47: "2 potato" against a 5 lb bag buys ONE bag and flags it; ct packs still divide', () => {
  const bag = { name: 'Russet Potatoes', price: 3.99, size: '5 lb', soldByWeight: false };
  const b = R.buyFor(ing('potato', 2), 1, bag);
  assert.equal(b.packs, 1);
  assert.equal(b.listQty, 1);
  assert.equal(b.review, true);
  assert.equal(b.total, 3.99);
  assert.match(b.buys, /1 pack for 2 · check the size/);
  const lemons = R.buyFor(ing('lemons', 3), 1, { name: 'Lemons', price: 0.79, size: '1 ea' });
  assert.equal(lemons.packs, 3, 'a per-each product still buys one per piece');
  assert.equal(lemons.review, false);
  const eggs = R.buyFor(ing('eggs', 14), 1, { name: 'Large Eggs', price: 3.49, size: '12 ct' });
  assert.equal(eggs.packs, 2, 'a 12 ct pack divides the count');
  const canned = R.buyFor(ing('tomatoes', 2, 'can'), 1, { name: 'Diced Tomatoes', price: 1.29, size: '14.5 oz' });
  assert.equal(canned.packs, 2, '2 cans still buys 2');
});

// ---------- L48 / L49 (behaviour is covered by the v024 browser probe; these pin the code paths) ----------
test('L48: after Add / Undo, focus goes to the first VISIBLE target, never the hidden phone CTA', () => {
  const rx = read('src/rx.js');
  assert.match(rx, /const AFTER_ADD = \['\.rx-cta \.btn', '#rx-side \.rx-added button', '#rx-side #rx-side-add', '#toast-undo', '\.rx-title'\]/);
  assert.match(rx, /renderKeep\(AFTER_ADD\)/);
  assert.match(rx, /renderKeep\(AFTER_UNDO\)/);
  assert.doesNotMatch(rx, /renderKeep\('\.rx-cta \.btn'\)/);
  assert.match(rx, /getClientRects\(\)\.length/);
});

test('L49: #ads opens the Weekly ads sheet and rewrites the URL with history.replaceState', () => {
  const app = read('src/app.js');
  const route = app.slice(app.indexOf('function route()'), app.indexOf('function bind()'));
  assert.match(route, /=== 'ads'/);
  assert.match(route, /openAds\(\)/);
  assert.match(route, /history\.replaceState\([^)]*#\$\{screen\}/);
});
