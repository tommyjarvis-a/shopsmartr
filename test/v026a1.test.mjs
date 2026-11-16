// v0.2.6-alpha.1: Tester's gate 566ff52 — M11 (imported recipes never load a remote image; CSP img-src pinned to
// the feed's image host), L55 (flavoured broth / stock / sausage count on the list), L56 (restore text and toasts
// name imported recipes), L57 (Cook "Missing N:" AA in every theme), L58 (oversized paste says it's too large).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as I from '../src/importer.js';
import * as R from '../src/recipes.js';
import * as B from '../src/backup.js';
import * as L from '../src/list.js';
import * as F from '../src/favorites.js';
import { IMG_HOSTS, feedImage } from '../src/imghost.js';
import { VERSION } from '../src/version.js';
import { inlineScriptHashes } from '../tools/csp-hashes.mjs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const NOW = new Date('2026-11-16T07:00:00Z');
const ing = (base) => ({ text: `1 ${base}`, base, qty: 1, unit: null, k: base });
const lidx = (...names) => R.listIndex(names.map((name, i) => ({ id: `i${i}`, name, checked: false })));
const onList = (base, ...names) => R.onListItem(ing(base), lidx(...names))?.name ?? null;

test('version 0.2.6-alpha.1 in version.js, package.json and the CHANGELOG', () => {
  assert.equal(VERSION, '0.2.6-alpha.1');
  assert.equal(JSON.parse(read('package.json')).version, VERSION);
  assert.match(read('CHANGELOG.md'), /## \[0\.2\.6-alpha\.1\]/);
});

// ---------- M11 ----------
test('M11: CSP img-src is self, data:, blob: and only the feed image host; script hashes still pinned', () => {
  const html = read('index.html');
  const csp = html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  const img = csp.split(';').map((s) => s.trim()).find((s) => s.startsWith('img-src'));
  assert.equal(img, `img-src 'self' data: blob: ${IMG_HOSTS.map((h) => `https://${h}`).join(' ')}`);
  assert.deepEqual([...IMG_HOSTS], ['images.wegmans.com']);
  assert.ok(!/\bhttps:(?!\/\/)/.test(csp), 'no bare https: source anywhere');
  assert.ok(!/\*/.test(csp), 'no wildcards');
  for (const h of inlineScriptHashes(html)) assert.ok(csp.includes(h), `hash ${h} pinned`);
});
test('M11: feedImage keeps only https photos on the allowed host', () => {
  const ok = 'https://images.wegmans.com/is/image/wegmanscsprod/RECIPE_14853';
  assert.equal(feedImage(ok), ok);
  for (const bad of ['https://tracker.example.net/pixel.gif?id=qa', 'http://images.wegmans.com/a.jpg', 'https://images.wegmans.com.evil.net/a.jpg',
    'https://evil.net/https://images.wegmans.com/a', 'https://user@images.wegmans.com/a', 'https://images.wegmans.com:8443/a', 'javascript:alert(1)',
    'https://images.wegmans.com/a"onerror="x', 'https://images.wegmans.com/a b', 'data:image/gif;base64,R0lGOD', '', null, 42, `https://images.wegmans.com/${'a'.repeat(700)}`]) {
    assert.equal(feedImage(bad), null, String(bad).slice(0, 60));
  }
});
test('M11: an imported recipe never keeps a photo URL (JSON-LD, fragment payload, saved rows, backup rows, favorites)', async () => {
  const tracker = 'https://tracker.example.net/pixel.gif?id=qa';
  assert.equal(I.draftFromJsonLd({ '@type': 'Recipe', name: 'Pie', image: tracker, recipeIngredient: ['1 egg'] }).image, '');
  assert.equal(I.parseRecipeText(JSON.stringify({ '@type': 'Recipe', name: 'Pie', image: [{ url: tracker }], recipeIngredient: ['1 egg'] })).image, '');
  assert.equal(I.draftFromCompact({ v: 1, t: 'Pie', u: 'https://example-recipes.com/p', im: tracker, i: ['1 egg'], p: [] }).image, '', 'bookmarklet / Shortcut payload');
  const row = I.cleanUserRecipe({ id: 'u-aaaaaa01', title: 'Old', image: tracker, lines: ['1 egg'], importedAt: NOW.toISOString() });
  assert.equal(row.image, '', 'a v0.2.6 saved row with an image loses it on load');
  assert.equal(I.prepareUserRecipes([{ ...row, image: tracker }])[0].image, null);
  const favs = F.saveRecipe(F.emptyFavorites(), { id: 'u-aaaaaa01', title: 'Old', image: tracker, source: 'import' }, NOW);
  assert.equal(favs.recipes[0].image, null);
  const loaded = F.deserializeFavorites(JSON.stringify({ version: 1, items: [], meals: [], recipes: [{ id: 'u-aaaaaa01', title: 'Old', image: tracker, source: 'import', savedAt: NOW.toISOString() }, { id: '9', title: 'W', image: tracker, source: 'wegmans', savedAt: NOW.toISOString() }] }));
  assert.equal(loaded.recipes[0].image, null);
  assert.equal(loaded.recipes[1].image, null, 'a Wegmans snapshot only keeps an image on the feed host');
});
test('M11: feed recipes keep Wegmans photos, other hosts are dropped', () => {
  const doc = { schema: R.RECIPES_SCHEMA, recipes: [
    { id: '1', title: 'A', cat: 'x', image: 'https://images.wegmans.com/is/image/wegmanscsprod/RECIPE_1', ing: [{ text: '1 egg', base: 'egg', qty: 1 }] },
    { id: '2', title: 'B', cat: 'x', image: 'https://cdn.example.net/b.jpg', ing: [{ text: '1 egg', base: 'egg', qty: 1 }] }] };
  const out = R.prepareRecipes(doc).recipes;
  assert.equal(out[0].image, 'https://images.wegmans.com/is/image/wegmanscsprod/RECIPE_1');
  assert.equal(out[1].image, null);
});
test('M11: the renderer passes imported recipes to photo() as placeholders, and the preview never builds an img', () => {
  const rx = read('src/rx.js');
  assert.match(rx, /const src = imported \? null : feedImage\(url\);/);
  assert.match(rx, /photo\(null, \{ imported: true \}\)/, 'import preview');
  assert.equal((rx.match(/photo\(r\.image, \{[^}]*imported: isImp\(r\)/g) ?? []).length, 3, 'cards, Cook rows, detail hero');
  assert.ok(!/photo\(d\.image/.test(rx));
  assert.ok(!/src: top\.get\(c\.slug\)\.image/.test(rx), 'category thumbnails go through feedImage');
  assert.ok(!/\bfetch\(|new Image\(|prefetch|preconnect|sendBeacon/.test(read('src/importer.js')), 'importer makes no requests');
});

// ---------- L55 ----------
test('L55: flavoured broth / stock / sausage / jam on the list count for the bare line', () => {
  for (const [base, name] of [['broth', 'Chicken Broth'], ['broth', 'Vegetable Broth'], ['stock', 'Beef Stock'], ['sausage', 'Chicken Sausage'], ['sausage', 'Pork Sausage'], ['jam', 'Strawberry Jam']]) {
    assert.equal(onList(base, name), name, `${name} counts as "${base}"`);
  }
});
test('L55: oil and juice stay strict; M10 pairs and other foods are unchanged', () => {
  for (const [base, name] of [['oil', 'Coconut Oil'], ['oil', 'Sesame Oil'], ['juice', 'Apple Juice'], ['chicken', 'Chicken Broth'], ['chicken', 'Chicken Sausage'],
    ['butter', 'Peanut Butter'], ['cream', 'Cream Cheese'], ['bread', 'Banana Bread'], ['sugar', 'Brown Sugar'], ['beans', 'Green Beans'], ['sausage', 'Sausage Pizza'], ['broth', 'Chicken Broth Concentrate']]) {
    assert.equal(onList(base, name), null, `${name} is not "${base}"`);
  }
  assert.equal(onList('oil', 'Vegetable Oil'), 'Vegetable Oil');
  assert.equal(onList('chicken broth', 'Broth'), null, 'a bare list name does not cover a flavoured line');
});
test('L55: Add missing skips the covered flavoured lines (no double bump)', () => {
  const recipe = { id: 'x', ing: ['broth', 'stock', 'sausage', 'oil', 'juice', 'onion'].map(ing) };
  const items = ['Chicken Broth', 'Beef Stock', 'Chicken Sausage', 'Coconut Oil', 'Apple Juice'].map((name, i) => ({ id: `i${i}`, name, qty: 1, unit: '', checked: false }));
  const c = R.coverageDetail(recipe, R.listIndex(items));
  assert.deepEqual(c.missing.map((m) => m.base).sort(), ['juice', 'oil', 'onion']);
  const m = R.detailModel(recipe, { servings: 4, listItems: items });
  assert.deepEqual(m.missing.map((l) => l.ing.base).sort(), ['juice', 'oil', 'onion'], 'Add missing only adds these');
});

// ---------- L56 ----------
test('L56: Restore sheet text and toasts name imported recipes with counts', () => {
  assert.equal(B.replaceText({ userRecipes: 2, settings: 3 }), 'Favorites, store picks, 2 imported recipes and settings are replaced too. Your current imported recipes are removed.');
  assert.equal(B.replaceText({ userRecipes: 1 }), 'Favorites, store picks and 1 imported recipe are replaced too. Your current imported recipes are removed.');
  assert.equal(B.replaceText({}), 'Favorites and store picks are replaced too.');
  assert.match(B.mergeText({ items: 3, userRecipes: 2 }), /Its 2 imported recipes are added too \(yours are kept\)\./);
  assert.ok(!/imported/.test(B.mergeText({ items: 3 })));
  const r1 = I.makeUserRecipe({ title: 'Tacos', lines: ['2 limes'] }, { id: 'u-aaaaaa01', now: NOW });
  const r2 = I.makeUserRecipe({ title: 'Slaw', lines: ['2 cups cabbage'] }, { id: 'u-aaaaaa02', now: NOW });
  const mine = I.makeUserRecipe({ title: 'Mine', lines: ['1 egg'] }, { id: 'u-mine0001', now: NOW });
  const STATE = { ...L.emptyState(), items: [{ id: 'i1', name: 'Limes', qty: 2, unit: '', checked: false }] };
  const p = B.parseBackup(B.backupJSON(B.makeBackup({ state: STATE, favs: F.emptyFavorites(), appVersion: VERSION, now: NOW, userRecipes: [r1, r2] })));
  const cur = { state: L.emptyState(), favs: F.emptyFavorites(), shopStore: '', listSort: L.cleanSort(null), prefs: {}, userRecipes: [mine, { ...r1, title: 'Edit' }] };
  const rep = B.applyBackup(cur, p.backup, 'replace');
  assert.equal(B.restoreToast('replace', rep, 2), 'Backup restored · 1 item, 2 imported recipes, 2 settings');
  const mer = B.applyBackup(cur, p.backup, 'merge');
  assert.equal(mer.rxIn, 1, 'one new id (u-aaaaaa01 already here)');
  assert.equal(B.restoreToast('merge', mer), 'Backup merged · 1 item, 1 imported recipe added');
  const empty = B.parseBackup(B.backupJSON(B.makeBackup({ state: STATE, favs: F.emptyFavorites(), appVersion: VERSION, now: NOW })));
  assert.equal(B.restoreToast('replace', B.applyBackup(cur, empty.backup, 'replace')), 'Backup restored · 1 item, 0 imported recipes', 'a file with an empty section still says it replaced them');
  const old = JSON.parse(B.backupJSON(B.makeBackup({ state: STATE, favs: F.emptyFavorites(), appVersion: '0.2.5-alpha.1', now: NOW }))); delete old.userRecipes;
  const none = B.parseBackup(JSON.stringify(old));
  assert.equal(B.restoreToast('replace', B.applyBackup(cur, none.backup, 'replace')), 'Backup restored · 1 item');
  assert.equal(B.restoreToast('merge', { ...B.applyBackup(cur, none.backup, 'merge'), combined: 2 }), 'Backup merged · 1 item added, 2 combined');
  const app = read('src/app.js');
  assert.ok(app.includes('Bk.mergeText(sm)') && app.includes('Bk.replaceText(sm)') && app.includes("Bk.restoreToast('merge'"));
});

// ---------- L57 ----------
const lum = (hex) => { const c = hex.match(/[0-9a-f]{2}/gi).map((x) => parseInt(x, 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
test('L57: Cook "Missing N:" uses --color-miss-text, at least 4.5:1 on the surface in every theme block', () => {
  assert.match(read('style.css'), /\.rx-row \.miss b \{ color: var\(--color-miss-text, var\(--color-orange-text\)\)/);
  const css = read('tokens.css');
  const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*--color-miss-text[^{}]*)\}/g)];
  assert.equal(blocks.length, 15, '5 themes x (light, auto dark, forced dark)');
  for (const [, sel, body] of blocks) {
    const v = (k) => body.match(new RegExp(`--${k}: (#[0-9A-Fa-f]{6})`))?.[1];
    let miss = body.match(/--color-miss-text: ([^;]+);/)[1].trim();
    if (miss === 'var(--color-orange-text)') miss = v('color-orange-text');
    for (const bg of ['color-surface', 'color-bg']) {
      const b = v(bg); if (!b) continue;
      assert.ok(ratio(miss, b) >= 4.5, `${sel.trim()} ${miss} on ${bg} ${b} = ${ratio(miss, b).toFixed(2)}`);
    }
  }
});

// ---------- L58 ----------
test('L58: a paste over the cap is refused as too large, not cut mid-JSON', () => {
  const ld = JSON.stringify({ '@type': 'Recipe', name: 'Big', recipeIngredient: ['1 egg', '2 cups flour'], description: 'x'.repeat(I.CAPS.text) });
  assert.ok(ld.length > I.CAPS.text);
  assert.throws(() => I.parseRecipeText(ld), (e) => e instanceof I.ImportError && /too large/i.test(e.message));
  assert.equal(I.parseRecipeText(`Ingredients\n1 egg\n${'a'.repeat(I.CAPS.text - 20)}`.slice(0, I.CAPS.text))?.lines[0], '1 egg', 'exactly at the cap still parses');
  const rx = read('src/rx.js');
  assert.match(rx, /maxlength: String\(Imp\.CAPS\.text \+ 1\)/, 'the textarea lets one extra character through so the cap is detected');
  assert.match(rx, /rx\.imp\.error = tooBig \|\| \(String\(text/, 'the too-large message wins over the generic one (parenthesised)');
});
