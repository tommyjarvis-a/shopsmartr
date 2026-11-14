// Wiring: loads data, owns state, routes between screens and connects events to the pure modules.
import { VERSION } from './version.js';
import { lookupZip, storesNear, normalizeZip } from './geo.js';
import { validateStoresDoc, indexById, CHAINS } from './stores.js';
import * as L from './list.js';
import { loadStateWithStatus, saveState } from './storage.js';
import { toCSV, toText, favoritesToCSV } from './export.js';
import * as F from './favorites.js';
import { NOTES } from './notes.js';
import { nextNote } from './lovenotes.js';
import * as Prices from './prices.js';
import * as UI from './ui.js';

const el = (id) => document.getElementById(id);
const SCREENS = ['list', 'favorites', 'stores', 'ads'];
const loaded = loadStateWithStatus();
let state = loaded.state;
let favs = F.loadFavorites();
let favTab = 'items';
let saveWarned = loaded.problem === 'unavailable';
let data = { stores: [], chains: {}, byId: {}, zips: {}, asOf: '' };
let nearby = [];
let listFilter = '';   // '' = all stores
let chainFilter = '';  // '' = all chains (stores screen)

function commit(next) {
  state = next;
  if (!saveState(state) && !saveWarned) {
    saveWarned = true;
    showNotice('This browser isn\'t letting ShopSmartR save, so your list will be lost when you close this page. Export it to keep a copy.');
  }
  const focus = focusKey();
  renderAll();
  restoreFocus(focus);
}

function showNotice(text) {
  el('notice-text').textContent = text;
  el('notice').hidden = false;
}

// Re-rendering replaces rows, so remember which row control had focus and put it back (L4).
const FOCUS_HOOKS = ['data-check', 'data-edit', 'data-remove', 'data-pick'];
function focusKey() {
  const a = document.activeElement;
  const row = a?.closest?.('[data-item-id], [data-store-id]');
  if (!row || !row.closest('#list-groups, #store-results')) return null;
  const hook = FOCUS_HOOKS.find((h) => a.hasAttribute(h));
  if (!hook) return null;
  const rows = [...document.querySelectorAll(row.dataset.itemId ? '#list-groups [data-item-id]' : '#store-results [data-store-id]')];
  return { item: row.dataset.itemId, store: row.dataset.storeId, hook, index: rows.indexOf(row) };
}
function restoreFocus(k) {
  if (!k) return;
  const sel = k.item ? `#list-groups [data-item-id="${CSS.escape(k.item)}"]` : `#store-results [data-store-id="${CSS.escape(k.store)}"]`;
  let target = document.querySelector(`${sel} [${k.hook}]`);
  if (!target && k.item) {
    // The row is gone (removed): focus the row that took its place, else the list heading.
    const rows = [...document.querySelectorAll('#list-groups [data-item-id]')];
    const next = rows[Math.min(k.index, rows.length - 1)];
    target = next ? next.querySelector('[data-check]') : el('list-title');
  }
  target?.focus({ preventScroll: true });
}

/** Stores offered on the list: the user's picks plus any store an item still points at. */
function listStores() {
  const ids = new Set([...state.selectedStoreIds, ...state.items.map((i) => i.storeId).filter(Boolean)]);
  return [...ids].map((id) => data.byId[id]).filter(Boolean);
}

function origin() {
  return lookupZip(state.zip, data.zips);
}

function withDistance(stores) {
  const o = origin();
  return stores.map((s) => ({ ...s, distanceMi: o ? storesNear([s], o, Infinity)[0].distanceMi : NaN }));
}

function renderAll() {
  renderStoresScreen();
  renderListScreen();
  renderAds();
  renderFavs();
}

// ---------- Favorites ----------
function commitFavs(next, focus) {
  favs = next;
  F.saveFavorites(favs);
  renderFavs();
  if (focus) document.querySelector(focus)?.focus({ preventScroll: true });
}

