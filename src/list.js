// Pure shopping-list model. Every function returns a new state; nothing touches the DOM.
export const UNITS = ['ea', 'lb', 'oz', 'kg', 'g', 'gal', 'qt', 'L', 'ml', 'pack', 'bag', 'box', 'can', 'jar', 'bottle', 'bunch', 'dozen', 'loaf', 'tub', 'cup'];

// Plural / alternate spellings accepted by the quick-add parser.
const UNIT_ALIASES = {
  each: 'ea', lbs: 'lb', pound: 'lb', pounds: 'lb', ounce: 'oz', ounces: 'oz', kgs: 'kg', grams: 'g', gram: 'g',
  gals: 'gal', gallon: 'gal', gallons: 'gal', quart: 'qt', quarts: 'qt', liter: 'L', liters: 'L', litre: 'L', l: 'L',
  packs: 'pack', pkg: 'pack', package: 'pack', bags: 'bag', boxes: 'box', cans: 'can', jars: 'jar', bottles: 'bottle',
  bunches: 'bunch', cups: 'cup', doz: 'dozen', loaves: 'loaf', tubs: 'tub',
};

/** Upper bound for a quantity (also covers weights such as 1000 g). */
export const MAX_QTY = 9999;
/** Upper bound for a stored price (catalog prices above this are dropped too). */
export const MAX_PRICE = 1e6;

export function emptyState() {
  return { version: 1, items: [], selectedStoreIds: [], zip: '', radiusMi: 10, chains: [] };
}

