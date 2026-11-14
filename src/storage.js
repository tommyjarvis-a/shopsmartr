// localStorage persistence with a versioned key. The storage object is injectable for tests.
import { emptyState, cleanItemInput } from './list.js';

export const STORAGE_KEY = 'shopsmartr:v1';

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

/** Parses saved JSON defensively; bad or foreign data falls back to an empty state. */
export function deserialize(json) {
  const base = emptyState();
  let raw;
  try { raw = JSON.parse(json); } catch { return base; }
  if (!raw || typeof raw !== 'object' || raw.version !== 1) return base;
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
  try {
    const json = storage.getItem(STORAGE_KEY);
    return json ? deserialize(json) : emptyState();
  } catch { return emptyState(); }
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
