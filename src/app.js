// Wiring: loads data, owns state, routes between screens and connects events to the pure modules.
import { VERSION } from './version.js';
import { lookupZip, storesNear, normalizeZip } from './geo.js';
import { validateStoresDoc, indexById, CHAINS } from './stores.js';
import * as L from './list.js';
import { loadStateWithStatus, saveState, loadShopStore, saveShopStore, loadListSort, saveListSort, loadCollapsed, saveCollapsed, STORAGE_KEY } from './storage.js';
import * as Bk from './backup.js';
import { toCSV, toText, favoritesToCSV, localDateStamp } from './export.js';
import * as F from './favorites.js';
import { NOTES } from './notes.js';
import { nextNote } from './lovenotes.js';
import * as Prices from './prices.js';
import * as C from './catalog.js';
import { makeDecoder } from './pricefeed.js';
import * as UI from './ui.js';

const el = (id) => document.getElementById(id);
const SCREENS = ['list', 'shop', 'favorites', 'stores', 'ads'];
const loaded = loadStateWithStatus();
let state = loaded.state;
const favLoaded = F.loadFavoritesWithStatus();
let favs = favLoaded.favorites;
let favTab = 'items';
let saveWarned = loaded.problem === 'unavailable' || favLoaded.problem === 'unavailable';
let data = { stores: [], chains: {}, byId: {}, zips: {}, asOf: '' };
let nearby = [];
let listSort = loadListSort();        // device-only preference (also written into Save list files)
const collapsed = loadCollapsed();     // section keys collapsed on this device
let backupMeta = Bk.loadMeta();
let storagePersisted = null;
let chainFilter = '';  // '' = all chains (stores screen)

function commit(next) {
  state = next;
  if (!saveState(state)) warnCantSave();
  const focus = focusKey();
  renderAll();
  restoreFocus(focus);
}

const CANT_SAVE = 'This browser isn\'t letting ShopSmartR save, so your list will be lost when you close this page. Export it to keep a copy.';
function warnCantSave() {
  if (saveWarned) return;
  saveWarned = true;
  showNotice(CANT_SAVE);
}

function showNotice(text) {
  const box = el('notice-text');
  if ([...box.children].some((p) => p.textContent === text)) return;
  const p = document.createElement('p');
  p.textContent = text;
  box.append(p);
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
  if (!F.saveFavorites(favs)) warnCantSave();
  renderFavs();
  UI.syncStars(favKeys());   // stars on Shop results and list rows follow Favorites everywhere
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
  UI.toast(`Removed ${it.name} from Favorites`, () => {
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
      // M6: same identity check as the stars; an existing favorite is not added a second time.
      commitFavs(F.addFavorite(favs, { name: q.name, qty: q.qty, unit: q.unit }));
      input.value = '';
      UI.setStatus(el('fav-status'), '');
      input.focus();
    } catch (err) {
      UI.setStatus(el('fav-status'), err instanceof F.DuplicateFavoriteError ? `${err.existing.name} is already in your Favorites. Edit it to change the amount.` : err.message, 'error');
    }
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
    } catch (err) {
      UI.setStatus(el('fav-sheet-status'), err instanceof F.DuplicateFavoriteError ? `${err.existing.name} at this store is already in your Favorites. Change the name or store, or edit that one.` : err.message, 'error');
    }
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
  // v0.1.5: one section per store (chain-storeId) in the Stores-tab order, Any store last,
  // each sorted by the device's sort choice. Checking an item never moves it.
  const sections = L.storeSections(state.items, data.byId, listSort, state.selectedStoreIds);
  const t = L.totals(state.items);
  UI.renderList(el('list-groups'), sections, {
    onToggle: (id, checked) => commit(L.toggleItem(state, id, checked)),
    onEdit: (id) => openSheet(id),
    onRemove: removeWithUndo,
    collapsed,
    onCollapse: toggleCollapsed,
    chainName: (c) => data.chains[c]?.shortName || data.chains[c]?.name || c,
    star: (it) => starFor(it),
    emptyText: 'Your list is empty. Add your first item.',
  });
  renderSortControl(state.items.length > 1, sections.length > 1);
  const s = L.summary(state);
  const storeCount = sections.filter((g) => g.key).length;
  el('list-meta').textContent = s.total ? `${s.total} item${s.total === 1 ? '' : 's'} · ${storeCount} store${storeCount === 1 ? '' : 's'}` : 'No items yet';
  // One store: no headers, just a faint store line under the title.
  const one = sections.length === 1 && sections[0].key ? sections[0] : null;
  el('list-store').hidden = !one;
  if (one) {
    el('list-store').dataset.chain = one.chain;
    el('list-store').querySelector('[data-store-name]').textContent = one.name;
    const addr = el('list-store').querySelector('[data-store-addr]');
    addr.replaceChildren();
    if (one.street) {
      const city = one.address.length > one.street.length ? one.address.slice(one.street.length) : '';
      const c = document.createElement('span'); c.className = 'city'; c.textContent = city;
      addr.append(` · ${one.street}`, c);
    }
    el('list-store').title = [one.name, one.address].filter(Boolean).join(' · ');
  }
  UI.renderProgress(s.done, s.total);
  UI.renderTotals(state.items);
  UI.renderTrip(sections, t, jumpToSection);
  renderNudge();
  const mine = withDistance(state.selectedStoreIds.map((id) => data.byId[id]).filter(Boolean));
  UI.renderStaticChips(el('panel-stores'), mine);
  el('panel-where').textContent = state.zip ? `${state.zip} · within ${state.radiusMi} mi` : 'No zip code yet';
}

// ---------- Store sections: collapse, jump (v0.1.5) ----------
function toggleCollapsed(key) {
  if (collapsed.has(key)) collapsed.delete(key); else collapsed.add(key);
  saveCollapsed(collapsed);
  renderListScreen();
  document.getElementById(`${UI.secId(key === 'any' ? '' : key)}-h`)?.focus({ preventScroll: true });
}
function setAllCollapsed(on) {
  const keys = L.storeSections(state.items, data.byId).map((g) => g.key || 'any');
  for (const k of keys) { if (on) collapsed.add(k); else collapsed.delete(k); }
  saveCollapsed(collapsed);
  renderListScreen();
}
/** Adding an item to a collapsed store expands that store. */
function expandFor(item) {
  const k = item ? (L.storeKeyOf(item) || 'any') : null;
  if (k && collapsed.delete(k)) saveCollapsed(collapsed);
}
function jumpToSection(key) {
  const h = document.getElementById(`${UI.secId(key)}-h`);
  if (!h) return;
  h.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  h.focus({ preventScroll: true });
}

