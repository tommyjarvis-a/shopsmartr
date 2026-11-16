// Recipes tab (v0.2.0): feed loader, Landing, Browse, Detail and the Favorites › Recipes grid.
// DOM + wiring only; all rules live in recipes.js (pure, unit-tested).
import * as R from './recipes.js';
import * as Prices from './prices.js';
import * as C from './catalog.js';
import * as F from './favorites.js';
import * as L from './list.js';
import { makeDecoder } from './pricefeed.js';

export const RX_MANIFEST_URL = 'data/recipes.json';
export const RX_SLOT = 'aes-recipes';
export const HOUSEHOLD_KEY = 'shopsmartr:household:v1';
export const RX_SORT_KEY = 'shopsmartr:rxSort:browse:v1';
/** v0.2.1: remembered swaps { "<ingredient key>|<store key>": sku } and the "Matched at" store. Device-only. */
export const RX_SWAPS_KEY = 'shopsmartr:rxSwaps:v1';
export const RX_STORE_KEY = 'shopsmartr:rxStore:v1';
export function cleanSwaps(x) {
  const out = {};
  if (!x || typeof x !== 'object' || Array.isArray(x)) return out;
  for (const [k, v] of Object.entries(x).slice(0, 5000)) if (/^[^|]{1,160}\|[\w-]{1,40}:[\w-]{1,40}$/.test(k) && typeof v === 'string' && v && v.length <= 40) out[k] = v;
  return out;
}
export function loadSwaps(storage = globalThis.localStorage) { try { return cleanSwaps(JSON.parse(storage.getItem(RX_SWAPS_KEY))); } catch { return {}; } }
function saveSwaps(x) { try { localStorage.setItem(RX_SWAPS_KEY, JSON.stringify(x)); } catch { /* device-only */ } }
function loadRxStore() { try { const v = localStorage.getItem(RX_STORE_KEY); return typeof v === 'string' && /^[\w-]{1,40}:[\w-]{1,40}$/.test(v) ? v : ''; } catch { return ''; } }
const PAGE = 24;
const MAX_SERV = 24;

export function loadHousehold(storage = globalThis.localStorage) {
  try { const n = Number(storage.getItem(HOUSEHOLD_KEY)); return Number.isInteger(n) && n >= 1 && n <= MAX_SERV ? n : 3; } catch { return 3; }
}
function saveHousehold(n) { try { localStorage.setItem(HOUSEHOLD_KEY, String(n)); } catch { /* device-only */ } }
function loadRxSort() { try { return R.cleanRxSort(JSON.parse(localStorage.getItem(RX_SORT_KEY))); } catch { return R.cleanRxSort(null); } }
function saveRxSort(s) { try { localStorage.setItem(RX_SORT_KEY, JSON.stringify(s)); } catch { /* device-only */ } }

