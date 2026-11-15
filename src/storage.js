// localStorage persistence with a versioned key. The storage object is injectable for tests.
import { emptyState, cleanItemInput } from './list.js';

export const STORAGE_KEY = 'shopsmartr:v1';
export const BACKUP_KEY = 'shopsmartr:v1.bak';

export function serialize(state) {
  return JSON.stringify({
    version: 1,
    items: state.items,
    selectedStoreIds: state.selectedStoreIds,
    zip: state.zip,
    radiusMi: state.radiusMi,
    chains: state.chains,
  });
}

/** True when json parses as a ShopSmartR v1 document (rows may still be partly invalid). */
export function isReadable(json) {
  try { const raw = JSON.parse(json); return Boolean(raw) && typeof raw === 'object' && raw.version === 1; } catch { return false; }
}

/** Parses saved JSON defensively; bad or foreign data falls back to an empty state. */
export function deserialize(json) {
  const base = emptyState();
  if (!isReadable(json)) return base;
  const raw = JSON.parse(json);
  const items = [];
  for (const it of Array.isArray(raw.items) ? raw.items : []) {
    try {
      if (!it || typeof it.id !== 'string') continue;
      items.push({ id: it.id, ...cleanItemInput(it), checked: Boolean(it.checked) });
    } catch { /* drop invalid rows */ }
  }
  const radius = Number(raw.radiusMi);
  return {
    ...base,
    items,
    selectedStoreIds: Array.isArray(raw.selectedStoreIds) ? raw.selectedStoreIds.filter((s) => typeof s === 'string') : [],
    zip: typeof raw.zip === 'string' ? raw.zip.slice(0, 10) : '',
    radiusMi: Number.isFinite(radius) && radius > 0 && radius <= 200 ? radius : base.radiusMi,
    chains: Array.isArray(raw.chains) ? raw.chains.filter((c) => typeof c === 'string') : [],
  };
}

export function saveState(state, storage = globalThis.localStorage) {
  try { storage.setItem(STORAGE_KEY, serialize(state)); return true; } catch { return false; }
}

export function loadState(storage = globalThis.localStorage) {
  return loadStateWithStatus(storage).state;
}

/**
 * Loads state and reports problems the UI should tell the user about:
 *   problem: null | 'unreadable' (saved data could not be read; a copy was kept in BACKUP_KEY)
 *          | 'unavailable' (this browser won't let us save, e.g. storage blocked)
 * An unreadable value is copied to BACKUP_KEY before anything can overwrite it.
 */
export function loadStateWithStatus(storage = globalThis.localStorage) {
  let json;
  try {
    if (!storage) throw new Error('no storage');
    json = storage.getItem(STORAGE_KEY);
    const probe = `${STORAGE_KEY}:probe`;
    storage.setItem(probe, '1');
    storage.removeItem(probe);
  } catch {
    return { state: json ? deserialize(json) : emptyState(), problem: 'unavailable', backedUp: false };
  }
  if (!json) return { state: emptyState(), problem: null, backedUp: false };
  if (isReadable(json)) return { state: deserialize(json), problem: null, backedUp: false };
  let backedUp = false;
  try { storage.setItem(BACKUP_KEY, json); backedUp = true; } catch { /* ignore */ }
  return { state: emptyState(), problem: 'unreadable', backedUp };
}

/** Minimal in-memory Storage for tests and private-mode fallback. */
export function memoryStorage() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    clear: () => m.clear(),
  };
}

/** Device-local choice of store in the Shop view (a catalog store key such as "wegmans:90"). */
export const SHOP_STORE_KEY = 'shopsmartr:shopStore:v1';
export function loadShopStore(storage = globalThis.localStorage) {
  try { const v = storage?.getItem(SHOP_STORE_KEY); return typeof v === 'string' && /^[\w-]{1,40}:[\w-]{1,40}$/.test(v) ? v : ''; } catch { return ''; }
}
export function saveShopStore(key, storage = globalThis.localStorage) {
  try { storage.setItem(SHOP_STORE_KEY, String(key)); return true; } catch { return false; }
}