// ---------- List sort (v0.1.5) ----------
const SORT_LABEL = { name: 'A–Z', price: 'Price', aisle: 'Aisle' };
function sortSpoken() {
  if (listSort.by === 'price') return `price, ${listSort.dir === 'desc' ? 'high to low' : 'low to high'}`;
  return listSort.by === 'aisle' ? 'aisle' : 'name, A to Z';
}
function renderSortControl(show, multi) {
  const high = listSort.dir === 'desc';
  // Mobile chip + menu
  el('sort-btn').hidden = !show;
  el('sort-btn-label').textContent = `${SORT_LABEL[listSort.by]}${listSort.by === 'price' ? (high ? ' ↓' : ' ↑') : ''}`;
  el('sort-btn').setAttribute('aria-label', `Sort items: ${sortSpoken()}`);
  for (const b of el('sort-menu').querySelectorAll('[data-sort]')) b.setAttribute('aria-checked', String(b.dataset.sort === listSort.by));
  el('sort-menu-dir').hidden = listSort.by !== 'price';
  for (const b of el('sort-menu-dir').querySelectorAll('[data-dir]')) b.setAttribute('aria-pressed', String(b.dataset.dir === listSort.dir));
  // Desktop toolbar
  el('list-toolbar').hidden = !show;
  for (const b of el('sort-seg').querySelectorAll('[data-sort]')) {
    const on = b.dataset.sort === listSort.by;
    b.setAttribute('aria-checked', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  const dir = el('sort-dir');
  dir.hidden = listSort.by !== 'price';
  dir.querySelector('use').setAttribute('href', high ? '#i-down' : '#i-up');
  dir.querySelector('span').textContent = high ? 'High to low' : 'Low to high';
  dir.setAttribute('aria-label', `Price order: ${high ? 'high to low' : 'low to high'}. Activate to reverse.`);
  const ca = el('collapse-all');
  ca.hidden = !multi;
  const keys = L.storeSections(state.items, data.byId).map((g) => g.key || 'any');
  const allShut = keys.length > 0 && keys.every((k) => collapsed.has(k));
  ca.textContent = allShut ? 'Expand all' : 'Collapse all';
  ca.dataset.all = allShut ? 'collapsed' : 'open';
}
function setSort(next, { announce = true } = {}) {
  listSort = L.cleanSort(next);
  saveListSort(listSort);
  renderListScreen();
  if (announce) el('sort-live').textContent = `Sorted by ${sortSpoken()}`;
}
const sortMenu = () => el('sort-menu');
function openSortMenu() {
  const m = sortMenu();
  const btn = el('sort-btn');
  m.hidden = false;
  const r = btn.getBoundingClientRect();
  const w = m.offsetWidth;
  m.style.setProperty('top', `${Math.round(r.bottom + 6)}px`);
  m.style.setProperty('left', `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)))}px`);
  btn.setAttribute('aria-expanded', 'true');
  (m.querySelector('[aria-checked="true"]') ?? m.querySelector('.mi')).focus();
}
function closeSortMenu(focusBack = false) {
  if (sortMenu().hidden) return;
  sortMenu().hidden = true;
  el('sort-btn').setAttribute('aria-expanded', 'false');
  if (focusBack) el('sort-btn').focus();
}
function bindSort() {
  el('sort-btn').addEventListener('click', (e) => { e.stopPropagation(); if (sortMenu().hidden) openSortMenu(); else closeSortMenu(true); });
  sortMenu().addEventListener('click', (e) => {
    e.stopPropagation();
    const d = e.target.closest('[data-dir]');
    if (d) { setSort({ by: 'price', dir: d.dataset.dir }); d.focus(); return; }   // direction applies without closing
    const mi = e.target.closest('[data-sort]');
    if (!mi) return;
    setSort({ by: mi.dataset.sort, dir: listSort.dir });
    if (mi.dataset.sort === 'price') { sortMenu().querySelector(`[data-dir="${listSort.dir}"]`)?.focus(); return; }
    closeSortMenu(true);
  });
  sortMenu().addEventListener('keydown', (e) => {
    const items = [...sortMenu().querySelectorAll('.mi, [data-dir]')].filter((x) => x.offsetParent);
    const i = items.indexOf(document.activeElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeSortMenu(true); }
    if (e.key === 'Tab') closeSortMenu();
  });
  document.addEventListener('click', (e) => { if (!sortMenu().contains(e.target)) closeSortMenu(); });
  // Desktop segmented radiogroup: click, roving tabindex, arrow keys; clicking the active Price reverses.
  const seg = el('sort-seg');
  seg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    if (b.dataset.sort === 'price' && listSort.by === 'price') setSort({ by: 'price', dir: listSort.dir === 'desc' ? 'asc' : 'desc' });
    else setSort({ by: b.dataset.sort, dir: listSort.dir });
    seg.querySelector(`[data-sort="${listSort.by}"]`).focus();
  });
  seg.addEventListener('keydown', (e) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const order = L.SORTS;
    const i = order.indexOf(listSort.by);
    const next = order[(i + (e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1) + order.length) % order.length];
    setSort({ by: next, dir: listSort.dir });
    seg.querySelector(`[data-sort="${next}"]`).focus();
  });
  el('sort-dir').addEventListener('click', () => { setSort({ by: 'price', dir: listSort.dir === 'desc' ? 'asc' : 'desc' }); el('sort-dir').focus(); });
  el('collapse-all').addEventListener('click', () => { setAllCollapsed(el('collapse-all').dataset.all !== 'collapsed'); el('collapse-all').focus(); });
  el('tb-toggle').addEventListener('click', (e) => { e.stopPropagation(); UI.toggleBreakdown(); });
  document.addEventListener('click', (e) => { if (!el('tb-break').contains(e.target)) UI.closeBreakdown(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !el('tb-break').hidden) { UI.closeBreakdown(); el('tb-toggle').focus(); } });
}

