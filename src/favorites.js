// Pure favorites model: staple items and favorite meals (named groups of items).
// Every function returns a new value; nothing touches the DOM. Persistence helpers take an
// injectable storage object so tests can use memoryStorage().
import { cleanItemInput, addItem, newId, storeKeyOf } from './list.js';

export const FAVORITES_KEY = 'shopsmartr:favorites:v1';
export const FAVORITES_BACKUP_KEY = 'shopsmartr:favorites:v1.bak';

export function emptyFavorites() {
  return { version: 1, items: [], meals: [], recipes: [] };
}

/** A favorite item: name, qty/unit, optional store tag and note (same rules as list items). */
function cleanFav(input) {
  const { name, qty, unit, storeId, notes } = cleanItemInput(input);
  return { name, qty, unit, storeId, notes };
}

function cleanMealName(name) {
  const s = String(name ?? '').trim().replace(/\s+/g, ' ').slice(0, 120);
  if (!s) throw new Error('Meal name is required');
  return s;
}

// ---------- staple items ----------
/** Thrown when an add or edit would make a second favorite with the same identity (M6). */
export class DuplicateFavoriteError extends Error {
  constructor(existing) {
    super(`${existing.name} is already in your Favorites`);
    this.name = 'DuplicateFavoriteError';
    this.existing = existing;
  }
}
/**
 * Every staple add goes through the identity check (v0.1.10, M6): name + store (favKey). An add
 * that matches an existing favorite throws DuplicateFavoriteError and changes nothing, so the
 * L30 migration never has anything to combine again.
 */
export function addFavorite(fav, input, id = newId()) {
  const row = { id, ...cleanFav(input) };
  const existing = findFavorite(fav, row);
  if (existing) throw new DuplicateFavoriteError(existing);
  return { ...fav, items: [...fav.items, row] };
}
/** Edits a favorite; an edit (rename or store change) into another favorite's identity throws DuplicateFavoriteError. */
export function updateFavorite(fav, id, patch) {
  const cur = fav.items.find((it) => it.id === id);
  if (!cur) return fav;
  const next = { ...cur, ...cleanFav({ ...cur, ...patch }) };
  const k = favKey(next);
  const other = fav.items.find((it) => it.id !== id && favKey(it) === k);
  if (other) throw new DuplicateFavoriteError(other);
  return { ...fav, items: fav.items.map((it) => (it.id === id ? next : it)) };
}
export function removeFavorite(fav, id) {
  return { ...fav, items: fav.items.filter((it) => it.id !== id) };
}

// ---------- favorite identity (stars on Shop results and list rows, v0.1.7) ----------
/**
 * The one favorite identity, shared by the Shop stars, the list stars, the Favorites tab and the
 * Favorites half of Load list merge: normalized name + store (the chosen store, else the price's
 * source store). v0.1.8 (L30): the unit is an amount, not part of the identity. A Shop result has
 * no unit, so "2 lb Boneless Chicken" starred on the list and the same chicken in Shop are one
 * favorite. (List lines still merge on name + unit + store: see backup.js lineKey.)
 */
export function favKey(x) {
  return `${nameKey(x?.name)}|${storeKeyOf(x ?? {})}`;
}

/**
 * v0.1.8 (L30) migration: v0.1.7 keyed favorites on name + unit + store, so the same item could be
 * a favorite twice ("2 lb" from the list, no unit from Shop). Keeps the FIRST of each identity in
 * place (its qty/unit/store as the user made it), fills its empty qty, unit or note from the later
 * copies, and joins two different notes. Meals are never touched. Returns { favorites, merged }.
 */
export function dedupeFavorites(fav) {
  const at = new Map();
  const items = [];
  let merged = 0;
  for (const it of fav.items) {
    const k = favKey(it);
    if (!at.has(k)) { at.set(k, items.length); items.push(it); continue; }
    merged += 1;
    const i = at.get(k);
    const a = items[i];
    const out = { ...a };
    if (a.qty == null && it.qty != null) out.qty = it.qty;
    if (!a.unit && it.unit) out.unit = it.unit;
    if (it.notes && !a.notes) out.notes = it.notes;
    else if (it.notes && a.notes && nameKey(it.notes) !== nameKey(a.notes)) out.notes = `${a.notes} · ${it.notes}`.slice(0, 500);
    items[i] = out;
  }
  return merged ? { favorites: { ...fav, items }, merged } : { favorites: fav, merged: 0 };
}
export const FAVORITES_DEDUPE_BAK_KEY = 'shopsmartr:favorites:v1.predupe.bak';
/**
 * v0.1.10 (M6): { noticedAt, extra: [keys] }. noticedAt makes the "Combined N duplicate…" notice
 * one-time; extra lists timestamped copies made by any later combine (the first copy in
 * FAVORITES_DEDUPE_BAK_KEY is never overwritten). At most MAX_EXTRA_DEDUPE_BAKS are kept.
 */
