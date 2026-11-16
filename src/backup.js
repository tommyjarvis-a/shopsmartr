// "Save list" / "Load list": a versioned JSON file the household keeps outside the browser.
// Pure builders and validators; app.js does the file picking, sharing and storage writes.
// Only list, favorites, store picks and settings go in. Never the price passphrase, the cached
// key (that lives in IndexedDB and is never read here) or any price catalog data.
import { serialize, deserialize } from './storage.js';
import { serializeFavorites, deserializeFavorites, emptyFavorites, nameKey, favKey, dedupeFavorites } from './favorites.js';
import { emptyState, newId, storeKeyOf, normUnit, MAX_QTY } from './list.js';
import { cleanPrefs } from './keys.js';
import { APP_NAME, FILE_STEM } from './brand.js';
import { cleanUserRecipes, CAPS as IMPORT_CAPS } from './importer.js';

export const BACKUP_SCHEMA = 'shopsmartr.backup/2';
/**
 * v0.2.1: backup/2 adds favorites.recipes (saved recipes). backup/1 files still load.
 * v0.2.4 (full restore): backup/2 gains an optional `prefs` section (device settings from the
 * key registry in keys.js). Additive, so the format id stays /2 and older app versions ignore it.
 * v0.2.6: backup/2 gains an optional top-level `userRecipes` array (imported recipes, the
 * shopsmartr:userRecipes:v1 store). Also additive: files without it still load, and keep this device's.
 */
export const BACKUP_SCHEMAS_READ = ['1', '2'];
/** Copy of the list and favorites taken just before a "Load list" replace. */
export const PRE_LOAD_BAK_KEY = 'shopsmartr:beforeLoad:v1.bak';
/** { lastSavedAt, nudgeHiddenUntil, firstSeenAt } as ISO strings. */
export const BACKUP_META_KEY = 'shopsmartr:backupMeta:v1';
const DAY = 86400000;
export const NUDGE_DAYS = 7;

export function backupFilename(stamp) {
  return `${FILE_STEM}-backup-${stamp}.json`;
}
export const NOT_A_LIST = `That file isn't a ${APP_NAME} backup`;
/** Load list limits (L24): checked on the file size before reading, and on the item count. */
export const MAX_LOAD_BYTES = 5 * 1024 * 1024;
export const MAX_LOAD_ITEMS = 5000;
export const TOO_LARGE = `That file is too large to be a ${APP_NAME} backup (over 5 MB).`;
export const tooManyText = (n) => `That file has ${n.toLocaleString('en-US')} items. Load list takes up to ${MAX_LOAD_ITEMS.toLocaleString('en-US')}.`;
/** saveIds this device already merged, loaded with Replace, or saved (L23/L27): { [saveId]: { at, how } }. */
export const MERGED_KEY = 'shopsmartr:mergedSaves:v1';
const SAVE_ID_RE = /^[A-Za-z0-9-]{8,64}$/;
export function newSaveId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 15) | 64; b[8] = (b[8] & 63) | 128;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const SHOP_STORE_RE = /^[\w-]{1,40}:[\w-]{1,40}$/;

/**
 * The backup document. state = list state, favs = favorites, shopStore = Shop store key,
 * Fields are copied by name, so nothing else in memory can leak in. The sort choice is a device
 * preference and is not saved (L22). saveId is a random UUID per saved file (L23).
 */
export function makeBackup({ state, favs = emptyFavorites(), shopStore = '', appVersion, now = new Date(), saveId = newSaveId(), prefs = {}, userRecipes = [] }) {
  // Round-trip through the same cleaners the app loads with: only known fields survive.
  const list = deserialize(serialize(state));
  const fav = deserializeFavorites(serializeFavorites(favs));
  return {
    schema: BACKUP_SCHEMA,
    saveId: String(saveId),
    appVersion: String(appVersion ?? ''),
    createdAt: new Date(now).toISOString(),
    list: { items: list.items },
    favorites: { items: fav.items, meals: fav.meals, recipes: fav.recipes ?? [] },
    stores: { shopStore: SHOP_STORE_RE.test(shopStore) ? shopStore : '', selectedStoreIds: list.selectedStoreIds },
    settings: { zip: list.zip, radiusMi: list.radiusMi, chains: list.chains },
    prefs: cleanPrefs(prefs),
    userRecipes: cleanUserRecipes(userRecipes),
  };
}

