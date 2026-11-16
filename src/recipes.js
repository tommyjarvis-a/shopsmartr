// Pure Recipes model (v0.2.0): feed validation, the ingredient normalizer, pantry rule, scaling and
// fractions, whole-pack buying, catalog matching with confidence, cost ranges, sorts, search, quick
// picks, list coverage and step splitting. No DOM, no network; safe to run in a Worker.
// Recipe data is never shipped in this repo: it arrives encrypted in data/recipes.enc.
import { tokenize, getItem, estimate, unitOf, storeKey, editDistance1, hiddenStoreIdx } from './catalog.js';
import { convert, parsePackSize, linePrice, compareNames } from './list.js';

export const RECIPES_SCHEMA = 'shopsmartr.recipes/1';
export const RECIPE_FEED_SCHEMA = 'shopsmartr.recipefeed/1';

// ---------- categories ----------
const CAT_LABEL = {
  'main-dishes': 'Main dishes', 'side-dishes': 'Sides', soups: 'Soups', salads: 'Salads', cocktails: 'Cocktails',
  appetizers: 'Appetizers', desserts: 'Desserts', 'condiments-and-sauces': 'Sauces', 'breakfast-and-brunch': 'Breakfast',
  breads: 'Breads', beverages: 'Drinks', drinks: 'Drinks', snacks: 'Snacks',
};
const CAT_ORDER = Object.keys(CAT_LABEL);
/** "condiments-and-sauces" -> "Sauces"; unknown slugs read naturally ("party-food" -> "Party food"). */
export function categoryLabel(slug) {
  const s = String(slug ?? '');
  if (CAT_LABEL[s]) return CAT_LABEL[s];
  const t = s.replace(/-and-/g, ' & ').replace(/-/g, ' ').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Other';
}
/** { slug: count } -> [{ slug, label, count }] in the mock's order, unknown slugs after, A-Z. */
export function categoryList(counts) {
  const rank = (s) => { const i = CAT_ORDER.indexOf(s); return i < 0 ? CAT_ORDER.length : i; };
  return Object.entries(counts ?? {}).filter(([s, n]) => /^[a-z0-9-]{1,60}$/.test(s) && Number.isFinite(n) && n > 0)
    .map(([slug, count]) => ({ slug, label: categoryLabel(slug), count }))
    .sort((a, b) => rank(a.slug) - rank(b.slug) || compareNames(a.label, b.label));
}

// ---------- normalizer ----------
const STOP = new Set('a an and or of the to for with in into on at plus about each per if as your'.split(' '));
/** Words that describe an ingredient without changing what you buy (and brand words). */
const DESC = new Set(('fresh freshly chopped minced diced sliced thinly thick thin large medium small whole ground grated shredded '
  + 'crumbled cubed peeled trimmed halved quartered divided optional cut piece finely roughly coarsely packed softened melted '
  + 'room temperature cold warm boneless skinless bone skin loose baby petite wegman wegmans fyfga food feel good about '
  + 'brand style premium select family value size pack lightly firmly rinsed drained patted dry juiced zested beaten '
  + 'prepared cooked uncooked raw extra virgin').split(' '));
const BONUS = new Set(['organic']);
const NO_SINGULAR = new Set(['asparagus', 'hummus', 'couscous', 'molasses', 'swiss', 'grits', 'citrus', 'bass', 'brussels', 'species', 'series', 'chassis']);
/** Plural to singular for matching ("tomatoes" -> "tomato", "berries" -> "berry", "thighs" -> "thigh"). */
export function singular(t) {
  if (t.length <= 3 || NO_SINGULAR.has(t)) return t;
  if (t.endsWith('ies')) return `${t.slice(0, -3)}y`;
  if (/(oes|ches|shes|sses|xes|zes)$/.test(t)) return t.slice(0, -2);
  if (t.endsWith('ves') && t.length > 4) return `${t.slice(0, -3)}f`;   // leaves -> leaf, halves -> half
  if (t.endsWith('s') && !/(ss|us|is)$/.test(t)) return t.slice(0, -1);
  return t;
}
const memoNorm = new Map();
/**
 * Name -> { core, bonus }: lowercase accent-free word tokens, singular, without numbers, stop
 * words, descriptors and brand words. core keeps the name's word order (the last word is the head
 * noun, e.g. "beans" in "green beans"). Same normalizer for recipe lines, list names and products.
 */
export function normName(text) {
  const key = String(text ?? '');
  const hit = memoNorm.get(key);
  if (hit) return hit;
  const core = []; const bonus = [];
  for (const raw of tokenize(key.replace(/\([^)]*\)/g, ' '))) {
    if (/\d/.test(raw) || raw.length < 2) continue;
    const t = singular(raw);
    if (STOP.has(t) || STOP.has(raw)) continue;
    if (BONUS.has(t)) { bonus.push(t); continue; }
    if (DESC.has(t) || DESC.has(raw)) continue;
    if (!core.includes(t)) core.push(t);
  }
  const out = { core, bonus };
  if (memoNorm.size > 20000) memoNorm.clear();
  memoNorm.set(key, out);
  return out;
}
/** Stable ingredient key for caches and remembered swaps ("green bean"). */
export const ingKey = (name) => normName(name).core.join(' ');

// ---------- pantry ----------
const PANTRY_WORDS = new Set(['salt', 'pepper', 'black', 'white', 'kosher', 'sea', 'table', 'peppercorn', 'water', 'tap', 'ice']);
const PANTRY_NEED = new Set(['salt', 'pepper', 'peppercorn', 'water']);
/**
 * Pantry basics are never missing, never counted in coverage and never priced: salt, pepper,
 * water, cooking spray, and any "to taste" line. Oils are tracked like any other ingredient.
 */