export const FAVORITES_DEDUPE_META_KEY = 'shopsmartr:favorites:v1.dedupeMeta';
export const MAX_EXTRA_DEDUPE_BAKS = 3;
const dedupeExtraBase = (iso) => `shopsmartr:favorites:v1.predupe.${iso.replace(/[^0-9TZ]/g, '')}`;
function readDedupeMeta(storage) {
  try {
    const m = JSON.parse(storage.getItem(FAVORITES_DEDUPE_META_KEY) ?? 'null');
    const extra = Array.isArray(m?.extra) ? m.extra.filter((k) => typeof k === 'string' && /^shopsmartr:favorites:v1\.predupe\.[0-9TZ]+(\.\d+)?\.bak$/.test(k)) : [];
    return { noticedAt: typeof m?.noticedAt === 'string' ? m.noticedAt : null, extra };
  } catch { return { noticedAt: null, extra: [] }; }
}
/**
 * Copies the pre-combine set aside without ever overwriting an earlier copy: the first goes to
 * FAVORITES_DEDUPE_BAK_KEY; later ones get a timestamped key, keeping the newest few. Throws when
 * the copy can't be written (the caller then loads unchanged).
 */
export function keepDedupeCopy(json, storage, now = new Date()) {
  const meta = readDedupeMeta(storage);
  if (storage.getItem(FAVORITES_DEDUPE_BAK_KEY) == null) {
    storage.setItem(FAVORITES_DEDUPE_BAK_KEY, json);
    return { key: FAVORITES_DEDUPE_BAK_KEY, meta };
  }
  const base = dedupeExtraBase(new Date(now).toISOString());
  let key = `${base}.bak`;
  for (let i = 2; storage.getItem(key) != null; i += 1) key = `${base}.${i}.bak`;
  storage.setItem(key, json);
  const extra = [...meta.extra.filter((k) => k !== key), key];
  while (extra.length > MAX_EXTRA_DEDUPE_BAKS) { const old = extra.shift(); try { storage.removeItem(old); } catch { /* ignore */ } }
  return { key, meta: { ...meta, extra } };
}
/** Favorite fields for a list row or a Shop result: name, qty, unit and its store (chosen or price source). */
export function favInputOf(x) {
  return { name: x.name, qty: x.qty ?? null, unit: x.unit ?? '', storeId: storeKeyOf(x), notes: '' };
}
export function findFavorite(fav, x) {
  const k = favKey(x);
  return fav.items.find((f) => favKey(f) === k) ?? null;
}
export const isFavorite = (fav, x) => Boolean(findFavorite(fav, x));
/** Star on: adds the favorite unless one with the same identity exists (then unchanged). */
export function starFavorite(fav, x, id = newId()) {
  return isFavorite(fav, x) ? fav : addFavorite(fav, favInputOf(x), id);
}
/** Star off: removes every favorite item with this identity (meals are never touched). */
export function unstarFavorite(fav, x) {
  const k = favKey(x);
  return { ...fav, items: fav.items.filter((f) => favKey(f) !== k) };
}

// ---------- meals ----------
/** source is the phase-2 hook: e.g. { type: 'recipe', id, url } when a recipe is starred. */
export function createMeal(fav, name, items = [], { id = newId(), source = null } = {}) {
  const meal = { id, name: cleanMealName(name), items: items.map((it) => ({ id: newId(), ...cleanFav(it) })) };
  if (source) meal.source = cleanSource(source);
  return { ...fav, meals: [...fav.meals, meal] };
}
export function renameMeal(fav, mealId, name) {
  const clean = cleanMealName(name);
  return mapMeal(fav, mealId, (m) => ({ ...m, name: clean }));
}
export function deleteMeal(fav, mealId) {
  return { ...fav, meals: fav.meals.filter((m) => m.id !== mealId) };
}
export function addMealItem(fav, mealId, input, id = newId()) {
  const item = { id, ...cleanFav(input) };
  return mapMeal(fav, mealId, (m) => ({ ...m, items: [...m.items, item] }));
}
export function updateMealItem(fav, mealId, itemId, patch) {
  return mapMeal(fav, mealId, (m) => ({
    ...m, items: m.items.map((it) => (it.id === itemId ? { ...it, ...cleanFav({ ...it, ...patch }) } : it)),
  }));
}
export function removeMealItem(fav, mealId, itemId) {
  return mapMeal(fav, mealId, (m) => ({ ...m, items: m.items.filter((it) => it.id !== itemId) }));
}
function mapMeal(fav, mealId, fn) {
  return { ...fav, meals: fav.meals.map((m) => (m.id === mealId ? fn(m) : m)) };
}