// ---------- Save list / Load list (v0.1.5) ----------
function renderNudge() {
  if (state.items.length && !backupMeta.firstSeenAt) setMetaQuiet({ ...backupMeta, firstSeenAt: new Date().toISOString() });
  const text = Bk.nudgeText(backupMeta, state.items.length);
  el('save-nudge').hidden = !text;
  if (text) el('save-nudge-text').textContent = text;
}
function setMetaQuiet(next) { backupMeta = next; Bk.saveMeta(backupMeta); }
function setMeta(next) { setMetaQuiet(next); renderNudge(); }

function renderStoreStatus() {
  const warn = saveWarned;
  el('store-status').classList.toggle('warn', warn);
  el('store-status-title').textContent = warn ? 'This browser isn\'t saving your list' : 'Kept in this browser only';
  el('store-status-saved').textContent = warn ? 'Save list to keep a copy.' : Bk.savedLine(backupMeta, state.items.length);
  el('storage-status').textContent = Bk.storageText(storagePersisted);
}

async function askPersist() {
  try {
    const sm = navigator.storage;
    if (!sm?.persisted) storagePersisted = null;
    else {
      storagePersisted = await sm.persisted();
      if (!storagePersisted && sm.persist && state.items.length) storagePersisted = await sm.persist();
    }
  } catch { storagePersisted = null; }
  renderStoreStatus();
}

async function saveListNow() {
  const doc = Bk.makeBackup({ state, favs, shopStore: loadShopStore(), appVersion: VERSION });
  const name = Bk.backupFilename(stamp());
  const json = Bk.backupJSON(doc);
  let shared = false;
  try {
    const file = new File([json], name, { type: 'application/json' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: 'ShopSmartR list' });
      shared = true;
    }
  } catch (err) {
    if (err?.name === 'AbortError') { UI.toast('Save list cancelled'); return null; }
  }
  if (!shared) UI.download(name, json, 'application/json');
  setMeta(Bk.markSaved(backupMeta));
  // L23: a file saved from this list shouldn't be merged back into it (it would double everything).
  Bk.saveMerged(Bk.recordSaveId(Bk.loadMerged(), doc.saveId, 'saved'));
  if (!storagePersisted) askPersist();
  UI.toast(`List saved · ${name}`);
  return name;
}

/** Save list, guarded against a double tap or a second call while one is in flight (L29). */
const saveList = Bk.makeSaveGuard(saveListNow, { ms: 800, now: () => performance.now() });

let pendingLoad = null;
/** Copy of the list taken just before "Clear checked items" (v0.1.7), parallel to the Replace .bak. */
const CLEAR_BAK_KEY = 'shopsmartr:beforeClear:v1.bak';
function openLoadPicker() {
  const input = el('load-file');
  input.value = '';
  input.click();
}
async function onLoadFile(file) {
  if (!file) return;
  if (file.size > Bk.MAX_LOAD_BYTES) { UI.toast(Bk.TOO_LARGE); return; }   // L24: before reading it
  let text = '';
  try { text = await file.text(); } catch { UI.toast(Bk.NOT_A_LIST); return; }
  const r = Bk.parseBackup(text);
  if (!r.ok) { UI.toast(r.error); return; }
  pendingLoad = { backup: r.backup, summary: r.summary };
  const sm = r.summary;
  const when = new Date(sm.createdAt);
  el('load-fname').textContent = file.name;
  el('load-fmeta').textContent = `Saved ${when.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} · ${when.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })} · v${sm.appVersion}`;
  const pill = (t) => { const x = document.createElement('span'); x.textContent = t; return x; };
  const n = (k, one, v = sm[k]) => `${v} ${one}${v === 1 ? '' : 's'}`;
  el('load-stats').replaceChildren(...[n('items', 'item'), n('listStores', 'store'), `${sm.priced} priced`,
    sm.favorites ? (sm.favorites === 1 ? '1 favorite' : `${sm.favorites} Favorites`) : '', sm.meals ? n('meals', 'meal') : '',
    sm.dropped ? `${sm.dropped} unreadable skipped` : '',
    sm.duplicates ? `${sm.duplicates} duplicate${sm.duplicates === 1 ? '' : 's'} skipped` : ''].filter(Boolean).map(pill));
  const cur = state.items.length;
  const fi = n('items', 'item');
  el('load-fs').hidden = cur === 0;
  el('load-legend').textContent = `What should happen to your current ${cur} item${cur === 1 ? '' : 's'}?`;
  el('load-merge-d').textContent = `Keep my items and add the file's ${sm.items}. Matching items are combined.`;
  const d = el('load-replace-d');
  const b = document.createElement('b'); b.textContent = `Removes your ${cur} current item${cur === 1 ? '' : 's'}`;
  d.replaceChildren(b, `, then loads the file's ${sm.items}. Favorites and store picks are replaced too.`);
  el('load-form').elements.mode.value = 'merge';
  pendingLoad.empty = cur === 0;
  pendingLoad.fileItems = fi;
  pendingLoad.repeat = cur === 0 ? null : Bk.repeatMergeText(Bk.loadMerged(), r.backup.saveId);
  syncLoadChoice();
  el('load-sheet').showModal();
  el('load-confirm').focus();
}
function syncLoadChoice() {
  const mode = el('load-form').elements.mode.value;
  for (const c of el('load-form').querySelectorAll('.opt-card')) c.classList.toggle('on', c.dataset.opt === mode);
  const sheet = el('load-sheet');
  sheet.classList.toggle('replace', mode === 'replace');
  const btn = el('load-confirm');
  btn.textContent = pendingLoad?.empty ? `Load ${pendingLoad.fileItems}` : mode === 'replace' ? 'Replace my list' : `Merge ${pendingLoad?.fileItems ?? ''}`;
  btn.classList.toggle('btn-danger', mode === 'replace' && !pendingLoad?.empty);
  btn.classList.toggle('btn-primary', !(mode === 'replace' && !pendingLoad?.empty));
  // L23: merging the same file again is skipped; Replace is still allowed.
  const rep = pendingLoad?.repeat;
  if (rep && mode === 'merge') UI.setStatus(el('load-status'), `${rep}. Merging it again would add its quantities twice, so Merge will skip it. Choose Replace to load it instead.`, 'error');
  else UI.setStatus(el('load-status'), '');
}
function applyLoad(mode) {
  if (!pendingLoad) return;
  if (pendingLoad.empty) mode = 'merge';
  if (mode === 'merge' && pendingLoad.repeat) {
    const msg = `${pendingLoad.repeat}. Nothing changed.`;
    pendingLoad = null;
    el('load-sheet').close();
    UI.toast(msg);
    return;
  }
  const saveId = pendingLoad.backup.saveId;
  const before = { state, favs, shopStore: loadShopStore(), listSort };
  if (mode === 'replace') {
    try {
      localStorage.setItem(Bk.PRE_LOAD_BAK_KEY, JSON.stringify({ savedAt: new Date().toISOString(), list: localStorage.getItem(STORAGE_KEY), favorites: localStorage.getItem(F.FAVORITES_KEY) }));
    } catch {
      UI.setStatus(el('load-status'), 'Couldn\'t keep a copy of your current list on this device, so nothing was replaced. Try Merge, or Save list first.', 'error');
      return;
    }
  }
  const res = Bk.applyBackup(before, pendingLoad.backup, mode);
  pendingLoad = null;
  const mergedBefore = Bk.loadMerged();
  // L23/L27: remember this file (merged or replaced) so merging it again is refused; Undo forgets it.
  Bk.saveMerged(Bk.recordSaveId(mergedBefore, saveId, mode === 'replace' ? 'replaced' : 'merged'));
  el('load-sheet').close();
  const restore = (x) => {
    commitFavs(x.favs);
    if (x.shopStore) {
      saveShopStore(x.shopStore);
      if (feed) { shop.store = C.pickStore(feed.catalog, x.shopStore) ?? shop.store; el('shop-store').value = shop.store; renderShop(); }
    }
    commit(x.state);   // the sort choice stays this device's (L22)
  };
  restore(res);
  if (mode === 'replace') UI.toast('List replaced', () => { restore(before); Bk.saveMerged(mergedBefore); }, 10000);
  else {
    const n = res.added; const c = res.combined;
    UI.toast(`List merged · ${n} item${n === 1 ? '' : 's'} added${c ? `, ${c} combined` : ''}`, () => { restore(before); Bk.saveMerged(mergedBefore); });
  }
}