export function backupJSON(doc) {
  return `${JSON.stringify(doc, null, 1)}\n`;
}

const isObj = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);

/**
 * Validates a backup file's text. Returns { ok: true, backup, summary } with cleaned contents
 * ({ state, favs, shopStore, saveId, appVersion, createdAt }), or { ok: false, error }.
 * A sort choice in the file (0.1.5 files) is ignored: sort is device-only (L22).
 */
export function parseBackup(text) {
  let raw;
  if (typeof text !== 'string') return { ok: false, error: NOT_A_LIST };
  if (text.length > MAX_LOAD_BYTES) return { ok: false, error: TOO_LARGE };
  try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { return { ok: false, error: NOT_A_LIST }; }
  if (!isObj(raw) || typeof raw.schema !== 'string') return { ok: false, error: NOT_A_LIST };
  const m = /^shopsmartr\.backup\/(\d+)$/.exec(raw.schema);
  if (!m) return { ok: false, error: NOT_A_LIST };
  if (!BACKUP_SCHEMAS_READ.includes(m[1])) return { ok: false, error: `This backup was saved by a newer ${APP_NAME}. Update the app, then try again.` };
  if (typeof raw.appVersion !== 'string' || !/^\d+\.\d+\.\d+/.test(raw.appVersion)) return { ok: false, error: 'The saved list is missing its app version.' };
  const created = Date.parse(raw.createdAt);
  if (!Number.isFinite(created)) return { ok: false, error: 'The saved list is missing its date.' };
  if (!isObj(raw.list) || !Array.isArray(raw.list.items)) return { ok: false, error: 'The saved list has no list items section.' };
  if (raw.list.items.length > MAX_LOAD_ITEMS) return { ok: false, error: tooManyText(raw.list.items.length) };
  const favRaw = isObj(raw.favorites) ? raw.favorites : {};
  const favN = (Array.isArray(favRaw.items) ? favRaw.items.length : 0) + (Array.isArray(favRaw.meals) ? favRaw.meals.length : 0);
  if (favN > MAX_LOAD_ITEMS) return { ok: false, error: `That file has ${favN.toLocaleString('en-US')} Favorites and meals. Load list takes up to ${MAX_LOAD_ITEMS.toLocaleString('en-US')}.` };
  if (Array.isArray(favRaw.recipes) && favRaw.recipes.length > MAX_LOAD_ITEMS) return { ok: false, error: `That file has ${favRaw.recipes.length.toLocaleString('en-US')} saved recipes. Load list takes up to ${MAX_LOAD_ITEMS.toLocaleString('en-US')}.` };
  if (('items' in favRaw && !Array.isArray(favRaw.items)) || ('meals' in favRaw && !Array.isArray(favRaw.meals)) || ('recipes' in favRaw && !Array.isArray(favRaw.recipes))) return { ok: false, error: 'The Favorites in this file are damaged.' };
  if ('userRecipes' in raw && !Array.isArray(raw.userRecipes)) return { ok: false, error: 'The imported recipes in this file are damaged.' };
  if (Array.isArray(raw.userRecipes) && raw.userRecipes.length > MAX_LOAD_ITEMS) return { ok: false, error: `That file has ${raw.userRecipes.length.toLocaleString('en-US')} imported recipes. Load list takes up to ${MAX_LOAD_ITEMS.toLocaleString('en-US')}.` };
  const stores = isObj(raw.stores) ? raw.stores : {};
  const settings = isObj(raw.settings) ? raw.settings : {};
  const state = deserialize(JSON.stringify({
    version: 1, items: raw.list.items, selectedStoreIds: stores.selectedStoreIds,
    zip: settings.zip, radiusMi: settings.radiusMi, chains: settings.chains,
  }));
  const favs = deserializeFavorites(JSON.stringify({ version: 1, items: favRaw.items ?? [], meals: favRaw.meals ?? [], recipes: favRaw.recipes ?? [] }));
  const shopStore = typeof stores.shopStore === 'string' && SHOP_STORE_RE.test(stores.shopStore) ? stores.shopStore : '';
  const dropped = raw.list.items.length - state.items.length;
  // L25: one id per row. Exact duplicates are dropped; a different row reusing an id gets a new one.
  const ids = { dupes: 0, renewed: 0 };
  const uniq = (rows) => {
    const seen = new Map(); const out = [];
    for (const r of rows) {
      const j = JSON.stringify(r);
      if (seen.has(r.id)) {
        if (seen.get(r.id).has(j)) { ids.dupes += 1; continue; }
        seen.get(r.id).add(j);   // a later exact copy of this row is dropped too
        const id = freshId(seen); seen.set(id, new Set()); out.push({ ...r, id }); ids.renewed += 1; continue;
      }
      seen.set(r.id, new Set([j])); out.push(r);
    }
    return out;
  };
  state.items = uniq(state.items);
  favs.items = uniq(favs.items);
  favs.meals = uniq(favs.meals);
  const saveId = typeof raw.saveId === 'string' && SAVE_ID_RE.test(raw.saveId) ? raw.saveId : '';
  // hasRecipes: a backup/2 file says what the saved recipes are (even none); a /1 file doesn't.
  const prefs = cleanPrefs(raw.prefs);
  const hasUserRecipes = Array.isArray(raw.userRecipes);
  const userRecipes = hasUserRecipes ? cleanUserRecipes(raw.userRecipes) : [];
  const backup = { state, favs, shopStore, saveId, appVersion: raw.appVersion, createdAt: new Date(created).toISOString(), schemaVersion: Number(m[1]), hasRecipes: m[1] !== '1', prefs, hasUserRecipes, userRecipes };
  return { ok: true, backup, summary: { ...summarize(backup, dropped), duplicates: ids.dupes, renewedIds: ids.renewed } };
}
function freshId(seen) {
  let id;
  do id = newId(); while (seen.has(id));
  return id;
}

