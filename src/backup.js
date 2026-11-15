// "Save list" / "Load list": a versioned JSON file the household keeps outside the browser.
// Pure builders and validators; app.js does the file picking, sharing and storage writes.
// Only list, favorites, store picks and settings go in. Never the price passphrase, the cached
// key (that lives in IndexedDB and is never read here) or any price catalog data.
import { serialize, deserialize } from './storage.js';
import { serializeFavorites, deserializeFavorites, emptyFavorites, nameKey } from './favorites.js';
import { emptyState, newId, normUnit, storeKeyOf, cleanSort, MAX_QTY } from './list.js';

export const BACKUP_SCHEMA = 'shopsmartr.backup/1';
/** Copy of the list and favorites taken just before a "Load list" replace. */
export const PRE_LOAD_BAK_KEY = 'shopsmartr:beforeLoad:v1.bak';
/** { lastSavedAt, nudgeHiddenUntil, firstSeenAt } as ISO strings. */
export const BACKUP_META_KEY = 'shopsmartr:backupMeta:v1';
const DAY = 86400000;
export const NUDGE_DAYS = 7;

export function backupFilename(stamp) {
  return `shopsmartr-list-${stamp}.json`;
}
export const NOT_A_LIST = 'That file isn\'t a ShopSmartR list';

const SHOP_STORE_RE = /^[\w-]{1,40}:[\w-]{1,40}$/;

/**
 * The backup document. state = list state, favs = favorites, shopStore = Shop store key,
 * listSort = { by, dir }. Fields are copied by name, so nothing else in memory can leak in.
 */
export function makeBackup({ state, favs = emptyFavorites(), shopStore = '', listSort = null, appVersion, now = new Date() }) {
  // Round-trip through the same cleaners the app loads with: only known fields survive.
  const list = deserialize(serialize(state));
  const fav = deserializeFavorites(serializeFavorites(favs));
  return {
    schema: BACKUP_SCHEMA,
    appVersion: String(appVersion ?? ''),
    createdAt: new Date(now).toISOString(),
    list: { items: list.items },
    favorites: { items: fav.items, meals: fav.meals },
    stores: { shopStore: SHOP_STORE_RE.test(shopStore) ? shopStore : '', selectedStoreIds: list.selectedStoreIds },
    settings: { zip: list.zip, radiusMi: list.radiusMi, chains: list.chains, listSort: cleanSort(listSort) },
  };
}

export function backupJSON(doc) {
  return `${JSON.stringify(doc, null, 1)}\n`;
}

const isObj = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);

/**
 * Validates a backup file's text. Returns { ok: true, backup, summary } with cleaned contents
 * ({ state, favs, shopStore, listSort, appVersion, createdAt }), or { ok: false, error }.
 */
export function parseBackup(text) {
  let raw;
  if (typeof text !== 'string' || text.length > 5e6) return { ok: false, error: `${NOT_A_LIST} (it's too large)` };
  try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { return { ok: false, error: NOT_A_LIST }; }
  if (!isObj(raw) || typeof raw.schema !== 'string') return { ok: false, error: NOT_A_LIST };
  const m = /^shopsmartr\.backup\/(\d+)$/.exec(raw.schema);
  if (!m) return { ok: false, error: NOT_A_LIST };
  if (m[1] !== '1') return { ok: false, error: 'This list was saved by a newer ShopSmartR. Update the app, then try again.' };
  if (typeof raw.appVersion !== 'string' || !/^\d+\.\d+\.\d+/.test(raw.appVersion)) return { ok: false, error: 'The saved list is missing its app version.' };
  const created = Date.parse(raw.createdAt);
  if (!Number.isFinite(created)) return { ok: false, error: 'The saved list is missing its date.' };
  if (!isObj(raw.list) || !Array.isArray(raw.list.items)) return { ok: false, error: 'The saved list has no list items section.' };
  const favRaw = isObj(raw.favorites) ? raw.favorites : {};
  if (('items' in favRaw && !Array.isArray(favRaw.items)) || ('meals' in favRaw && !Array.isArray(favRaw.meals))) return { ok: false, error: 'The favorites in this file are damaged.' };
  const stores = isObj(raw.stores) ? raw.stores : {};
  const settings = isObj(raw.settings) ? raw.settings : {};
  const state = deserialize(JSON.stringify({
    version: 1, items: raw.list.items, selectedStoreIds: stores.selectedStoreIds,
    zip: settings.zip, radiusMi: settings.radiusMi, chains: settings.chains,
  }));
  const favs = deserializeFavorites(JSON.stringify({ version: 1, items: favRaw.items ?? [], meals: favRaw.meals ?? [] }));
  const shopStore = typeof stores.shopStore === 'string' && SHOP_STORE_RE.test(stores.shopStore) ? stores.shopStore : '';
  const dropped = raw.list.items.length - state.items.length;
  const backup = { state, favs, shopStore, listSort: cleanSort(settings.listSort), appVersion: raw.appVersion, createdAt: new Date(created).toISOString() };
  return { ok: true, backup, summary: summarize(backup, dropped) };
}

