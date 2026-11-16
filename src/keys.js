// v0.2.4: one registry for every shopsmartr:* storage key, so the full backup knows what to carry.
//   backup   = the household's data (list, Favorites, saved recipes, store picks, ingredient swaps)
//   settings = this device's preferences that a full restore brings back (sort, household size, app icon…)
//   exclude  = never in a backup: local safety copies, bookkeeping, and anything secret or derived
// The passphrase is never stored. The derived AES keys live in IndexedDB ('shopsmartr-keys') and
// decrypted prices/recipes are only ever in memory, so neither can reach a backup file.
// test/v024.test.mjs fails if code uses a shopsmartr:* key that isn't classified here.
import { cleanSort } from './list.js';
import { APP_ICON_KEY, cleanAppIcon } from './appicon.js';
import { cleanSwaps, HOUSEHOLD_KEY, RX_SORT_KEY, RX_SWAPS_KEY, RX_STORE_KEY } from './rx.js';
import { cleanRxSort } from './recipes.js';

const STORE_KEY_RE = /^[\w-]{1,40}:[\w-]{1,40}$/;
const json = { read: (raw) => { try { return JSON.parse(raw); } catch { return undefined; } }, write: (v) => JSON.stringify(v) };
const str = { read: (raw) => raw, write: (v) => String(v) };
/** Theme keys are placeholders until themes ship (v0.2.5); kept only when they look like a theme id. */
export const THEME_KEY = 'shopsmartr:theme:v1';
export const MODE_KEY = 'shopsmartr:mode:v1';

/**
 * Every key. `pref` entries travel in a backup file's `prefs` section: clean(value) returns the
 * cleaned value or undefined (dropped). Keys covered by the list/favorites/stores sections have `section`.
 */
export const KEY_REGISTRY = [
  { key: 'shopsmartr:v1', cls: 'backup', section: 'list, stores, settings', what: 'shopping list, store picks, zip and distance' },
  { key: 'shopsmartr:favorites:v1', cls: 'backup', section: 'favorites', what: 'Favorites, meals and saved recipes' },
  { key: 'shopsmartr:shopStore:v1', cls: 'backup', section: 'stores.shopStore', what: 'store chosen on Shop' },
  { key: RX_SWAPS_KEY, cls: 'backup', pref: 'rxSwaps', ...json, clean: (v) => { const c = cleanSwaps(v); return Object.keys(c).length ? c : undefined; }, what: 'ingredient swaps on recipes' },
  { key: 'shopsmartr:listSort:v1', cls: 'settings', pref: 'listSort', ...json, clean: (v) => (v && typeof v === 'object' ? cleanSort(v) : undefined), what: 'List sort' },
  { key: HOUSEHOLD_KEY, cls: 'settings', pref: 'household', ...str, clean: (v) => { const n = Number(v); return Number.isInteger(n) && n >= 1 && n <= 24 ? n : undefined; }, what: 'household size' },
  { key: APP_ICON_KEY, cls: 'settings', pref: 'appIcon', ...str, clean: (v) => (typeof v === 'string' && cleanAppIcon(v) === v ? v : undefined), what: 'app icon' },
  { key: RX_STORE_KEY, cls: 'settings', pref: 'rxStore', ...str, clean: (v) => (typeof v === 'string' && STORE_KEY_RE.test(v) ? v : undefined), what: 'store recipes are priced at' },
  { key: RX_SORT_KEY, cls: 'settings', pref: 'rxSort', ...json, clean: (v) => (v && typeof v === 'object' ? cleanRxSort(v) : undefined), what: 'recipe sort' },
  { key: THEME_KEY, cls: 'settings', pref: 'theme', ...str, clean: (v) => (typeof v === 'string' && /^[a-z][a-z-]{1,39}$/.test(v) ? v : undefined), what: 'theme (v0.2.5)' },
  { key: MODE_KEY, cls: 'settings', pref: 'mode', ...str, clean: (v) => (['auto', 'light', 'dark'].includes(v) ? v : undefined), what: 'light/dark mode (v0.2.5)' },
  { key: 'shopsmartr:collapsed:v1', cls: 'exclude', what: 'collapsed store sections (screen state)' },
  { key: 'shopsmartr:notes:v1', cls: 'exclude', what: 'love-note rotation' },
  { key: 'shopsmartr:backupMeta:v1', cls: 'exclude', what: 'last-saved bookkeeping for the save reminder' },
  { key: 'shopsmartr:mergedSaves:v1', cls: 'exclude', what: 'files this device already loaded' },
  { key: 'shopsmartr:v1.bak', cls: 'exclude', what: 'local copy of an unreadable list' },
  { key: 'shopsmartr:v1:probe', cls: 'exclude', what: 'storage write test' },
  { key: 'shopsmartr:favorites:v1.bak', cls: 'exclude', what: 'local copy of unreadable Favorites' },
  { key: 'shopsmartr:favorites:v1.predupe.bak', cls: 'exclude', what: 'local copy before the Favorites combine' },
  { prefix: 'shopsmartr:favorites:v1.predupe.', cls: 'exclude', what: 'later pre-combine copies' },
  { key: 'shopsmartr:favorites:v1.dedupeMeta', cls: 'exclude', what: 'Favorites combine bookkeeping' },
  { key: 'shopsmartr:beforeLoad:v1.bak', cls: 'exclude', what: 'local copy before Load › Replace' },
  { key: 'shopsmartr:beforeClear:v1.bak', cls: 'exclude', what: 'local copy before Clear checked items' },
];
/** Storage outside localStorage, always excluded: derived AES keys for the price and recipe feeds. */
export const EXCLUDED_STORES = [{ indexedDB: 'shopsmartr-keys', what: 'derived feed keys (never the passphrase)' }];

/** 'backup' | 'settings' | 'exclude' | null (unclassified). */
export function classifyKey(k) {
  const exact = KEY_REGISTRY.find((e) => e.key === k);
  if (exact) return exact.cls;
  const pre = KEY_REGISTRY.find((e) => e.prefix && String(k).startsWith(e.prefix));
  return pre ? pre.cls : null;
}
export const PREF_ENTRIES = KEY_REGISTRY.filter((e) => e.pref);

/** The device prefs a full backup carries: { household: 3, appIcon: 'love-basket', … } (only set ones). */
export function collectPrefs(storage = globalThis.localStorage) {
  const out = {};
  for (const e of PREF_ENTRIES) {
    let raw = null;
    try { raw = storage?.getItem(e.key); } catch { raw = null; }
    if (raw == null) continue;
    const v = e.clean(e.read(raw));
    if (v !== undefined) out[e.pref] = v;
  }
  return out;
}
/** Cleans a file's prefs section: unknown names and bad values are dropped. */
export function cleanPrefs(x) {
  const out = {};
  if (!x || typeof x !== 'object' || Array.isArray(x)) return out;
  for (const e of PREF_ENTRIES) if (e.pref in x) { const v = e.clean(x[e.pref]); if (v !== undefined) out[e.pref] = v; }
  return out;
}
/** Writes prefs to storage. Returns the pref names written. */
export function writePrefs(prefs, storage = globalThis.localStorage) {
  const done = [];
  for (const e of PREF_ENTRIES) {
    if (!(e.pref in prefs)) continue;
    try { storage.setItem(e.key, e.write(prefs[e.pref])); done.push(e.pref); } catch { /* storage full or blocked */ }
  }
  return done;
}
