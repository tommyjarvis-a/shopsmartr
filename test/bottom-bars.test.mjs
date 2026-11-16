// Hotfix (Steven's iPhone, home-screen app): the tab bar sat above the screen edge with recipe content showing beneath
// it, and the sticky Add bar was half hidden behind it. Root cause: env(safe-area-inset-bottom) counted twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { tabbarStackHeight } from '../src/layout.js';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const tokens = readFileSync(new URL('../tokens.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const rules = (sel) => [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) => m[1].split(',').map((s) => s.trim()).includes(sel)).map((m) => m[2]);
const lastDecl = (sel, prop) => { let v = null; for (const r of rules(sel)) for (const d of r.split(';')) { const [k, ...rest] = d.split(':'); if (k.trim() === prop) v = rest.join(':').trim(); } return v; };

test('tabbarStackHeight: height plus any lift, null when not laid out', () => {
  assert.equal(tabbarStackHeight(106, '0px'), 106);
  assert.equal(tabbarStackHeight(72, '44px'), 116);
  assert.equal(tabbarStackHeight(72.5, 'auto'), 72.5);
  assert.equal(tabbarStackHeight(0, '0px'), null);
  assert.equal(tabbarStackHeight(undefined, '0px'), null);
});

test('the tab bar applies the safe area once: lift XOR padding, never both', () => {
  const bottom = lastDecl('.tabbar', 'bottom'); const pad = lastDecl('.tabbar', 'padding-bottom'); const h = lastDecl('.tabbar', 'height');
  assert.match(bottom, /var\(--sab\) \* var\(--tabbar-float\)/);
  assert.match(pad, /var\(--sab\) \* \(1 - var\(--tabbar-float\)\)/);
  assert.match(h, /var\(--sab\) \* \(1 - var\(--tabbar-float\)\)/);
  for (const v of [bottom, pad, h]) assert.doesNotMatch(v, /env\(/, 'the final .tabbar rules go through --sab only');
  assert.match(css, /--sab: env\(safe-area-inset-bottom, 0px\)/);
  assert.match(css, /--tabbar-float: 0/);
  assert.match(tokens, /--tabbar-float: 1;/, 'the floating pill theme lifts instead of padding');
});

test('everything stacked on the tab bar uses --tabbar-h on phones, and full heights have a dvh value', () => {
  const phone = css.slice(css.lastIndexOf('@media (max-width: 767px) {'));
  for (const sel of ['.totalbar', '.rx-cta', '.fab', '.toast', '.main', '.tb-break']) assert.match(phone, new RegExp(`\\${sel}[^{]*\\{[^}]*var\\(--tabbar-h\\)`), sel);
  assert.match(css, /min-height: 100vh; min-height: 100dvh;/);
  assert.match(html, /viewport-fit=cover/);
});