function setFavTab(tab, focus = false) {
  favTab = tab;
  for (const b of document.querySelectorAll('[data-fav-tab]')) {
    const on = b.dataset.favTab === tab;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
  }
  el('fav-items').hidden = tab !== 'items';
  el('fav-meals').hidden = tab !== 'meals';
}

function renderFavs() {
  const n = favs.items.length;
  const m = favs.meals.length;
  el('favs-meta').textContent = `${n} staple${n === 1 ? '' : 's'} · ${m} meal${m === 1 ? '' : 's'}`;
  UI.renderFavItems(el('fav-list'), favs.items, data.byId, {
    onEdit: (id) => openFavSheet(null, id),
    onAdd: (id) => addFavsToList(favs.items.filter((i) => i.id === id), favs.items.find((i) => i.id === id)?.name),
    onRemove: removeFavWithUndo,
  });
  el('fav-empty').hidden = n > 0;
  el('fav-add-all').hidden = n === 0;
  UI.renderMeals(el('meal-list'), favs.meals, data.byId, {
    onRename: openMealSheet,
    onAddMeal: (mealId) => { const meal = favs.meals.find((x) => x.id === mealId); if (meal) addFavsToList(meal.items, meal.name); },
    onEditItem: (mealId, id) => openFavSheet(mealId, id),
    onRemoveItem: (mealId, id) => commitFavs(F.removeMealItem(favs, mealId, id)),
    onAddItem: (mealId, text) => {
      const q = L.parseQuick(text);
      try {
        commitFavs(F.addMealItem(favs, mealId, { name: q.name, qty: q.qty, unit: q.unit }), `[data-meal-id="${CSS.escape(mealId)}"] [data-meal-item-form] input`);
        UI.setStatus(el('meal-status'), '');
      } catch (err) { UI.setStatus(el('meal-status'), err.message, 'error'); }
    },
  });
  el('meal-empty').hidden = m > 0;
}

function addFavsToList(items, what = '') {
  const res = F.addFavoritesToList(state, items);
  if (res.added) commit(res.state);
  UI.toast(F.addedMessage(res, items.length === 1 ? '' : what));
}

function removeFavWithUndo(id) {
  const idx = favs.items.findIndex((i) => i.id === id);
  if (idx < 0) return;
  const it = favs.items[idx];
  commitFavs(F.removeFavorite(favs, id));
  UI.toast(`Removed ${it.name} from favorites`, () => {
    if (favs.items.some((i) => i.id === id)) return;
    const items = [...favs.items];
    items.splice(Math.min(idx, items.length), 0, it);
    commitFavs({ ...favs, items });
  });
}

let favEditing = null; // { mealId, id }
function openFavSheet(mealId, id) {
  const src = mealId ? favs.meals.find((m) => m.id === mealId)?.items : favs.items;
  const it = src?.find((i) => i.id === id);
  if (!it) return;
  favEditing = { mealId, id };
  const form = el('fav-form');
  el('fav-sheet-title').textContent = mealId ? 'Edit meal item' : 'Edit favorite';
  form.elements.name.value = it.name;
  form.elements.qty.value = it.qty ?? '';
  form.elements.unit.value = L.UNITS.includes(it.unit) ? it.unit : '';
  form.elements.notes.value = it.notes ?? '';
  const stores = listStores();
  if (it.storeId && !stores.some((x) => x.id === it.storeId) && data.byId[it.storeId]) stores.push(data.byId[it.storeId]);
  UI.renderRadioChips(el('ff-stores'), 'storeId', [{ value: '', label: 'Any' }, ...stores.map((x) => ({ value: x.id, label: x.name, chain: x.chain }))], it.storeId, () => {});
  UI.setStatus(el('fav-sheet-status'), '');
  el('fav-sheet').showModal();
  form.elements.name.focus();
}

