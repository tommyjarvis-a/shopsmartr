// v0.2.5: themes v2 — registry, persistence, full backup round trip, the early-apply boot script, and font
// loading for only the active theme.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import vm from 'node:vm';
import * as Th from '../src/themes.js';
import * as K from '../src/keys.js';
import * as B from '../src/backup.js';
import * as L from '../src/list.js';
import * as F from '../src/favorites.js';
import { memoryStorage } from '../src/storage.js';
import { VERSION } from '../src/version.js';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const IDS = ['tomato-parmesan', 'blueberry-lemon', 'blackberry-lavender', 'coconut-lagoon', 'espresso-mango'];

test('version 0.2.5-alpha.1 in version.js and package.json', () => {
  assert.equal(VERSION, '0.2.5-alpha.1');
  assert.match(read('CHANGELOG.md'), /## \[0\.2\.5-alpha\.1\]/);
  assert.equal(JSON.parse(read('package.json')).version, VERSION);
  assert.match(read('CHANGELOG.md'), /## \[0\.2\.5-alpha\]/);
});

// ---------- registry ----------
test('registry: five themes in order, Tomato default; theme + mode are settings; sprite copy is excluded', () => {
  assert.deepEqual(Th.THEME_IDS, IDS);
  assert.equal(Th.DEFAULT_THEME, 'tomato-parmesan');
  assert.deepEqual(Th.THEMES.map((t) => t.name), ['Tomato & Parmesan', 'Blueberry & Lemon', 'Blackberry & Lavender', 'Coconut & Lagoon', 'Espresso & Mango']);
  assert.equal(K.classifyKey('shopsmartr:theme:v1'), 'settings');
  assert.equal(K.classifyKey('shopsmartr:mode:v1'), 'settings');
  assert.equal(K.classifyKey(Th.SPRITE_CACHE_KEY), 'exclude');
  assert.equal(K.THEME_KEY, Th.THEME_KEY);
  const te = K.KEY_REGISTRY.find((e) => e.key === Th.THEME_KEY);
  const me = K.KEY_REGISTRY.find((e) => e.key === Th.MODE_KEY);
  for (const id of IDS) assert.equal(te.clean(id), id);
  for (const bad of ['paprika-saffron', 'TOMATO-PARMESAN', '', null, 3, '<x>']) assert.equal(te.clean(bad), undefined, String(bad));
  for (const m of ['auto', 'light', 'dark']) assert.equal(me.clean(m), m);
  assert.equal(me.clean('sepia'), undefined);
});

test('tokens.css: every theme has a light, an OS-dark and a forced-dark block, each with the identity tokens', () => {
  const css = read('tokens.css');
  for (const id of IDS.slice(1)) {
    assert.match(css, new RegExp(`:root\\[data-theme="${id}"\\] \\{`), `${id} light`);
    assert.match(css, new RegExp(`:root\\[data-theme="${id}"\\]:not\\(\\[data-mode="light"\\]\\)`), `${id} auto dark`);
    assert.match(css, new RegExp(`:root\\[data-theme="${id}"\\]\\[data-mode="dark"\\]`), `${id} forced dark`);
  }
  assert.match(css, /:root,\n:root\[data-theme="tomato-parmesan"\] \{/);
  assert.ok(!/data-theme="(light|dark)"/.test(css), 'old [data-theme=light|dark] mode switch is gone');
  for (const tok of ['--radius-control', '--tabbar-inset', '--tab-on-bg', '--font-heading', '--font-num-family', '--card-shadow']) assert.equal((css.match(new RegExp(`${tok}:`, 'g')) ?? []).length, 5, tok);
  const shape = read('style.css');
  for (const s of ['.tabbar { background: var(--tabbar-bg)', 'border-radius: var(--radius-control)', '.chip:where(:not(.chip-static))', '.theme-opt .pv']) assert.ok(shape.includes(s), s);
});

// ---------- persistence ----------
test('persistence: theme and mode save per device and read back; junk falls back to Tomato / Auto', () => {
  const st = memoryStorage();
  assert.equal(Th.loadTheme(st), 'tomato-parmesan');
  assert.equal(Th.loadMode(st), 'auto');
  assert.ok(Th.saveTheme('coconut-lagoon', st));
  assert.ok(Th.saveMode('dark', st));
  assert.equal(st.getItem('shopsmartr:theme:v1'), 'coconut-lagoon');
  assert.equal(Th.loadTheme(st), 'coconut-lagoon');
  assert.equal(Th.loadMode(st), 'dark');
  st.setItem('shopsmartr:theme:v1', 'plum-fig'); st.setItem('shopsmartr:mode:v1', 'night');
  assert.equal(Th.loadTheme(st), 'tomato-parmesan');
  assert.equal(Th.loadMode(st), 'auto');
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  assert.equal(Th.loadTheme(blocked), 'tomato-parmesan');
  assert.equal(Th.saveTheme('blueberry-lemon', blocked), false);
  assert.equal(Th.effectiveMode('light'), 'light');
  assert.equal(Th.effectiveMode('auto', { matchMedia: () => ({ matches: true }) }), 'dark');
  assert.equal(Th.effectiveMode('auto', { matchMedia: () => ({ matches: false }) }), 'light');
});

// ---------- backup ----------
test('full backup round trip carries theme + mode; Replace restores them; Merge only fills a missing one', () => {
  const st = memoryStorage();
  Th.saveTheme('espresso-mango', st); Th.saveMode('light', st);
  st.setItem(Th.SPRITE_CACHE_KEY, JSON.stringify({ theme: 'espresso-mango', v: VERSION, svg: '<symbol id="i-x"></symbol>' }));
  const prefs = K.collectPrefs(st);
  assert.deepEqual(prefs, { theme: 'espresso-mango', mode: 'light' });
  const doc = B.makeBackup({ state: L.emptyState(), favs: F.emptyFavorites(), appVersion: VERSION, prefs, saveId: '11111111-2222-4333-8444-555555555555' });
  const text = B.backupJSON(doc);
  assert.ok(!text.includes('spriteCache') && !text.includes('<symbol'), 'icon-set copy never travels');
  const r = B.parseBackup(text);
  assert.equal(r.ok, true);
  assert.deepEqual(r.backup.prefs, prefs);
  // Replace on a fresh device
  const fresh = memoryStorage();
  const cur = { state: L.emptyState(), favs: F.emptyFavorites(), shopStore: '', listSort: L.cleanSort(null), prefs: K.collectPrefs(fresh) };
  const rep = B.applyBackup(cur, r.backup, 'replace');
  K.writePrefs(rep.prefs, fresh);
  assert.equal(Th.loadTheme(fresh), 'espresso-mango');
  assert.equal(Th.loadMode(fresh), 'light');
  // Merge onto a device that picked a theme but never touched the mode: theme kept, mode filled
  const other = memoryStorage(); Th.saveTheme('blueberry-lemon', other);
  const mer = B.applyBackup({ ...cur, prefs: K.collectPrefs(other) }, r.backup, 'merge');
  assert.deepEqual(mer.prefs, { mode: 'light' });
  K.writePrefs(mer.prefs, other);
  assert.equal(Th.loadTheme(other), 'blueberry-lemon');
  assert.equal(Th.loadMode(other), 'light');
  // junk in a file is dropped
  const bad = B.parseBackup(JSON.stringify({ ...JSON.parse(text), prefs: { theme: 'neon', mode: 'sepia' } }));
  assert.deepEqual(bad.backup.prefs, {});
});

// ---------- early apply ----------
function bootScript() {
  const html = read('index.html');
  const head = html.slice(0, html.indexOf('</head>'));
  const m = [...head.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((x) => x[1]).find((s) => s.includes('shopsmartr:theme:v1'));
  return { src: m, head };
}
function runBoot(values, src = bootScript().src) {
  const attrs = {}; const appended = [];
  const document = {
    documentElement: { setAttribute: (k, v) => { attrs[k] = v; }, getAttribute: (k) => attrs[k] ?? null },
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: (n) => appended.push(n) },
  };
  const localStorage = values === 'blocked' ? { getItem() { throw new Error('blocked'); } } : { getItem: (k) => (k in values ? values[k] : null) };
  vm.runInNewContext(src, { document, localStorage, Object });
  return { attrs, appended };
}
test('early-apply script: in <head> before the stylesheets and the app, sets data-theme/data-mode and only that theme\'s fonts', () => {
  const { src, head } = bootScript();
  assert.ok(src, 'boot script present');
  assert.ok(head.indexOf(src) < head.indexOf('href="tokens.css"') && head.indexOf(src) < head.indexOf('src="src/app.js"'), 'runs before CSS and the module');
  assert.ok(!/fonts\.googleapis|fonts\.gstatic|use\.typekit|cdn/i.test(read('index.html')), 'no third-party font CDN');
  for (const id of IDS) for (const mode of [null, 'auto', 'light', 'dark']) {
    const { attrs, appended } = runBoot({ 'shopsmartr:theme:v1': id, ...(mode ? { 'shopsmartr:mode:v1': mode } : {}) });
    assert.equal(attrs['data-theme'], id);
    assert.equal(attrs['data-mode'], mode === 'light' || mode === 'dark' ? mode : undefined, `${id}/${mode}`);
    assert.equal(appended.length, 1);
    assert.equal(appended[0].id, 'theme-fonts');
    assert.equal(appended[0].textContent, Th.fontFaceCSS(id), `${id}: boot script fonts match src/themes.js`);
  }
  for (const v of [{}, { 'shopsmartr:theme:v1': 'constructor' }, { 'shopsmartr:theme:v1': '__proto__' }, 'blocked']) {
    const { attrs, appended } = runBoot(v);
    assert.equal(attrs['data-theme'], 'tomato-parmesan', JSON.stringify(v));
    assert.equal(appended[0].textContent, Th.fontFaceCSS('tomato-parmesan'));
  }
  // the icon set is applied from the local copy straight after the sprite, before the app module runs
  const html = read('index.html');
  const sp = html.indexOf('id="icon-sprite"');
  const post = html.indexOf('shopsmartr:spriteCache:v1', sp);
  assert.ok(sp > 0 && post > sp && post < html.indexOf('<div class="app">'));
});

// ---------- fonts ----------
test('fonts: each theme\'s @font-face names only its own files, which exist, are self-hosted and licensed (OFL)', () => {
  const all = new Set(Th.THEMES.flatMap((t) => t.fonts.map((f) => f.file)));
  assert.equal(all.size, 6);
  for (const t of Th.THEMES) {
    const css = Th.fontFaceCSS(t.id);
    const files = [...css.matchAll(/url\("fonts\/([^"]+)"\)/g)].map((x) => x[1]);
    assert.deepEqual(files, t.fonts.map((f) => f.file), t.id);
    for (const other of all) if (!files.includes(other)) assert.ok(!css.includes(other), `${t.id} must not name ${other}`);
    assert.ok(/font-display:swap/.test(css));
    for (const f of files) assert.ok(statSync(new URL(`../fonts/${f}`, import.meta.url)).size > 10000, f);
    assert.ok(existsSync(new URL(`../fonts/preview/${t.preview.fontFile}`, import.meta.url)), t.preview.fontFile);
    assert.ok(statSync(new URL(`../fonts/preview/${t.preview.fontFile}`, import.meta.url)).size < 8000, 'preview subsets stay tiny');
  }
  // the families each theme's tokens name are exactly the ones its @font-face declares (so nothing else can load)
  const css = read('tokens.css');
  const custom = new Set(Th.THEMES.flatMap((t) => t.fonts.map((f) => f.family)));
  for (const t of Th.THEMES) {
    const start = t.id === 'tomato-parmesan' ? css.indexOf(':root,\n:root[data-theme="tomato-parmesan"]') : css.indexOf(`:root[data-theme="${t.id}"] {`);
    const block = css.slice(start, css.indexOf('}', start));
    const named = new Set([...block.matchAll(/--font-[a-z-]+: ([^;]+);/g)].flatMap((x) => x[1].split(',').map((s) => s.trim().replace(/"/g, ''))).filter((f) => custom.has(f)));
    assert.deepEqual([...named].sort(), t.fonts.map((f) => f.family).sort(), t.id);
  }
  assert.ok(!/@font-face/.test((read('style.css') + css).replace(/\/\*[\s\S]*?\*\//g, '')), 'no global @font-face: fonts come only from the active theme');
  for (const lic of ['nunito-variable', 'inter-variable', 'fraunces', 'quicksand-variable', 'dm-serif-display', 'ibm-plex-mono']) assert.match(read(`fonts/LICENSE-${lic}.txt`), /SIL Open Font License, Version 1\.1/, lic);
  for (const lic of ['lucide', 'phosphor']) assert.ok(existsSync(new URL(`../icons/sprites/LICENSE-${lic}.txt`, import.meta.url)));
  const pv = Th.previewFontCSS();
  assert.ok(!/Quicksand|Nunito|Inter|Fraunces|DM Serif/.test(pv.replace(/url\([^)]*\)/g, '')), 'preview subsets use their own family names (OFL reserved names)');
});

test('icon sprites: each theme set has every icon the app uses (missing ones come from the default set)', () => {
  const used = new Set([...(read('index.html') + read('src/app.js') + read('src/rx.js') + read('src/ui.js')).matchAll(/#(i-[a-z0-9-]+)/g)].map((m) => m[1]));
  const base = new Set([...read('index.html').matchAll(/<symbol id="(i-[a-z0-9-]+)"/g)].map((m) => m[1]));
  for (const u of used) assert.ok(base.has(u), `default sprite has ${u}`);
  for (const id of IDS.slice(1)) {
    const svg = read(`icons/sprites/${id}.svg`);
    const have = new Set([...svg.matchAll(/<symbol id="(i-[a-z0-9-]+)"/g)].map((m) => m[1]));
    const missing = [...used].filter((u) => !have.has(u));
    assert.ok(missing.length <= 1, `${id} lacks ${missing}`);
  }
});

test('menu + sheet: Theme row is shown with the current name; picker has Auto/Light/Dark and a card list', () => {
  const html = read('index.html');
  const row = html.match(/<button[^>]*data-action="theme"[^>]*>/)[0];
  assert.ok(!/\bhidden\b|data-flag/.test(row), row);
  assert.match(html, /id="theme-sub"/);
  const sheet = html.slice(html.indexOf('id="theme-sheet"'), html.indexOf('</dialog>', html.indexOf('id="theme-sheet"')));
  assert.deepEqual([...sheet.matchAll(/name="mode" value="(\w+)"/g)].map((m) => m[1]), ['auto', 'light', 'dark']);
  assert.match(sheet, /id="theme-list"/);
  assert.match(html, /data-action="appicon"/, 'App icon stays its own row');
  const pv = Th.previewStyle('coconut-lagoon', 'dark');
  assert.match(pv, /--pv-bg:#06161D/);
  assert.match(pv, /--pv-font-h:'HWH Preview Geometric'/);
});