function bindSaveLoad() {
  el('save-nudge-save').addEventListener('click', saveList);
  el('save-nudge-hide').addEventListener('click', () => { setMeta(Bk.hideNudge(backupMeta)); el('list-title').focus(); });
  el('load-file').addEventListener('change', (e) => {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = '';   // picking the same file again still fires a change
    onLoadFile(f);
  });
  el('load-form').addEventListener('change', syncLoadChoice);
  el('load-form').addEventListener('submit', (e) => {
    e.preventDefault();   // Enter on a radio doesn't confirm; only the button does
    if (e.submitter?.value !== 'ok') return;
    applyLoad(e.currentTarget.elements.mode.value);
  });
  el('load-sheet').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  el('load-sheet').addEventListener('close', () => { pendingLoad = null; });
  askPersist();
}


// ---------- Favorite stars (v0.1.7): Shop results and list rows ----------
const favKeys = () => new Set(favs.items.map(F.favKey));
/** Favorite identity source for a catalog result: name and its store (directory id or chain-store). The unit is not identity (L30). */
function catalogFavSource(it) {
  const f = C.pricedFields(feed.catalog, it, data.byId);
  return { name: it.name, qty: null, unit: '', storeId: f.storeId, priced: f.priced };
}
function starFor(x) {
  return { key: F.favKey(x), on: F.isFavorite(favs, x), onStar: (btn) => toggleStar(x, btn) };
}
async function toggleStar(x, btn) {
  if (!F.isFavorite(favs, x)) {
    commitFavs(F.starFavorite(favs, x));
    UI.toast(`Added ${x.name} to Favorites`);
    btn.focus({ preventScroll: true });
    return;
  }
  const choice = await confirmDialog({
    title: `Remove ${x.name} from Favorites?`,
    body: [state.items.some((i) => F.favKey(i) === F.favKey(x)) ? 'It stays on your list. You can star it again any time.' : 'You can star it again any time.'],
    actions: [{ label: 'Cancel', value: 'cancel', kind: 'secondary' }, { label: 'Remove', value: 'remove', kind: 'danger' }],
    initial: 'cancel',
    returnFocus: btn,
  });
  if (choice !== 'remove') return;
  const before = favs;
  commitFavs(F.unstarFavorite(favs, x));
  UI.toast(`Removed ${x.name} from Favorites`, () => commitFavs(before));
}

// ---------- Confirm dialog (v0.1.7): focus trapped, Esc = Cancel, focus returns to the opener ----------
let confirmResolve = null;
const BACKDROP_GRACE_MS = 300;
/**
 * actions: [{ label, value, kind: 'primary'|'secondary'|'danger' }]. Resolves with the chosen value,
 * or 'cancel' (Esc, backdrop, Cancel). returnFocus gets focus back when it closes.
 */