let mealEditing = null;
function openMealSheet(mealId) {
  const meal = favs.meals.find((m) => m.id === mealId);
  if (!meal) return;
  mealEditing = mealId;
  el('meal-form').elements.name.value = meal.name;
  UI.setStatus(el('meal-sheet-status'), '');
  el('meal-sheet').showModal();
  el('meal-form').elements.name.focus();
}

function deleteMealWithUndo(mealId) {
  const idx = favs.meals.findIndex((m) => m.id === mealId);
  if (idx < 0) return;
  const meal = favs.meals[idx];
  commitFavs(F.deleteMeal(favs, mealId));
  UI.toast(`Deleted ${meal.name}`, () => {
    if (favs.meals.some((m) => m.id === mealId)) return;
    const meals = [...favs.meals];
    meals.splice(Math.min(idx, meals.length), 0, meal);
    commitFavs({ ...favs, meals });
  });
}

function bindFavorites() {
  for (const b of document.querySelectorAll('[data-fav-tab]')) {
    b.addEventListener('click', () => setFavTab(b.dataset.favTab));
    b.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); setFavTab(favTab === 'items' ? 'meals' : 'items', true); }
    });
  }
  el('fav-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.currentTarget.elements.text;
    const q = L.parseQuick(input.value);
    try {
      commitFavs(F.addFavorite(favs, { name: q.name, qty: q.qty, unit: q.unit }));
      input.value = '';
      UI.setStatus(el('fav-status'), '');
      input.focus();
    } catch (err) { UI.setStatus(el('fav-status'), err.message, 'error'); }
  });
  el('fav-add-all').addEventListener('click', () => addFavsToList(favs.items, 'Favorites'));
  el('meal-add').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = e.currentTarget.elements.name;
    try {
      const next = F.createMeal(favs, input.value);
      const id = next.meals[next.meals.length - 1].id;
      input.value = '';
      UI.setStatus(el('meal-status'), '');
      commitFavs(next, `[data-meal-id="${CSS.escape(id)}"] [data-meal-item-form] input`);
    } catch (err) { UI.setStatus(el('meal-status'), err.message, 'error'); }
  });
  el('fav-form').addEventListener('submit', (e) => {
    if (e.submitter?.value === 'cancel') return;
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const patch = { name: f.get('name'), qty: f.get('qty'), unit: f.get('unit'), storeId: f.get('storeId') ?? '', notes: f.get('notes') };
    try {
      const { mealId, id } = favEditing;
      commitFavs(mealId ? F.updateMealItem(favs, mealId, id, patch) : F.updateFavorite(favs, id, patch));
      el('fav-sheet').close();
    } catch (err) { UI.setStatus(el('fav-sheet-status'), err.message, 'error'); }
  });
  el('meal-form').addEventListener('submit', (e) => {
    const v = e.submitter?.value;
    if (v === 'cancel') return;
    e.preventDefault();
    if (v === 'delete') { el('meal-sheet').close(); deleteMealWithUndo(mealEditing); return; }
    try {
      commitFavs(F.renameMeal(favs, mealEditing, e.currentTarget.elements.name.value));
      el('meal-sheet').close();
    } catch (err) { UI.setStatus(el('meal-sheet-status'), err.message, 'error'); }
  });
  for (const id of ['fav-sheet', 'meal-sheet']) {
    el(id).addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  }
  el('favs-export').addEventListener('click', downloadFavs);
}

function downloadFavs() {
  UI.download(`shopsmartr-favorites-${stamp()}.csv`, favoritesToCSV(favs, data.byId, { bom: true }), 'text/csv;charset=utf-8');
}