// ---------- merged / saved file ids (L23) ----------
export function cleanMerged(x) {
  const out = {};
  if (!isObj(x)) return out;
  const rows = Object.entries(x).filter(([k, v]) => SAVE_ID_RE.test(k) && isObj(v) && Number.isFinite(Date.parse(v.at)) && ['merged', 'saved', 'replaced'].includes(v.how));
  rows.sort((a, b) => Date.parse(b[1].at) - Date.parse(a[1].at));
  for (const [k, v] of rows.slice(0, 200)) out[k] = { at: new Date(Date.parse(v.at)).toISOString(), how: v.how };
  return out;
}
export function loadMerged(storage = globalThis.localStorage) {
  try { return cleanMerged(JSON.parse(storage?.getItem(MERGED_KEY) ?? 'null')); } catch { return {}; }
}
export function saveMerged(map, storage = globalThis.localStorage) {
  try { storage.setItem(MERGED_KEY, JSON.stringify(cleanMerged(map))); return true; } catch { return false; }
}
/** Records a saveId (keeps the first record: a later merge of a file saved here stays 'saved'). */
export function recordSaveId(map, saveId, how, now = Date.now()) {
  if (!saveId || !SAVE_ID_RE.test(saveId) || map[saveId]) return cleanMerged(map);
  return cleanMerged({ ...map, [saveId]: { at: new Date(now).toISOString(), how } });
}
/** Warning when merging this file again would double it, or null. */
export function repeatMergeText(map, saveId) {
  const r = saveId ? cleanMerged(map)[saveId] : null;
  if (!r) return null;
  const d = new Date(r.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (r.how === 'merged') return `This file was already merged on ${d}`;
  if (r.how === 'replaced') return `This file was already loaded on ${d}`;
  return `This file was saved from this list on ${d}`;
}

export function summarize(b, dropped = 0) {
  return {
    items: b.state.items.length,
    listStores: new Set(b.state.items.map(storeKeyOf).filter(Boolean)).size,
    priced: b.state.items.filter((i) => i.priced).length,
    // L34: count Favorites after the same-item combine that loading runs, so the pill matches what loads.
    favorites: dedupeFavorites(b.favs).favorites.items.length,
    meals: b.favs.meals.length,
    recipes: (b.favs.recipes ?? []).length,
    ...((b.userRecipes ?? []).length ? { userRecipes: b.userRecipes.length } : {}),   // v0.2.6, only when the file has some
    stores: b.state.selectedStoreIds.length,
    settings: Object.keys(b.prefs ?? {}).length,
    dropped,
    appVersion: b.appVersion,
    createdAt: b.createdAt,
  };
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** L56 (v0.2.6-alpha.1): Restore sheet wording that names the file's imported recipes. */
export function replaceText(sm) {
  const parts = ['Favorites', 'store picks'];
  if (sm.userRecipes) parts.push(plural(sm.userRecipes, 'imported recipe'));
  if (sm.settings) parts.push('settings');
  const what = parts.length > 2 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts.join(' and ');
  return `${what} ${parts.length === 1 ? 'is' : 'are'} replaced too.${sm.userRecipes ? ' Your current imported recipes are removed.' : ''}`;
}
export function mergeText(sm) {
  return `Keep my items and add the file's ${sm.items}. Matching items are combined.${sm.userRecipes ? ` Its ${plural(sm.userRecipes, 'imported recipe')} ${sm.userRecipes === 1 ? 'is' : 'are'} added too (yours are kept).` : ''}`;
}
/** L56: the toast after Replace or Merge, with item, imported-recipe and settings counts. */
export function restoreToast(mode, res, settings = 0) {
  const st = settings ? `, ${plural(settings, 'setting')}` : '';
  const items = plural(res.added, 'item');
  if (mode === 'replace') {
    const rx = res.rxIn || res.rxOut ? `, ${plural(res.rxIn ?? 0, 'imported recipe')}` : '';
    return `Backup restored · ${items}${rx}${st}`;
  }
  const rx = res.rxIn ? `, ${plural(res.rxIn, 'imported recipe')}` : '';
  return `Backup merged · ${items}${rx} added${res.combined ? `, ${res.combined} combined` : ''}${st}`;
}

/** "12 list items · 4 Favorites · 2 meals · 3 stores" */
export function summaryText(s) {
  const n = (k, one, many = `${one}s`) => `${s[k]} ${s[k] === 1 ? one : many}`;
  // L33: the plural names the Favorites collection (capitalized); one item is "1 favorite".
  return [n('items', 'list item'), n('favorites', 'favorite', 'Favorites'), s.recipes ? n('recipes', 'saved recipe') : '', n('meals', 'meal'), n('stores', 'store')].filter(Boolean).join(' · ');
}

/**
 * Merge key for list lines: name + unit + source store (L5 style name folding). Quantities of
 * matching lines add up, so the unit must match too. (Favorites merge on favKey, name + store.)
 */
export function lineKey(it) {
  return `${nameKey(it?.name)}|${normUnit(it?.unit) || String(it?.unit ?? '').toLowerCase()}|${storeKeyOf(it ?? {})}`;
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
 * are added. Favorites with the same name + store (favKey) are skipped, meals with the same name
 * are skipped, store picks are united, and zip and distance keep the current values unless
 * unset. Merge never changes the sort (L22); v0.2.4 Replace restores the file's settings (prefs), sort included,
 * and Merge only adds settings this device lacks. Returns { state, favs, shopStore, listSort, prefs, added, combined }.
 */
export function applyBackup(cur, b, mode) {
  if (mode === 'replace') {
    // A backup/2 file's saved recipes replace this device's; a backup/1 file has none, so they stay.
    // v0.2.4: the file's settings are restored too (a file without them leaves this device's alone).
    // v0.2.6: a file with a userRecipes section replaces the imported recipes; one without keeps this device's.
    return { state: b.state, favs: { ...dedupeFavorites(b.favs).favorites, recipes: b.hasRecipes ? (b.favs.recipes ?? []) : (cur.favs.recipes ?? []) }, shopStore: b.shopStore || cur.shopStore, listSort: b.prefs?.listSort ?? cur.listSort, prefs: { ...(b.prefs ?? {}) }, userRecipes: b.hasUserRecipes ? (b.userRecipes ?? []) : (cur.userRecipes ?? []), added: b.state.items.length, combined: 0,
      // L56: imported-recipe counts for the toast (a file without the section leaves this device's alone)
      rxIn: b.hasUserRecipes ? (b.userRecipes ?? []).length : 0, rxOut: b.hasUserRecipes ? (cur.userRecipes ?? []).length : 0, rxKept: !b.hasUserRecipes };
  }
  if (mode !== 'merge') throw new Error('Choose merge or replace');
  const items = mergeRows(cur.state.items, b.state.items, lineKey, true);
  const favItems = mergeRows(cur.favs.items, b.favs.items, favKey, false);
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
  const ur = mergeUserRecipes(cur.userRecipes ?? [], b.userRecipes ?? []);
  return {
    state: {
      ...s,
      items: items.rows,
      selectedStoreIds: [...new Set([...s.selectedStoreIds, ...b.state.selectedStoreIds])],
      zip: s.zip || b.state.zip,
      radiusMi: s.zip ? s.radiusMi : (b.state.zip ? b.state.radiusMi : s.radiusMi ?? base.radiusMi),
      chains: [...new Set([...(s.chains ?? []), ...b.state.chains])],
    },
    favs: { ...cur.favs, items: favItems.rows, meals, recipes: mergeRecipes(cur.favs.recipes ?? [], b.favs.recipes ?? []) },
    shopStore: cur.shopStore || b.shopStore,
    listSort: cur.listSort,
    userRecipes: ur,
    rxIn: ur.length - (cur.userRecipes ?? []).length,   // L56: imported recipes added
    // Merge only fills in settings this device doesn't have yet.
    prefs: Object.fromEntries(Object.entries(b.prefs ?? {}).filter(([k]) => !(k in (cur.prefs ?? {})))),
    added: items.added,
    combined: items.combined,
  };
}

/** Imported recipes united by id (this device's copy wins), newest first, within the app's cap. */
export function mergeUserRecipes(cur, incoming) {
  const ids = new Set(cur.map((r) => r.id));
  return [...cur, ...incoming.filter((r) => !ids.has(r.id))].slice(0, IMPORT_CAPS.recipes);
}
/** Saved recipes united by id; this device's copy wins. */
export function mergeRecipes(cur, incoming) {
  const ids = new Set(cur.map((r) => r.id));
  return [...cur, ...incoming.filter((r) => !ids.has(r.id))];
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
export function savedLine(meta, itemCount, now = Date.now(), recipeCount = 0) {
  const m = cleanMeta(meta);
  const items = `${itemCount} item${itemCount === 1 ? '' : 's'}${recipeCount ? ` · ${recipeCount} saved recipe${recipeCount === 1 ? '' : 's'}` : ''}`;
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

/**
 * v0.1.8 (L29): one Save list at a time. While a save is in flight, more calls get that same
 * result; for `ms` after a save finished, a repeat (a double tap landing on the reopened
 * "Save list first") returns the last file name instead of saving a second copy.
 */
export function makeSaveGuard(run, { ms = 800, now = () => Date.now() } = {}) {
  let busy = null;
  let last = { at: -Infinity, name: null };
  return async function guardedSave(...args) {
    if (busy) return busy;
    if (now() - last.at < ms) return last.name;
    busy = (async () => run(...args))();
    try {
      const name = await busy;
      if (name) last = { at: now(), name };
      return name;
    } finally { busy = null; }
  };
}
