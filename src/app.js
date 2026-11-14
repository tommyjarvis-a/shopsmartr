// Wiring: loads data, owns state, routes between screens and connects events to the pure modules.
import { VERSION } from './version.js';
import { lookupZip, storesNear, normalizeZip } from './geo.js';
import { validateStoresDoc, indexById, CHAINS } from './stores.js';
import * as L from './list.js';
import { loadState, saveState } from './storage.js';
import { toCSV, toText } from './export.js';
import { loadPrices } from './prices.js';
import * as UI from './ui.js';

const el = (id) => document.getElementById(id);
const SCREENS = ['list', 'stores', 'ads'];
let state = loadState();
let data = { stores: [], chains: {}, byId: {}, zips: {}, asOf: '' };
let nearby = [];
let listFilter = '';   // '' = all stores
let chainFilter = '';  // '' = all chains (stores screen)

function commit(next) {
  state = next;
  saveState(state);
  renderAll();
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
  if (!zip) { if (!quiet) UI.setStatus(status, 'Enter a 5-digit zip code.', 'error'); return; }
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
  form.elements.qty.value = it?.qty ?? 1;
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
const asText = () => toText(state.items, data.byId, { date: stamp() });

async function menuAction(action) {
  closeMenu();
  if (action === 'csv') UI.download(`shopsmartr-list-${stamp()}.csv`, toCSV(state.items, data.byId), 'text/csv;charset=utf-8');
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

async function init() {
  document.querySelectorAll('[data-version]').forEach((n) => { n.textContent = `v${VERSION}`; });
  UI.fillUnitSelects();
  bind();
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
  // Phase-2 hook: an optional encrypted price feed. Absent file => nothing is shown.
  loadPrices().then((prices) => { if (prices) document.body.dataset.prices = 'available'; });
}

init();