function renderStoresScreen() {
  const chainOpts = [{ value: '', label: 'All chains' }, ...CHAINS.filter((c) => data.chains[c]).map((c) => ({ value: c, label: data.chains[c].shortName || data.chains[c].name, chain: c }))];
  UI.renderRadioChips(el('chain-filter'), 'chain', chainOpts, chainFilter, (v) => { chainFilter = v; renderStoresScreen(); });
  const base = nearby.length ? nearby : withDistance(state.selectedStoreIds.map((id) => data.byId[id]).filter(Boolean));
  const shown = chainFilter ? base.filter((s) => s.chain === chainFilter) : base;
  UI.renderStores(el('store-results'), shown, state.selectedStoreIds, data.chains, onPickStore);
  const n = state.selectedStoreIds.length;
  el('picked-count').textContent = n ? `${n} selected` : '';
}

function renderListScreen() {
  const stores = listStores();
  UI.fillStoreSelects(stores);
  if (listFilter && !stores.some((s) => s.id === listFilter)) listFilter = '';
  const used = new Set(state.items.map((i) => i.storeId));
  const filterOpts = [{ value: '', label: 'All stores' }, ...stores.filter((s) => used.has(s.id)).map((s) => ({ value: s.id, label: s.name, chain: s.chain }))];
  if (used.has('') && filterOpts.length > 1) filterOpts.push({ value: '-', label: 'Any store' });
  el('list-filter').hidden = filterOpts.length <= 2;
  UI.renderRadioChips(el('list-filter'), 'list-filter', filterOpts, listFilter, (v) => { listFilter = v; renderListScreen(); });
  const items = listFilter === '-' ? state.items.filter((i) => !i.storeId)
    : listFilter ? state.items.filter((i) => i.storeId === listFilter) : state.items;
  UI.renderList(el('list-groups'), items, data.byId, {
    onToggle: (id, checked) => commit(L.toggleItem(state, id, checked)),
    onEdit: (id) => openSheet(id),
    onRemove: removeWithUndo,
    emptyText: state.items.length ? 'Nothing for this store.' : 'Your list is empty. Add your first item.',
  });
  const s = L.summary(state);
  const storeCount = new Set(state.items.map((i) => i.storeId).filter(Boolean)).size;
  el('list-meta').textContent = s.total ? `${s.total} item${s.total === 1 ? '' : 's'} · ${storeCount} store${storeCount === 1 ? '' : 's'}` : 'No items yet';
  UI.renderProgress(s.done, s.total);
  const mine = withDistance(state.selectedStoreIds.map((id) => data.byId[id]).filter(Boolean));
  UI.renderStaticChips(el('panel-stores'), mine);
  el('panel-where').textContent = state.zip ? `${state.zip} · within ${state.radiusMi} mi` : 'No zip code yet';
}

function renderAds() {
  const mine = withDistance(state.selectedStoreIds.map((id) => data.byId[id]).filter(Boolean));
  const rows = mine.length
    ? mine.map((s) => ({
      chain: s.chain, name: s.name, url: data.chains[s.chain].weeklyAd.url, label: data.chains[s.chain].weeklyAd.label,
      meta: [Number.isFinite(s.distanceMi) ? `${s.distanceMi.toFixed(1)} mi` : '', s.address].filter(Boolean).join(' · '),
    }))
    : CHAINS.filter((c) => data.chains[c]).map((c) => ({ chain: c, name: data.chains[c].name, url: data.chains[c].weeklyAd.url, label: data.chains[c].weeklyAd.label, meta: data.chains[c].weeklyAd.label }));
  UI.renderAdRows(rows);
}

function onPickStore(id, picked) {
  const ids = picked ? [...state.selectedStoreIds, id] : state.selectedStoreIds.filter((x) => x !== id);
  commit(L.setSelectedStores(state, ids));
}

function radiusValue() {
  return Number(document.querySelector('#radius input:checked')?.value ?? 10);
}

