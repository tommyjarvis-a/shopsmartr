// Pure favorites model: staple items and favorite meals (named groups of items).
// Every function returns a new value; nothing touches the DOM. Persistence helpers take an
// injectable storage object so tests can use memoryStorage().
import { cleanItemInput, addItem, newId, normUnit, storeKeyOf } from './list.js';

export const FAVORITES_KEY = 'shopsmartr:favorites:v1';
export const FAVORITES_BACKUP_KEY = 'shopsmartr:favorites:v1.bak';

export function emptyFavorites() {
  return { version: 1, items: [], meals: [] };
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
export function addFavorite(fav, input, id = newId()) {
  return { ...fav, items: [...fav.items, { id, ...cleanFav(input) }] };
}
export function updateFavorite(fav, id, patch) {
  return { ...fav, items: fav.items.map((it) => (it.id === id ? { ...it, ...cleanFav({ ...it, ...patch }) } : it)) };
}
export function removeFavorite(fav, id) {
  return { ...fav, items: fav.items.filter((it) => it.id !== id) };
}

// ---------- favorite identity (stars on Shop results and list rows, v0.1.7) ----------
/**
 * The one favorite identity, shared by the stars, the Favorites tab and Load list merge:
 * normalized name + unit + store (the chosen store, else the price's source store).
 */
export function favKey(x) {
  return `${nameKey(x?.name)}|${normUnit(x?.unit) || String(x?.unit ?? '').toLowerCase()}|${storeKeyOf(x ?? {})}`;
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
  return JSON.stringify({ version: 1, items: fav.items, meals: fav.meals });
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
  return { version: 1, items: cleanRows(raw.items), meals };
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
export function loadFavoritesWithStatus(storage = globalThis.localStorage) {
  let json;
  try { json = storage.getItem(FAVORITES_KEY); } catch { return { favorites: emptyFavorites(), problem: 'unavailable', backedUp: false }; }
  if (!json) return { favorites: emptyFavorites(), problem: null, backedUp: false };
  if (isReadableFavorites(json)) return { favorites: deserializeFavorites(json), problem: null, backedUp: false };
  let backedUp = false;
  try { storage.setItem(FAVORITES_BACKUP_KEY, json); backedUp = true; } catch { /* ignore */ }
  return { favorites: emptyFavorites(), problem: 'unreadable', backedUp };
}

export function saveFavorites(fav, storage = globalThis.localStorage) {
  try { storage.setItem(FAVORITES_KEY, serializeFavorites(fav)); return true; } catch { return false; }
}
