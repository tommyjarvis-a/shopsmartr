// Recipes tab (v0.2.0): feed loader, Landing, Browse, Detail and the Favorites › Recipes grid.
// DOM + wiring only; all rules live in recipes.js (pure, unit-tested).
import * as R from './recipes.js';
import * as Prices from './prices.js';
import * as C from './catalog.js';
import * as F from './favorites.js';
import * as L from './list.js';
import { makeDecoder } from './pricefeed.js';
import * as Imp from './importer.js';
import { isStandalone, LIVE_URL } from './brand.js';

export const RX_MANIFEST_URL = 'data/recipes.json';
export const RX_SLOT = 'aes-recipes';
export const HOUSEHOLD_KEY = 'shopsmartr:household:v1';
export const RX_SORT_KEY = 'shopsmartr:rxSort:browse:v1';
/** v0.2.6: Cook from my list remembers its own sort (spec §3.2: separately for Browse and Cook). */
export const RX_COOK_SORT_KEY = 'shopsmartr:rxSort:cook:v1';
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
function loadCookSort() { try { return R.cleanCookSort(JSON.parse(localStorage.getItem(RX_COOK_SORT_KEY))); } catch { return R.cleanCookSort(null); } }
function saveCookSort(s) { try { localStorage.setItem(RX_COOK_SORT_KEY, JSON.stringify(s)); } catch { /* device-only */ } }

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
    // v0.2.6: imported recipes (device store, in the full backup), Cook from my list, Import
    userRows: [], user: [], cookSort: loadCookSort(), cookShown: PAGE, cov: { sig: null, lidx: [], memo: new Map(), byId: new Map() },
    imp: { draft: null, error: '', note: '', busy: false, fromLink: false, editing: '', more: false, link: '', text: '' },
  };
  const allRecipes = () => (rx.data ? (rx.user.length ? [...rx.data.recipes, ...rx.user] : rx.data.recipes) : rx.user);
  function reindex() { rx.byId = new Map(allRecipes().map((r) => [r.id, r])); rx.cov.sig = null; rx.costMemo.clear(); }
  function loadUser() {
    rx.userRows = Imp.loadUserRecipes();
    try { rx.user = Imp.prepareUserRecipes(rx.userRows); } catch { rx.user = []; }
    reindex();
  }
  globalThis.__shopsmartrRx = rx.perf;

  // ----- prices / matching -----
  function priceCtx() {
    const feed = ctx.getFeed();
    if (!feed || (!rx.data && !rx.user.length)) return null;
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
    // v0.2.6: an imported recipe saved after matching ran gets its few ingredients matched now
    for (const r of rx.user) for (const ing of r.ing) if (!ing.pantry && ing.k && !done.has(ing.k)) done.set(ing.k, R.matchRows(rx.mi, ing.base, st.idx));
    return { st, cands: done };
  }
  /** Precomputes ingredient matches at one store in small slices so the page never freezes. */
  function startPricing(key, idx) {
    if (rx.pricing === key) return;
    rx.pricing = key;
    const keys = [];
    const seen = new Set();
    for (const r of allRecipes()) for (const ing of r.ing) if (!ing.pantry && ing.k && !seen.has(ing.k)) { seen.add(ing.k); keys.push([ing.k, ing.base]); }
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
  /** v0.2.6 Cook: the low-to-high range for just the lines that aren't on the list yet. */
  function buyCostOf(r, servings = rx.servings) {
    const pc = priceCtx();
    const c = covOf(r);
    if (!pc?.cands || !c.missing.length) return null;
    const mk = `buy|${pc.st.key}|${servings}|${rx.swapVer ?? 0}|${rx.cov.sig}`;
    let m = rx.costMemo.get(mk);
    if (!m) { for (const k of rx.costMemo.keys()) if (k.startsWith('buy|')) rx.costMemo.delete(k); m = new Map(); rx.costMemo.set(mk, m); }
    if (!m.has(r.id)) m.set(r.id, R.recipeCost(r, { mi: rx.mi, cands: pc.cands, factor: R.scaleFactor(r, servings), swapOf: swapOfAt(pc.st.key), only: new Set(c.missing) }));
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
    rx.data = res.recipes; reindex();
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
    const parts = String(sub || '').split('/');
    const [view, id] = parts;
    const prev = `${rx.view}/${rx.id}`;
    // v0.2.6: "#recipes/import/<payload>" from the bookmarklet or Shortcut. The payload is taken off
    // the address bar at once (history.replaceState), before it is read, so it isn't kept in history,
    // bookmarks or a reload, then decoded and checked on this device.
    if (view === 'import' && parts.length > 1) {
      const payload = parts.slice(1).join('/');
      try { history.replaceState(history.state, '', `${location.pathname}${location.search}#recipes/import`); } catch { /* sandboxed */ }
      if (payload) readPayload(payload, true);
    }
    rx.view = ['browse', 'cook', 'import'].includes(view) ? view : view === 'r' && id ? 'detail' : 'landing';
    rx.id = rx.view === 'detail' ? decodeURIComponent(id) : null;
    if (rx.view === 'cook' && prev !== 'cook/null') rx.cookShown = PAGE;
    if (rx.view === 'import' && prev !== 'import/null' && !(parts.length > 1 && parts[1]) && !rx.imp.busy) resetImport();
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
      ctx.commitFavs(F.saveRecipe(favs, { id: r.id, title: r.title, image: r.image, source: r.imported ? 'import' : 'wegmans' }));
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
        withTag(photo(r.image), r),
        h('span', { class: 'bd' },
          h('span', { class: 'ttl', text: r.title }),
          small ? null : h('span', { class: 'rx-meta' }, t ? h('span', { class: 'm' }, icon('i-clock', 'icon icon-14'), t) : null, ratingSlot(r)),
          small ? null : costSlot(costOf(r)))),
      rxStar(r));
  }

  /** "Imported" pill on the photo of a recipe the user imported (spec §3.3). */
  function withTag(ph, r) {
    if (r.imported || r.source === 'import') ph.append(h('span', { class: 'rx-tag' }, icon('i-link', 'icon icon-14'), 'Imported'));
    return ph;
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
    const choices = [];
    if (rx.status === 'ready' || rx.user.length) {
      const near = nearCount();
      choices.push(h('a', { class: 'rx-choice', href: '#recipes/cook' },
        h('span', { class: 'ico', 'aria-hidden': 'true' }, icon('i-list', 'icon')),
        h('span', { class: 'txt' }, h('span', { class: 'ttl', text: 'Cook from my list' }),
          h('span', { class: 'd', text: 'Recipes that use what\'s already on your list' }),
          near ? h('span', { class: 'rx-pill mt-1', text: `${fmt(near)} ${near === 1 ? 'is' : 'are'} 1–2 items away` }) : null),
        h('span', { class: 'go' }, icon('i-chev-r', 'icon'))));
    }
    if (rx.status === 'ready' || rx.status === 'locked') {
      choices.push(
        h('a', { class: 'rx-choice photo', href: '#recipes/browse' },
          h('span', { class: 'strip', 'aria-hidden': 'true' }, ...[0, 1, 2].map((i) => (pics[i] ? photo(pics[i].image, { eager: true }) : h('span', { class: 'ph' })))),
          h('span', { class: 'txt' }, h('span', { class: 'ttl', text: 'Browse recipes' }),
            h('span', { class: 'd', text: `${fmt(count())} Wegmans recipes in ${nCats()} categories` })),
          h('span', { class: 'go' }, icon('i-chev-r', 'icon'))));
    }
    if (choices.length) kids.push(h('div', { class: 'rx-choices' }, ...choices));
    if (saved.length) {
      kids.push(h('div', { class: 'rx-sec-h' }, h('h2', { text: 'Saved recipes' }), h('a', { class: 'rx-link', href: '#favorites', onclick: () => ctx.openFavRecipes(), text: `See all ${saved.length} ›` })));
      kids.push(h('ul', { class: 'rx-scroller', 'aria-label': 'Saved recipes' }, ...saved.slice(0, 12).map((s) => card(rx.byId.get(s.id) ?? { ...s, ing: [], time: null }, { small: true }))));
    }
    if (rx.user.length) {
      const mine = [...rx.user].sort((a, b) => (rowOf(b.id)?.importedAt ?? '').localeCompare(rowOf(a.id)?.importedAt ?? ''));
      kids.push(h('div', { class: 'rx-sec-h' }, h('h2', { text: 'My recipes' }), h('span', { class: 'faint', text: `${mine.length} imported` })));
      kids.push(h('ul', { class: 'rx-scroller', 'aria-label': 'My recipes' }, ...mine.slice(0, 24).map((r) => card(r, { small: true }))));
    }
    kids.push(h('a', { class: 'rx-import-row', href: '#recipes/import' },
      h('span', { class: 'ico', 'aria-hidden': 'true' }, icon('i-link', 'icon icon-20')),
      h('span', { class: 't' }, 'Import a recipe', h('small', { text: 'From a recipe site, or paste the recipe' })),
      icon('i-chev-r', 'icon icon-20')));
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


  // ----- v0.2.6: Cook from my list -----
  /** Coverage of a recipe by the current list (memoized per list: each distinct ingredient is checked once). */
  function covOf(r) {
    const items = ctx.getState().items;
    const sig = items.map((i) => i.name).join('\u0001');
    if (rx.cov.sig !== sig) rx.cov = { sig, lidx: R.listIndex(items), memo: new Map(), byId: new Map() };
    let c = rx.cov.byId.get(r.id);
    if (!c) { c = R.coverageDetail(r, rx.cov.lidx, rx.cov.memo); rx.cov.byId.set(r.id, c); }
    return c;
  }
  const cookable = () => allRecipes().filter((r) => R.usesList(covOf(r)));
  /** Landing pill: recipes that use the list and are only 1-2 items short. */
  function nearCount() {
    if (ctx.getState().items.length < 3) return 0;
    let n = 0;
    for (const r of allRecipes()) { const c = covOf(r); if (R.usesList(c) && c.missing.length >= 1 && c.missing.length <= 2) n += 1; }
    return n;
  }
  function cookRow(r) {
    const c = covOf(r);
    const pct = c.total ? Math.round(c.share * 100) : 0;
    const bar = h('span', { class: 'bar', role: 'img', 'aria-label': `${pct}% of the ingredients` }, h('i'));
    bar.firstChild.style.width = `${pct}%`;
    const t = R.timeText(r.time);
    const miss = c.missing.length;
    return h('li', {},
      h('a', { class: 'rx-row', href: `#recipes/r/${encodeURIComponent(r.id)}` },
        h('span', { class: 'th' }, withTag(photo(r.image), r)),
        h('span', { class: 'bd' },
          h('span', { class: 'ttl', text: r.title }),
          h('span', { class: 'cov' }, h('span', { class: 'lbl', text: `${c.have} of ${c.total} on your list` }), bar),
          miss ? h('span', { class: `miss${miss === 1 ? ' ok' : ''}` }, h('b', { text: `Missing ${miss}:` }), ` ${R.missingNames(c.missing)}`) : h('span', { class: 'miss ok' }, h('b', { text: 'Everything\'s on your list' })),
          h('span', { class: 'rx-meta' }, t ? h('span', { class: 'm' }, icon('i-clock', 'icon icon-14'), t) : null, ratingSlot(r), costSlot(buyCostOf(r))))));
  }
  function cook() {
    const items = ctx.getState().items;
    const kids = [h('div', { class: 'rx-top' }, back('#recipes'), h('div', { class: 't' }, h('h1', { tabindex: '-1', text: 'Cook from my list' }),
      h('div', { class: 's', text: `Using the ${fmt(items.length)} item${items.length === 1 ? '' : 's'} on your list` })))];
    const sb = rx.status === 'ready' ? null : stateBox();
    if (sb && !rx.user.length) { kids.push(sb); return kids; }
    if (sb) kids.push(sb);
    if (items.length < 3) {
      kids.push(h('div', { class: 'empty rx-state' }, h('p', { text: 'Add a few items to your list and we\'ll find recipes that use them.' }),
        h('a', { class: 'btn btn-secondary mt-2', href: '#recipes/browse', text: 'Browse recipes' })));
      return kids;
    }
    const t0 = performance.now();
    const list = cookable();
    const ps = pricesState();
    const sort = { ...rx.cookSort };
    if (sort.by === 'price' && ps !== 'ready') sort.by = 'coverage';
    const sorted = R.sortCook(list, sort, { covOf, costOf: (r) => (covOf(r).missing.length ? buyCostOf(r) : { low: 0, high: 0 }) });
    rx.perf.cookRank = performance.now() - t0;
    const shownSort = sort.by === 'rating' && !list.some(R.hasRating) ? { ...sort, by: 'coverage' } : sort;
    kids.push(h('div', { class: 'rx-toolbar' },
      h('span', { class: 'cnt', role: 'status', 'aria-live': 'polite', text: `${fmt(list.length)} recipe${list.length === 1 ? ' uses' : 's use'} your list${ps === 'pricing' ? ' · pricing…' : ''}` }),
      list.length ? sortControl(shownSort, list.some(R.hasRating), ps === 'ready') : null));
    if (!list.length) {
      kids.push(h('div', { class: 'empty' }, h('p', { text: 'No recipe uses 3 or more of your items yet. Add a few more, or browse.' }), h('a', { class: 'btn btn-secondary mt-2', href: '#recipes/browse', text: 'Browse recipes' })));
      return kids;
    }
    kids.push(h('ul', { class: 'rx-rows', 'aria-label': 'Recipes that use your list' }, ...sorted.slice(0, rx.cookShown).map(cookRow)));
    if (sorted.length > rx.cookShown) {
      const left = sorted.length - rx.cookShown;
      kids.push(h('button', { type: 'button', class: 'btn btn-secondary btn-block show-more', onclick: () => { rx.cookShown += PAGE; render({ keepScroll: true }); root.querySelectorAll('.rx-rows .rx-row')[rx.cookShown - PAGE]?.focus({ preventScroll: true }); }, text: `Show more (${fmt(left)} more)` }));
    }
    kids.push(h('p', { class: 'faint rx-foot', text: `Pantry basics (salt, pepper, water) don't count. ${ps === 'ready' ? `Costs are whole packs at ${priceCtx()?.st?.label ?? 'your store'} for ${rx.servings} serving${rx.servings === 1 ? '' : 's'}, for just what's missing.` : ''}`.trim() }));
    return kids;
  }

  // ----- v0.2.6: Import (paste, bookmarklet / Shortcut hand-off) -----
  const rowOf = (id) => rx.userRows.find((r) => r.id === id);
  function resetImport() { rx.imp = { draft: null, error: '', note: '', busy: false, fromLink: false, editing: '', more: false, link: '', text: '' }; }
  async function readPayload(payload, fromLink) {
    resetImport();
    rx.imp.busy = true; rx.imp.fromLink = fromLink;
    try { rx.imp.draft = await Imp.decodePayload(payload); rx.imp.came = 'link'; } catch (e) { rx.imp.error = e instanceof Imp.ImportError ? e.message : 'Couldn\'t read that recipe. Paste the text instead.'; }
    rx.imp.busy = false;
    if (rx.view === 'import') { render(); focusImport(); }
  }
  function focusImport() {
    const t = rx.imp.draft ? root.querySelector('#rx-imp-ok') : rx.imp.error ? root.querySelector('#rx-imp-text') : null;
    (t ?? root.querySelector('h1'))?.focus({ preventScroll: !rx.imp.draft });
  }
  function importView() {
    const kids = [h('div', { class: 'rx-top' }, back('#recipes'), h('div', { class: 't' }, h('h1', { tabindex: '-1', text: 'Import a recipe' })))];
    if (rx.imp.busy) { kids.push(h('p', { class: 'muted rx-state', role: 'status', text: 'Reading the recipe…' })); return kids; }
    if (rx.imp.draft) return kids.concat(previewView());
    kids.push(h('section', { class: 'imp-card', 'aria-labelledby': 'rx-imp-share-h' },
      h('h2', { id: 'rx-imp-share-h' }, icon('i-share', 'icon icon-20'), 'From any recipe site'),
      h('ol', { class: 'imp-steps' }, h('li', { text: 'Open the recipe in Safari' }), h('li', { text: 'Tap the Happy Wife bookmark, or Share › Happy Wife Import' }), h('li', { text: 'Check it and tap Save' })),
      h('p', { class: 'imp-note' }, 'Set it up once from ⋮ › About. The recipe goes straight from the page to this app; nothing is sent anywhere. ',
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: (e) => ctx.openAbout(e.currentTarget), text: 'How to set it up' }))));
    const status = h('p', { class: 'status', id: 'rx-imp-status', role: 'status', 'aria-live': 'polite' });
    if (rx.imp.error) { status.textContent = rx.imp.error; status.dataset.kind = 'error'; }
    else if (rx.imp.note) status.textContent = rx.imp.note;
    const link = h('input', { class: 'input', id: 'rx-imp-link', type: 'url', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', maxlength: String(Imp.MAX_FRAGMENT + 200), placeholder: 'https://…', value: rx.imp.link });
    link.addEventListener('input', () => { rx.imp.link = link.value; });
    const paste = navigator.clipboard?.readText ? h('button', { type: 'button', class: 'btn btn-secondary btn-sm', onclick: async () => { try { link.value = (await navigator.clipboard.readText()).slice(0, Imp.MAX_FRAGMENT + 200); rx.imp.link = link.value; link.focus(); } catch { link.focus(); } }, text: 'Paste' }) : null;
    const linkForm = h('form', { class: 'imp-field', novalidate: true, onsubmit: (e) => { e.preventDefault(); importLink(link.value); } },
      h('label', { class: 'label', for: 'rx-imp-link', text: 'Paste a link' }),
      h('div', { class: 'imp-row' }, link, paste),
      h('button', { type: 'submit', class: 'btn btn-primary btn-block mt-2', id: 'rx-imp-link-btn', text: 'Import from link' }));
    const ta = h('textarea', { class: 'input imp-text', id: 'rx-imp-text', rows: '6', maxlength: String(Imp.CAPS.text), placeholder: 'Paste the title, ingredients and steps', 'aria-describedby': 'rx-imp-status' });
    ta.value = rx.imp.text;
    ta.addEventListener('input', () => { rx.imp.text = ta.value; });
    const textForm = h('form', { class: 'imp-field', novalidate: true, onsubmit: (e) => { e.preventDefault(); importText(ta.value); } },
      h('label', { class: 'label', for: 'rx-imp-text', text: 'Paste the recipe text' }), ta,
      h('button', { type: 'submit', class: 'btn btn-secondary btn-block mt-2', id: 'rx-imp-text-btn', text: 'Read pasted text' }));
    kids.push(linkForm, h('p', { class: 'imp-or', text: 'or' }), textForm, status);
    return kids;
  }
  function importLink(value) {
    const v = String(value ?? '').trim();
    rx.imp.error = ''; rx.imp.note = '';
    const payload = Imp.payloadFromLink(v);
    if (payload) { rx.imp.link = ''; readPayload(payload, false); render(); return; }
    if (Imp.cleanUrl(v)) {
      // No proxy and no fetch: the app can't read another site. Keep the link as the source for pasted text.
      rx.imp.note = `This app doesn't open other websites, so nothing leaves your phone. On that page, tap the Happy Wife bookmark (or Share › Happy Wife Import). Or copy the recipe's text and paste it below; we'll keep ${Imp.sourceDomain(v)} as the source.`;
      render(); root.querySelector('#rx-imp-text')?.focus();
      return;
    }
    rx.imp.error = v ? 'That isn\'t a web link. Paste a link that starts with https://, or paste the recipe text below.' : 'Paste a link first.';
    render(); root.querySelector('#rx-imp-link')?.focus();
  }
  function importText(text) {
    rx.imp.error = ''; rx.imp.note = '';
    const payload = Imp.payloadFromLink(text);
    if (payload) { readPayload(payload, false); render(); return; }
    let d = null;
    try { d = Imp.parseRecipeText(text, Imp.cleanUrl(rx.imp.link.trim())); } catch { d = null; }
    if (!d || !d.lines.length) {
      rx.imp.error = String(text ?? '').trim() ? 'Couldn\'t find ingredients in that text. Put each ingredient on its own line, under an "Ingredients" heading.' : 'Paste the recipe text first.';
      render(); root.querySelector('#rx-imp-text')?.focus();
      return;
    }
    rx.imp.draft = d; rx.imp.came = 'paste';
    render(); focusImport();
  }
  function previewView() {
    const d = rx.imp.draft;
    const pv = Imp.previewOf(d);
    const kids = [];
    kids.push(h('p', { class: 'imp-ok', id: 'rx-imp-ok', role: 'status', tabindex: '-1' }, icon('i-check', 'icon icon-18'), `Found ${pv.ings.length} ingredient${pv.ings.length === 1 ? '' : 's'} and ${d.steps.length} step${d.steps.length === 1 ? '' : 's'}`));
    const dom = Imp.sourceDomain(d.url);
    const title = h('input', { class: 'input', id: 'rx-imp-title', maxlength: String(Imp.CAPS.title), value: d.title, autocomplete: 'off' });
    title.addEventListener('input', () => { d.title = title.value.slice(0, Imp.CAPS.title); });
    const serv = h('input', { class: 'input', id: 'rx-imp-serv', type: 'number', inputmode: 'numeric', min: '1', max: '100', value: d.servings ?? '', placeholder: String(rx.servings) });
    serv.addEventListener('input', () => { const n = Number(serv.value); d.servings = Number.isInteger(n) && n >= 1 && n <= 100 ? n : null; });
    const tm = R.recipeTime({ times: d.times });
    const time = h('input', { class: 'input', id: 'rx-imp-time', type: 'number', inputmode: 'numeric', min: '0', max: '6000', value: tm ?? '', placeholder: 'min' });
    time.addEventListener('input', () => { const n = Number(time.value); d.times = { prep: null, cook: null, total: time.value !== '' && Number.isInteger(n) && n >= 0 && n < 100000 ? n : null }; });
    const top = h('div', { class: 'top' }, photo(d.image, { eager: true }),
      h('div', {}, h('label', { class: 'sr-only', for: 'rx-imp-title', text: 'Recipe name' }), title,
        dom ? h('p', { class: 'src' }, icon('i-link', 'icon icon-14'), dom) : h('p', { class: 'src', text: 'Pasted text' })));
    const fields = h('div', { class: 'prev-fields' },
      h('label', { class: 'f', for: 'rx-imp-serv' }, 'Serves', serv), h('label', { class: 'f', for: 'rx-imp-time' }, 'Time (min)', time));
    const editBtn = (which, label) => h('button', { type: 'button', class: 'rx-link', id: `rx-imp-${which}-btn`, 'aria-expanded': String(rx.imp.editing === which), onclick: () => toggleEdit(which), text: rx.imp.editing === which ? 'Done' : label });
    let ingBody;
    if (rx.imp.editing === 'ing') {
      const ta = h('textarea', { class: 'input imp-text', id: 'rx-imp-edit-ing', rows: String(Math.min(14, d.lines.length + 2)), 'aria-label': 'Ingredients, one per line', maxlength: String(Imp.CAPS.lines * Imp.CAPS.line) });
      ta.value = d.lines.join('\n');
      ta.addEventListener('input', () => { d.lines = Imp.sanitizeDraft({ lines: ta.value.split('\n') }).lines; });
      ingBody = [h('p', { class: 'faint', text: 'One ingredient per line, amount first.' }), ta];
    } else {
      const max = rx.imp.more ? pv.ings.length : 8;
      ingBody = [h('ul', { class: 'pi-list' }, ...pv.ings.slice(0, max).map((ing) => {
        const amt = R.amountText(ing);
        const nm = [ing.base, ing.prep].filter(Boolean).join(', ');
        if (ing.qty == null && !/\bto taste\b/i.test(ing.text)) return h('li', { class: 'pi warn' }, h('span', { class: 'q' }, icon('i-info', 'icon icon-16')), h('span', {}, ing.text, h('small', { text: 'No amount found. It\'s added as written.' })));
        return h('li', { class: 'pi' }, h('span', { class: 'q', text: amt }), h('span', { text: amt ? nm : ing.text }));
      }))];
      if (pv.ings.length > max) ingBody.push(h('button', { type: 'button', class: 'rx-link', onclick: () => { rx.imp.more = true; render({ keepScroll: true }); }, text: `+ ${pv.ings.length - max} more` }));
    }
    let stepBody = [];
    if (rx.imp.editing === 'steps') {
      const ta = h('textarea', { class: 'input imp-text', id: 'rx-imp-edit-steps', rows: '8', 'aria-label': 'Steps, one per line', maxlength: String(Imp.CAPS.stepsTotal) });
      ta.value = d.steps.join('\n');
      ta.addEventListener('input', () => { d.steps = Imp.sanitizeDraft({ steps: ta.value.split('\n') }).steps; });
      stepBody = [ta];
    } else if (d.steps.length) stepBody = [h('p', { class: 'faint', text: `${d.steps[0].length > 120 ? `${d.steps[0].slice(0, 117)}…` : d.steps[0]}${d.steps.length > 1 ? ` (+ ${d.steps.length - 1} more)` : ''}` })];
    kids.push(h('div', { class: 'prev' }, top, h('div', { class: 'sec' }, fields),
      h('section', { class: 'sec', 'aria-labelledby': 'rx-imp-ing-h' }, h('h3', {}, h('span', { id: 'rx-imp-ing-h', text: `Ingredients · ${pv.ings.length}` }), editBtn('ing', 'Edit')), ...ingBody),
      h('section', { class: 'sec', 'aria-labelledby': 'rx-imp-steps-h' }, h('h3', {}, h('span', { id: 'rx-imp-steps-h', text: `Steps · ${d.steps.length}` }), editBtn('steps', d.steps.length ? 'Edit' : 'Add')), ...stepBody)));
    const status = h('p', { class: 'status', id: 'rx-imp-status', role: 'status', 'aria-live': 'polite' });
    if (rx.imp.error) { status.textContent = rx.imp.error; status.dataset.kind = 'error'; }
    kids.push(h('div', { class: 'imp-actions' },
      h('button', { type: 'button', class: 'btn btn-secondary', id: 'rx-imp-cancel', onclick: () => { resetImport(); render(); root.querySelector('h1')?.focus(); }, text: 'Cancel' }),
      h('button', { type: 'button', class: 'btn btn-primary', id: 'rx-imp-save', onclick: saveImport }, icon('i-star-fill', 'icon icon-20'), 'Save recipe')),
    h('p', { class: 'faint imp-foot', text: 'Saves to Favorites › Recipes and My recipes, on this device and in your backup.' }), status);
    if (!isStandalone() && rx.imp.came === 'link') {
      kids.push(h('div', { class: 'imp-card imp-handoff' }, h('p', { text: 'Using the home-screen app? It keeps its own recipes. Copy this recipe, open the app, then Recipes › Import a recipe › Paste a link.' }),
        h('button', { type: 'button', class: 'btn btn-secondary btn-sm', id: 'rx-imp-copy', onclick: copyHandoff }, icon('i-copy', 'icon icon-18'), 'Copy for the home-screen app')));
    }
    return kids;
  }
  function toggleEdit(which) {
    rx.imp.editing = rx.imp.editing === which ? '' : which;
    render({ keepScroll: true });
    root.querySelector(rx.imp.editing ? `#rx-imp-edit-${which}` : `#rx-imp-${which}-btn`)?.focus({ preventScroll: true });
  }
  async function copyHandoff() {
    const btn = root.querySelector('#rx-imp-copy');
    try {
      const link = `${LIVE_URL}#${Imp.FRAGMENT_PREFIX}${await Imp.encodePayload(rx.imp.draft)}`;
      await navigator.clipboard.writeText(link);
      ctx.toast('Copied. Paste it in Import in the home-screen app.');
    } catch { ctx.toast('Couldn\'t copy. Save it here, or paste the recipe text in the home-screen app.'); }
    btn?.focus();
  }
  function saveImport() {
    const d = rx.imp.draft;
    if (!d) return;
    if (rx.userRows.length >= Imp.CAPS.recipes) { rx.imp.error = `You have ${Imp.CAPS.recipes} imported recipes, the most this app keeps. Delete one first.`; render({ keepScroll: true }); return; }
    let row;
    try { row = Imp.makeUserRecipe(d); } catch { rx.imp.error = 'There are no ingredients to save. Tap Edit to add some.'; render({ keepScroll: true }); return; }
    const rows = [row, ...rx.userRows];
    if (!Imp.saveUserRecipes(rows)) { rx.imp.error = 'Couldn\'t save: this device\'s storage is full. Back up, then delete something you don\'t need.'; render({ keepScroll: true }); return; }
    loadUser();
    try { ctx.commitFavs(F.saveRecipe(ctx.getFavs(), { id: row.id, title: row.title, image: row.image || null, source: 'import' })); } catch { /* still in My recipes */ }
    resetImport();
    ctx.toast(`Saved ${row.title} to Favorites › Recipes`);
    location.hash = `#recipes/r/${encodeURIComponent(row.id)}`;
  }
  function deleteImported(r) {
    const row = rowOf(r.id);
    if (!row) return;
    const favs = ctx.getFavs();
    const favRow = (favs.recipes ?? []).find((x) => x.id === r.id);
    if (!Imp.saveUserRecipes(rx.userRows.filter((x) => x.id !== r.id))) { ctx.toast('Couldn\'t delete it. Try again.'); return; }
    loadUser();
    if (favRow) ctx.commitFavs(F.unsaveRecipe(favs, r.id));
    location.hash = '#recipes';
    ctx.toast(`Deleted ${r.title}`, () => {
      if (!rowOf(row.id)) { Imp.saveUserRecipes([row, ...rx.userRows]); loadUser(); }
      const f = ctx.getFavs(); if (favRow && !F.isRecipeSaved(f, row.id)) ctx.commitFavs({ ...f, recipes: [favRow, ...f.recipes] });
      render({ keepScroll: true });
    }, 8000);
  }

  // ----- sort (mirrors the v0.1.5 List sort: chip + menu on phones, segmented control on desktop) -----
  const sortMenu = document.getElementById('rx-sort-menu');
  function spoken(s) { return s.by === 'price' ? `Price, ${s.dir === 'desc' ? 'high to low' : 'low to high'}` : R.COOK_SORT_LABEL[s.by]; }
  /** v0.2.6: the same chip + menu (phones) and segmented control (desktop) serve Browse and Cook; each keeps its own sort. */
  const curSort = () => (rx.view === 'cook' ? rx.cookSort : rx.sort);
  function setSort(next) {
    if (rx.view === 'cook') { rx.cookSort = R.cleanCookSort(next); saveCookSort(rx.cookSort); rx.cookShown = PAGE; render({ keepScroll: true }); return; }
    rx.sort = R.cleanRxSort(next); saveRxSort(rx.sort); renderResults();
  }
  function sortControl(sort, hasRatings, pricesOn) {
    const opts = (rx.view === 'cook' ? R.COOK_SORTS : R.RX_SORTS).filter((k) => (k !== 'rating' || hasRatings) && (k !== 'price' || pricesOn));
    const btn = h('button', { type: 'button', class: 'sort-btn mob-only', id: 'rx-sort-btn', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': 'rx-sort-menu', 'aria-label': `Sort recipes: ${spoken(sort)}` },
      icon('i-sort', 'icon icon-18 ico'), h('span', {}, h('span', { class: 'k', text: 'Sort:' }), ` ${R.COOK_SORT_LABEL[sort.by]}${sort.by === 'price' ? (sort.dir === 'desc' ? ' ↓' : ' ↑') : ''}`), icon('i-chev'));
    btn.addEventListener('click', (e) => { e.stopPropagation(); if (sortMenu.hidden) openSortMenu(btn, sort, opts); else closeSortMenu(true); });
    const seg = h('div', { class: 'sort-seg desk-only', role: 'radiogroup', 'aria-label': 'Sort recipes' },
      ...opts.map((k) => h('button', { type: 'button', role: 'radio', 'aria-checked': String(sort.by === k), tabindex: sort.by === k ? '0' : '-1', onclick: () => { if (k === 'price' && sort.by === 'price') setSort({ by: 'price', dir: sort.dir === 'desc' ? 'asc' : 'desc' }); else setSort({ by: k, dir: curSort().dir }); root.querySelector('.sort-seg [aria-checked="true"]')?.focus(); } }, k === 'rating' ? '★ Rating' : R.COOK_SORT_LABEL[k])));
    seg.addEventListener('keydown', (e) => {
      if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
      e.preventDefault();
      const i = opts.indexOf(sort.by); const k = opts[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length];
      setSort({ by: k, dir: curSort().dir }); root.querySelector('.sort-seg [aria-checked="true"]')?.focus();
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
    if (d) { setSort({ by: 'price', dir: d.dataset.rxDir }); openSortMenu(root.querySelector('#rx-sort-btn'), curSort(), [...sortMenu.querySelectorAll('[data-rx-sort]:not([hidden])')].map((x) => x.dataset.rxSort)); sortMenu.querySelector(`[data-rx-dir="${curSort().dir}"]`)?.focus(); return; }
    const mi = e.target.closest('[data-rx-sort]');
    if (!mi) return;
    const opts = [...sortMenu.querySelectorAll('[data-rx-sort]:not([hidden])')].map((x) => x.dataset.rxSort);
    setSort({ by: mi.dataset.rxSort, dir: curSort().dir });
    if (mi.dataset.rxSort === 'price') { openSortMenu(root.querySelector('#rx-sort-btn'), curSort(), opts); sortMenu.querySelector(`[data-rx-dir="${curSort().dir}"]`)?.focus(); return; }
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
    const crumb = r.imported ? h('a', { class: 'crumb desk-only', href: '#recipes' }, icon('i-back', 'icon icon-16'), 'My recipes')
      : h('a', { class: 'crumb desk-only', href: '#recipes/browse', onclick: () => { rx.browse.cat = r.cat; rx.browse.shown = PAGE; } }, icon('i-back', 'icon icon-16'), R.categoryLabel(r.cat));
    const hero = h('div', { class: 'rx-hero' }, withTag(photo(r.image, { eager: true }), r), h('span', { class: 'mob-only' }, back(r.imported ? '#recipes' : '#recipes/browse')), rxStar(r));
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
    const source = r.imported
      ? h('div', { class: 'faint rx-foot rx-imp-foot' }, r.url ? h('span', {}, 'Imported from ', h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', text: Imp.sourceDomain(r.url) || 'the recipe page' }), '. ') : 'Imported by you. ',
        'Prices are a saved snapshot, not checkout prices. ', h('button', { type: 'button', class: 'btn btn-ghost btn-sm', id: 'rx-imp-delete', onclick: () => deleteImported(r) }, icon('i-trash', 'icon icon-18'), 'Delete recipe'))
      : r.url ? h('p', { class: 'faint rx-foot' }, 'Recipe from ', h('a', { href: r.url, target: '_blank', rel: 'noopener noreferrer', text: 'wegmans.com' }), '. Prices are a saved snapshot, not checkout prices.') : null;
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
    renderKeep(AFTER_ADD);
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
    if (rx.view === 'detail') renderKeep(AFTER_UNDO);
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
    else if (rx.view === 'cook') root.replaceChildren(...cook());
    else if (rx.view === 'import') root.replaceChildren(...importView());
    else root.replaceChildren(...landing());
    if (rx.view !== 'detail') { side?.replaceChildren(); if (sheet.open) sheet.close(); }
    if (keepScroll) window.scrollTo(0, y);
    renderFavGrid();
  }
  // L48: after Add / Undo, focus goes to the first of these that is actually shown: the phone CTA
  // (hidden at desktop widths), the side panel's Undo, its Add button, the toast's Undo, the title.
  const AFTER_ADD = ['.rx-cta .btn', '#rx-side .rx-added button', '#rx-side #rx-side-add', '#toast-undo', '.rx-title'];
  const AFTER_UNDO = ['.rx-cta .btn', '#rx-side #rx-side-add', '#rx-side .rx-added button', '.rx-title'];
  const shown = (e) => Boolean(e && e.getClientRects().length && getComputedStyle(e).visibility !== 'hidden' && !e.closest('[hidden]'));
  function focusFirst(sels) {
    for (const q of sels) {
      const e = root.querySelector(q) ?? document.querySelector(q);
      if (shown(e) && !e.disabled) { e.focus({ preventScroll: true }); if (document.activeElement === e) return e; }
    }
    return null;
  }
  function renderKeep(sel) {
    const y = window.scrollY;
    const had = document.activeElement;
    const inside = had && had !== document.body && (root.contains(had) || side?.contains(had));
    render();
    window.scrollTo(0, y);
    if (Array.isArray(sel)) focusFirst(sel);
    else if (sel) root.querySelector(sel)?.focus({ preventScroll: true });
    else if (inside && !had.isConnected) focusFirst(AFTER_UNDO);   // the focused button was re-rendered away (6 s Undo timeout)
  }
  function renderFavGrid() {
    const grid = document.getElementById('fav-rx-grid');
    if (!grid) return;
    const saved = F.savedRecipes(ctx.getFavs());
    grid.replaceChildren(...saved.map((s) => card(rx.byId.get(s.id) ?? { ...s, ing: [], time: null })));
    document.getElementById('fav-rx-empty').hidden = saved.length > 0;
  }

  loadUser();
  load();
  return {
    show, render: () => render({ keepScroll: true }), syncStars: () => { syncStars(); renderFavGrid(); }, retryCache: tryCache,
    setServings(n) { rx.servings = Math.max(1, Math.min(MAX_SERV, n)); saveHousehold(rx.servings); rx.costMemo.clear(); rx.detailServ = rx.servings; render({ keepScroll: true }); },
    /** v0.2.4: re-read the device prefs a full restore may have written (household, swaps, match store). */
    reloadPrefs() { rx.servings = loadHousehold(); rx.detailServ = rx.servings; rx.swaps = loadSwaps(); rx.matchStore = loadRxStore(); rx.swapVer = (rx.swapVer ?? 0) + 1; rx.costMemo.clear(); render({ keepScroll: true }); },
    servings: () => rx.servings, perf: rx.perf, savedCount: () => (ctx.getFavs().recipes ?? []).length,
    /** v0.2.6: re-read imported recipes after a backup restore (or its Undo). */
    reloadUser() { loadUser(); rx.cands.clear(); render({ keepScroll: true }); },
    userCount: () => rx.userRows.length,
  };
}