function runSearch({ quiet = false } = {}) {
  const status = el('find-status');
  const zip = normalizeZip(el('zip').value);
  const radiusMi = radiusValue();
  if (!zip) {
    if (quiet) return;
    nearby = [];
    UI.setStatus(status, 'Enter a 5-digit zip code.', 'error');
    commit({ ...state, zip: '' });
    return;
  }
  const o = lookupZip(zip, data.zips);
  if (!o) {
    nearby = [];
    UI.setStatus(status, `Zip ${zip} isn't in ShopSmartR's Western NY list yet.`, 'error');
  } else {
    nearby = storesNear(data.stores, o, radiusMi);
    const n = nearby.length;
    UI.setStatus(status, n ? `${n} store${n === 1 ? '' : 's'} within ${radiusMi} mi of ${zip}. Tick the ones you shop at.`
      : `No stores within ${radiusMi} mi of ${zip}. Try a larger distance.`, n ? '' : 'error');
  }
  commit({ ...state, zip, radiusMi });
}

// ---------- Add / edit sheet ----------
let editingId = null;
function openSheet(id = null) {
  const form = el('item-form');
  const it = id ? state.items.find((i) => i.id === id) : null;
  editingId = it ? it.id : null;
  el('sheet-title').textContent = it ? 'Edit item' : 'Add item';
  el('sheet-submit').textContent = it ? 'Save' : 'Add to list';
  form.elements.name.value = it?.name ?? '';
  form.elements.qty.value = it ? (it.qty ?? '') : 1;
  form.elements.unit.value = it && L.UNITS.includes(it.unit) ? it.unit : '';
  form.elements.notes.value = it?.notes ?? '';
  const storeOpts = [{ value: '', label: 'Any' }, ...listStores().map((s) => ({ value: s.id, label: s.name, chain: s.chain }))];
  const current = it ? it.storeId : (listFilter && listFilter !== '-' ? listFilter : '');
  UI.renderRadioChips(el('f-stores'), 'storeId', storeOpts, current, () => {});
  UI.setStatus(el('sheet-status'), '');
  el('item-sheet').showModal();
  form.elements.name.focus();
}

function sheetValues(form) {
  const f = new FormData(form);
  return { name: f.get('name'), qty: f.get('qty'), unit: f.get('unit'), storeId: f.get('storeId') ?? '', notes: f.get('notes') };
}

function removeWithUndo(id) {
  const idx = state.items.findIndex((i) => i.id === id);
  if (idx < 0) return;
  const it = state.items[idx];
  commit(L.removeItem(state, id));
  UI.toast(`Removed ${it.name}`, () => {
    if (state.items.some((i) => i.id === id)) return;
    const items = [...state.items];
    items.splice(Math.min(idx, items.length), 0, it);
    commit({ ...state, items });
  });
}

// ---------- Export menu ----------
const menu = () => el('export-menu');
function openMenu(btn) {
  const m = menu();
  el('love-text').textContent = nextNote(NOTES);
  m.hidden = false;
  const r = btn.getBoundingClientRect();
  const w = m.offsetWidth;
  m.style.setProperty('top', `${Math.round(r.bottom + 6)}px`);
  m.style.setProperty('left', `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)))}px`);
  document.querySelectorAll('[data-menu-toggle]').forEach((b) => b.setAttribute('aria-expanded', String(b === btn)));
  m.querySelector('.mi:not([hidden])').focus();
}
function closeMenu(focusBack = false) {
  if (menu().hidden) return;
  menu().hidden = true;
  const opener = document.querySelector('[data-menu-toggle][aria-expanded="true"]');
  document.querySelectorAll('[data-menu-toggle]').forEach((b) => b.setAttribute('aria-expanded', 'false'));
  if (focusBack && opener) opener.focus();
}

const stamp = () => new Date().toISOString().slice(0, 10);
const asText = () => toText(state.items, data.byId, { date: stamp(), favorites: favs });