export function isPantry(ing) {
  const text = String(ing?.text ?? '');
  if (/\bto taste\b/i.test(text) || /\bcooking spray\b/i.test(`${text} ${ing?.base ?? ''}`)) return true;
  const { core } = normName(ing?.base || text);
  return core.length > 0 && core.every((t) => PANTRY_WORDS.has(t)) && core.some((t) => PANTRY_NEED.has(t)) && !core.includes('ice');
}
/** "salt & pepper", "Salt and freshly ground pepper" -> ["salt", "pepper"] for the pantry line. */
export function pantryLabels(ings) {
  const out = [];
  for (const ing of ings) {
    const t = String(ing.base || ing.text || '').toLowerCase().replace(/\bto taste\b/g, '').replace(/[,.]/g, ' ').trim();
    for (const part of t.split(/\s*(?:&|\band\b)\s*/)) {
      const words = part.replace(/\b(freshly|ground|wegmans|organic|kosher|coarse)\b/g, ' ').replace(/\s+/g, ' ').trim();
      if (words && !out.includes(words)) out.push(words);
    }
  }
  return out;
}

// ---------- feed validation ----------
const str = (x, n = 200) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, n) : null);
const pos = (x) => (typeof x === 'number' && Number.isFinite(x) && x > 0 && x < 1e5 ? x : null);
const mins = (x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x < 100000 ? Math.round(x) : null);
const https = (x) => (typeof x === 'string' && /^https:\/\/[^\s"'<>]+$/.test(x) ? x.slice(0, 600) : null);

function cleanIng(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = str(raw.text, 300);
  const base = str(raw.base, 160) ?? text;
  if (!text && !base) return null;
  const ing = {
    text: text ?? base, base, qty: pos(raw.qty), qtyText: str(raw.qtyText, 20), unit: str(raw.unit, 20)?.toLowerCase() ?? null,
    unitType: str(raw.unitType, 20), optional: Boolean(raw.optional), prep: str(raw.prep, 160), alt: str(raw.alt, 60), section: str(raw.section, 80),
  };
  ing.pantry = isPantry(ing);
  ing.k = ingKey(ing.base);
  return ing;
}

/**
 * Decrypted shopsmartr.recipes/1 document -> { recipes, categories, count, generatedAt }.
 * Unknown fields are dropped; recipes without an id, title or any ingredient are skipped. Adds
 * derived fields: time (sort/display minutes), s (search tokens), n (non-pantry count).
 */
export function prepareRecipes(doc) {
  if (!doc || typeof doc !== 'object' || doc.schema !== RECIPES_SCHEMA || !Array.isArray(doc.recipes)) throw new Error('Not a recipe document');
  const seen = new Set();
  const recipes = [];
  for (const r of doc.recipes) {
    if (!r || typeof r !== 'object') continue;
    const id = str(String(r.id ?? ''), 40);
    const title = str(r.title, 160);
    if (!id || !title || seen.has(id)) continue;
    const ing = (Array.isArray(r.ing) ? r.ing : []).map(cleanIng).filter(Boolean).slice(0, 80);
    if (!ing.length) continue;
    seen.add(id);
    const t = r.times && typeof r.times === 'object' ? r.times : {};
    const rating = typeof r.rating === 'number' && r.rating > 0 && r.rating <= 5 ? Math.round(r.rating * 100) / 100 : null;
    const rec = {
      id, title, cat: str(r.cat, 60) ?? 'other', servings: pos(r.servings) ? Math.round(r.servings) : null,
      times: { prep: mins(t.prep), cook: mins(t.cook), total: mins(t.total) },
      image: https(r.image), url: https(r.url), rating, ratingCount: rating && Number.isInteger(r.ratingCount) && r.ratingCount > 0 ? r.ratingCount : 0,
      ing, steps: (Array.isArray(r.steps) ? r.steps : []).map((s) => str(typeof s === 'string' ? s : s?.text, 4000)).filter(Boolean).slice(0, 60),
    };
    rec.time = recipeTime(rec);
    rec.n = ing.filter((i) => !i.pantry).length;
    const toks = new Set();
    for (const w of tokenize(`${title} ${ing.map((i) => i.base).join(' ')}`)) if (w.length > 1) { toks.add(w); toks.add(singular(w)); }
    rec.s = [...toks];
    recipes.push(rec);
  }
  const categories = {};
  for (const r of recipes) categories[r.cat] = (categories[r.cat] ?? 0) + 1;
  return { recipes, categories, count: recipes.length, generatedAt: str(doc.generatedAt, 40) };
}

/** Manifest object -> { available, file, itemCount, categories, updated } or null (any problem). */
export function cleanRecipeManifest(m) {
  if (!m || typeof m !== 'object' || m.schema !== RECIPE_FEED_SCHEMA || typeof m.available !== 'boolean') return null;
  if (m.dataSchema !== undefined && m.dataSchema !== RECIPES_SCHEMA) return null;
  const file = typeof m.file === 'string' && /^[\w.-]+\.enc$/.test(m.file) ? m.file : 'recipes.enc';
  const itemCount = Number.isInteger(m.itemCount) && m.itemCount >= 0 ? m.itemCount : null;
  const categories = {};
  if (m.categories && typeof m.categories === 'object') for (const [k, v] of Object.entries(m.categories)) if (/^[a-z0-9-]{1,60}$/.test(k) && Number.isInteger(v) && v > 0) categories[k] = v;
  return { available: m.available, file, itemCount, categories, updated: str(m.updated ?? m.generatedAt, 40) };
}

// ---------- time, rating ----------
/** Minutes shown and sorted on: prep + cook, otherwise total, otherwise prep; null when unknown. */
export function recipeTime(r) {
  const { prep = null, cook = null, total = null } = r?.times ?? {};
  if (prep != null && cook != null) return prep + cook;
  if (total != null) return total;
  if (prep != null) return prep;
  return null;
}
/** "45 min", "1 hr 20 min". */
export function timeText(m) {
  if (m == null) return '';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60); const r = m % 60;
  return r ? `${h} hr ${r} min` : `${h} hr`;
}
export const hasRating = (r) => r.rating != null && r.ratingCount > 0;
export const ratingText = (r) => (Math.round(r.rating * 10) / 10).toFixed(1);
export const ratingAria = (r) => `Rated ${ratingText(r)} out of 5 from ${r.ratingCount} review${r.ratingCount === 1 ? '' : 's'}`;

// ---------- amounts ----------
const FR = [[0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'], [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, '']];
/** Cooking amounts as fractions: 0.75 -> "¾", 1.5 -> "1½", 2.333 -> "2⅓"; 20+ rounds to whole. */
export function formatAmount(x) {
  if (x == null || !Number.isFinite(x) || x <= 0) return '';
  if (x >= 20) return String(Math.round(x));
  let w = Math.floor(x);
  const f = x - w;
  let best = FR[0];
  for (const c of FR) if (Math.abs(c[0] - f) < Math.abs(best[0] - f)) best = c;
  if (best[0] === 1) { w += 1; best = FR[0]; }
  if (w === 0 && !best[1]) return '⅛';
  return `${w || ''}${best[1]}`;
}
const METRIC = new Set(['g', 'kg', 'ml', 'l']);
const UNIT_PLURAL = { leaf: 'leaves', box: 'boxes', bunch: 'bunches', pinch: 'pinches', dash: 'dashes', splash: 'splashes', inch: 'inches', each: 'each', pkg: 'pkg' };
const NO_PLURAL = new Set(['tbsp', 'tsp', 'oz', 'lb', 'g', 'kg', 'ml', 'l', 'cm', 'pkg', 'large', 'medium', 'small', 'each']);
/** Unit as shown after an amount; '' for "whole". */
export function unitLabel(unit, q = 1) {
  if (!unit || unit === 'whole') return '';
  if (unit === 'l') return 'L';
  if (unit === 'floz') return 'fl oz';   // L38
  if (NO_PLURAL.has(unit) || q <= 1) return unit;
  return UNIT_PLURAL[unit] ?? `${unit}s`;
}
/** Scaled amount text: "1½ lb", "3 sprigs", "250 g"; '' when the line has no amount. */
export function amountText(ing, factor = 1) {
  if (ing.qty == null) return '';
  const q = ing.qty * factor;
  const n = METRIC.has(ing.unit) ? String(q >= 10 ? Math.round(q) : Math.round(q * 10) / 10) : formatAmount(q);
  const u = unitLabel(ing.unit, q);
  return u ? `${n} ${u}` : n;
}
/** factor for a servings choice; 1 when the recipe doesn't say how many it makes. */
export const scaleFactor = (recipe, servings) => (recipe.servings && servings > 0 ? servings / recipe.servings : 1);

// ---------- buying: whole packs ----------
const VOL_ML = { tsp: 4.92892, tbsp: 14.7868, cup: 236.588, pint: 473.176, quart: 946.353, gallon: 3785.41, ml: 1, l: 1000, floz: 29.5735 };
const WT_G = { oz: 28.3495, lb: 453.592, g: 1, kg: 1000 };
const PACKAGE = new Set(['pkg', 'container', 'can', 'jar', 'bottle', 'bag', 'box', 'bunch', 'head']);
const COUNT = new Set(['whole', 'large', 'medium', 'small', 'each', 'ear', 'link', 'piece']);
const isCountish = (u) => !u || COUNT.has(u) || PACKAGE.has(u);
const PACK_ML = { floz: 29.5735, ml: 1, L: 1000, gal: 3785.41, qt: 946.353, cup: 236.588 };
const PACK_G = { lb: 453.592, oz: 28.3495, g: 1, kg: 1000 };

/** What a scaled line needs, as { g } or { ml }; package lines use "(16 oz each)" when given. */
export function needOf(ing, q) {
  if (q == null) return null;
  const u = ing.unit;
  if (u && WT_G[u]) return { g: q * WT_G[u] };
  if (u && VOL_ML[u]) return { ml: q * VOL_ML[u] };
  if (u && PACKAGE.has(u) && ing.alt) {
    const m = /(\d+(?:\.\d+)?)\s*(fl\.?\s*oz|oz|lb|g|kg|ml|l)\b/i.exec(ing.alt);
    if (m) {
      const per = Number(m[1]); const pu = m[2].toLowerCase().replace(/fl\.?\s*oz/, 'floz');
      if (WT_G[pu]) return { g: q * per * WT_G[pu] };
      if (VOL_ML[pu]) return { ml: q * per * VOL_ML[pu] };
    }
  }
  return null;
}

/** Price snapshot fields for a catalog item, as list.js linePrice() reads them. */
export function pricedOf(it) {
  const est = estimate(it);
  return { each: est.each, approx: est.approx, shelf: it.price, unitPrice: it.unitPrice, unitOf: unitOf(it), byWeight: it.soldByWeight, size: it.size, onSale: it.onSale, regular: it.regularPrice };
}

/**
 * What to buy of one product for a scaled recipe line, priced with the existing linePrice():
 * whole packs for packaged items (a 1 lb bag covers ¾ lb; 1½ lemons buys 2), the weight for
 * by-weight items. Returns { packs, total, approx, listQty, listUnit, buys } where buys is the
 * "Buys 2" subline (null when it would just repeat the amount). total is null when unpriceable.
 */
export function buyFor(ing, factor, it) {
  const q = ing.qty == null ? null : ing.qty * factor;
  const priced = pricedOf(it);
  const need = needOf(ing, q);
  if (it.soldByWeight && need && priced.unitPrice && convert('lb', priced.unitOf)) {
    const lb = Math.max(0.05, Math.round(((need.g ?? need.ml) / 453.592) * 100) / 100);   // volume as water (≈1 g/ml)
    const line = linePrice({ qty: lb, unit: 'lb', priced });
    return { packs: null, total: line?.total ?? null, approx: true, listQty: lb, listUnit: 'lb', buys: null };
  }
  let packs = 1;
  let approx = false;
  const pack = parsePackSize(it.size);
  if (need && pack) {
    let amt;
    if (need.g != null && PACK_G[pack.unit]) amt = need.g / PACK_G[pack.unit];
    else if (need.ml != null && PACK_ML[pack.unit]) amt = need.ml / PACK_ML[pack.unit];
    else { amt = (need.g ?? need.ml) / (PACK_G[pack.unit] ?? PACK_ML[pack.unit] ?? 1); approx = true; }   // weight vs volume: ≈1 g per ml
    packs = Math.max(1, Math.ceil(Math.round((amt / pack.amount) * 1000) / 1000 - 1e-9));
  } else if (need) {
    approx = true;   // e.g. "2 cups" of a product sold as "12 ct": one pack
  } else if (q != null && isCountish(ing.unit)) {
    const ct = /(\d+)\s*(?:ct|count|pk)\b/i.exec(it.size ?? '');
    if (!ct && !PACKAGE.has(ing.unit) && pack && PACK_G[pack.unit]) {
      // L47: "2 potato" against a 5 lb bag: a count can't be turned into a weight here, so it buys
      // ONE pack (not one bag per potato) and the line says so for the shopper to check.
      const line = linePrice({ qty: 1, unit: '', priced });
      return { packs: 1, total: line?.total ?? null, approx: true, listQty: 1, listUnit: '', buys: `1 pack for ${formatAmount(q)} · check the size`, review: true };
    }
    packs = Math.max(1, Math.ceil(q / (ct && !PACKAGE.has(ing.unit) ? Number(ct[1]) : 1) - 1e-9));
  }
  const line = linePrice({ qty: packs, unit: '', priced });
  const buys = packs > 1 && !(isCountish(ing.unit) && q === packs) ? `Buys ${packs}` : null;
  return { packs, total: line?.total ?? null, approx: approx || Boolean(line?.approx), listQty: packs, listUnit: '', buys, review: false };
}

// ---------- matching against the catalog ----------
/**
 * Built once per catalog: normalized word -> rows whose product NAME has that word (from the
 * Shop's token index, so no extra pass over all items), plus per-row normalized names on demand.
 */
export function buildMatchIndex(cat, index) {
  const norm = new Map();
  index.tokens.forEach((t, k) => {
    if (/\d/.test(t)) return;
    const n = singular(t);
    const a = norm.get(n);
    if (a) a.push(k); else norm.set(n, [k]);
  });
  return { cat, index, norm, rows: new Map(), core: new Map(), items: new Map(), foods: new Map() };
}
function rowsWith(mi, t) {
  const hit = mi.rows.get(t);
  if (hit) return hit;
  const ks = mi.norm.get(t) ?? [];
  const { offsets, flat } = mi.index;
  const set = new Set();
  for (const k of ks) for (let p = offsets[k], e = offsets[k + 1]; p < e; p += 1) if ((flat[p] & 3) === 3) set.add(flat[p] >> 2);
  const rows = Int32Array.from(set).sort();
  mi.rows.set(t, rows);
  return rows;
}
function productCore(mi, row) {
  let c = mi.core.get(row);
  if (!c) { c = normName(mi.cat.cols.name[row]).core; mi.core.set(row, c); }
  return c;
}
export function itemAt(mi, row) {
  let it = mi.items.get(row);
  if (!it) { it = getItem(mi.cat, row); mi.items.set(row, it); }
  return it;
}
/** Pack and form words that can end a product name without being what it is ("Garlic Bulb", "Limes Bag"). */
const FORM = new Set('bulb head bunch clove stalk sprig ear bag box carton jar can bottle tub container tray pkg package ct count multipack variety pound lb oz each'.split(' '));
/** Class, cut and variety words that can follow a food's name without making it another food. */
const GENERIC = new Set(('cheese breast thigh wing drumstick drumette tender tenderloin cutlet leg quarter fillet filet loin chop '
  + 'steak strip half breast bulb clove head root stalk floret crown spear leaf hass haas roma plum vine cluster ball log '
  + 'wedge block shred crumble round link patty piece nugget kernel ear slice heart chunk cob').split(' '));
/** L44: words that make a processed form of a food (still the same food, ranked below the plain one). */
const PROCESSED = new Set('nugget patty wedge fry chip tender crisp bite popper puff tot finger strip stick breaded battered frozen'.split(' '));
/** M9: the product words after the ingredient word are all generic or pack words. */
function sameFoodTail(pc, w) {
  const i = pc.indexOf(w);
  if (i < 0) return false;
  for (let j = i + 1; j < pc.length; j += 1) if (!GENERIC.has(pc[j]) && !FORM.has(pc[j])) return false;
  return true;
}
/** L45: words in FRONT of a food that make a prepared/processed product of it (Popcorn Chicken). */
const PRE_PROCESSED = new Set('popcorn rotisserie fried breaded battered crispy crunchy general tso sesame buffalo teriyaki bbq barbecue glazed marinated stuffed smoked dino'.split(' '));
/**
 * M10/L46: words in front of a food that name a different product, whatever the catalog holds
 * (Peanut Butter, Ice/Sour/Whipped Cream, Banana Bread, Almond Milk, Chicken Broth for "broth").
 */
const OTHER_MOD = new Set(('ice sour whipped peanut almond cashew hazelnut pistachio coconut soy oat banana pumpkin zucchini apple '
  + 'chocolate vanilla strawberry blueberry cinnamon garlic onion corn cookie cottage cream buttermilk condensed evaporated powdered '
  + 'confectioner chicken beef pork turkey vegetable veggie bone fish clam seafood tomato lemon lime orange').split(' '));
/** L52: words in front of one food that make another product of it (Brown Sugar is not sugar, Green Beans are not beans). */
const OTHER_FRONT = { sugar: new Set(['brown']), bean: new Set(['green', 'string', 'wax', 'snap']) };
/**
 * L51: bare words whose every product carries a food word in front (Chicken Broth, Strawberry Jam,
 * Pork Sausage). When nothing plainer exists, those still count as the food, ranked behind any
 * plain product, instead of matching nothing.
 */
const MOD_OK = new Set('broth stock jam jelly preserves sausage oil juice'.split(' '));
/** M10: a generic-looking word after a food that still makes another product of it (Cream Cheese is not cream). */
const OTHER_TAIL = { cream: new Set(['cheese']), butter: new Set(['cheese']) };
/**
 * THE shared same-food rule (M10, L45, L46), used by both product matching (matchRows) and the
 * list check (onListItem): does a product or list name (core words `pc`) mean the ingredient
 * (core words `ic`)? Every ingredient word must be in the name; words after the ingredient's head
 * noun may only be cut/class/pack words (Chicken Breast, Garlic Bulb, not Chicken Broth or Garlic
 * Salt); words in front may not name another food (Peanut Butter, Ice Cream, Banana Bread).
 * Returns { other, processed, front, soft }: other = a different food; processed = a processed form
 * (Chicken Nuggets, Popcorn Chicken); front = the processed word is in front; soft = the only
 * processed word is "frozen" (same food for the list check).
 */
export function foodRelation(ic, pc) {
  const out = { other: true, processed: false, front: false, soft: false };
  if (!ic.length || !pc.length || !ic.every((t) => pc.includes(t))) return out;
  const head = ic[ic.length - 1];
  const at = pc.lastIndexOf(head);
  const proc = [];
  for (let j = at + 1; j < pc.length; j += 1) {
    const w = pc[j];
    if (ic.includes(w)) continue;   // "Butter, unsalted" for unsalted butter
    if (OTHER_TAIL[head]?.has(w)) return out;
    if (PROCESSED.has(w)) proc.push(w);
    else if (!GENERIC.has(w) && !FORM.has(w)) return out;
  }
  let front = false;
  let mod = false;
  for (let j = 0; j < at; j += 1) {
    const w = pc[j];
    if (ic.includes(w) || PLAIN[head]?.has(w)) continue;
    if (OTHER_FRONT[head]?.has(w)) return out;
    // L52: a flavour or source word in front of an already specific (multi-word) ingredient keeps it
    // the same food (Vanilla Ice Cream is ice cream); for a bare word it names another product.
    if (OTHER_MOD.has(w) && ic.length === 1) mod = true;
    else if ((PROCESSED.has(w) || PRE_PROCESSED.has(w))) { proc.push(w); if (w !== 'frozen') front = true; }
  }
  const processed = proc.length > 0; const soft = processed && proc.every((x) => x === 'frozen');
  // L51: `mod` = another food only because of a front modifier; a MOD_OK word may still fall back to it.
  if (mod) return { other: true, processed, front, soft, mod: MOD_OK.has(head) };
  return { other: false, processed, front, soft };
}
/** The everyday form of a bare ingredient word ("cream" means heavy or whipping cream). */
const PLAIN = Object.fromEntries(Object.entries({
  cream: 'heavy whipping', bread: 'sandwich white wheat sliced', milk: 'whole', oil: 'vegetable canola', rice: 'white long grain', flour: 'all purpose', sugar: 'granulated white cane',
}).map(([k, v]) => [k, new Set(v.split(' '))]));
/** A word that is itself a food: the head noun of some product in the catalog ("ice" in Bagged Ice, "banana"). Cached. */
function isFood(mi, t) {
  let v = mi.foods.get(t);
  if (v === undefined) {
    v = false;
    const rows = rowsWith(mi, t);
    for (let i = 0; i < rows.length && i < 400; i += 1) if (headOf(productCore(mi, rows[i])) === t) { v = true; break; }
    mi.foods.set(t, v);
  }
  return v;
}
/** A product's head noun: its last word that isn't a pack or form word. */
export function headOf(pc) {
  for (let i = pc.length - 1; i >= 0; i -= 1) if (!FORM.has(pc[i])) return pc[i];
  return pc[pc.length - 1];
}
export const CONF = { EXACT: 4, STRONG: 3, GOOD: 2, WEAK: 1 };
/**
 * Products at one store for an ingredient, best first: [{ row, conf }].
 * EXACT: same words; STRONG: all words + up to 2 others; GOOD: all words + more, or more than half
 * of them with up to 2 others; WEAK (never offered): little more than the head noun. A product whose name ends in another noun ("green bean
 * casserole") drops a level. At most `limit` are kept.
 */
export function matchRows(mi, name, storeIdx, limit = 8) {
  const { core } = normName(name);
  if (!core.length) return [];
  const head = core[core.length - 1];
  const want = new Set(core);
  const storeCol = mi.cat.cols.store;
  const hid = storeIdx < 0 ? hiddenStoreIdx(mi.cat) : null;   // v0.2.4: never match at a hidden chain
  const out = [];
  const fallback = [];
  // Scan the head noun's rows; when that list is long ("cheese", "sauce") and the name has other
  // words, scan the rarest of those instead (still requiring the head), which keeps it fast.
  let scan = rowsWith(mi, head);
  let needHead = null;
  if (scan.length > 400 && core.length > 1) {
    for (const t of core) { if (t === head) continue; const r = rowsWith(mi, t); if (r.length < scan.length) { scan = r; needHead = head; } }
  }
  for (const row of scan) {
    if (storeIdx >= 0 ? storeCol[row] !== storeIdx : hid.has(storeCol[row])) continue;
    if (needHead && !productCore(mi, row).includes(needHead)) continue;
    const pc = productCore(mi, row);
    let hits = 0;
    for (const t of pc) if (want.has(t)) hits += 1;
    const extra = pc.length - hits;
    let conf;
    if (hits === want.size) conf = extra === 0 ? 4 : extra <= 2 ? 3 : 2;
    else if (hits * 2 > want.size && extra <= 2) conf = 2;
    else conf = 1;
    // The product's own head noun decides what it is. A name that ends in another noun drops a
    // level ("green bean casserole"). L39/M9: for a one-word ingredient, the words after it in the
    // product name must be a generic class or cut of the same food (Parmesan Cheese, Chicken
    // Breast, Avocados Hass, Garlic Bulb); when they name a different food (Ice Cream, Garlic Ham)
    // it drops two levels and is never offered.
    if (conf > 1 && headOf(pc) !== head) conf -= core.length === 1 && !sameFoodTail(pc, head) ? 2 : 1;
    else if (core.length === 1 && conf > 1) {
      // A bare "cream" / "bread": the plain form wins (Heavy Cream, Sandwich Bread), and a product
      // whose head is modified by another food (Ice Cream, Banana Bread) drops a level, not out.
      if (PLAIN[head] && pc.length > 1 && pc.every((t) => t === head || PLAIN[head].has(t))) conf = CONF.EXACT;
      else if (conf > 2 && pc.some((t) => t !== head && isFood(mi, t))) conf -= 1;
    }
    // L44: processed forms (nuggets, patties, wedges, fries, chips…) rank below plain ones at the
    // same level, ahead of any name-length tiebreak; they stay in the list as Swap alternatives.
    let proc = core.length === 1 && pc.some((t) => t !== head && PROCESSED.has(t)) ? 1 : 0;
    if (core.length === 1 && conf > 1) {
      // M10/L46 (shared rule with the list check): a name that means another food (Ice Cream,
      // Sour Cream, Whipped Cream, Peanut Butter, Cream Cheese for a bare "cream") is never
      // offered, so it is no Swap option and never sets the cost range. L45: a processed word in
      // front (Popcorn Chicken, Rotisserie Chicken) drops a level and sorts behind plain cuts.
      const rel = foodRelation(core, pc);
      if (rel.other) { if (rel.mod) fallback.push({ row, conf: CONF.GOOD, extra, proc: 1 }); conf = CONF.WEAK; }
      else if (rel.front) { conf -= 1; proc = 1; }
    }
    out.push({ row, conf, extra, proc });
  }
  // L51: a bare broth/stock/jam/sausage/oil/juice with no plain product offers the modified ones
  // (Chicken Broth, Strawberry Jam) rather than nothing.
  if (fallback.length && !out.some((c) => c.conf >= CONF.GOOD)) out.push(...fallback);
  out.sort((a, b) => b.conf - a.conf || a.proc - b.proc || a.extra - b.extra || mi.cat.cols.name[a.row].length - mi.cat.cols.name[b.row].length || a.row - b.row);
  const best = out[0]?.conf ?? 0;
  // The shortlist: the best level and the one below it. Head-noun-only (WEAK) hits are dropped:
  // "heavy cream" must not price as ice cream; no match is better than a wrong one.
  return out.filter((c) => c.conf >= Math.max(2, best - 1)).slice(0, limit).map(({ row, conf, proc }) => ({ row, conf, proc }));
}

/**
 * Precompute: candidate lists for every distinct ingredient of every recipe at one store. Runs once
 * after both feeds are unlocked (and again only for another store). Returns { cands, ms, keys }.
 */
export function precomputeCandidates(mi, recipes, storeIdx, now = () => Date.now()) {
  const t0 = now();
  const cands = new Map();
  for (const r of recipes) for (const ing of r.ing) {
    if (ing.pantry || !ing.k || cands.has(ing.k)) continue;
    cands.set(ing.k, matchRows(mi, ing.base, storeIdx));
  }
  return { cands, ms: now() - t0, keys: cands.size };
}

/** Swap memory key: ingredient + store (device-only). */
export const swapKey = (k, store) => `${k}|${store}`;

/**
 * Choices for one line at the current servings: [{ row, it, conf, buy }], the default pick first
 * (best confidence; ties go to the cheapest pack covering the amount), then up to 4 alternatives
 * (confidence, then price). A remembered swap is moved to the front. Unpriceable options go last.
 */
export function lineOptions(mi, cands, ing, factor, swapSku = null) {
  const list = cands.get(ing.k) ?? [];
  if (!list.length) return [];
  const opts = list.map(({ row, conf, proc = 0 }) => { const it = itemAt(mi, row); return { row, it, conf, proc, buy: buyFor(ing, factor, it) }; });
  const price = (o) => (o.buy.total == null ? Infinity : o.buy.total);
  opts.sort((a, b) => b.conf - a.conf || a.proc - b.proc || price(a) - price(b) || a.row - b.row);
  const best = opts[0].conf;
  const tier = opts.filter((o) => o.conf === best).sort((a, b) => a.proc - b.proc || price(a) - price(b) || a.row - b.row);
  const rest = opts.filter((o) => o.conf !== best);
  let ordered = [...tier, ...rest].slice(0, 5);
  if (swapSku) {
    const i = opts.findIndex((o) => o.it.sku === swapSku);
    if (i >= 0) ordered = [opts[i], ...ordered.filter((o) => o !== opts[i])].slice(0, 5);
  }
  return ordered;
}

/**
 * Cost range for a recipe: LOW = cheapest match per line, HIGH = most expensive match, both whole
 * packs at the servings, pantry excluded; a remembered swap fixes both ends to that product.
 * Returns { low, high, unpriced, priced } with low floored and high ceiled to whole dollars, or
 * null when no line could be priced.
 */
export function recipeCost(recipe, { mi, cands, factor = 1, swapOf = () => null, only = null }) {
  let low = 0; let high = 0; let unpriced = 0; let priced = 0;
  for (const ing of recipe.ing) {
    if (ing.pantry || (only && !only.has(ing))) continue;
    const opts = lineOptions(mi, cands, ing, factor, null).filter((o) => o.buy.total != null);
    if (!opts.length) { unpriced += 1; continue; }
    priced += 1;
    const sw = swapOf(ing.k);
    const fixed = sw ? opts.find((o) => o.it.sku === sw) ?? (() => { const all = lineOptions(mi, cands, ing, factor, sw); return all[0]?.it.sku === sw && all[0].buy.total != null ? all[0] : null; })() : null;
    if (fixed) { low += fixed.buy.total; high += fixed.buy.total; continue; }
    let lo = Infinity; let hi = 0;
    for (const o of opts) { lo = Math.min(lo, o.buy.total); hi = Math.max(hi, o.buy.total); }
    low += lo; high += hi;
  }
  if (!priced) return null;
  return { low: Math.floor(low + 1e-9), high: Math.ceil(high - 1e-9), unpriced, priced };
}
/** "$12–$21" / "$12"; aria "12 to 21 dollars to buy". */
export function costText(c, per = 1) {
  if (!c) return { text: '', aria: '' };
  const lo = per > 1 ? Math.floor(c.low / per) : c.low; const hi = per > 1 ? Math.ceil(c.high / per) : c.high;
  const tail = per > 1 ? 'per serving' : 'to buy';
  return lo === hi
    ? { text: `$${lo}`, tail, aria: `${lo} dollar${lo === 1 ? '' : 's'} ${tail}` }
    : { text: `$${lo}–$${hi}`, tail, aria: `${lo} to ${hi} dollars ${tail}` };
}

// ---------- list coverage ----------
/** Normalized list names, once per render: [{ item, core, set, head }]. Checked items count too. */
export function listIndex(items) {
  return items.map((item) => { const { core } = normName(item.name); return { item, core, set: new Set(core), head: core[core.length - 1] }; }).filter((x) => x.core.length);
}
/** M10: a list name covers an ingredient under the same rule as product matching (foodRelation). */
const covers = (ic, pc) => { const r = foodRelation(ic, pc); return (!r.other || r.mod) && (!r.processed || r.soft); };
/**
 * The list item an ingredient is already covered by, or null. M10: the same head-noun and
 * modifier rules as product matching, through foodRelation(): "Unsalted Butter" or "Chicken
 * Breast" covers butter / chicken, but Peanut Butter, Chicken Broth, Cream Cheese, Banana Bread,
 * Corn Tortillas, Garlic Salt or Chicken Nuggets do not. A plainer list name covers a more exact
 * line when the line only adds descriptors ("butter" on the list for "unsalted butter").
 */
export function onListItem(ing, lidx) {
  const { core } = normName(ing.base);
  if (!core.length) return null;
  const head = core[core.length - 1];
  for (const x of lidx) {
    if (covers(core, x.core)) return x.item;
    if (x.head === head && covers(x.core, core)) return x.item;
  }
  return null;
}
/** { have, total } non-pantry lines on the list. */
export function coverage(recipe, lidx) {
  let have = 0; let total = 0;
  for (const ing of recipe.ing) { if (ing.pantry) continue; total += 1; if (onListItem(ing, lidx)) have += 1; }
  return { have, total };
}
/** Cook-from-my-list rule, used by the "Uses my list" quick pick: 3+ lines on the list, or half. */
export const usesList = (cov) => cov.total > 0 && (cov.have >= 3 || cov.have * 2 >= cov.total) && cov.have > 0;

// ---------- browse: search, quick picks, sorts ----------
/** One typo against a word or a word start, for 5+ letter query words (L35, like Shop search): spagetti, marinera. */
function typo1(w, t) {
  if (t.length < 4) return false;
  return editDistance1(w, t) || (t.length > w.length && (editDistance1(w, t.slice(0, w.length)) || editDistance1(w, t.slice(0, w.length + 1))));
}
/** Every query word must start a word of the title or an ingredient name, or match one with one typo. */
export function matchesQuery(recipe, query) {
  const q = tokenize(query).filter((w) => w.length > 0);
  if (!q.length) return true;
  return q.every((w) => { const s = singular(w); return recipe.s.some((t) => t.startsWith(w) || t.startsWith(s)) || (w.length >= 5 && recipe.s.some((t) => typo1(w, t))); });
}
export const QUICK = {
  quick: { label: 'Under 30 min', test: (r) => r.time != null && r.time <= 30 },
  cheap: { label: 'Under $15', test: (r, x) => { const c = x.costOf(r); return Boolean(c) && c.low < 15; }, needsPrices: true },
  few: { label: '5 ingredients or fewer', test: (r) => r.n <= 5 },
  mine: { label: 'Uses my list', test: (r, x) => usesList(x.coverageOf(r)) },
};
export const RX_SORTS = ['time', 'price', 'name', 'rating'];
export const RX_SORT_LABEL = { time: 'Time', price: 'Price', name: 'A–Z', rating: 'Rating' };
/** Saved sort -> { by, dir }; Price defaults to low to high (asc). */
export function cleanRxSort(x, fallback = 'time') {
  const by = RX_SORTS.includes(x?.by) ? x.by : fallback;
  return { by, dir: x?.dir === 'desc' ? 'desc' : 'asc' };
}
/** Rating applies only when a recipe in the set has one; otherwise the default sort is used. */
export function effectiveSort(sort, list, fallback = 'time') {
  const s = cleanRxSort(sort, fallback);
  return s.by === 'rating' && !list.some(hasRating) ? { ...s, by: fallback } : s;
}
/**
 * Sorted copy. time: quickest first, unknown last; price: low end of the cost range (asc default,
 * desc toggle), unpriced last; name: A-Z (locale, numeric); rating: average desc, then count,
 * unrated last. Ties go A-Z.
 */
export function sortRecipes(list, sort, { costOf = () => null } = {}) {
  const { by, dir } = cleanRxSort(sort);
  const name = (a, b) => compareNames(a.title, b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // Nulls last, then cmp, then A-Z.
  const by2 = (x, y, cmp, a, b) => {
    if (x == null || y == null) return x == null && y == null ? name(a, b) : x == null ? 1 : -1;
    return cmp || name(a, b);
  };
  if (by === 'name') return [...list].sort(name);
  if (by === 'time') return [...list].sort((a, b) => by2(a.time, b.time, a.time - b.time, a, b));
  if (by === 'rating') {
    return [...list].sort((a, b) => {
      const x = hasRating(a) ? a.rating : null; const y = hasRating(b) ? b.rating : null;
      return by2(x, y, (y - x) || (b.ratingCount - a.ratingCount), a, b);
    });
  }
  const low = new Map(list.map((r) => [r, costOf(r)?.low ?? null]));
  const sign = dir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => { const x = low.get(a); const y = low.get(b); return by2(x, y, sign * (x - y), a, b); });
}

// ---------- steps ----------
const ABBR = new Set(['approx', 'min', 'mins', 'oz', 'lb', 'lbs', 'tsp', 'tbsp', 'pkg', 'no', 'dr', 'st', 'vs', 'etc', 'fl', 'qt', 'pt', 'hr', 'hrs', 'sec', 'deg', 'ea', 'e.g', 'i.e']);
/** Sentences of a step, not breaking after "approx.", "1.5" or a single initial. */
export function splitSentences(text) {
  const out = [];
  let start = 0;
  const re = /[.!?](?=\s+["“(]?[A-Z0-9])/g;
  let m;
  while ((m = re.exec(text))) {
    const before = text.slice(start, m.index).split(/\s+/).pop()?.toLowerCase().replace(/^\(/, '') ?? '';
    if (ABBR.has(before) || /^[a-z]$/.test(before)) continue;
    out.push(text.slice(start, m.index + 1).trim());
    start = m.index + 1;
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}
/** Numbered steps; a dense step (over `max` chars) becomes several, a few sentences each. */
export function splitSteps(steps, max = 300, target = 220) {
  const out = [];
  for (const s of steps) {
    const text = String(s).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    if (text.length <= max) { out.push(text); continue; }
    let cur = '';
    for (const sen of splitSentences(text)) {
      if (cur && cur.length + 1 + sen.length > target) { out.push(cur); cur = sen; } else cur = cur ? `${cur} ${sen}` : sen;
    }
    if (cur) out.push(cur);
  }
  return out;
}
/** Timer pill text for a step that names times: "25 + 10 min", "1 hr"; '' when none. */
export function stepTimer(text) {
  const parts = [];
  for (const m of String(text).matchAll(/(\d+)(?:\s*(?:–|-|to)\s*(\d+))?\s*(minutes?|mins?|hours?|hrs?)\b/gi)) {
    const unit = /^h/i.test(m[3]) ? 'hr' : 'min';
    parts.push({ v: m[2] ? `${m[1]}–${m[2]}` : m[1], unit });
  }
  if (!parts.length) return '';
  const sameUnit = parts.every((p) => p.unit === parts[0].unit);
  return sameUnit ? `${parts.map((p) => p.v).join(' + ')} ${parts[0].unit}` : parts.map((p) => `${p.v} ${p.unit}`).join(' + ');
}

// ---------- detail model ----------
/**
 * Everything the Detail screen shows for a recipe at a servings choice:
 * { factor, lines: [{ ing, amount, name, sub, onList, opts }], missing, have, pantry, cost, missingCost }.
 * mi/cands may be null (no prices): lines then have no options and the cost is null.
 */
export function detailModel(recipe, { servings, listItems = [], mi = null, cands = null, swapOf = () => null }) {
  const factor = scaleFactor(recipe, servings);
  const lidx = listIndex(listItems);
  const lines = []; const pantry = [];
  for (const ing of recipe.ing) {
    if (ing.pantry) { pantry.push(ing); continue; }
    const onList = onListItem(ing, lidx);
    const opts = mi && cands ? lineOptions(mi, cands, ing, factor, swapOf(ing.k)) : [];
    lines.push({ ing, amount: amountText(ing, factor), name: ing.qty == null ? ing.text : ing.base, sub: [ing.prep, ing.optional ? 'optional' : ''].filter(Boolean).join(' · '), onList, opts });
  }
  const missing = lines.filter((l) => !l.onList);
  const have = lines.filter((l) => l.onList);
  let total = 0; let unpriced = 0; let approx = false;
  for (const l of missing) { const o = l.opts[0]; if (o?.buy.total != null) { total += o.buy.total; approx = approx || o.buy.approx; } else unpriced += 1; }
  const cost = mi && cands ? recipeCost(recipe, { mi, cands, factor, swapOf }) : null;
  return { factor, lines, missing, have, pantry: pantryLabels(pantry), cost, missingCost: { total: Math.round(total * 100) / 100, unpriced, approx } };
}
export { storeKey };

// ---------- v0.2.6: Cook from my list ----------
/**
 * Coverage of one recipe by the list, with the missing lines: { have, total, missing: [ing], share }.
 * Same rule as Detail and Add missing (onListItem -> foodRelation); pantry basics never count.
 * memo (ingredient key -> covered?) is shared across recipes for one list, so ranking 1,300+
 * recipes checks each distinct ingredient once.
 */
export function coverageDetail(recipe, lidx, memo = new Map()) {
  let have = 0; let total = 0; const missing = [];
  for (const ing of recipe.ing) {
    if (ing.pantry) continue;
    total += 1;
    const k = ing.k ? `${ing.k}` : '';
    let on;
    if (k && memo.has(k)) on = memo.get(k);
    else { on = Boolean(onListItem(ing, lidx)); if (k) memo.set(k, on); }
    if (on) have += 1; else missing.push(ing);
  }
  return { have, total, missing, share: total ? have / total : 0 };
}
export const COOK_SORTS = ['coverage', 'time', 'price', 'name', 'rating'];
export const COOK_SORT_LABEL = { coverage: 'Coverage', ...RX_SORT_LABEL };
/** Saved Cook sort -> { by, dir }; Coverage is the default (spec §3.6). */
export function cleanCookSort(x) {
  return { by: COOK_SORTS.includes(x?.by) ? x.by : 'coverage', dir: x?.dir === 'desc' ? 'desc' : 'asc' };
}
/**
 * Cook from my list order. coverage: share of non-pantry lines on the list, highest first; ties go
 * to fewer missing, then shorter time (unknown last), then A-Z. Other sorts are Browse's; a saved
 * Rating with no rated recipe in the set falls back to Coverage.
 */
export function sortCook(list, sort, { covOf, costOf = () => null }) {
  let s = cleanCookSort(sort);
  if (s.by === 'rating' && !list.some(hasRating)) s = { ...s, by: 'coverage' };
  if (s.by !== 'coverage') return sortRecipes(list, s, { costOf });
  const c = new Map(list.map((r) => [r, covOf(r)]));
  const t = (r) => (r.time == null ? Infinity : r.time);
  return [...list].sort((a, b) => {
    const x = c.get(a); const y = c.get(b);
    return (y.share - x.share) || (x.missing.length - y.missing.length) || (t(a) - t(b)) || compareNames(a.title, b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  });
}
/** "green beans, lemons, thyme" for the coverage row (names as the recipe writes them). */
export function missingNames(missing, max = 6) {
  const names = [];
  for (const ing of missing) { const n = String(ing.base || ing.text).toLowerCase(); if (!names.includes(n)) names.push(n); if (names.length >= max) break; }
  return names.join(', ');
}