function confirmDialog({ title, body = [], actions, initial, returnFocus, status = '', armMs = 0 }) {
  const dlg = el('confirm-dlg');
  // armMs (L29): a dialog reopened under the finger ignores taps for a moment, so a double tap
  // on a button doesn't also press the same button of the reopened dialog.
  const armedAt = performance.now() + armMs;
  dlg.dataset.armed = armMs ? 'false' : 'true';
  if (armMs) setTimeout(() => { dlg.dataset.armed = 'true'; }, armMs);
  el('confirm-title').textContent = title;
  el('confirm-body').replaceChildren(...body.map((t) => { const p = document.createElement('p'); if (typeof t === 'string') p.textContent = t; else p.append(...t); return p; }));
  UI.setStatus(el('confirm-status'), status);
  const row = el('confirm-actions');
  row.classList.toggle('three', actions.length > 2);
  row.replaceChildren(...actions.map((a) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `btn btn-${a.kind}`;
    b.dataset.value = a.value;
    b.textContent = a.label;
    b.addEventListener('click', () => { if (performance.now() >= armedAt) finish(a.value); });
    return b;
  }));
  const finish = (v) => {
    if (!confirmResolve) return;
    const r = confirmResolve; confirmResolve = null;
    if (dlg.open) dlg.close();
    if (returnFocus?.isConnected) returnFocus.focus({ preventScroll: true });
    r(v);
  };
  return new Promise((resolve) => {
    confirmResolve = resolve;
    dlg._finish = finish;
    dlg._openedAt = performance.now();
    dlg.showModal();
    (row.querySelector(`[data-value="${initial}"]`) ?? row.querySelector('button')).focus();
  });
}
function bindConfirm() {
  const dlg = el('confirm-dlg');
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); dlg._finish?.('cancel'); });   // Esc = Cancel
  // Backdrop. L32: ignored while the dialog is not armed and for BACKDROP_GRACE_MS after it opens,
  // so the second click of a desktop double-click (the reopened dialog is still sliding in) can't close it.
  dlg.addEventListener('click', (e) => {
    if (e.target !== dlg) return;
    if (dlg.dataset.armed === 'false' || performance.now() - (dlg._openedAt ?? 0) < BACKDROP_GRACE_MS) return;
    dlg._finish?.('cancel');
  });
  // A late 'close' from the previous round must not cancel a dialog that was opened again since.
  dlg.addEventListener('close', () => { if (!dlg.open) dlg._finish?.('cancel'); });
  dlg.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = [...dlg.querySelectorAll('button:not([disabled])')].filter((b) => b.offsetParent);
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
  });
  el('confirm-form').addEventListener('submit', (e) => e.preventDefault());
}

// ---------- List actions: Check all (new in v0.1.7) beside the existing Uncheck all / Clear checked ----------
function setAllChecked(on) {
  const snap = L.checkedSnapshot(state);
  const n = state.items.filter((i) => i.checked !== on).length;
  if (!n) { UI.toast(on ? 'Everything is already checked' : 'Nothing is checked'); return; }
  commit(on ? L.checkAll(state) : L.uncheckAll(state));
  UI.toast(`${on ? 'Checked' : 'Unchecked'} ${n} item${n === 1 ? '' : 's'}`, () => commit(L.restoreChecked(state, snap)));
}
/**
 * The existing "Clear checked items" action (v0.1.6 and earlier: no confirm, Undo toast).
 * v0.1.7: confirm first with "Save list first" (runs Save list, then comes back here), Cancel and
 * a destructive Clear; keeps a .bak copy; the existing Undo toast is unchanged. Favorites untouched.
 */