async function menuAction(action) {
  closeMenu();
  if (action === 'csv') UI.download(`shopsmartr-list-${stamp()}.csv`, toCSV(state.items, data.byId, { bom: true }), 'text/csv;charset=utf-8');
  else if (action === 'favcsv') downloadFavs();
  else if (action === 'txt') UI.download(`shopsmartr-list-${stamp()}.txt`, asText(), 'text/plain;charset=utf-8');
  else if (action === 'copy') {
    try { await navigator.clipboard.writeText(asText()); UI.toast('Copied the list as text'); } catch { UI.toast('Copy failed. Try Download text.'); }
  } else if (action === 'share') {
    try { await navigator.share({ title: 'Shopping list', text: asText() }); } catch { /* cancelled */ }
  } else if (action === 'uncheck') commit(L.uncheckAll(state));
  else if (action === 'clear') {
    const before = state.items;
    const n = state.items.filter((i) => i.checked).length;
    if (!n) { UI.toast('No checked items'); return; }
    commit(L.clearChecked(state));
    UI.toast(`Cleared ${n} checked item${n === 1 ? '' : 's'}`, () => commit({ ...state, items: before }));
  }
}

// ---------- Routing ----------
function route() {
  const want = location.hash.slice(1);
  const screen = SCREENS.includes(want) ? want : (state.selectedStoreIds.length || state.items.length ? 'list' : 'stores');
  UI.setScreen(screen);
  closeMenu();
}

function bind() {
  window.addEventListener('hashchange', route);
  el('find-form').addEventListener('submit', (e) => { e.preventDefault(); runSearch(); });
  el('zip').addEventListener('input', () => { if (normalizeZip(el('zip').value)) runSearch({ quiet: true }); });
  el('radius').addEventListener('change', () => runSearch({ quiet: true }));

  el('addbar').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const parsed = L.parseQuick(form.elements.text.value);
    const typedQty = form.elements.qty.value;
    try {
      commit(L.addItem(state, {
        name: parsed.name,
        qty: parsed.qty ?? (typedQty === '' ? null : typedQty),
        unit: parsed.unit || form.elements.unit.value,
        storeId: form.elements.storeId.value,
      }));
      form.elements.text.value = '';
      form.elements.qty.value = '';
      form.elements.unit.value = '';
      UI.setStatus(el('list-status'), '');
      form.elements.text.focus();
    } catch (err) { UI.setStatus(el('list-status'), err.message, 'error'); }
  });

  el('fab').addEventListener('click', () => openSheet());
  // Close buttons are type=button so Enter in a field submits (saves) instead of closing.
  document.querySelectorAll('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
  el('notice-close').addEventListener('click', () => { el('notice').hidden = true; });
  el('item-form').addEventListener('submit', (e) => {
    if (e.submitter?.value === 'cancel') return;
    e.preventDefault();
    const form = e.currentTarget;
    try {
      if (editingId) {
        commit(L.updateItem(state, editingId, sheetValues(form)));
        el('item-sheet').close();
      } else {
        commit(L.addItem(state, sheetValues(form)));
        // Keep the sheet open for the next item (store choice is kept).
        form.elements.name.value = '';
        form.elements.qty.value = 1;
        form.elements.unit.value = '';
        form.elements.notes.value = '';
        UI.setStatus(el('sheet-status'), 'Added. Add another or close.');
        form.elements.name.focus();
      }
    } catch (err) { UI.setStatus(el('sheet-status'), err.message, 'error'); }
  });
  el('item-sheet').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  el('item-sheet').addEventListener('close', () => { editingId = null; });
  el('item-form').addEventListener('click', (e) => {
    const b = e.target.closest('[data-step]');
    if (!b) return;
    const q = el('f-qty');
    const v = Math.max(0, (Number(q.value) || 0) + Number(b.dataset.step));
    q.value = v || '';
  });

  document.querySelectorAll('[data-menu-toggle]').forEach((b) => b.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!menu().hidden && b.getAttribute('aria-expanded') === 'true') closeMenu(true); else openMenu(b);
  }));
  menu().addEventListener('click', (e) => { const mi = e.target.closest('[data-action]'); if (mi) menuAction(mi.dataset.action); });
  menu().addEventListener('keydown', (e) => {
    const items = [...menu().querySelectorAll('.mi:not([hidden])')];
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (e.key === 'Tab') closeMenu();
  });
  document.addEventListener('click', (e) => { if (!menu().contains(e.target)) closeMenu(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeMenu(true); });
  if (typeof navigator.share === 'function') menu().querySelector('[data-action="share"]').hidden = false;
}