export function summarize(b, dropped = 0) {
  return {
    items: b.state.items.length,
    listStores: new Set(b.state.items.map(storeKeyOf).filter(Boolean)).size,
    priced: b.state.items.filter((i) => i.priced).length,
    favorites: b.favs.items.length,
    meals: b.favs.meals.length,
    stores: b.state.selectedStoreIds.length,
    dropped,
    appVersion: b.appVersion,
    createdAt: b.createdAt,
  };
}

/** "12 list items · 4 favorites · 2 meals · 3 stores" */
export function summaryText(s) {
  const n = (k, one, many = `${one}s`) => `${s[k]} ${s[k] === 1 ? one : many}`;
  return [n('items', 'list item'), n('favorites', 'favorite'), n('meals', 'meal'), n('stores', 'store')].join(' · ');
}

/** Merge key for list lines: name + unit + source store (L5 style name folding). */
export function lineKey(it) {
  return `${nameKey(it.name)}|${normUnit(it.unit) || String(it.unit ?? '').toLowerCase()}|${storeKeyOf(it)}`;
}

const asOf = (it) => { const t = Date.parse(it.priced?.asOf ?? ''); return Number.isFinite(t) ? t : -Infinity; };
/** Two matching lines become one: quantities add (capped), the newer price snapshot wins. */
export function combineLines(a, b) {
  const qty = a.qty == null && b.qty == null ? null : Math.min(MAX_QTY, Math.round(((a.qty ?? 1) + (b.qty ?? 1)) * 1000) / 1000);
  // Done if either copy was done (checked OR).
  const out = { ...a, qty, checked: Boolean(a.checked || b.checked) };
  const newer = !a.priced || (b.priced && asOf(b) > asOf(a)) ? b.priced : a.priced;
  if (newer) out.priced = newer; else delete out.priced;
  if (!out.notes && b.notes) out.notes = b.notes;
  return out;
}

/**
 * combine=true (list lines): a match is combined into the existing line. combine=false
 * (favorites): a match is skipped.
 */
function mergeRows(current, incoming, keyOf, combine) {
  const at = new Map(current.map((it, i) => [keyOf(it), i]));
  const ids = new Set(current.map((i) => i.id));
  const out = [...current];
  let added = 0; let combined = 0;
  for (const it of incoming) {
    const k = keyOf(it);
    if (at.has(k)) {
      combined += 1;
      if (combine) out[at.get(k)] = combineLines(out[at.get(k)], it);
      continue;
    }
    at.set(k, out.length);
    out.push(ids.has(it.id) ? { ...it, id: newId() } : it);
    ids.add(out[out.length - 1].id);
    added += 1;
  }
  return { rows: out, added, combined };
}

/**
 * Applies a parsed backup. mode 'replace': the file's list, favorites, store picks and settings
 * replace the current ones. mode 'merge': a list line with the same name + unit + source store
 * as one already there is combined into it (quantities add, the newer price wins); other lines
 * are added. Favorites with the same name + unit + store are skipped, meals with the same name
 * are skipped, store picks are united, and zip, distance and sort keep the current values unless
 * unset. Returns { state, favs, shopStore, listSort, added, combined }.
 */