// ---------- phase-2 hook: star a recipe into Meals ----------
function cleanSource(src) {
  const out = { type: String(src.type || 'recipe').slice(0, 20) };
  if (src.id !== undefined && src.id !== null) out.id = String(src.id).slice(0, 100);
  if (typeof src.url === 'string' && /^https:\/\//.test(src.url)) out.url = src.url.slice(0, 500);
  return out;
}
/**
 * Phase 2: a recipe ({ id, title, url?, ingredients: [{ name, qty?, unit? }] }) becomes a meal.
 * Starring the same recipe twice updates the existing meal instead of adding another.
 */
export function starRecipe(fav, recipe) {
  const source = { type: 'recipe', id: recipe.id, url: recipe.url };
  const items = (recipe.ingredients || []).filter((i) => String(i?.name ?? '').trim());
  const existing = fav.meals.find((m) => m.source?.type === 'recipe' && m.source.id === String(recipe.id));
  if (!existing) return createMeal(fav, recipe.title, items, { source });
  return mapMeal(fav, existing.id, (m) => ({ ...m, name: cleanMealName(recipe.title), items: items.map((it) => ({ id: newId(), ...cleanFav(it) })) }));
}

// ---------- saved recipes (v0.2.0, Favorites › Recipes) ----------
/** A saved recipe: { id, source, title, image, savedAt }. title/image are a snapshot for the grid. */
function cleanSavedRecipe(r) {
  if (!r || typeof r !== 'object') return null;
  const id = typeof r.id === 'string' || typeof r.id === 'number' ? String(r.id).trim().slice(0, 40) : '';
  const title = String(r.title ?? '').trim().replace(/\s+/g, ' ').slice(0, 160);
  if (!id || !title) return null;
  const savedAt = Number.isFinite(Date.parse(r.savedAt)) ? new Date(Date.parse(r.savedAt)).toISOString() : new Date(0).toISOString();
  const image = typeof r.image === 'string' && /^https:\/\/[^\s"'<>]+$/.test(r.image) ? r.image.slice(0, 600) : null;
  return { id, source: r.source === 'import' ? 'import' : 'wegmans', title, image, savedAt };
}
function cleanSavedRecipes(rows) {
  const out = []; const seen = new Set();
  for (const r of Array.isArray(rows) ? rows : []) { const c = cleanSavedRecipe(r); if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c); } }
  return out.slice(0, 2000);
}
export const isRecipeSaved = (fav, id) => (fav.recipes ?? []).some((r) => r.id === String(id));
/** Star a recipe (newest first in the grid); starring again changes nothing. */
export function saveRecipe(fav, recipe, now = new Date()) {
  if (isRecipeSaved(fav, recipe.id)) return fav;
  const row = cleanSavedRecipe({ ...recipe, savedAt: new Date(now).toISOString() });
  if (!row) throw new Error('Recipe needs an id and a title');
  return { ...fav, recipes: [row, ...(fav.recipes ?? [])] };
}
export function unsaveRecipe(fav, id) {
  return { ...fav, recipes: (fav.recipes ?? []).filter((r) => r.id !== String(id)) };
}
/** Saved recipes, newest saved first. */
export const savedRecipes = (fav) => [...(fav.recipes ?? [])].sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));