// ---------- Optional encrypted price snapshot ----------
let priceEnv = null;
function showPrices(doc) {
  el('prices-locked').hidden = Boolean(doc);
  el('prices-open').hidden = !doc;
  el('prices-forget').hidden = !doc;
  if (!doc) return;
  const when = Date.parse(doc.asOf);
  el('prices-asof').textContent = Number.isFinite(when) ? `As of ${new Date(when).toLocaleString()}` : '';
  UI.renderPrices(el('prices-groups'), Prices.groupPrices(doc));
}

async function initPrices() {
  priceEnv = await Prices.loadFeed();
  if (!priceEnv) return;            // no data/prices.enc: price UI stays hidden
  el('prices').hidden = false;
  showPrices(await Prices.unlockWithCache(priceEnv));
  el('unlock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = el('unlock-pass');
    const btn = el('unlock-btn');
    btn.disabled = true;
    UI.setStatus(el('unlock-status'), 'Unlocking…');
    try {
      const doc = await Prices.unlockWithPassphrase(priceEnv, input.value);
      input.value = '';
      UI.setStatus(el('unlock-status'), '');
      showPrices(doc);
    } catch (err) {
      input.value = '';
      input.focus();
      UI.setStatus(el('unlock-status'), err instanceof Prices.WrongPassphraseError ? 'Wrong passphrase. Please try again.' : 'Could not unlock the price snapshot.', 'error');
    } finally { btn.disabled = false; }
  });
  el('prices-forget').addEventListener('click', async () => {
    await Prices.forgetKeys();
    showPrices(null);
    UI.setStatus(el('unlock-status'), 'Passphrase forgotten on this device.');
  });
}

async function init() {
  document.querySelectorAll('[data-version]').forEach((n) => { n.textContent = `v${VERSION}`; });
  UI.fillUnitSelects();
  bind();
  bindFavorites();
  try {
    const [storesDoc, zipsDoc] = await Promise.all([
      fetch('data/stores.json').then((r) => r.json()),
      fetch('data/zips.json').then((r) => r.json()),
    ]);
    const problems = validateStoresDoc(storesDoc);
    if (problems.length) console.warn('stores.json problems:', problems);
    data = { stores: storesDoc.stores, chains: storesDoc.chains, byId: indexById(storesDoc.stores), zips: zipsDoc.zips, asOf: storesDoc.asOf };
    document.querySelectorAll('[data-asof]').forEach((t) => { t.textContent = storesDoc.asOf; t.dateTime = storesDoc.asOf; });
  } catch (err) {
    UI.setStatus(el('find-status'), 'Could not load the store list. Please reload.', 'error');
    console.error(err);
  }
  el('zip').value = state.zip;
  const r = document.querySelector(`#radius input[value="${state.radiusMi}"]`) || document.querySelector('#radius input[value="10"]');
  r.checked = true;
  route();
  if (state.zip) runSearch({ quiet: true }); else renderAll();
  initPrices();
  if (loaded.problem === 'unreadable') {
    showNotice(`Your saved list couldn't be read, so ShopSmartR started a new one.${loaded.backedUp ? ' A copy of the old data was kept in this browser (shopsmartr:v1.bak).' : ''}`);
  } else if (loaded.problem === 'unavailable') {
    showNotice('This browser isn\'t letting ShopSmartR save, so your list will be lost when you close this page. Export it to keep a copy.');
  }
}

init();