export function applyBackup(cur, b, mode) {
  if (mode === 'replace') {
    return { state: b.state, favs: b.favs, shopStore: b.shopStore || cur.shopStore, listSort: b.listSort, added: b.state.items.length, combined: 0 };
  }
  if (mode !== 'merge') throw new Error('Choose merge or replace');
  const items = mergeRows(cur.state.items, b.state.items, lineKey, true);
  const favItems = mergeRows(cur.favs.items, b.favs.items, lineKey, false);
  const mealNames = new Set(cur.favs.meals.map((m) => nameKey(m.name)));
  const mealIds = new Set(cur.favs.meals.map((m) => m.id));
  const meals = [...cur.favs.meals];
  for (const m of b.favs.meals) {
    if (mealNames.has(nameKey(m.name))) continue;
    mealNames.add(nameKey(m.name));
    meals.push(mealIds.has(m.id) ? { ...m, id: newId() } : m);
  }
  const base = emptyState();
  const s = cur.state;
  return {
    state: {
      ...s,
      items: items.rows,
      selectedStoreIds: [...new Set([...s.selectedStoreIds, ...b.state.selectedStoreIds])],
      zip: s.zip || b.state.zip,
      radiusMi: s.zip ? s.radiusMi : (b.state.zip ? b.state.radiusMi : s.radiusMi ?? base.radiusMi),
      chains: [...new Set([...(s.chains ?? []), ...b.state.chains])],
    },
    favs: { ...cur.favs, items: favItems.rows, meals },
    shopStore: cur.shopStore || b.shopStore,
    listSort: cur.listSort,
    added: items.added,
    combined: items.combined,
  };
}

// ---------- "Last saved N days ago — Save list" nudge ----------
export function cleanMeta(x) {
  const iso = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null);
  return { lastSavedAt: iso(x?.lastSavedAt), nudgeHiddenUntil: iso(x?.nudgeHiddenUntil), firstSeenAt: iso(x?.firstSeenAt) };
}
export function loadMeta(storage = globalThis.localStorage) {
  try { return cleanMeta(JSON.parse(storage?.getItem(BACKUP_META_KEY) ?? 'null')); } catch { return cleanMeta(null); }
}
export function saveMeta(meta, storage = globalThis.localStorage) {
  try { storage.setItem(BACKUP_META_KEY, JSON.stringify(cleanMeta(meta))); return true; } catch { return false; }
}

export const NEVER_SAVED_DAYS = 3;
/**
 * Nudge text, or null when it shouldn't show. Shows when the list isn't empty and either the
 * last file save is 7+ days old, or it was never saved and the list (firstSeenAt: when this
 * device's list first had items) is 3+ days old; and the user hasn't hidden it in the last 7 days.
 */
export function nudgeText(meta, itemCount, now = Date.now()) {
  const m = cleanMeta(meta);
  if (!itemCount) return null;
  if (m.nudgeHiddenUntil && Date.parse(m.nudgeHiddenUntil) > now) return null;
  const since = m.lastSavedAt ?? m.firstSeenAt;
  if (!since) return null;
  const days = Math.floor((now - Date.parse(since)) / DAY);
  if (days < (m.lastSavedAt ? NUDGE_DAYS : NEVER_SAVED_DAYS)) return null;
  return m.lastSavedAt ? `Last saved ${days} day${days === 1 ? '' : 's'} ago` : 'Not saved to a file yet';
}

/** "16 items · last saved to a file Nov 3 (12 days ago)" for the menu's storage line. */
export function savedLine(meta, itemCount, now = Date.now()) {
  const m = cleanMeta(meta);
  const items = `${itemCount} item${itemCount === 1 ? '' : 's'}`;
  if (!m.lastSavedAt) return `${items} · never saved to a file`;
  const t = Date.parse(m.lastSavedAt);
  const days = Math.max(0, Math.floor((now - t) / DAY));
  const ago = days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`;
  return `${items} · last saved to a file ${new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} (${ago})`;
}
export function hideNudge(meta, now = Date.now()) {
  return { ...cleanMeta(meta), nudgeHiddenUntil: new Date(now + NUDGE_DAYS * DAY).toISOString() };
}
export function markSaved(meta, now = Date.now()) {
  return { ...cleanMeta(meta), lastSavedAt: new Date(now).toISOString(), nudgeHiddenUntil: null };
}

/** navigator.storage.persist() result for the ⋮ menu. persisted: true | false | null (unsupported). */
export function storageText(persisted) {
  if (persisted === true) return 'Storage: persistent';
  if (persisted === false) return 'Storage: may be cleared by the browser';
  return 'Storage: browser default';
}