// ---------- adding to the weekly list ----------
/** Name key used for dedupe: case-, whitespace- and accent-insensitive. */
export function nameKey(name) {
  return String(name ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Adds favorites to the list, skipping any whose name is already on the list and NOT checked
 * (a checked item was already bought, so it can be added again), and skipping repeats within
 * the batch. Returns { state, added, skipped }.
 */
export function addFavoritesToList(listState, favItems) {
  const onList = new Set(listState.items.filter((i) => !i.checked).map((i) => nameKey(i.name)));
  let state = listState;
  let added = 0;
  let skipped = 0;
  for (const f of favItems) {
    const k = nameKey(f.name);
    if (!k || onList.has(k)) { skipped += 1; continue; }
    state = addItem(state, { name: f.name, qty: f.qty, unit: f.unit, storeId: f.storeId, notes: f.notes });
    onList.add(k);
    added += 1;
  }
  return { state, added, skipped };
}

/** Toast copy for an add result. */
export function addedMessage({ added, skipped }, what = '') {
  const pre = what ? `${what}: ` : '';
  if (!added && skipped) return `${pre}already on your list`;
  const a = `Added ${added} item${added === 1 ? '' : 's'}`;
  return `${pre}${a}${skipped ? ` (${skipped} already on the list)` : ''}`;
}

// ---------- persistence ----------
export function serializeFavorites(fav) {
  return JSON.stringify({ version: 1, items: fav.items, meals: fav.meals, recipes: fav.recipes ?? [] });
}

function cleanRows(rows) {
  const out = [];
  for (const it of Array.isArray(rows) ? rows : []) {
    try {
      if (!it || typeof it.id !== 'string') continue;
      out.push({ id: it.id, ...cleanFav(it) });
    } catch { /* drop invalid rows */ }
  }
  return out;
}

export function deserializeFavorites(json) {
  let raw;
  try { raw = JSON.parse(json); } catch { return emptyFavorites(); }
  if (!raw || typeof raw !== 'object' || raw.version !== 1) return emptyFavorites();
  const meals = [];
  for (const m of Array.isArray(raw.meals) ? raw.meals : []) {
    try {
      if (!m || typeof m.id !== 'string') continue;
      const meal = { id: m.id, name: cleanMealName(m.name), items: cleanRows(m.items) };
      if (m.source && typeof m.source === 'object') meal.source = cleanSource(m.source);
      meals.push(meal);
    } catch { /* drop invalid meals */ }
  }
  return { version: 1, items: cleanRows(raw.items), meals, recipes: cleanSavedRecipes(raw.recipes) };
}

/** True when json parses as a v1 favorites document (rows may still be partly invalid). */
export function isReadableFavorites(json) {
  try { const raw = JSON.parse(json); return Boolean(raw) && typeof raw === 'object' && raw.version === 1; } catch { return false; }
}

export function loadFavorites(storage = globalThis.localStorage) {
  return loadFavoritesWithStatus(storage).favorites;
}

/**
 * Like the list (storage.js loadStateWithStatus): an unreadable value is copied to
 * FAVORITES_BACKUP_KEY before anything can overwrite it, and reported as problem 'unreadable'.
 */
export function loadFavoritesWithStatus(storage = globalThis.localStorage, now = new Date()) {
  let json;
  try { json = storage.getItem(FAVORITES_KEY); } catch { return { favorites: emptyFavorites(), problem: 'unavailable', backedUp: false }; }
  if (!json) return { favorites: emptyFavorites(), problem: null, backedUp: false };
  if (isReadableFavorites(json)) {
    // L30: combine favorites that are now one identity. Only after the old set is copied aside,
    // and only if the combined set saves; otherwise load it unchanged (the stars still work).
    // v0.1.10 (M6): idempotent. A combined set has no duplicates, so the next load does nothing;
    // the notice is shown once per device, and an earlier backup copy is never overwritten.
    const d = dedupeFavorites(deserializeFavorites(json));
    if (!d.merged) return { favorites: d.favorites, problem: null, backedUp: false, merged: 0, notice: false };
    try {
      const { key, meta } = keepDedupeCopy(json, storage, now);
      storage.setItem(FAVORITES_KEY, serializeFavorites(d.favorites));
      // One notice per device, and only with the copy it names (a v0.1.8 copy already existing = already told).
      const notice = !meta.noticedAt && key === FAVORITES_DEDUPE_BAK_KEY;
      try { storage.setItem(FAVORITES_DEDUPE_META_KEY, JSON.stringify({ noticedAt: meta.noticedAt ?? new Date(now).toISOString(), extra: meta.extra })); } catch { /* the notice may show again */ }
      return { favorites: d.favorites, problem: null, backedUp: false, merged: d.merged, notice, bakKey: key };
    } catch {
      try { storage.setItem(FAVORITES_KEY, json); } catch { /* unchanged */ }
      return { favorites: deserializeFavorites(json), problem: null, backedUp: false, merged: 0, notice: false };
    }
  }
  let backedUp = false;
  try { storage.setItem(FAVORITES_BACKUP_KEY, json); backedUp = true; } catch { /* ignore */ }
  return { favorites: emptyFavorites(), problem: 'unreadable', backedUp };
}

export function saveFavorites(fav, storage = globalThis.localStorage) {
  try { storage.setItem(FAVORITES_KEY, serializeFavorites(fav)); return true; } catch { return false; }
}
