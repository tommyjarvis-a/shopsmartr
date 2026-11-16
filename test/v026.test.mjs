// v0.2.6: Cook from my list and recipe Import (paste, bookmarklet / Shortcut #fragment hand-off),
// imported recipes in the full backup, sanitising of untrusted imports, and the CSP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as I from '../src/importer.js';
import * as R from '../src/recipes.js';
import * as B from '../src/backup.js';
import * as K from '../src/keys.js';
import * as L from '../src/list.js';
import * as F from '../src/favorites.js';
import { memoryStorage } from '../src/storage.js';
import { VERSION } from '../src/version.js';
import { LIVE_URL } from '../src/brand.js';
import { RX_COOK_SORT_KEY } from '../src/rx.js';
import { inlineScriptHashes } from '../tools/csp-hashes.mjs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const NOW = new Date('2026-11-16T03:00:00Z');

test('version 0.2.6-alpha in version.js, package.json and the CHANGELOG', () => {
  assert.match(VERSION, /^0\.2\.6-alpha(\.\d+)?$/);   // v0.2.6-alpha.1: exact version is checked in v026a1.test.mjs
  assert.equal(JSON.parse(read('package.json')).version, VERSION);
  assert.match(read('CHANGELOG.md'), /## \[0\.2\.6-alpha\]/);
});

// ---------- ingredient lines ----------
test('parseIngredientLine: amounts, fractions, ranges, units, package sizes, prep, optional', () => {
  const p = (t) => I.parseIngredientLine(t);
  assert.deepEqual([p('1 (15 oz) can black beans, drained').qty, p('1 (15 oz) can black beans, drained').unit, p('1 (15 oz) can black beans, drained').alt, p('1 (15 oz) can black beans, drained').base, p('1 (15 oz) can black beans, drained').prep], [1, 'can', '15 oz', 'black beans', 'drained']);
  assert.equal(p('1½ cups all-purpose flour').qty, 1.5);
  assert.equal(p('1½ cups all-purpose flour').unit, 'cup');
  assert.equal(p('¾ tsp kosher salt').qty, 0.75);
  assert.equal(p('1⁄2 cup milk').qty, 0.5);
  assert.equal(p('3-4 cloves garlic, minced').qty, 4, 'a range buys the larger amount');
  assert.equal(p('3-4 cloves garlic, minced').unit, 'clove');
  assert.equal(p('2 T butter').unit, 'tbsp');
  assert.equal(p('2 t vanilla').unit, 'tsp');
  assert.equal(p('2 large eggs').base, 'eggs');
  assert.equal(p('a pinch of nutmeg').unit, 'pinch');
  assert.equal(p('Juice of 1 lemon').base, 'lemon');
  assert.equal(p('- 8 small corn tortillas').qty, 8);
  assert.equal(p('• 2 cups shredded cabbage').base, 'shredded cabbage');
  assert.equal(p('salt to taste').qty, null);
  assert.equal(p('fresh cilantro (optional)').optional, true);
  assert.equal(p('Ingredients:'), null);
  assert.equal(p(''), null);
  // they become feed-shaped lines: pantry and keys work like Wegmans lines
  const [r] = I.prepareUserRecipes([I.makeUserRecipe({ title: 'T', lines: ['salt to taste', '1 lb chicken thighs'] }, { id: 'u-test000001', now: NOW })]);
  assert.equal(r.ing[0].pantry, true);
  assert.equal(r.ing[1].k, 'chicken thigh');
  assert.equal(r.imported, true);
  assert.equal(r.cat, 'imported');
});

// ---------- JSON-LD and pasted text ----------
const LD = {
  '@context': 'https://schema.org',
  '@graph': [{ '@type': 'WebSite', name: 'Example' }, {
    '@type': ['Recipe'], name: 'Chicken Street Tacos', recipeYield: ['4', '4 servings'], prepTime: 'PT15M', cookTime: 'PT15M', totalTime: 'PT30M',
    image: [{ '@type': 'ImageObject', url: 'https://example-recipes.com/img/tacos.jpg' }],
    recipeIngredient: ['1 lb boneless chicken thighs', '8 small corn tortillas', '2 cups shredded cabbage', '1 avocado', '2 limes', '½ cup cilantro', 'salt to taste'],
    recipeInstructions: [{ '@type': 'HowToSection', name: 'Cook', itemListElement: [{ '@type': 'HowToStep', text: 'Season the chicken.' }, { '@type': 'HowToStep', text: 'Grill 6 minutes a side.' }] }, { '@type': 'HowToStep', text: 'Fill the tortillas.' }],
  }],
};
test('JSON-LD: Recipe found in @graph; sections, ISO times, yield and image object read', () => {
  const html = `<html><head><script type="application/ld+json">{bad json</script><script type="application/ld+json">${JSON.stringify(LD)}</script></head><body>x</body></html>`;
  const d = I.parseRecipeText(html, 'https://example-recipes.com/tacos');
  assert.equal(d.title, 'Chicken Street Tacos');
  assert.equal(d.servings, 4);
  assert.deepEqual(d.times, { prep: 15, cook: 15, total: 30 });
  assert.equal(d.image, '', 'M11 (v0.2.6-alpha.1): an imported photo URL is dropped, never kept or loaded');
  assert.equal(d.lines.length, 7);
  assert.deepEqual(d.steps, ['Season the chicken.', 'Grill 6 minutes a side.', 'Fill the tortillas.']);
  assert.equal(d.url, 'https://example-recipes.com/tacos');
  assert.equal(I.parseRecipeText(JSON.stringify(LD)).title, 'Chicken Street Tacos', 'pasted JSON works too');
  assert.equal(I.isoMinutes('PT1H20M'), 80);
  assert.equal(I.isoMinutes('garbage'), null);
});
test('pasted text: headings, Serves line, numbered steps; no headings: amounts and bullets are ingredients', () => {
  const t = 'Lemon Garlic Chicken\nServes 4\nPrep time: 10 min\n\nIngredients\n1 lb chicken thighs\n2 lemons\n4 cloves garlic, minced\nSalt and pepper to taste\n\nInstructions\n1. Heat the oven to 425°F.\n2. Toss everything together and roast 35 minutes.\nNotes\nKeeps 3 days.';
  const d = I.parseRecipeText(t);
  assert.equal(d.title, 'Lemon Garlic Chicken');
  assert.equal(d.servings, 4);
  assert.deepEqual(d.lines, ['1 lb chicken thighs', '2 lemons', '4 cloves garlic, minced', 'Salt and pepper to taste']);
  assert.deepEqual(d.steps, ['Heat the oven to 425°F.', 'Toss everything together and roast 35 minutes.']);
  const loose = I.parseRecipeText('Quick Slaw\n2 cups shredded cabbage\n- 1 carrot\n1/4 cup mayo\nMix everything in a bowl and chill it for twenty minutes before serving.');
  assert.equal(loose.title, 'Quick Slaw');
  assert.equal(loose.lines.length, 3);
  assert.equal(loose.steps.length, 1);
  assert.equal(I.parseRecipeText('just some words with no ingredients'), null);
  assert.equal(I.parseRecipeText(''), null);
  assert.equal(I.parseRecipeText(null), null);
});

// ---------- malicious payloads ----------
test('sanitising: script tags, handlers, entities, control and bidi characters, bad links, caps', () => {
  const evil = {
    title: '<img src=x onerror=alert(1)>Tacos<script>alert(2)</script>\u202e\u0000',
    url: 'javascript:alert(1)', image: 'http://example.com/a.jpg',
    lines: ['<b>1 cup</b> sugar', '&lt;script&gt;alert(3)&lt;/script&gt; 2 eggs', `${'x'.repeat(5000)}`, ...Array.from({ length: 500 }, (_, i) => `${i + 1} cup thing`)],
    steps: ['<style>body{display:none}</style>Stir.', ...Array.from({ length: 300 }, () => 'y'.repeat(1990))],
    servings: 1e9, times: { total: -5 }, extra: { __proto__: { polluted: true } },
  };
  const d = I.sanitizeDraft(evil);
  assert.equal(d.title, 'Tacos');
  assert.ok(!/[<>]/.test(d.title));
  assert.equal(d.url, '');
  assert.equal(d.image, '', 'only https images');
  assert.equal(d.lines[0], '1 cup sugar');
  assert.equal(d.lines[1], '<script>alert(3)</script> 2 eggs', 'decoded once, stays inert text (shown with textContent)');
  assert.equal(d.lines[2].length, I.CAPS.line);
  assert.equal(d.lines.length, I.CAPS.lines);
  assert.equal(d.steps[0], 'Stir.');
  assert.ok(d.steps.length <= I.CAPS.steps && d.steps.join('').length <= I.CAPS.stepsTotal);
  assert.equal(d.servings, null);
  assert.equal(d.times.total, null);
  assert.deepEqual(Object.keys(d).sort(), ['image', 'lines', 'servings', 'steps', 'times', 'title', 'url']);
  assert.equal({}.polluted, undefined);
  assert.equal(I.cleanUrl('https://user:pw@example.com/'), '');
  assert.equal(I.cleanUrl('https://ex.com/"onmouseover=x'), '');
  assert.equal(I.cleanUrl(`https://ex.com/${'a'.repeat(700)}`), '');
  assert.equal(I.cleanText('a\u200bb\u2066c'), 'a b c');
});

test('#fragment payload: j and z round trip; damaged, oversized, inflating (zip bomb), wrong version and empty payloads are refused', async () => {
  const d = I.draftFromJsonLd(LD['@graph'][1], 'https://example-recipes.com/tacos');
  for (const compress of [true, false]) {
    const p = await I.encodePayload(d, { compress });
    assert.match(p, compress ? /^1z\./ : /^1j\./);
    assert.deepEqual(await I.decodePayload(p), d);
  }
  const rej = async (p, re) => { await assert.rejects(I.decodePayload(p), (e) => e instanceof I.ImportError && re.test(e.message)); };
  await rej('', /Nothing/);
  await rej('1j.!!!', /damaged/);
  await rej('2j.abc', /damaged/);
  await rej(`1j.${'A'.repeat(I.MAX_FRAGMENT)}`, /too large/);
  await rej(`1j.${Buffer.from('{not json').toString('base64url')}`, /damaged/);
  await rej(`1j.${Buffer.from(JSON.stringify({ v: 9, i: ['1 egg'] })).toString('base64url')}`, /different version/);
  await rej(`1j.${Buffer.from(JSON.stringify({ v: 1, t: 'x', i: [] })).toString('base64url')}`, /Couldn't read a recipe/);
  await rej(`1j.${Buffer.from(JSON.stringify([1, 2])).toString('base64url')}`, /different version/);
  // a small payload that inflates far past the cap
  const { deflateRawSync } = await import('node:zlib');
  const bomb = deflateRawSync(Buffer.from(JSON.stringify({ v: 1, t: 'x', i: ['1 egg'], p: ['a'.repeat(5 * 1024 * 1024)] })));
  assert.ok(bomb.length < 20000);
  await rej(`1z.${bomb.toString('base64url')}`, /too large/);
  await rej(`1z.${Buffer.from('not deflate at all').toString('base64url')}`, /damaged/);
  // a text-only hand-off (no JSON-LD on the page) is parsed with the text heuristic
  const tx = await I.decodePayload(`1j.${Buffer.from(JSON.stringify({ v: 1, t: 'Slaw | Example', u: 'https://ex.com/slaw', x: 'Ingredients\n2 cups cabbage\n1 carrot\nDirections\nMix well and chill for twenty minutes.' })).toString('base64url')}`);
  assert.equal(tx.lines.length, 2);
  assert.equal(tx.title, 'Slaw');
  assert.equal(tx.url, 'https://ex.com/slaw');
  assert.equal(I.payloadFromHash('#recipes/import/1j.abc'), '1j.abc');
  assert.equal(I.payloadFromHash('#recipes/browse'), '');
  assert.equal(I.payloadFromLink(`${LIVE_URL}#recipes/import/1z.Ab-_9`), '1z.Ab-_9');
  assert.equal(I.payloadFromLink('https://evil.example/#recipes/import/1j.x y'), '');
});

// ---------- the bookmarklet and the Shortcut script, run against a fake recipe page ----------
function fakePage(ldText, { href = 'https://example-recipes.com/tacos', title = 'Tacos', text = '' } = {}) {
  const loc = { href };
  const ctx = {
    location: loc, alert: () => {}, TextEncoder, Response, Blob, CompressionStream, btoa, String, JSON, Array, Object, Uint8Array, Math, Promise,
    document: { title, body: { innerText: text }, querySelectorAll: () => (ldText == null ? [] : [{ textContent: ldText }]) },
    getSelection: () => '',
  };
  ctx.window = ctx;
  return { ctx, loc };
}
test('bookmarklet: reads the page JSON-LD, makes no requests, hands off through #fragment only', async () => {
  const src = I.bookmarkletSource(LIVE_URL);
  assert.match(src, /^javascript:/);
  const code = decodeURIComponent(src.slice('javascript:'.length));
  for (const bad of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'new Image', 'import(', 'eval(', 'innerHTML', 'document.write']) assert.ok(!code.includes(bad), bad);
  assert.throws(() => I.bookmarkletSource('http://example.com/'));
  assert.throws(() => I.bookmarkletSource('javascript:alert(1)'));
  const { ctx, loc } = fakePage(JSON.stringify(LD));
  await vm.runInNewContext(code.replace(/^\(async\(\)=>/, 'globalThis.__p=(async()=>').replace(/\)\(\)$/, ')()'), ctx);
  await ctx.__p;
  assert.ok(loc.href.startsWith(`${LIVE_URL}#recipes/import/1z.`), 'opens the app with the payload after #');
  const d = await I.decodePayload(I.payloadFromHash(new URL(loc.href).hash));
  assert.equal(d.title, 'Chicken Street Tacos');
  assert.equal(d.lines.length, 7);
  assert.equal(d.steps.length, 3);
  // a page without JSON-LD sends its text
  const p2 = fakePage(null, { text: 'Ingredients\n2 cups cabbage\n1 carrot\nMethod\nMix and chill for twenty minutes.' });
  await vm.runInNewContext(code.replace(/^\(async\(\)=>/, 'globalThis.__p=(async()=>'), p2.ctx); await p2.ctx.__p;
  assert.equal((await I.decodePayload(I.payloadFromHash(new URL(p2.loc.href).hash))).lines.length, 2);
});
test('Shortcut script: same extractor, returns the link with completion()', async () => {
  const code = I.shortcutScript(LIVE_URL);
  assert.ok(!code.includes('location.href=A'));
  const { ctx } = fakePage(JSON.stringify(LD));
  let out = null; ctx.completion = (v) => { out = v; };
  await vm.runInNewContext(code.replace(/^\(async\(\)=>/, 'globalThis.__p=(async()=>'), ctx); await ctx.__p;
  assert.ok(out.startsWith(`${LIVE_URL}#recipes/import/`));
  assert.equal((await I.decodePayload(I.payloadFromLink(out))).title, 'Chicken Street Tacos');
});

// ---------- imported recipes store ----------
test('user recipes: saved, cleaned (bad ids, junk rows, caps), and matched like feed recipes', () => {
  const st = memoryStorage();
  const r1 = I.makeUserRecipe({ title: 'Tacos', lines: ['1 lb chicken thighs', '2 limes', '1 avocado'] }, { id: 'u-aaaaaa01', now: NOW });
  assert.equal(I.saveUserRecipes([r1, { id: '../evil', title: 'x', lines: ['1 egg'] }, { id: 'u-bbbbbb02', title: 'none', lines: [] }, 'junk'], st), true);
  const rows = I.loadUserRecipes(st);
  assert.deepEqual(rows.map((r) => r.id), ['u-aaaaaa01']);
  assert.equal(JSON.parse(st.getItem(I.USER_RECIPES_KEY)).schema, 'shopsmartr.userrecipes/1');
  const many = Array.from({ length: 250 }, (_, i) => ({ ...r1, id: `u-${String(i).padStart(8, '0')}` }));
  assert.equal(I.cleanUserRecipes(many).length, I.CAPS.recipes);
  const [rec] = I.prepareUserRecipes(rows);
  const cov = R.coverageDetail(rec, R.listIndex([{ name: 'Chicken Thighs' }, { name: 'Limes' }]));
  assert.deepEqual([cov.have, cov.total, cov.missing.map((i) => i.base)], [2, 3, ['avocado']]);
  assert.throws(() => I.makeUserRecipe({ title: 'x', lines: [] }));
  const st2 = memoryStorage(); st2.setItem(I.USER_RECIPES_KEY, '{oops'); assert.deepEqual(I.loadUserRecipes(st2), []);
});

// ---------- Cook from my list ----------
const doc = { schema: R.RECIPES_SCHEMA, recipes: [
  { id: 'a', title: 'Alpha Chicken', times: { total: 40 }, ing: [{ text: '1 lb chicken', base: 'chicken', qty: 1, unit: 'lb' }, { text: '1 lemon', base: 'lemon', qty: 1 }, { text: '2 cloves garlic', base: 'garlic', qty: 2, unit: 'clove' }, { text: 'salt to taste', base: 'salt' }] },
  { id: 'b', title: 'Beta Soup', times: { total: 20 }, ing: [{ text: '1 onion', base: 'onion', qty: 1 }, { text: '1 lemon', base: 'lemon', qty: 1 }, { text: '1 qt chicken broth', base: 'chicken broth', qty: 1, unit: 'quart' }, { text: '1 carrot', base: 'carrot', qty: 1 }] },
  { id: 'c', title: 'Gamma Pasta', times: { total: 30 }, rating: 4.8, ratingCount: 10, ing: [{ text: '1 lb pasta', base: 'pasta', qty: 1, unit: 'lb' }, { text: '1 jar sauce', base: 'tomato sauce', qty: 1, unit: 'jar' }] },
  { id: 'd', title: 'Delta Chicken', times: { total: 25 }, ing: [{ text: '1 lb chicken', base: 'chicken', qty: 1, unit: 'lb' }, { text: '1 lemon', base: 'lemon', qty: 1 }, { text: '2 cloves garlic', base: 'garlic', qty: 2, unit: 'clove' }, { text: '1 bunch thyme', base: 'thyme', qty: 1, unit: 'bunch' }] },
] };
test('Cook from my list: coverage share ranks, ties go to fewer missing then time; shared foodRelation rules; filter 3+ or half', () => {
  const recipes = R.prepareRecipes(doc).recipes;
  const lidx = R.listIndex([{ name: 'Chicken Breast' }, { name: 'Lemons' }, { name: 'Garlic' }, { name: 'Onion' }, { name: 'Peanut Butter' }]);
  const memo = new Map();
  const covOf = (r) => R.coverageDetail(r, lidx, memo);
  assert.deepEqual(['a', 'b', 'c', 'd'].map((id) => { const c = covOf(recipes.find((r) => r.id === id)); return `${c.have}/${c.total}`; }), ['3/3', '2/4', '0/2', '3/4']);
  assert.ok(memo.size > 0, 'each ingredient checked once');
  const b = covOf(recipes[1]);
  assert.deepEqual(b.missing.map((i) => i.base), ['chicken broth', 'carrot'], 'Chicken Breast does not cover chicken broth (M10 rule)');
  const shown = recipes.filter((r) => R.usesList(covOf(r)));
  assert.deepEqual(shown.map((r) => r.id), ['a', 'b', 'd'], 'Gamma (0 of 2) is not shown');
  assert.deepEqual(R.sortCook(shown, { by: 'coverage' }, { covOf }).map((r) => r.id), ['a', 'd', 'b']);
  assert.deepEqual(R.sortCook(shown, { by: 'time' }, { covOf }).map((r) => r.id), ['b', 'd', 'a']);
  assert.deepEqual(R.sortCook(shown, { by: 'name' }, { covOf }).map((r) => r.id), ['a', 'b', 'd']);
  assert.deepEqual(R.sortCook(shown, { by: 'rating' }, { covOf }).map((r) => r.id), ['a', 'd', 'b'], 'no rated recipe in the set: falls back to Coverage');
  const costs = { a: 20, b: 5, d: 12 };
  assert.deepEqual(R.sortCook(shown, { by: 'price', dir: 'asc' }, { covOf, costOf: (r) => ({ low: costs[r.id], high: costs[r.id] }) }).map((r) => r.id), ['b', 'd', 'a']);
  // tie on share: fewer missing first, then quicker
  const twin = R.prepareRecipes({ schema: R.RECIPES_SCHEMA, recipes: [{ ...doc.recipes[0], id: 'a2', title: 'Zeta', times: { total: 10 } }, doc.recipes[0]] }).recipes;
  assert.deepEqual(R.sortCook(twin, { by: 'coverage' }, { covOf }).map((r) => r.id), ['a2', 'a']);
  assert.deepEqual(R.cleanCookSort(null), { by: 'coverage', dir: 'asc' });
  assert.deepEqual(R.cleanCookSort({ by: 'bogus' }), { by: 'coverage', dir: 'asc' });
  assert.equal(R.missingNames(b.missing), 'chicken broth, carrot');
});

// ---------- full backup ----------
const STATE = { ...L.emptyState(), items: [{ id: 'i1', name: 'Limes', qty: 2, unit: '', checked: false }] };
test('backup round trip carries imported recipes; Replace restores them, Merge unites them; Cook sort travels as a setting', () => {
  const st = memoryStorage();
  const r1 = I.makeUserRecipe({ title: 'Tacos', url: 'https://example-recipes.com/t', lines: ['1 lb chicken thighs', '2 limes'], steps: ['Cook.'] }, { id: 'u-aaaaaa01', now: NOW });
  const r2 = I.makeUserRecipe({ title: 'Slaw', lines: ['2 cups cabbage'] }, { id: 'u-aaaaaa02', now: NOW });
  I.saveUserRecipes([r1, r2], st);
  st.setItem(RX_COOK_SORT_KEY, JSON.stringify({ by: 'time' }));
  const favs = F.saveRecipe(F.emptyFavorites(), { id: r1.id, title: r1.title, source: 'import' }, NOW);
  const doc2 = B.makeBackup({ state: STATE, favs, appVersion: VERSION, now: NOW, prefs: K.collectPrefs(st), userRecipes: I.loadUserRecipes(st) });
  const text = B.backupJSON(doc2);
  assert.equal(doc2.schema, 'shopsmartr.backup/2', 'format id unchanged (additive section)');
  const p = B.parseBackup(text);
  assert.equal(p.ok, true);
  assert.deepEqual(p.backup.userRecipes, [r1, r2]);
  assert.equal(p.summary.userRecipes, 2);
  assert.deepEqual(p.backup.prefs.rxCookSort, { by: 'time', dir: 'asc' });
  assert.equal(p.backup.favs.recipes[0].source, 'import');
  const other = I.makeUserRecipe({ title: 'Other', lines: ['1 egg'] }, { id: 'u-ccccccc3', now: NOW });
  const cur = { state: L.emptyState(), favs: F.emptyFavorites(), shopStore: '', listSort: L.cleanSort(null), prefs: {}, userRecipes: [other, { ...r1, title: 'My edit' }] };
  const rep = B.applyBackup(cur, p.backup, 'replace');
  assert.deepEqual(rep.userRecipes.map((r) => r.id), ['u-aaaaaa01', 'u-aaaaaa02']);
  const fresh = memoryStorage(); I.saveUserRecipes(rep.userRecipes, fresh);
  assert.deepEqual(I.loadUserRecipes(fresh), [r1, r2], 'restored exactly');
  const mer = B.applyBackup(cur, p.backup, 'merge');
  assert.deepEqual(mer.userRecipes.map((r) => `${r.id}:${r.title}`), ['u-ccccccc3:Other', 'u-aaaaaa01:My edit', 'u-aaaaaa02:Slaw'], 'this device\'s copy wins');
});
test('backup: v1 and v2 files without imported recipes still load and keep this device\'s; damaged or hostile sections are handled', () => {
  const mine = I.makeUserRecipe({ title: 'Mine', lines: ['1 egg'] }, { id: 'u-mine0001', now: NOW });
  const base = B.makeBackup({ state: STATE, favs: F.emptyFavorites(), appVersion: '0.2.5-alpha.1', now: NOW });
  const v2 = { ...base }; delete v2.userRecipes; delete v2.prefs;
  const v1 = { ...v2, schema: 'shopsmartr.backup/1', appVersion: '0.1.6-alpha', favorites: { items: [], meals: [] } };
  for (const f of [v1, v2]) {
    const p = B.parseBackup(JSON.stringify(f));
    assert.equal(p.ok, true, f.schema);
    assert.equal(p.backup.hasUserRecipes, false);
    assert.equal('userRecipes' in p.summary, false);
    const cur = { state: L.emptyState(), favs: F.emptyFavorites(), shopStore: '', listSort: L.cleanSort(null), prefs: {}, userRecipes: [mine] };
    assert.deepEqual(B.applyBackup(cur, p.backup, 'replace').userRecipes, [mine]);
    assert.deepEqual(B.applyBackup(cur, p.backup, 'merge').userRecipes, [mine]);
  }
  assert.match(B.parseBackup(JSON.stringify({ ...base, userRecipes: 'nope' })).error, /imported recipes in this file are damaged/);
  const hostile = B.parseBackup(JSON.stringify({ ...base, userRecipes: [{ id: 'u-evil0001', title: '<script>alert(1)</script>Pie', url: 'javascript:alert(1)', lines: ['<img onerror=alert(1) src=x>1 cup flour'], steps: [] }, { id: 'x', title: 'bad id', lines: ['1 egg'] }] }));
  assert.equal(hostile.ok, true);
  assert.deepEqual(hostile.backup.userRecipes.map((r) => [r.title, r.url, r.lines[0]]), [['Pie', '', '1 cup flour']]);
});

// ---------- registry, CSP, no network ----------
test('key registry: imported recipes are household data, the Cook sort is a setting', () => {
  assert.equal(K.classifyKey(I.USER_RECIPES_KEY), 'backup');
  assert.equal(K.classifyKey('shopsmartr:rxSort:cook:v1'), 'settings');
  const st = memoryStorage(); st.setItem(RX_COOK_SORT_KEY, JSON.stringify({ by: 'nope' }));
  assert.deepEqual(K.collectPrefs(st).rxCookSort, { by: 'coverage', dir: 'asc' });
});
test('CSP: hash-pinned inline scripts, only this site for connections, no eval; Import never touches the network', () => {
  const html = read('index.html');
  const m = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  assert.ok(m, 'CSP meta present');
  const csp = Object.fromEntries(m[1].split(';').map((d) => d.trim().split(/\s+/)).map(([k, ...v]) => [k, v]));
  assert.deepEqual(csp['connect-src'], ["'self'"]);
  assert.deepEqual(csp['object-src'], ["'none'"]);
  assert.ok(!csp['script-src'].includes("'unsafe-inline'") && !csp['script-src'].includes("'unsafe-eval'"));
  assert.deepEqual(csp['script-src'].filter((s) => s.startsWith("'sha256-")).sort(), inlineScriptHashes(html).sort(), 'every inline script is pinned (run tools/csp-hashes.mjs after editing one)');
  assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), 'CSP comes before the first script');
  const imp = read('src/importer.js').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  for (const bad of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'WebSocket', 'EventSource', 'innerHTML', 'insertAdjacentHTML', 'eval(', 'new Function']) assert.ok(!imp.includes(bad), `importer.js: ${bad}`);
  const rx = read('src/rx.js');
  assert.ok(!/innerHTML|insertAdjacentHTML|outerHTML/.test(rx), 'rx.js renders with textContent only');
  assert.equal((rx.match(/fetch\(/g) ?? []).length, 1, 'rx.js fetches only its own recipe manifest');
});
test('Cook sort menu and About import help are in the page', () => {
  const html = read('index.html');
  assert.match(html, /data-rx-sort="coverage"/);
  assert.match(html, /id="about-bm-copy"/);
  assert.match(html, /Happy Wife Import/);
  assert.ok(!/ShopSmart/.test(read('src/importer.js').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')));
});

test('recipeCost only= prices just the given lines (Cook to-buy range)', () => {
  const ing = [{ k: 'a', base: 'a' }, { k: 'b', base: 'b' }];
  const r = { id: 'x', ing };
  const full = R.recipeCost(r, { mi: null, cands: new Map(), factor: 1 });
  const part = R.recipeCost(r, { mi: null, cands: new Map(), factor: 1, only: new Set([ing[0]]) });
  assert.equal(full, null); assert.equal(part, null);
  assert.equal(R.recipeCost(r, { mi: null, cands: new Map(), only: new Set() }), null);
});