async function clearCheckedFlow(opener) {
  let status = '';
  for (;;) {
    const n = state.items.filter((i) => i.checked).length;
    if (!n) { UI.toast('No checked items'); return; }
    const choice = await confirmDialog({
      title: `Clear ${n} checked item${n === 1 ? '' : 's'} from your list?`,
      body: ['This can\'t be undone after you leave the page. Save list first to keep a copy as a file.', 'Favorites, meals and your stores are not changed.'],
      actions: [{ label: 'Save list first', value: 'save', kind: 'primary' }, { label: 'Cancel', value: 'cancel', kind: 'secondary' }, { label: 'Clear', value: 'clear', kind: 'danger' }],
      initial: 'save',
      returnFocus: opener,
      status,
      armMs: status ? 600 : 0,   // reopened right after Save list first (L29)
    });
    if (choice === 'save') { const name = await saveList(); status = name ? `Saved ${name}. You can clear the checked items now.` : ''; continue; }
    if (choice !== 'clear') return;
    try {
      localStorage.setItem(CLEAR_BAK_KEY, JSON.stringify({ savedAt: new Date().toISOString(), list: localStorage.getItem(STORAGE_KEY) }));
    } catch {
      UI.toast('Couldn\'t keep a copy of your list on this device, so nothing was cleared. Save list first.');
      return;
    }
    const before = state.items;
    commit(L.clearChecked(state));
    UI.toast(`Cleared ${n} checked item${n === 1 ? '' : 's'}`, () => commit({ ...state, items: before }));
    return;
  }
}
/** Menu state: Check all / Uncheck all / Clear checked items are disabled when they'd do nothing. */
function syncListActions() {
  const items = state.items;
  const any = items.length > 0;
  const done = items.filter((i) => i.checked).length;
  const set = (action, show, enabled = true) => {
    const b = menu().querySelector(`[data-action="${action}"]`);
    b.hidden = !show;
    if (enabled) b.removeAttribute('aria-disabled'); else b.setAttribute('aria-disabled', 'true');
  };
  set('checkall', true, any && done < items.length);
  set('uncheck', true, done > 0);
  set('clear', true, done > 0);
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
  const current = it ? it.storeId : '';
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
  renderStoreStatus();
  syncListActions();
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

const stamp = () => localDateStamp();
const asText = () => toText(state.items, data.byId, { date: stamp(), favorites: favs, sort: listSort, order: state.selectedStoreIds });

async function menuAction(action) {
  const opener = document.querySelector('[data-menu-toggle][aria-expanded="true"]');
  closeMenu();
  if (action === 'csv') UI.download(`shopsmartr-list-${stamp()}.csv`, toCSV(state.items, data.byId, { bom: true }), 'text/csv;charset=utf-8');
  else if (action === 'favcsv') downloadFavs();
  else if (action === 'txt') UI.download(`shopsmartr-list-${stamp()}.txt`, asText(), 'text/plain;charset=utf-8');
  else if (action === 'save') saveList();
  else if (action === 'load') openLoadPicker();
  else if (action === 'copy') {
    try { await navigator.clipboard.writeText(asText()); UI.toast('Copied the list as text'); } catch { UI.toast('Copy failed. Try Download text.'); }
  } else if (action === 'share') {
    try { await navigator.share({ title: 'Shopping list', text: asText() }); } catch { /* cancelled */ }
  } else if (action === 'checkall') setAllChecked(true);
  else if (action === 'uncheck') setAllChecked(false);
  else if (action === 'clear') clearCheckedFlow(opener);
}

// ---------- Routing ----------
function route() {
  const want = location.hash.slice(1);
  let screen = SCREENS.includes(want) ? want : (state.selectedStoreIds.length || state.items.length ? 'list' : 'stores');
  if (screen === 'shop' && feedAvailable === false) screen = 'list';
  UI.setScreen(screen);
  closeMenu();
  closeSuggest();
}

function bind() {
  window.addEventListener('hashchange', route);
  el('find-form').addEventListener('submit', (e) => { e.preventDefault(); runSearch(); });
  el('zip').addEventListener('input', () => { if (normalizeZip(el('zip').value)) runSearch({ quiet: true }); });
  el('radius').addEventListener('change', () => runSearch({ quiet: true }));

  el('addbar').addEventListener('submit', (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    try {
      const next = L.addItem(state, { ...L.quickInput(form.elements.text.value, form.elements.qty.value, form.elements.unit.value), storeId: form.elements.storeId.value });
      expandFor(next.items[next.items.length - 1]);
      commit(next);
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
  el('notice-close').addEventListener('click', () => { el('notice').hidden = true; el('notice-text').replaceChildren(); });
  el('item-form').addEventListener('submit', (e) => {
    if (e.submitter?.value === 'cancel') return;
    e.preventDefault();
    const form = e.currentTarget;
    try {
      if (editingId) {
        commit(L.updateItem(state, editingId, sheetValues(form)));
        el('item-sheet').close();
      } else {
        // L20: same quick-add parse as the desktop bar ("2 lb apples" + Enter -> 2 lb of apples).
        const v = sheetValues(form);
        const next = L.addItem(state, { ...v, ...L.quickInput(v.name, v.qty, v.unit) });
        expandFor(next.items[next.items.length - 1]);
        commit(next);
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
  menu().addEventListener('click', (e) => {
    const mi = e.target.closest('[data-action]');
    if (!mi) return;
    if (mi.getAttribute('aria-disabled') === 'true') { e.stopPropagation(); return; }   // stays open; nothing to do
    menuAction(mi.dataset.action);
  });
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

// ---------- Encrypted price feed: Shop, item sheet, suggestions ----------
const PAGE = 50;
const DEBOUNCE_MS = 150;
let priceEnv = null;
let feedAvailable = null;   // null = still checking, then true/false
let feed = null;            // { catalog, index } while unlocked; only the key is cached, never the catalog
let decoder = null;
const shop = { store: '', dept: '', q: '', offset: 0 };
const deptMemo = new Map();
const perf = {};
globalThis.__shopsmartrPerf = perf;

const debounce = (fn, ms) => { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

function timedDecode(env, key) {
  const t0 = performance.now();
  return decoder(env, key).then((res) => {
    Object.assign(perf, { ...res.ms, decodeTotal: performance.now() - t0, where: res.where, items: res.catalog.n });
    return res;
  });
}

function storeOptionLabel(s) {
  return s.name && s.name !== `${s.chain} #${s.storeId}` ? `${s.label} · ${s.name}` : s.label;
}

function showShop(result) {
  feed = result;
  deptMemo.clear();
  el('shop-locked').hidden = Boolean(result);
  el('shop-open').hidden = !result;
  closeSuggest();
  if (!result) return;
  const t0 = performance.now();
  const stores = C.priceStores(feed.catalog);
  shop.store = C.pickStore(feed.catalog, loadShopStore()) ?? '';
  el('shop-store').replaceChildren(...stores.map((st) => new Option(storeOptionLabel(st), st.key)));
  el('shop-store').value = shop.store;
  const when = Date.parse(feed.catalog.asOf);
  el('shop-asof').textContent = Number.isFinite(when) ? `Prices as of ${new Date(when).toLocaleString()}.` : '';
  renderShop();
  perf.firstRender = performance.now() - t0;
  perf.readyAt = performance.now();
}

function storeDepts() {
  if (!deptMemo.has(shop.store)) deptMemo.set(shop.store, C.storeDepartments(feed.catalog, shop.store));
  return deptMemo.get(shop.store);
}

function renderShop({ keepScroll = true } = {}) {
  if (!feed) return;
  const t0 = performance.now();
  const { catalog: cat, index } = feed;
  const cur = C.priceStores(cat).find((st) => st.key === shop.store);
  const sub = el('shop-sub');
  sub.dataset.chain = cur?.chain ?? '';
  sub.lastElementChild.textContent = cur ? storeOptionLabel(cur) : 'No store prices';
  const depts = storeDepts();
  if (shop.dept && !depts.some((d) => d.name === shop.dept)) shop.dept = '';
  UI.renderDeptChips(el('shop-depts'), depts, shop.dept, (d) => { shop.dept = d; shop.offset = 0; renderShop(); });
  const q = shop.q.trim();
  const idle = !q && !shop.dept;
  el('shop-idle').hidden = !idle;
  const open = (i, btn) => openShopSheet(i, btn);
  if (idle) {
    const n = cur?.count ?? 0;
    el('shop-meta').textContent = `${n.toLocaleString('en-US')} items · ${depts.length} department${depts.length === 1 ? '' : 's'}`;
    el('shop-dept-grid').replaceChildren(...depts.map((d) => UI.deptCard(d, (name) => { shop.dept = name; shop.offset = 0; renderShop(); })));
    const sale = C.onSale(cat, index, shop.store, 6);
    el('shop-sale').hidden = sale.length === 0;
    el('shop-sale-list').replaceChildren(...sale.map((it) => UI.catRow(it, open, starFor(catalogFavSource(it)))));
    el('shop-results').hidden = true;
    el('shop-more').hidden = true;
    el('shop-empty').hidden = true;
    perf.lastRender = performance.now() - t0;
    return;
  }
  const r = C.search(cat, index, q, { store: shop.store, department: shop.dept, offset: shop.offset, limit: PAGE });
  const tSearch = performance.now() - t0;
  el('shop-results').hidden = r.total === 0;
  el('shop-results').replaceChildren(...r.items.map((it) => UI.catRow(it, open, starFor(catalogFavSource(it)))));
  const end = r.offset + r.items.length;
  const where = shop.dept ? ` in ${shop.dept}` : '';
  el('shop-meta').textContent = r.total === 0 ? ''
    : q && r.total <= PAGE ? `${r.total} result${r.total === 1 ? '' : 's'} for “${q}”${where}`
      : `Showing ${r.offset + 1}–${end} of ${r.total.toLocaleString('en-US')}${q ? ` for “${q}”` : ''}${where}`;
  const more = el('shop-more');
  const left = r.total - end;
  more.hidden = left <= 0 && r.offset === 0;
  more.textContent = left > 0 ? `Show more (${left.toLocaleString('en-US')})` : 'Back to the first results';
  more.dataset.next = left > 0 ? String(end) : '0';
  el('shop-empty').hidden = r.total > 0;
  if (r.total === 0) {
    el('shop-empty-title').textContent = q ? `No items match “${q}”` : 'No items here';
    el('shop-empty-add').textContent = `Add “${q}” without price`;
    el('shop-empty-add').hidden = !q;
    el('shop-empty-clear').hidden = !q;
  }
  if (!keepScroll) el('shop-open').scrollIntoView?.({ block: 'start' });
  perf.lastSearch = tSearch;
  perf.lastRender = performance.now() - t0;
}

let sheetItem = null;
let sheetQty = 1;
let sheetOpener = null;
function openShopSheet(idx, opener) {
  if (!feed) return;
  const it = C.getItem(feed.catalog, idx);
  sheetItem = it;
  sheetQty = 1;
  sheetOpener = opener ?? null;
  el('ci-title').textContent = it.name;
  el('ci-size').textContent = it.size ?? '';
  const price = el('ci-price');
  price.textContent = UI.itemPriceText(it);
  price.classList.toggle('price-sale', it.onSale);
  el('ci-sale').hidden = !it.onSale;
  el('ci-was').textContent = it.onSale && it.regularPrice ? L.priceText(C.regularEach(it), it.soldByWeight) : '';
  el('ci-unit').textContent = [it.soldByWeight ? `${it.unitPriceText ?? ''}, estimated for ${it.approxWeightLb ?? 1} lb` : it.unitPriceText].filter(Boolean).join('');
  el('ci-aisle').textContent = [it.aisle, it.department].filter(Boolean).join(' · ');
  el('ci-store').textContent = C.storeLabel(it);
  el('ci-qty').textContent = '1';
  el('shop-sheet').showModal();
  el('ci-add').focus();
}

/** Adds a catalog item; merges into an unchecked line for the same product from the same store. */
function addPriced(it, qty = 1, unit = '') {
  try { return addPricedOrThrow(it, qty, unit); } catch (err) { return err.message; }
}
function addPricedOrThrow(it, qty, unit) {
  const f = C.pricedFields(feed.catalog, it, data.byId);
  const u = L.normUnit(unit) || unit;
  const same = state.items.find((x) => !x.checked && x.priced && x.priced.sku === f.priced.sku && x.priced.chain === f.priced.chain
    && x.priced.storeNo === f.priced.storeNo && (L.normUnit(x.unit) || x.unit) === u);
  if (same) {
    const n = Math.min(L.MAX_QTY, Math.round(((same.qty ?? 1) + qty) * 1000) / 1000);
    commit(L.updateItem(state, same.id, { qty: n }));
    return `${it.name}: now ${L.formatQty({ qty: n, unit: same.unit })} on your list`;
  }
  const next = L.addItem(state, { name: it.name, qty, unit, storeId: f.storeId, priced: f.priced });
  expandFor(next.items[next.items.length - 1]);
  commit(next);
  return L.addedText(next.items[next.items.length - 1]);
}

// ----- combobox suggestions (add bar + mobile add sheet), shared matcher -----
const combos = [];
function closeSuggest() { for (const c of combos) c.close(); }

function bindSuggest(input, box, { onPick, onCustom }) {
  let items = [];
  let active = -1;
  let text = '';
  const opts = () => [...box.children];
  function close() {
    box.hidden = true;
    box.replaceChildren();
    items = [];
    active = -1;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
  }
  function setActive(i) {
    const o = opts();
    active = i;
    o.forEach((n, k) => n.setAttribute('aria-selected', String(k === i)));
    if (i >= 0) { input.setAttribute('aria-activedescendant', o[i].id); o[i].scrollIntoView?.({ block: 'nearest' }); } else input.removeAttribute('aria-activedescendant');
  }
  function update() {
    text = L.parseQuick(input.value).name.trim();
    if (!feed || document.activeElement !== input) { close(); return; }
    const t0 = performance.now();
    items = C.suggest(feed.catalog, feed.index, text, { limit: 5, store: shop.store });
    perf.lastSuggest = performance.now() - t0;
    if (!items.length) { close(); return; }
    box.replaceChildren(...items.map((it, i) => UI.sugOption(it, `${box.id}-${i}`)), UI.customOption(text, `${box.id}-custom`));
    box.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    setActive(-1);
  }
  function choose(i) {
    const it = items[i];
    const raw = input.value;
    close();
    if (it) onPick(it, raw); else onCustom(raw);
  }
  const later = debounce(update, DEBOUNCE_MS);
  input.addEventListener('input', later);
  input.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== input) close(); }, 0));
  input.addEventListener('keydown', (e) => {
    if (box.hidden) return;
    const n = opts().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((active + 1) % n); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(active <= 0 ? n - 1 : active - 1); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'Enter' && active >= 0) { e.preventDefault(); choose(active); }
  });
  box.addEventListener('pointerdown', (e) => e.preventDefault());   // keep focus in the input
  box.addEventListener('click', (e) => { const o = e.target.closest('[role="option"]'); if (o) choose(opts().indexOf(o)); });
  const c = { close };
  combos.push(c);
  return c;
}

function bindShop() {
  const search = el('shop-q');
  const run = debounce(() => { shop.offset = 0; renderShop(); }, DEBOUNCE_MS);
  search.addEventListener('input', () => {
    shop.q = search.value;
    el('shop-clear').hidden = !search.value;
    run();
  });
  el('shop-search-form').addEventListener('submit', (e) => { e.preventDefault(); shop.q = search.value; shop.offset = 0; renderShop(); });
  const clear = () => { search.value = ''; shop.q = ''; shop.offset = 0; el('shop-clear').hidden = true; renderShop(); search.focus(); };
  el('shop-clear').addEventListener('click', clear);
  el('shop-empty-clear').addEventListener('click', clear);
  el('shop-empty-add').addEventListener('click', () => {
    const q = L.parseQuick(shop.q);
    try { commit(L.addItem(state, { name: q.name, qty: q.qty, unit: q.unit })); UI.toast(`Added ${q.name} without a price`); } catch (err) { UI.toast(err.message); }
  });
  el('shop-store').addEventListener('change', (e) => {
    shop.store = e.currentTarget.value;
    saveShopStore(shop.store);
    shop.offset = 0;
    renderShop();
  });
  el('shop-more').addEventListener('click', (e) => {
    shop.offset = Number(e.currentTarget.dataset.next) || 0;
    renderShop({ keepScroll: false });
    el('shop-results').querySelector('.cat-row')?.focus({ preventScroll: true });
  });
  el('shop-depts').addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const chips = [...el('shop-depts').children];
    const i = chips.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    const next = chips[(i + (e.key === 'ArrowRight' ? 1 : -1) + chips.length) % chips.length];
    shop.dept = next.dataset.dept; shop.offset = 0; renderShop();
    el('shop-depts').querySelector(`[data-dept="${CSS.escape(shop.dept)}"]`)?.focus();
  });
  el('shop-form').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ci-step]');
    if (!b) return;
    sheetQty = Math.min(99, Math.max(1, sheetQty + Number(b.dataset.ciStep)));
    el('ci-qty').textContent = String(sheetQty);
  });
  el('shop-form').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!sheetItem || !feed) return;
    const msg = addPriced(sheetItem, sheetQty);
    el('shop-sheet').close();
    UI.toast(msg);
  });
  el('shop-sheet').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close(); });
  el('shop-sheet').addEventListener('close', () => { sheetItem = null; sheetOpener?.focus?.({ preventScroll: true }); sheetOpener = null; });

  // Add bar (desktop) and the add sheet's Item field (mobile) share the matcher.
  const addbar = el('addbar');
  bindSuggest(el('quick-name'), el('quick-sug'), {
    onPick: (it, raw) => {
      const q = L.parseQuick(raw);
      const typed = addbar.elements.qty.value;
      const msg = addPriced(it, q.qty ?? (Number(typed) > 0 ? Number(typed) : 1), q.unit || '');
      addbar.elements.text.value = ''; addbar.elements.qty.value = ''; addbar.elements.unit.value = '';
      UI.setStatus(el('list-status'), '');
      el('quick-name').focus();
      UI.toast(msg);
    },
    onCustom: () => addbar.requestSubmit(),
  });
  const form = el('item-form');
  bindSuggest(el('f-name'), el('sheet-sug'), {
    onPick: (it, raw) => {
      const q = L.parseQuick(raw);
      const msg = addPriced(it, q.qty ?? (Number(form.elements.qty.value) > 0 ? Number(form.elements.qty.value) : 1), q.unit || '');
      form.elements.name.value = ''; form.elements.qty.value = 1; form.elements.unit.value = ''; form.elements.notes.value = '';
      UI.setStatus(el('sheet-status'), `${msg}. Add another or close.`);
      el('f-name').focus();
    },
    onCustom: () => form.requestSubmit(el('sheet-submit')),
  });
}