let counter = 0;
export function newId(now = Date.now()) {
  counter = (counter + 1) % 1e6;
  return `i${now.toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Normalises user input into item fields; throws on an empty name or bad quantity. */
export function cleanItemInput(input = {}) {
  const name = String(input.name ?? '').trim();
  if (!name) throw new Error('Item name is required');
  let qty = input.qty;
  if (qty === '' || qty === undefined || qty === null) qty = null;
  else {
    qty = Number(qty);
    if (!Number.isFinite(qty) || qty <= 0) throw new Error('Quantity must be a positive number');
    if (qty > MAX_QTY) throw new Error(`Quantity must be ${MAX_QTY} or less`);
    qty = Math.round(qty * 1000) / 1000;
  }
  const out = {
    name: name.slice(0, 200),
    qty,
    unit: String(input.unit ?? '').trim().slice(0, 20),
    notes: String(input.notes ?? '').trim().slice(0, 500),
    storeId: input.storeId ? String(input.storeId) : '',
  };
  const priced = cleanPriced(input.priced);
  if (priced) out.priced = priced;
  return out;
}

const pStr = (x, n = 80) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, n) : (typeof x === 'number' && Number.isFinite(x) ? String(x) : null));
const pNum = (x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 && x < MAX_PRICE ? Math.round(x * 100) / 100 : null);
const pPos = (x) => (typeof x === 'number' && Number.isFinite(x) && x > 0 && x < MAX_PRICE ? x : null);

/** Price snapshot carried by items added from the catalog; null when absent or invalid. */
export function cleanPriced(p) {
  if (!p || typeof p !== 'object') return null;
  const each = pNum(p.each);
  if (each == null) return null;
  const regular = pNum(p.regular);
  return {
    each,
    approx: Boolean(p.approx),
    regular: regular != null && regular > (pNum(p.shelf) ?? each) ? regular : null,
    onSale: Boolean(p.onSale),
    unitPriceText: pStr(p.unitPriceText),
    size: pStr(p.size),
    aisle: pStr(p.aisle, 40),
    sku: pStr(p.sku, 40),
    store: pStr(p.store, 60),
    chain: pStr(p.chain, 40),
    storeNo: pStr(p.storeNo, 40),
    asOf: pStr(p.asOf, 40),
    shelf: pNum(p.shelf),
    unitPrice: pPos(p.unitPrice),
    unitOf: normUnit(p.unitOf),
    byWeight: Boolean(p.byWeight),
  };
}

// ---------- units ----------
const UNIT_NORM = {
  lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb', oz: 'oz', ounce: 'oz', ounces: 'oz', g: 'g', gram: 'g', grams: 'g',
  kg: 'kg', kgs: 'kg', kilogram: 'kg', gal: 'gal', gallon: 'gal', gallons: 'gal', qt: 'qt', quart: 'qt', quarts: 'qt',
  l: 'L', liter: 'L', liters: 'L', litre: 'L', ml: 'ml', milliliter: 'ml', cup: 'cup', cups: 'cup',
  floz: 'floz', 'fl oz': 'floz', 'fluid ounce': 'floz', 'fl. oz': 'floz',
  ea: 'ea', each: 'ea', ct: 'ea', count: 'ea',
};
/** Canonical unit name, or '' when unknown. Accepts "lb.", "Pounds", "fl oz". */
export function normUnit(u) {
  const k = String(u ?? '').trim().toLowerCase().replace(/\.$/, '').replace(/\s+/g, ' ');
  return UNIT_NORM[k] ?? UNIT_NORM[k.replace(/s$/, '')] ?? '';
}
const TO_LB = { lb: 1, oz: 1 / 16, g: 1 / 453.59237, kg: 2.20462262 };
const TO_ML = { gal: 3785.411784, qt: 946.352946, L: 1000, ml: 1, cup: 236.5882365, floz: 29.5735295625 };
/** Factor turning one `from` into `to` units (weights with weights, volumes with volumes); null otherwise. */
export function convert(from, to) {
  if (from === to) return 1;
  if (TO_LB[from] && TO_LB[to]) return TO_LB[from] / TO_LB[to];
  const f = from === 'oz' && to in TO_ML ? 'floz' : from;   // "oz" of a liquid priced per fl oz
  if (TO_ML[f] && TO_ML[to]) return TO_ML[f] / TO_ML[to];
  return null;
}
export const isWeight = (u) => u in TO_LB;
export const isMeasure = (u) => u in TO_LB || u in TO_ML;

const r2 = (x) => Math.round(x * 100) / 100;

/**
 * Price of one list line, from the snapshot carried on the item. Returns { total, approx, regular }
 * or null when the item has no price. Rules (M2):
 * - qty in a weight/volume unit and a unit price in a compatible unit: qty converted x unit price.
 *   Exact for items sold by weight; "~" for package items (you buy whole packages).
 * - qty in a weight/volume unit without a usable unit price: one line at the package price, marked
 *   "~" (we don't invent a conversion).
 * - otherwise qty counts packages (or estimated pieces for by-weight items): qty x each.
 * regular is the same line at the regular price when the item was on sale.
 */
export function linePrice(it) {
  const p = it?.priced;
  if (!p) return null;
  const qty = it.qty ?? 1;
  const u = normUnit(it.unit);
  const ratio = p.onSale && p.regular ? p.regular / (p.shelf || p.each) : null;
  let total;
  let approx = p.approx;
  if (isMeasure(u)) {
    const f = p.unitPrice && p.unitOf ? convert(u, p.unitOf) : null;
    if (f) { total = qty * f * p.unitPrice; approx = !p.byWeight; } else { total = p.each; approx = true; }
  } else total = qty * p.each;
  total = r2(total);
  return { total, approx: Boolean(approx), regular: ratio && ratio > 1 ? r2(total * ratio) : null };
}

/** Line total for one item; null when the item has no price. Same rules as linePrice(). */
export function lineTotal(it) {
  return linePrice(it)?.total ?? null;
}

/**
 * Running totals over priced items: remaining (unchecked), inCart (checked) and all.
 * approx is true when any counted line is an estimate (by-weight items).
 */
export function totals(items) {
  const t = { all: 0, remaining: 0, inCart: 0, priced: 0, unpriced: 0, approx: false, approxRemaining: false };
  for (const it of items) {
    const line = linePrice(it);
    if (!line) { t.unpriced += 1; continue; }
    t.priced += 1;
    t.all += line.total;
    if (it.checked) t.inCart += line.total; else { t.remaining += line.total; if (line.approx) t.approxRemaining = true; }
    if (line.approx) t.approx = true;
  }
  for (const k of ['all', 'remaining', 'inCart']) t[k] = Math.round(t[k] * 100) / 100;
  return t;
}
/** "$1,234.50" (thousands separators, 2 decimals). */
// One shared formatter: toLocaleString() with options builds a new Intl formatter per call,
// which doubled the Shop render time for 50 rows.
const MONEY = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n) => (Number.isFinite(n) ? `$${MONEY.format(n)}` : '');
/** "$3.99", or "~$3.99" for an estimate. */
export const priceText = (n, approx = false) => (Number.isFinite(n) ? `${approx ? '~' : ''}${money(n)}` : '');

export function addItem(state, input, id = newId()) {
  const item = { id, ...cleanItemInput(input), checked: false };
  return { ...state, items: [...state.items, item] };
}

export function updateItem(state, id, patch) {
  return {
    ...state,
    items: state.items.map((it) => {
      if (it.id !== id) return it;
      const merged = cleanItemInput({ ...it, ...patch });
      return { ...it, ...merged, checked: patch.checked ?? it.checked };
    }),
  };
}

export function toggleItem(state, id, checked) {
  return {
    ...state,
    items: state.items.map((it) => (it.id === id ? { ...it, checked: checked ?? !it.checked } : it)),
  };
}

export function removeItem(state, id) {
  return { ...state, items: state.items.filter((it) => it.id !== id) };
}

export function uncheckAll(state) {
  return { ...state, items: state.items.map((it) => (it.checked ? { ...it, checked: false } : it)) };
}

/**
 * Quick-add parser: "2 lb apples" -> { qty: 2, unit: 'lb', name: 'apples' }.
 * Understands decimals, simple fractions ("1/2", "1 1/2") and the units/aliases above.
 * Text without a leading number is returned as the name.
 */
export function parseQuick(text) {
  const src = String(text ?? '').trim().replace(/\s+/g, ' ');
  const m = /^(\d+\s+\d+\/\d+|\d+\/\d+|\d+(?:\.\d+)?|\.\d+)\s+(?:x\s+)?(.*)$/i.exec(src);
  if (!m || !m[2]) return { name: src, qty: null, unit: '' };
  let qty = 0;
  for (const part of m[1].split(' ')) {
    if (part.includes('/')) { const [a, b] = part.split('/').map(Number); qty += b ? a / b : 0; } else qty += Number(part);
  }
  let rest = m[2];
  let unit = '';
  const u = /^([A-Za-z]+)\.?\s+(.+)$/.exec(rest);
  if (u) {
    const word = u[1];
    const hit = UNITS.find((x) => x.toLowerCase() === word.toLowerCase()) || UNIT_ALIASES[word.toLowerCase()];
    if (hit) { unit = hit; rest = u[2]; }
  }
  rest = rest.replace(/^of\s+/i, '');
  return { name: rest, qty: qty > 0 ? Math.round(qty * 1000) / 1000 : null, unit };
}

export function clearChecked(state) {
  return { ...state, items: state.items.filter((it) => !it.checked) };
}

export function setSelectedStores(state, ids) {
  return { ...state, selectedStoreIds: [...new Set(ids)] };
}

/** Groups items by storeId, keeping list order; '' (any store) group comes last. */
export function groupByStore(items) {
  const groups = new Map();
  for (const it of items) {
    const k = it.storeId || '';
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(it);
  }
  const keys = [...groups.keys()].filter((k) => k !== '');
  if (groups.has('')) keys.push('');
  return keys.map((storeId) => ({ storeId, items: groups.get(storeId) }));
}

export function formatQty(item) {
  if (item.qty === null || item.qty === undefined) return item.unit || '';
  return item.unit ? `${item.qty} ${item.unit}` : String(item.qty);
}

export function summary(state) {
  const done = state.items.filter((i) => i.checked).length;
  return { total: state.items.length, done, remaining: state.items.length - done };
}