// ---------- tiny DOM helper ----------
function h(tag, attrs = {}, ...kids) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of kids.flat()) if (c != null && c !== false) n.append(c);
  return n;
}
function icon(id, cls = 'icon icon-18') {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('class', cls); s.setAttribute('aria-hidden', 'true');
  const u = document.createElementNS('http://www.w3.org/2000/svg', 'use'); u.setAttribute('href', `#${id}`); s.append(u);
  return s;
}
/** Photo hotlinked from the feed (never stored in the repo); a pot tile if it's missing or fails. */
function photo(url, { eager = false } = {}) {
  const box = h('div', { class: 'ph' });
  const fallback = () => { box.replaceChildren(h('span', { class: 'ph-none' }, icon('i-pot', 'icon'))); };
  if (!url) { fallback(); return box; }
  const img = h('img', { src: url, alt: '', loading: eager ? 'eager' : 'lazy', decoding: 'async', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', fallback, { once: true });
  box.append(img);
  return box;
}
function ratingSlot(r, big = false) {
  if (!R.hasRating(r)) return null;   // no ratings: the slot isn't rendered at all
  return h('span', { class: `rx-rating${big ? ' big' : ''}`, role: 'img', 'aria-label': R.ratingAria(r) },
    icon('i-star-fill', 'icon icon-14 ico'), h('span', { text: R.ratingText(r) }), h('span', { class: 'n', text: `(${r.ratingCount})` }));
}
function costSlot(c) {
  if (!c) return null;
  const t = R.costText(c);
  return h('span', { class: 'rx-cost', role: 'img', 'aria-label': t.aria }, h('b', { text: t.text }), ' ', h('span', { class: 'k', text: t.tail }));
}

/** M8: taps on the CTA slot are ignored this long after an add (double tap / double click). */
export const TAP_GUARD_MS = 500;

/** L41: one wording for the toast and the CTA: "Added 3 items", "Updated 2 items", "Added 1, updated 2". */
export function addedText(added, updated) {
  const items = (n) => `${n} item${n === 1 ? '' : 's'}`;
  if (added && updated) return `Added ${added}, updated ${updated}`;
  return updated ? `Updated ${items(updated)}` : `Added ${items(added)}`;
}

export function initRecipes(ctx) {
  const root = document.getElementById('rx-root');
  // L42: a held Enter auto-repeats; only a fresh press activates the add / Undo button.
  document.addEventListener('keydown', (e) => { if (e.repeat && (e.key === 'Enter' || e.key === ' ') && e.target.closest?.('.rx-cta, #rx-side, #rx-sheet')) e.preventDefault(); }, true);
  const rx = {
    status: 'checking',   // checking | none | locked | ready | error
    manifest: null, env: null, data: null, byId: new Map(), decoder: null,
    mi: null, miFeed: null, cands: new Map(), pricing: null, costMemo: new Map(),
    view: 'landing', id: null, browse: { cat: '', q: '', quick: '', shown: PAGE }, sort: loadRxSort(),
    servings: loadHousehold(), detailServ: null, lastAdd: null, undoAt: 0, perf: {},
    swaps: loadSwaps(), matchStore: loadRxStore(), off: new Set(), open: null, sheetOpener: null,
  };
  globalThis.__shopsmartrRx = rx.perf;

  // ----- prices / matching -----
  function priceCtx() {
    const feed = ctx.getFeed();
    if (!feed || !rx.data) return null;
    if (rx.miFeed !== feed) {
      const t0 = performance.now();
      rx.mi = R.buildMatchIndex(feed.catalog, feed.index); rx.miFeed = feed; rx.cands = new Map(); rx.costMemo.clear(); rx.pricing = null;
      rx.perf.matchIndex = performance.now() - t0;
    }
    const stores = C.priceStores(feed.catalog);
    const st = stores.find((s) => s.key === rx.matchStore) ?? stores.find((s) => s.key === ctx.getShopStore()) ?? stores[0];
    if (!st) return null;
    const key = st.key;
    const done = rx.cands.get(key);
    if (!done) { startPricing(key, st.idx); return { st, cands: null }; }
    return { st, cands: done };
  }
  /** Precomputes ingredient matches at one store in small slices so the page never freezes. */
  function startPricing(key, idx) {
    if (rx.pricing === key) return;
    rx.pricing = key;
    const keys = [];
    const seen = new Set();
    for (const r of rx.data.recipes) for (const ing of r.ing) if (!ing.pantry && ing.k && !seen.has(ing.k)) { seen.add(ing.k); keys.push([ing.k, ing.base]); }
    const cands = new Map();
    const t0 = performance.now();
    let i = 0;
    const mi = rx.mi;
    const step = () => {
      if (rx.pricing !== key || rx.mi !== mi) return;
      const end = performance.now() + 12;
      while (i < keys.length && performance.now() < end) { const [k, base] = keys[i]; cands.set(k, R.matchRows(mi, base, idx)); i += 1; }
      if (i < keys.length) { setTimeout(step, 0); return; }
      rx.cands.set(key, cands); rx.pricing = null;
      Object.assign(rx.perf, { precompute: performance.now() - t0, precomputeKeys: keys.length });
      render({ keepScroll: true });
    };
    setTimeout(step, 0);
  }
  function costOf(r, servings = rx.servings) {
    const pc = priceCtx();
    if (!pc?.cands) return null;
    const mk = `${pc.st.key}|${servings}|${rx.swapVer ?? 0}`;
    let m = rx.costMemo.get(mk);
    if (!m) { m = new Map(); rx.costMemo.set(mk, m); }
    if (!m.has(r.id)) m.set(r.id, R.recipeCost(r, { mi: rx.mi, cands: pc.cands, factor: R.scaleFactor(r, servings), swapOf: swapOfAt(pc.st.key) }));
    return m.get(r.id);
  }
  const swapOfAt = (store) => (k) => rx.swaps[R.swapKey(k, store)] ?? null;
  function setSwap(k, store, sku) {
    const key = R.swapKey(k, store);
    if (sku) rx.swaps[key] = sku; else delete rx.swaps[key];
    saveSwaps(rx.swaps);
    rx.swapVer = (rx.swapVer ?? 0) + 1;
  }
  function setMatchStore(key) {
    rx.matchStore = key;
    try { localStorage.setItem(RX_STORE_KEY, key); } catch { /* device-only */ }
    rx.costMemo.clear();
  }
  const pricesState = () => { const f = ctx.getFeed(); if (!f) return 'none'; const pc = priceCtx(); return pc?.cands ? 'ready' : pc ? 'pricing' : 'nostore'; };

  // ----- feed -----
  async function load() {
    const t0 = performance.now();
    try {
      const r = await fetch(RX_MANIFEST_URL, { cache: 'no-cache' });
      rx.manifest = r.ok ? R.cleanRecipeManifest(await r.json()) : null;
    } catch { rx.manifest = null; }
    if (!rx.manifest?.available) { rx.status = 'none'; render(); return; }
    rx.env = await Prices.loadEnvelope(`data/${rx.manifest.file}`);
    if (!rx.env) { rx.status = 'error'; render(); return; }
    rx.decoder = makeDecoder('recipes');
    rx.status = 'locked';
    await tryCache();
    rx.perf.loadTotal = performance.now() - t0;
  }
  const decode = (env, key) => rx.decoder(env, key);
  function accept(res) {
    rx.data = res.recipes; rx.byId = new Map(res.recipes.recipes.map((r) => [r.id, r]));
    rx.status = 'ready'; Object.assign(rx.perf, res.ms ?? {}, { where: res.where, recipes: res.recipes.count });
    render(); ctx.onChange();
  }
  async function tryCache() {
    if (!rx.env || rx.status === 'ready') return;
    try {
      const t0 = performance.now();
      const res = await Prices.unlockWithCache(rx.env, undefined, undefined, decode, RX_SLOT);
      if (res) { rx.perf.unlock = performance.now() - t0; accept(res); return; }
    } catch (err) { console.warn('recipe feed:', err?.message || err); rx.status = 'error'; }
    render();
  }
  async function unlock(pass) {
    const t0 = performance.now();
    const res = await Prices.unlockWithPassphrase(rx.env, pass, undefined, undefined, decode, RX_SLOT);
    rx.perf.unlock = performance.now() - t0;
    accept(res);
    ctx.onRecipesUnlocked();   // the same household passphrase may open the prices too
  }

  // ----- navigation -----
  function show(sub) {
    const [view, id] = String(sub || '').split('/');
    const prev = `${rx.view}/${rx.id}`;
    rx.view = view === 'browse' ? 'browse' : view === 'r' && id ? 'detail' : 'landing';
    rx.id = rx.view === 'detail' ? decodeURIComponent(id) : null;
    if (rx.view === 'detail' && prev !== `detail/${rx.id}`) { rx.detailServ = rx.servings; rx.lastAdd = null; rx.off.clear(); rx.open = null; }
    render();
    if (prev !== `${rx.view}/${rx.id}`) { window.scrollTo(0, 0); root.querySelector('h1')?.focus({ preventScroll: true }); }
  }
  const back = (fallback) => h('a', { class: 'back', href: fallback, 'aria-label': 'Back', onclick: (e) => { if (history.length > 1 && rx.cameFromApp) { e.preventDefault(); history.back(); } } }, icon('i-back', 'icon'));
  window.addEventListener('hashchange', () => { rx.cameFromApp = true; });

  // ----- star -----
  function rxStar(r, cls = 'fav-star') {
    const on = F.isRecipeSaved(ctx.getFavs(), r.id);
    const b = h('button', { type: 'button', class: cls, 'data-rx-star': r.id, 'aria-pressed': String(on), 'aria-label': on ? `Remove ${r.title} from Favorites` : `Save ${r.title} to Favorites`, title: on ? 'In Favorites' : 'Save to Favorites' }, icon(on ? 'i-star-fill' : 'i-star', 'icon icon-20'));
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); toggleStar(r); });
    return b;
  }
  function toggleStar(r) {
    const favs = ctx.getFavs();
    if (F.isRecipeSaved(favs, r.id)) {
      const row = favs.recipes.find((x) => x.id === r.id);
      ctx.commitFavs(F.unsaveRecipe(favs, r.id));
      ctx.toast(`Removed ${r.title} from Favorites`, () => { const f = ctx.getFavs(); if (!F.isRecipeSaved(f, r.id)) ctx.commitFavs({ ...f, recipes: [row, ...f.recipes] }); });
    } else {
      ctx.commitFavs(F.saveRecipe(favs, { id: r.id, title: r.title, image: r.image }));
      ctx.toast(`Saved ${r.title} to Favorites › Recipes`);
    }
  }
  function syncStars() {
    const favs = ctx.getFavs();
    for (const b of document.querySelectorAll('[data-rx-star]')) {
      const id = b.dataset.rxStar; const r = rx.byId.get(id) ?? favs.recipes.find((x) => x.id === id); const on = F.isRecipeSaved(favs, id);
      b.setAttribute('aria-pressed', String(on));
      b.setAttribute('aria-label', on ? `Remove ${r?.title ?? 'recipe'} from Favorites` : `Save ${r?.title ?? 'recipe'} to Favorites`);
      b.title = on ? 'In Favorites' : 'Save to Favorites';
      b.querySelector('use').setAttribute('href', on ? '#i-star-fill' : '#i-star');
    }
  }

  // ----- cards -----
  function card(r, { small = false } = {}) {
    const t = R.timeText(r.time);
    return h('li', { class: `rx-card${small ? ' sm' : ''}` },
      h('a', { class: 'rx-card-link', href: `#recipes/r/${encodeURIComponent(r.id)}` },
        photo(r.image),
        h('span', { class: 'bd' },
          h('span', { class: 'ttl', text: r.title }),
          small ? null : h('span', { class: 'rx-meta' }, t ? h('span', { class: 'm' }, icon('i-clock', 'icon icon-14'), t) : null, ratingSlot(r)),
          small ? null : costSlot(costOf(r)))),
      rxStar(r));
  }

  // ----- views -----
  function lockedPanel() {
    const form = h('form', { class: 'unlock-form', novalidate: true },
      h('input', { type: 'text', name: 'username', value: 'ShopSmartR household', autocomplete: 'username', hidden: true }),
      h('div', { class: 'field' }, h('label', { class: 'label', for: 'rx-pass', text: 'Household passphrase' }),
        h('input', { class: 'input', id: 'rx-pass', type: 'password', autocomplete: 'current-password', required: true })),
      h('button', { type: 'submit', class: 'btn btn-primary', id: 'rx-unlock-btn', text: 'Unlock' }));
    const status = h('p', { class: 'status', role: 'status', 'aria-live': 'polite' });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const input = form.querySelector('#rx-pass'); const btn = form.querySelector('button');
      btn.disabled = true; status.textContent = 'Unlocking…'; status.dataset.kind = '';
      try { await unlock(input.value); } catch (err) {
        input.value = ''; input.focus();
        status.textContent = err instanceof Prices.WrongPassphraseError ? 'Wrong passphrase. Please try again.' : 'Could not unlock the recipes.'; status.dataset.kind = 'error';
      } finally { btn.disabled = false; }
    });
    return h('div', { class: 'card prices-card' }, h('p', { class: 'muted', text: 'Your household recipe snapshot is locked.' }), form, status);
  }
  function stateBox() {
    if (rx.status === 'checking') return h('p', { class: 'muted rx-state', role: 'status', text: 'Loading recipes…' });
    if (rx.status === 'none') return h('div', { class: 'empty rx-state' }, h('p', { text: 'Recipes need store data, and there isn\'t a recipe snapshot yet. Check back after the next data refresh.' }));
    if (rx.status === 'error') return h('div', { class: 'empty rx-state' }, h('p', { text: 'The recipe snapshot couldn\'t be opened. Try again after the next refresh.' }));
    if (rx.status === 'locked') return lockedPanel();
    return null;
  }
  const count = () => rx.data?.count ?? rx.manifest?.itemCount ?? 0;
  const nCats = () => Object.keys(rx.data?.categories ?? rx.manifest?.categories ?? {}).length;
  const fmt = (n) => n.toLocaleString('en-US');

  function landing() {
    const favs = ctx.getFavs();
    const saved = F.savedRecipes(favs);
    const pics = rx.data ? R.sortRecipes(rx.data.recipes.filter((r) => r.image), { by: 'rating' }).slice(0, 3) : [];
    const kids = [
      h('h1', { class: 'rx-h1', tabindex: '-1', text: 'Recipes' }),
      h('p', { class: 'rx-lead', text: 'Find something to cook and put what it needs on your list.' }),
    ];
    const sb = stateBox();
    if (sb) kids.push(sb);
    if (rx.status === 'ready' || rx.status === 'locked') {
      kids.push(h('div', { class: 'rx-choices' },
        h('a', { class: 'rx-choice photo', href: '#recipes/browse' },
          h('span', { class: 'strip', 'aria-hidden': 'true' }, ...[0, 1, 2].map((i) => (pics[i] ? photo(pics[i].image, { eager: true }) : h('span', { class: 'ph' })))),
          h('span', { class: 'txt' }, h('span', { class: 'ttl', text: 'Browse recipes' }),
            h('span', { class: 'd', text: `${fmt(count())} Wegmans recipes in ${nCats()} categories` })),
          h('span', { class: 'go' }, icon('i-chev-r', 'icon')))));
    }
    if (saved.length) {
      kids.push(h('div', { class: 'rx-sec-h' }, h('h2', { text: 'Saved recipes' }), h('a', { class: 'rx-link', href: '#favorites', onclick: () => ctx.openFavRecipes(), text: `See all ${saved.length} ›` })));
      kids.push(h('ul', { class: 'rx-scroller', 'aria-label': 'Saved recipes' }, ...saved.slice(0, 12).map((s) => card(rx.byId.get(s.id) ?? { ...s, ing: [], time: null }, { small: true }))));
    }
    kids.push(h('p', { class: 'faint rx-foot' }, `Servings start at your household size (${rx.servings}). `,
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => ctx.openHousehold(), text: 'Change' })));
    return kids;
  }

  function browseList() {
    const b = rx.browse;
    let list = rx.data.recipes;
    if (b.cat) list = list.filter((r) => r.cat === b.cat);
    if (b.q) list = list.filter((r) => R.matchesQuery(r, b.q));
    if (b.quick) {
      const q = R.QUICK[b.quick];
      const lidx = b.quick === 'mine' ? R.listIndex(ctx.getState().items) : null;
      list = list.filter((r) => q.test(r, { costOf, coverageOf: (x) => R.coverage(x, lidx) }));
    }
    return list;
  }
  function browse() {
    const b = rx.browse;
    const kids = [h('div', { class: 'rx-top' }, back('#recipes'), h('div', { class: 't' }, h('h1', { tabindex: '-1', text: 'Browse recipes' }), h('div', { class: 's', text: `${fmt(count())} recipes` })))];
    const sb = stateBox();
    if (sb) { kids.push(sb); return kids; }
    const catLabel = b.cat ? R.categoryLabel(b.cat) : '';
    const input = h('input', { type: 'search', id: 'rx-q', value: b.q, placeholder: b.cat ? `Search ${catLabel.toLowerCase()}` : 'Search recipes or ingredients', autocomplete: 'off', maxlength: '80', 'aria-label': 'Search recipes or ingredients' });
    let t = 0;
    input.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { b.q = input.value.trim(); b.shown = PAGE; renderResults(); }, 150); });
    const clear = h('button', { type: 'button', class: 'search-clear', 'aria-label': 'Clear search', hidden: !b.q, onclick: () => { input.value = ''; b.q = ''; b.shown = PAGE; renderResults(); input.focus(); } }, icon('i-x'));
    input.addEventListener('input', () => { clear.hidden = !input.value; });
    kids.push(h('form', { class: 'search rx-searchbar', role: 'search', novalidate: true, onsubmit: (e) => { e.preventDefault(); clearTimeout(t); b.q = input.value.trim(); b.shown = PAGE; renderResults(); } }, icon('i-search', 'icon icon-20'), input, clear));
    kids.push(h('div', { id: 'rx-results' }));
    return kids;
  }
  function chip(label, on, onClick, extra = {}) {
    return h('button', { type: 'button', class: `chip${on ? ' on' : ''}`, 'aria-pressed': String(on), onclick: onClick, ...extra }, label);
  }
  function renderResults() {
    const box = root.querySelector('#rx-results');
    if (!box) return;
    const t0 = performance.now();
    const b = rx.browse;
    const idle = !b.cat && !b.q && !b.quick;
    const cats = R.categoryList(rx.data.categories);
    const kids = [];
    const ps = pricesState();
    const quicks = Object.entries(R.QUICK).filter(([k, q]) => !q.needsPrices || ps !== 'none');
    kids.push(h('div', { class: 'rx-quick', role: 'group', 'aria-label': 'Quick picks' }, ...quicks.map(([k, q]) => chip(q.label, b.quick === k, () => { b.quick = b.quick === k ? '' : k; b.shown = PAGE; renderResults(); }))));
    if (idle) {
      const top = new Map();
      for (const r of R.sortRecipes(rx.data.recipes.filter((x) => x.image), { by: 'rating' })) if (!top.has(r.cat)) top.set(r.cat, r);
      kids.push(h('h2', { class: 'sr-only', text: 'Categories' }));
      kids.push(h('div', { class: 'rx-cats' }, ...cats.map((c) => h('button', { type: 'button', class: 'rx-cat', onclick: () => { b.cat = c.slug; b.shown = PAGE; render(); } },
        h('span', { class: 'th', 'aria-hidden': 'true' }, top.get(c.slug) ? h('img', { src: top.get(c.slug).image, alt: '', loading: 'lazy', referrerpolicy: 'no-referrer', onerror: (e) => e.target.replaceWith(icon('i-pot', 'icon icon-20')) }) : icon('i-pot', 'icon icon-20')),
        h('span', {}, h('span', { class: 'n', text: c.label }), h('span', { class: 'c', text: `${fmt(c.count)} recipe${c.count === 1 ? '' : 's'}` }))))));
      box.replaceChildren(...kids);
      rx.perf.browseRender = performance.now() - t0;
      return;
    }
    kids.push(h('div', { class: 'rx-rail', role: 'group', 'aria-label': 'Categories' },
      chip('All', !b.cat, () => { b.cat = ''; b.shown = PAGE; render(); }),
      ...cats.map((c) => chip(c.label, b.cat === c.slug, () => { b.cat = c.slug; b.shown = PAGE; render(); }))));
    const list = browseList();
    const sort = R.effectiveSort(rx.sort, list);
    if (sort.by === 'price' && ps !== 'ready') sort.by = 'time';
    const ts = performance.now();
    const sorted = R.sortRecipes(list, sort, { costOf: (r) => costOf(r) });
    rx.perf.sort = performance.now() - ts;
    const hasRatings = list.some(R.hasRating);
    kids.push(h('div', { class: 'rx-toolbar' },
      h('span', { class: 'cnt', role: 'status', 'aria-live': 'polite', text: `${fmt(list.length)} recipe${list.length === 1 ? '' : 's'}${ps === 'pricing' ? ' · pricing…' : ''}` }),
      sortControl(sort, hasRatings, ps === 'ready')));
    if (b.quick === 'cheap' && ps !== 'ready') kids.push(h('p', { class: 'muted', text: ps === 'pricing' ? 'Pricing recipes at your store…' : 'Unlock prices in Shop to see costs.' }));
    if (!list.length) {
      kids.push(h('div', { class: 'empty' }, h('p', { text: 'No recipes match. Try fewer words or another category.' })));
    } else {
      kids.push(h('ul', { class: 'rx-grid', 'aria-label': 'Recipes' }, ...sorted.slice(0, b.shown).map((r) => card(r))));
      if (sorted.length > b.shown) {
        const left = sorted.length - b.shown;
        kids.push(h('button', { type: 'button', class: 'btn btn-secondary btn-block show-more', onclick: () => { b.shown += PAGE; renderResults(); root.querySelectorAll('.rx-grid .rx-card-link')[b.shown - PAGE]?.focus({ preventScroll: true }); }, text: `Show more (${fmt(left)} more)` }));
      }
    }
    if (ps === 'ready') { const st = priceCtx()?.st; if (st) kids.push(h('p', { class: 'faint rx-foot', text: `Costs are whole packs at ${st.label} for ${rx.servings} serving${rx.servings === 1 ? '' : 's'}, pantry basics left out. A saved snapshot, not checkout prices.` })); }
    box.replaceChildren(...kids);
    rx.perf.browseRender = performance.now() - t0;
  }

  // ----- sort (mirrors the v0.1.5 List sort: chip + menu on phones, segmented control on desktop) -----
  const sortMenu = document.getElementById('rx-sort-menu');
  function spoken(s) { return s.by === 'price' ? `Price, ${s.dir === 'desc' ? 'high to low' : 'low to high'}` : R.RX_SORT_LABEL[s.by]; }
  function setSort(next) { rx.sort = R.cleanRxSort(next); saveRxSort(rx.sort); renderResults(); }
  function sortControl(sort, hasRatings, pricesOn) {
    const opts = R.RX_SORTS.filter((k) => (k !== 'rating' || hasRatings) && (k !== 'price' || pricesOn));
    const btn = h('button', { type: 'button', class: 'sort-btn mob-only', id: 'rx-sort-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'rx-sort-menu', 'aria-label': `Sort recipes: ${spoken(sort)}` },
      icon('i-sort', 'icon icon-18 ico'), h('span', {}, h('span', { class: 'k', text: 'Sort:' }), ` ${R.RX_SORT_LABEL[sort.by]}${sort.by === 'price' ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}`), icon('i-chev'));
    btn.addEventListener('click', (e) => { e.stopPropagation(); if (sortMenu.hidden) openSortMenu(btn, sort, opts); else closeSortMenu(true); });
    const seg = h('div', { class: 'sort-seg desk-only', role: 'radiogroup', 'aria-label': 'Sort recipes' },
      ...opts.map((k) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(sort.by === k), tabindex: sort.by === k ? '0' : '-1', onclick: () => { if (k === 'price' && sort.by === 'price') setSort({ by: 'price', dir: sort.dir === 'desc' ? 'asc' : 'desc' }); else setSort({ by: k, dir: rx.sort.dir }); root.querySelector('.sort-seg [aria-checked="true"]')?.focus(); } }, k === 'rating' ? '★ Rating' : R.RX_SORT_LABEL[k])));
    seg.addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      const i = opts.indexOf(sort.by); const k = opts[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length];
      setSort({ by: k, dir: rx.sort.dir }); root.querySelector('.sort-seg [aria-checked="true"]')?.focus();
    });
    const dir = sort.by === 'price' ? h('button', { type: 'button', class: 'dir-btn desk-only', 'aria-label': `Price order: ${sort.dir === 'desc' ? 'high to low' : 'low to high'}. Activate to reverse.`, onclick: () => { setSort({ by: 'price', dir: sort.dir === 'desc' ? 'asc' : 'desc' }); root.querySelector('.dir-btn')?.focus(); } },
      icon(sort.dir === 'desc' ? 'i-down' : 'i-up', 'icon icon-16'), h('span', { text: sort.dir === 'desc' ? 'High to low' : 'Low to high' })) : null;
    return h('span', { class: 'rx-sort' }, btn, seg, dir);
  }
  function openSortMenu(btn, sort, opts) {
    for (const b of sortMenu.querySelectorAll('[data-rx-sort]')) { b.hidden = !opts.includes(b.dataset.rxSort); b.setAttribute('aria-checked', String(b.dataset.rxSort === sort.by)); }
    sortMenu.querySelector('#rx-sort-dir').hidden = sort.by !== 'price';
    for (const b of sortMenu.querySelectorAll('[data-rx-dir]')) b.setAttribute('aria-pressed', String(b.dataset.rxDir === sort.dir));
    sortMenu.hidden = false;
    const r = btn.getBoundingClientRect(); const w = sortMenu.offsetWidth;
    sortMenu.style.setProperty('top', `${Math.round(r.bottom + 6)}px`);
    sortMenu.style.setProperty('left', `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)))}px`);
    btn.setAttribute('aria-expanded', 'true');
    (sortMenu.querySelector('[aria-checked="true"]:not([hidden])') ?? sortMenu.querySelector('.mi:not([hidden])')).focus();
  }
  function closeSortMenu(focusBack = false) {
    if (sortMenu.hidden) return;
    sortMenu.hidden = true;
    const btn = root.querySelector('#rx-sort-btn');
    btn?.setAttribute('aria-expanded', 'false');
    if (focusBack) btn?.focus();
  }
  sortMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    const d = e.target.closest('[data-rx-dir]');
    if (d) { setSort({ by: 'price', dir: d.dataset.rxDir }); openSortMenu(root.querySelector('#rx-sort-btn'), rx.sort, [...sortMenu.querySelectorAll('[data-rx-sort]:not([hidden])')].map((x) => x.dataset.rxSort)); sortMenu.querySelector(`[data-rx-dir="${rx.sort.dir}"]`)?.focus(); return; }
    const mi = e.target.closest('[data-rx-sort]');
    if (!mi) return;
    const opts = [...sortMenu.querySelectorAll('[data-rx-sort]:not([hidden])')].map((x) => x.dataset.rxSort);
    setSort({ by: mi.dataset.rxSort, dir: rx.sort.dir });
    if (mi.dataset.rxSort === 'price') { openSortMenu(root.querySelector('#rx-sort-btn'), rx.sort, opts); sortMenu.querySelector(`[data-rx-dir="${rx.sort.dir}"]`)?.focus(); return; }
    closeSortMenu(true);
  });
  sortMenu.addEventListener('keydown', (e) => {
    const items = [...sortMenu.querySelectorAll('.mi, [data-rx-dir]')].filter((x) => x.offsetParent);
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSortMenu(true); }
    if (e.key === 'Tab') closeSortMenu();
  });
  document.addEventListener('click', (e) => { if (!sortMenu.contains(e.target)) closeSortMenu(); });

  // ----- detail -----
  function storeOf(item) {
    const s = ctx.directory()[item.storeId];
    if (s) return { name: s.name, chain: s.chain };
    return item.storeId ? { name: item.priced?.store ?? 'Any store', chain: item.priced?.chain ?? '' } : { name: 'Any store', chain: '' };
  }
  function model(r) {
    const serv = rx.detailServ ?? rx.servings;
    const pc = priceCtx();
    const t0 = performance.now();
    const m = R.detailModel(r, { servings: serv, listItems: ctx.getState().items, mi: pc?.cands ? rx.mi : null, cands: pc?.cands ?? null, swapOf: pc ? swapOfAt(pc.st.key) : () => null });
    rx.perf.detailModel = performance.now() - t0;
    return { m, pc, serv };
  }
  const lineLabel = (l) => (l.amount ? `${l.amount} ${l.name}` : l.name);
  /** Missing lines the add acts on: checked rows, with their chosen product (or none: added as text). */
  function picks(m) { return m.missing.filter((l) => !rx.off.has(rowKey(l))).map((l) => ({ l, o: l.opts[0] ?? null })); }
  /** One row per recipe line (two "lime" lines are two rows); swaps are still remembered per ingredient. */
  function rowKey(l) { return `${rx.byId.get(rx.id)?.ing.indexOf(l.ing) ?? 0}-${l.ing.k}`; }
  const pickTotal = (ps) => ps.reduce((a, p) => a + (p.o?.buy.total ?? 0), 0);

  function ingRow(l, have) {
    const o = l.opts[0];
    let right;
    if (have) {
      const st = storeOf(l.onList);
      right = h('span', { class: 'r' }, st.chain ? h('span', { class: 'dot', 'data-chain': st.chain, 'aria-hidden': 'true' }) : null, st.name);
    } else {
      const price = o?.buy.total != null ? `≈ ${L.money(o.buy.total)}` : (priceCtx()?.cands ? 'No match' : '');
      right = price ? h('span', { class: 'r', text: price }) : null;
    }
    return h('li', { class: `ing ${have ? 'have' : 'need'}` }, h('span', { class: 'mk', 'aria-hidden': 'true' }, have ? icon('i-check', 'icon icon-16') : null),
      h('span', { class: 'b' }, l.amount ? h('span', { class: 'q', text: `${l.amount} ` }) : null, h('span', { class: 'nm', text: l.name }),
        !have && (l.sub || o?.buy.buys) ? h('span', { class: 'sub', text: [l.sub, o?.buy.buys].filter(Boolean).join(' · ') }) : (have && l.sub ? h('span', { class: 'sub', text: l.sub }) : null)),
      right);
  }
  function detail() {
    const r = rx.byId.get(rx.id);
    if (!r) {
      const sb = stateBox();
      return [h('div', { class: 'rx-top' }, back('#recipes'), h('div', { class: 't' }, h('h1', { tabindex: '-1', text: 'Recipe' }))),
        sb ?? h('div', { class: 'empty' }, h('p', { text: 'That recipe isn\'t in this snapshot any more.' }), h('a', { class: 'btn btn-secondary mt-2', href: '#recipes/browse', text: 'Browse recipes' }))];
    }
    const { m, pc, serv } = model(r);
    const t = R.timeText(r.time);
    const crumb = h('a', { class: 'crumb desk-only', href: '#recipes/browse', onclick: () => { rx.browse.cat = r.cat; rx.browse.shown = PAGE; } }, icon('i-back', 'icon icon-16'), R.categoryLabel(r.cat));
    const hero = h('div', { class: 'rx-hero' }, photo(r.image, { eager: true }), h('span', { class: 'mob-only' }, back('#recipes/browse')), rxStar(r));
    hero.querySelector('.back')?.classList.add('ovl', 'l');
    const stepper = h('div', { class: 'stepper' },
      h('button', { type: 'button', 'aria-label': 'Fewer servings', 'aria-disabled': String(serv <= 1), onclick: () => { if (serv > 1) { rx.detailServ = serv - 1; renderKeep('[aria-label="Fewer servings"]'); } } }, icon('i-minus', 'icon icon-20')),
      h('output', { 'aria-live': 'polite', 'aria-label': `${serv} servings`, text: String(serv) }),
      h('button', { type: 'button', 'aria-label': 'More servings', 'aria-disabled': String(serv >= MAX_SERV), onclick: () => { if (serv < MAX_SERV) { rx.detailServ = serv + 1; renderKeep('[aria-label="More servings"]'); } } }, icon('i-plus', 'icon icon-20')));
    const info = h('div', { class: 'rx-dinfo' },
      h('h1', { class: 'rx-title', tabindex: '-1', text: r.title }),
      h('div', { class: 'rx-detail-meta' }, t ? h('span', { class: 'm' }, icon('i-clock', 'icon icon-16'), t) : null, ratingSlot(r, true), costSlot(m.cost)),
      unpricedNote(m, pc),
      h('div', { class: 'serv' }, h('div', { class: 'l' }, h('b', { text: 'Servings' }), h('small', { text: r.servings ? `Recipe makes ${r.servings}${serv !== r.servings ? ` · scaled to ${serv}` : ''}` : 'Amounts as written (servings not given)' })), stepper));
    const total = m.lines.length;
    const groups = h('div', { class: 'rx-ingcols' },
      m.missing.length ? h('div', {}, h('div', { class: 'ing-h' }, h('h3', { id: 'rx-miss-h', text: 'Missing' }), h('span', { class: 'count miss', text: String(m.missing.length) })),
        h('ul', { class: 'rx-ings', 'aria-labelledby': 'rx-miss-h' }, ...m.missing.map((l) => ingRow(l, false)))) : null,
      m.have.length ? h('div', {}, h('div', { class: 'ing-h' }, h('h3', { id: 'rx-have-h', text: 'Already on your list' }), h('span', { class: 'count have', text: String(m.have.length) })),
        h('ul', { class: 'rx-ings', 'aria-labelledby': 'rx-have-h' }, ...m.have.map((l) => ingRow(l, true)))) : null);
    const pantry = m.pantry.length ? h('p', { class: 'pantry', text: `Pantry basics, not added: ${m.pantry.join(', ')}` }) : null;
    const steps = R.splitSteps(r.steps);
    const stepsEl = steps.length ? h('ol', { class: 'rx-steps' }, ...steps.map((s) => { const tm = R.stepTimer(s); return h('li', {}, h('div', {}, h('p', { text: s }), tm ? h('span', { class: 'tm' }, icon('i-clock', 'icon icon-14'), tm) : null)); })) : h('p', { class: 'muted', text: 'No steps in the snapshot.' });
    const source = r.url ? h('p', { class: 'faint rx-foot' }, 'Recipe from ', h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', text: 'wegmans.com' }), '. Prices are a saved snapshot, not checkout prices.') : null;
    renderSide(r, m, pc);
    return [crumb, h('div', { class: 'rx-dtop' }, hero, info),
      h('section', { class: 'rx-ingsec', 'aria-labelledby': 'rx-ing-h' },
        h('div', { class: 'rx-sec-h' }, h('h2', { class: 'rx-h2', id: 'rx-ing-h', text: 'Ingredients' }), h('span', { class: 'rx-have-n', text: `${m.have.length} of ${total} on your list` })),
        groups, pantry),
      h('section', { class: 'rx-stepsec', 'aria-labelledby': 'rx-steps-h' }, h('div', { class: 'ing-h' }, h('h2', { class: 'rx-h2', id: 'rx-steps-h', text: 'Steps' })), stepsEl),
      source, cta(r, m, pc)].filter(Boolean);   // L36: no "null" when there's no source link
  }
  /** "N ingredients not priced"; L37: also when nothing could be priced ("N ingredients not priced at <store>"). */
  function unpricedNote(m, pc) {
    if (m.cost?.unpriced) return h('p', { class: 'faint rx-unpriced', text: `${m.cost.unpriced} ingredient${m.cost.unpriced === 1 ? '' : 's'} not priced` });
    if (!m.cost && pc?.cands && m.lines.length) {
      const n = m.lines.length;
      return h('p', { class: 'faint rx-unpriced', text: `${n} ingredient${n === 1 ? '' : 's'} not priced at ${pc.st?.label ?? 'this store'}` });
    }
    return null;

  }
  function cta(r, m, pc) {
    const last = rx.lastAdd && rx.lastAdd.id === r.id ? rx.lastAdd : null;
    const ps = m.missing.map((l) => ({ l, o: l.opts[0] ?? null }));
    const est = pickTotal(ps);
    const where = pc?.st ? pc.st.label : 'Any store';
    if (!m.missing.length && !last) {
      return h('div', { class: 'rx-cta done' }, h('div', { class: 'l' }, h('b', { text: 'Everything\'s on your list ✓' }), h('small', { text: `${m.have.length} ingredient${m.have.length === 1 ? '' : 's'}` })),
        h('a', { class: 'btn btn-secondary', href: '#list', text: 'View list' }));
    }
    const left = h('div', { class: 'l' },
      h('b', { text: pc?.cands && est ? `≈ ${L.money(est)}` : `${m.missing.length} missing` }),
      h('small', { text: pc?.cands ? `${m.missing.length} missing · ${where}` : (ctx.getFeed() ? 'Pricing…' : 'Unlock prices in Shop for costs') }));
    let btn;
    // M8: Undo takes the Add button's place, so taps right after the add are ignored.
    if (last && Date.now() - last.at < 6000) btn = h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { if (Date.now() - last.at >= TAP_GUARD_MS) undoAdd(); } }, icon('i-check', 'icon icon-20'), `${last.what} · Undo`);
    else if (last) btn = h('a', { class: 'btn btn-secondary', href: '#list', text: 'View list' });
    else btn = h('button', { type: 'button', class: 'btn btn-primary', id: 'rx-add-missing', 'aria-haspopup': 'dialog', onclick: (e) => openSheet(e.currentTarget) }, icon('i-plus', 'icon icon-20'), 'Add missing to list');
    return h('div', { class: `rx-cta${last ? ' done' : ''}` }, left, btn);
  }

  // ----- match review sheet (phones) / Review dialog (desktop) -----
  const sheet = document.getElementById('rx-sheet');
  function openSheet(opener) {
    rx.sheetOpener = opener;
    rx.open = null;
    renderSheet();
    if (!sheet.open) sheet.showModal();
    sheet.querySelector('#rx-sheet-title')?.focus();
  }
  function storeSelect(pc) {
    const feed = ctx.getFeed();
    if (!feed || !pc) return null;
    const stores = C.priceStores(feed.catalog);
    const sel = h('select', { class: 'input rx-store-sel', id: 'rx-store', 'aria-label': 'Store to match at' }, ...stores.map((st) => new Option(st.label, st.key)));
    sel.value = pc.st.key;
    sel.addEventListener('change', () => { setMatchStore(sel.value); renderKeep(null); renderSheet(); sheet.querySelector('#rx-store')?.focus(); });
    return sel;
  }
  function renderSheet() {
    const r = rx.byId.get(rx.id);
    if (!r || rx.view !== 'detail') { if (sheet.open) sheet.close(); return; }
    const { m, pc } = model(r);
    const ps = picks(m);
    const n = ps.length;
    const head = h('div', { class: 'sheet-head' }, h('h2', { id: 'rx-sheet-title', tabindex: '-1', text: `Add ${m.missing.length} item${m.missing.length === 1 ? '' : 's'} to your list` }),
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Close', onclick: () => sheet.close() }, icon('i-x', 'icon')));
    const at = pc ? h('div', { class: 'at' }, h('label', { for: 'rx-store', text: 'Matched at' }), storeSelect(pc), pc.cands ? null : h('span', { role: 'status', text: 'Matching…' })) : h('p', { class: 'muted', text: 'Unlock prices in Shop to match products. Lines are added as text.' });
    const blocks = m.missing.map((l) => matchBlock(l, pc));
    const total = pickTotal(ps);
    const foot = h('div', { class: 'foot' },
      h('div', { class: 'l' }, h('b', { 'aria-live': 'polite', text: total ? `≈ ${L.money(total)}` : '—' }), h('small', { text: pc ? `Goes to your ${pc.st.label} section` : 'Goes to Any store' })),
      h('button', { type: 'button', class: 'btn btn-primary', id: 'rx-sheet-add', disabled: n === 0, onclick: () => addMissing(r, m, pc) }, `Add ${n} to list`));
    sheet.querySelector('.rx-sheet-body').replaceChildren(head, at, h('div', { class: 'scroll' }, ...blocks), foot);
  }
  function matchBlock(l, pc) {
    const k = l.ing.k;
    const rk = rowKey(l);
    const on = !rx.off.has(rk);
    const o = l.opts[0];
    const cbId = `rx-cb-${rk.replace(/[^\w-]/g, '_')}`;
    const cb = h('input', { type: 'checkbox', class: 'cbx', id: cbId, checked: on, 'aria-label': `Add ${o ? o.it.name : l.name}` });
    cb.checked = on;
    cb.addEventListener('change', () => { if (cb.checked) rx.off.delete(rk); else rx.off.add(rk); rerenderSheet(`#${cbId}`); renderKeep(null); });
    const need = h('p', { class: 'need' }, 'For ', h('b', { text: lineLabel(l) }));
    if (!o) {
      return h('div', { class: `mt${on ? '' : ' off'}` }, need, h('div', { class: 'p' }, h('span', { class: 'cbx-wrap' }, cb), h('span', { class: 'pthumb', 'aria-hidden': 'true' }, icon('i-pot', 'icon icon-20')),
        h('span', {}, h('span', { class: 'pn', text: pc?.cands ? 'No match. Add as text' : `Add “${l.name}” as text` }), h('span', { class: 'ps', text: 'Goes to Any store' })), h('span', { class: 'pr' })));
    }
    const open = rx.open === rk;
    const swapBtn = l.opts.length > 1 ? h('button', { type: 'button', class: 'swap-btn', 'aria-expanded': String(open), 'aria-controls': `rx-swap-${cbId}`, onclick: () => { rx.open = open ? null : rk; rerenderSheet(open ? `[aria-controls="rx-swap-${cbId}"]` : `#rx-swap-${cbId} [aria-checked="true"]`); } }, 'Swap') : null;
    const row = h('div', { class: 'p' }, h('span', { class: 'cbx-wrap' }, cb), h('span', { class: 'pthumb', 'aria-hidden': 'true' }, icon('i-bag', 'icon icon-20')),
      h('span', { class: 'pmain' }, h('span', { class: 'pn', text: o.it.name }), h('span', { class: 'ps', text: [o.it.size, o.it.department, o.buy.buys].filter(Boolean).join(' · ') })),
      h('span', { class: 'pr' }, h('span', { class: 'v', text: o.buy.total != null ? L.money(o.buy.total) : '—' }), swapBtn));
    const kids = [need, row];
    if (open) kids.push(swapList(l, pc, cbId));
    return h('div', { class: `mt${on ? '' : ' off'}`, 'data-k': k }, ...kids);
  }
  function swapList(l, pc, cbId) {
    const opts = l.opts.slice(0, 5);
    const cur = opts[0];
    const group = h('div', { class: 'swap-list', id: `rx-swap-${cbId}` }, h('p', { class: 'h', id: `rx-swap-h-${cbId}`, text: 'Pick one' }));
    const rg = h('div', { role: 'radiogroup', 'aria-labelledby': `rx-swap-h-${cbId}` });
    const choose = (o) => { if (o !== cur) setSwap(l.ing.k, pc.st.key, o.it.sku); rx.open = null; rerenderSheet(`[aria-controls="rx-swap-${cbId}"]`); renderKeep(null); };
    const radios = opts.map((o) => h('button', { type: 'button', role: 'radio', class: 'swap-opt', 'aria-checked': String(o === cur), tabindex: o === cur ? '0' : '-1', onclick: () => choose(o) },
      h('span', {}, h('span', { class: 'pn', text: o.it.name }), h('span', { class: 'ps', text: [o.it.size, o.it.unitPriceText, o.buy.buys].filter(Boolean).join(' · ') })),
      h('span', { class: 'v', text: o.buy.total != null ? L.money(o.buy.total) : '—' }),
      h('span', { class: 'tick', 'aria-hidden': 'true' }, o === cur ? icon('i-check', 'icon icon-18') : null)));
    rg.addEventListener('keydown', (e) => {
      const i = radios.indexOf(document.activeElement);
      if (i < 0) return;
      if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(e.key)) {
        e.preventDefault();
        const j = (i + (e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : radios.length - 1)) % radios.length;
        radios.forEach((b, x) => { b.tabIndex = x === j ? 0 : -1; });
        radios[j].focus();
      }
    });
    rg.append(...radios);
    group.append(rg, h('button', { type: 'button', class: 'swap-more', onclick: () => { sheet.close(); ctx.openShopSearch(l.ing.base, pc.st.key); } }, icon('i-search', 'icon icon-18'), `Search ${pc.st.label} for something else`));
    return group;
  }
  function rerenderSheet(focusSel) {
    const y = sheet.querySelector('.scroll')?.scrollTop ?? 0;
    renderSheet();
    const sc = sheet.querySelector('.scroll'); if (sc) sc.scrollTop = y;
    if (focusSel) sheet.querySelector(focusSel)?.focus();
  }
  sheet.addEventListener('close', () => { const op = rx.sheetOpener; rx.sheetOpener = null; (op?.isConnected ? op : root.querySelector('#rx-add-missing') ?? root.querySelector('.rx-cta .btn'))?.focus({ preventScroll: true }); });
  sheet.addEventListener('click', (e) => { if (e.target === sheet) sheet.close(); });

  /** Adds the checked missing lines (the chosen product, or the ingredient as text when nothing
   * matched), merging into matching open lines (M7). Undo removes what was added and restores merged lines. */
  function addMissing(r, m, pc) {
    // M8: a double tap adds once; L42: and an Undo isn't followed by an instant re-add.
    if (Date.now() - Math.max(rx.lastAdd?.at ?? 0, rx.undoAt) < TAP_GUARD_MS) return;
    let s = ctx.getState();
    const ids = []; const prev = new Map();
    const feed = ctx.getFeed();
    const link = { id: r.id, title: r.title };
    for (const { l, o } of picks(m)) {
      try {
        let res;
        if (o && feed && pc?.cands) {
          const f = C.pricedFields(feed.catalog, o.it, ctx.directory());
          res = L.addOrMergeItem(s, { name: o.it.name, qty: o.buy.listQty ?? 1, unit: o.buy.listUnit || '', storeId: f.storeId, priced: f.priced, notes: lineLabel(l).slice(0, 200), recipe: link });
        } else {
          res = L.addOrMergeItem(s, { name: l.name, qty: null, unit: '', notes: l.amount ? `${l.amount}` : '', recipe: link });
        }
        s = res.state;
        if (!res.prev) ids.push(res.id);
        else if (!ids.includes(res.id) && !prev.has(res.id)) prev.set(res.id, res.prev);
      } catch { /* a line the list can't take is skipped */ }
    }
    if (sheet.open) sheet.close();
    const n = ids.length + prev.size;
    if (!n) return;
    ctx.commit(s);
    rx.off.clear();
    const what = addedText(ids.length, prev.size);
    rx.lastAdd = { id: r.id, ids, prev, n, what, at: Date.now() };
    ctx.toast(`${what} from ${r.title}`, undoAdd, 6000);
    renderKeep('.rx-cta .btn');
    const mine = rx.lastAdd;
    setTimeout(() => { if (rx.lastAdd === mine && rx.view === 'detail') renderKeep(null); }, 6100);
  }
  function undoAdd() {
    const last = rx.lastAdd;
    if (!last) return;
    const drop = new Set(last.ids);
    const s = ctx.getState();
    ctx.commit({ ...s, items: s.items.filter((i) => !drop.has(i.id)).map((i) => last.prev.get(i.id) ?? i) });
    rx.lastAdd = null;
    rx.undoAt = Date.now();
    ctx.toast('Removed them from your list');
    if (rx.view === 'detail') renderKeep('.rx-cta .btn');
  }

  // ----- desktop right panel: Add missing card + compact My list -----
  const side = document.getElementById('rx-side');
  function renderSide(r, m, pc) {
    if (!side) return;
    const kids = [];
    const ps = picks(m);
    if (m.missing.length) {
      const rows = m.missing.map((l) => {
        const k = rowKey(l); const on = !rx.off.has(k); const o = l.opts[0];
        const id = `rx-side-${k.replace(/[^\w-]/g, '_')}`;
        const cb = h('input', { type: 'checkbox', class: 'cbx', id, 'aria-label': `Add ${o ? o.it.name : l.name}` });
        cb.checked = on;
        cb.addEventListener('change', () => { if (cb.checked) rx.off.delete(k); else rx.off.add(k); renderKeep(null); side.querySelector(`#${CSS.escape(id)}`)?.focus(); });
        return h('div', { class: `row mini-add${on ? '' : ' off'}` }, h('span', { class: 'cbx-wrap' }, cb),
          h('label', { class: 'b', for: id }, h('span', { class: 'nm', text: o ? o.it.name : l.name }), h('span', { class: 'sub', text: `For ${lineLabel(l)}${o ? '' : (pc?.cands ? ' · no match, added as text' : '')}` })),
          h('span', { class: 'v', text: o?.buy.total != null ? L.money(o.buy.total) : '' }));
      });
      const n = ps.length;
      kids.push(h('section', { class: 'add-panel', 'aria-labelledby': 'rx-side-h' },
        h('h3', { id: 'rx-side-h', text: `Add ${m.missing.length} missing item${m.missing.length === 1 ? '' : 's'}` }),
        pc ? h('p', { class: 'faint', text: `Matched at ${pc.st.label}${pc.cands ? '' : ' (matching…)'}` }) : null,
        ...rows,
        h('div', { class: 'tot' }, h('span', { class: 'tl', text: 'Est.' }), h('span', { class: 'est', text: pickTotal(ps) ? `≈ ${L.money(pickTotal(ps))}` : '—' })),
        h('div', { class: 'add-actions' },
          h('button', { type: 'button', class: 'btn btn-secondary', 'aria-haspopup': 'dialog', onclick: (e) => openSheet(e.currentTarget), text: 'Review' }),
          h('button', { type: 'button', class: 'btn btn-primary', id: 'rx-side-add', disabled: n === 0, onclick: () => addMissing(r, m, pc), text: `Add ${n} to list` }))));
    } else {
      kids.push(h('section', { class: 'add-panel done' }, h('h3', { text: 'Everything\'s on your list ✓' }), h('a', { class: 'btn btn-secondary', href: '#list', text: 'View list' })));
    }
    const last = rx.lastAdd && rx.lastAdd.id === r.id && Date.now() - rx.lastAdd.at < 6000 ? rx.lastAdd : null;
    if (last) kids.push(h('p', { class: 'rx-added', role: 'status' }, `${last.what} · `, h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { if (Date.now() - last.at >= TAP_GUARD_MS) undoAdd(); }, text: 'Undo' })));
    // Compact My list by store; lines this recipe uses carry "in recipe".
    const items = ctx.getState().items;
    const used = new Set(m.have.map((l) => l.onList.id));
    for (const it of items) if (it.recipe?.id === r.id) used.add(it.id);
    const groups = new Map();
    for (const it of items) { const st = storeOf(it); const g = groups.get(st.name) ?? { st, rows: [] }; g.rows.push(it); groups.set(st.name, g); }
    const list = h('section', { class: 'mini-list', 'aria-labelledby': 'rx-mini-h' }, h('div', { class: 'section-h' }, h('h3', { id: 'rx-mini-h', text: 'My list' }), h('a', { class: 'btn btn-ghost btn-sm', href: '#list', text: 'Open' })));
    if (!items.length) list.append(h('p', { class: 'faint', text: 'Your list is empty.' }));
    for (const { st, rows } of groups.values()) {
      list.append(h('div', { class: 'mini-store' }, st.chain ? h('span', { class: 'dot', 'data-chain': st.chain, 'aria-hidden': 'true' }) : null, st.name, h('span', { class: 's', text: String(rows.length) })));
      list.append(h('ul', { class: 'mini-ul' }, ...rows.map((it) => h('li', { class: `mini-row${used.has(it.id) ? ' new' : ''}${it.checked ? ' done' : ''}` },
        h('span', { class: 'n', text: it.name }), used.has(it.id) ? h('span', { class: 'new-tag', text: 'in recipe' }) : null, h('span', { class: 'v', text: L.formatQty(it) })))));
    }
    kids.push(list);
    side.replaceChildren(...kids);
  }

  // ----- render -----
  function render({ keepScroll = false } = {}) {
    if (!root) return;
    const y = window.scrollY;
    if (rx.status === 'ready') priceCtx();   // start matching as soon as both snapshots are open
    document.body.dataset.rxView = rx.view;
    if (rx.view === 'browse') { root.replaceChildren(...browse()); if (rx.data && rx.status === 'ready') renderResults(); } else if (rx.view === 'detail') root.replaceChildren(...detail());
    else root.replaceChildren(...landing());
    if (rx.view !== 'detail') { side?.replaceChildren(); if (sheet.open) sheet.close(); }
    if (keepScroll) window.scrollTo(0, y);
    renderFavGrid();
  }
  function renderKeep(sel) {
    const y = window.scrollY;
    render();
    window.scrollTo(0, y);
    if (sel) root.querySelector(sel)?.focus({ preventScroll: true });
  }
  function renderFavGrid() {
    const grid = document.getElementById('fav-rx-grid');
    if (!grid) return;
    const saved = F.savedRecipes(ctx.getFavs());
    grid.replaceChildren(...saved.map((s) => card(rx.byId.get(s.id) ?? { ...s, ing: [], time: null })));
    document.getElementById('fav-rx-empty').hidden = saved.length > 0;
  }

  load();
  return {
    show, render: () => render({ keepScroll: true }), syncStars: () => { syncStars(); renderFavGrid(); }, retryCache: tryCache,
    setServings(n) { rx.servings = Math.max(1, Math.min(MAX_SERV, n)); saveHousehold(rx.servings); rx.costMemo.clear(); rx.detailServ = rx.servings; render({ keepScroll: true }); },
    servings: () => rx.servings, perf: rx.perf, savedCount: () => (ctx.getFavs().recipes ?? []).length,
  };
}