// L16: say what actually went wrong (a damaged file is not a network problem).
function feedProblem(err) {
  if (err instanceof Prices.FeedFormatError) return `${err.message}; it can't be read until the next refresh is published.`;
  return `the price snapshot couldn't be opened (${err?.name || 'Error'}: ${err?.message || err}).`;
}
function unlockError(err) {
  if (err instanceof Prices.WrongPassphraseError) return 'Wrong passphrase. Please try again.';
  if (err instanceof Prices.FeedFormatError) return 'The price snapshot file is damaged, so it can\'t be opened. Try again after the next price refresh.';
  return 'Could not unlock the price snapshot.';
}

async function initPrices() {
  bindShop();
  el('unlock-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = el('unlock-pass');
    const btn = el('unlock-btn');
    btn.disabled = true;
    UI.setStatus(el('unlock-status'), 'Unlocking…');
    const t0 = performance.now();
    try {
      const res = await Prices.unlockWithPassphrase(priceEnv, input.value, undefined, undefined, timedDecode);
      perf.unlockTotal = performance.now() - t0;
      input.value = '';
      UI.setStatus(el('unlock-status'), '');
      showShop(res);
      perf.usable = performance.now() - t0;
      el('shop-q').focus({ preventScroll: true });
    } catch (err) {
      input.value = '';
      input.focus();
      UI.setStatus(el('unlock-status'), unlockError(err), 'error');
      if (!(err instanceof Prices.WrongPassphraseError)) console.warn(`price feed: ${feedProblem(err)}`);
    } finally { btn.disabled = false; }
  });
  el('prices-forget').addEventListener('click', async () => {
    await Prices.forgetKeys();
    showShop(null);
    UI.setStatus(el('unlock-status'), 'Passphrase forgotten on this device.');
  });
  priceEnv = await Prices.loadFeed();
  feedAvailable = Boolean(priceEnv);
  document.querySelectorAll('[data-needs-feed]').forEach((n) => { n.hidden = !feedAvailable; });
  if (!feedAvailable) { route(); return; }
  decoder = makeDecoder();
  route();
  const t0 = performance.now();
  try {
    const res = await Prices.unlockWithCache(priceEnv, undefined, undefined, timedDecode);
    if (res) { showShop(res); perf.usable = performance.now() - t0; perf.cached = true; } else showShop(null);
  } catch (err) {
    console.warn(`price feed: ${feedProblem(err)}`);
    showShop(null);
    UI.setStatus(el('unlock-status'), unlockError(err), 'error');
  }
}

async function init() {
  document.querySelectorAll('[data-version]').forEach((n) => { n.textContent = `v${VERSION}`; });
  UI.fillUnitSelects();
  bind();
  bindFavorites();
  bindSaveLoad();
  bindSort();
  bindConfirm();
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
  }
  if (favLoaded.notice) {
    showNotice(`Combined ${favLoaded.merged === 1 ? '1 duplicate favorite' : `${favLoaded.merged} duplicate Favorites`}: the same item at the same store is now one favorite, whatever the amount. A copy of the old set was kept in this browser (${F.FAVORITES_DEDUPE_BAK_KEY}).`);
  }
  if (favLoaded.problem === 'unreadable') {
    showNotice(`Your saved Favorites couldn't be read, so ShopSmartR started a new set.${favLoaded.backedUp ? ' A copy of the old data was kept in this browser (shopsmartr:favorites:v1.bak).' : ''}`);
  }
  if (loaded.problem === 'unavailable' || favLoaded.problem === 'unavailable') showNotice(CANT_SAVE);
}

init();
