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
 * Package size from a catalog size text: "5 lb bag" -> { amount: 5, unit: 'lb' }, "32 oz",
 * "2 kg", "1.5 L", "12 fl oz", "64 fl. oz". Multi-packs ("6 x 12 oz") count the whole pack.
 * Null when there's no weight or volume in the text (e.g. "12 ct", "each").
 */
export function parsePackSize(size) {
  const t = String(size ?? '').toLowerCase();
  const m = /(?:(\d+(?:\.\d+)?)\s*(?:x|×)\s*)?(\d+(?:\.\d+)?|\.\d+)\s*-?\s*(fl\.?\s*oz|lbs?|pounds?|ounces?|oz|kgs?|kilograms?|grams?|g|gallons?|gal|quarts?|qt|liters?|litres?|l|ml)\b/.exec(t);
  if (!m) return null;
  const unit = normUnit(m[3].replace(/fl\.?\s*oz/, 'floz'));
  const amount = Number(m[2]) * (m[1] ? Number(m[1]) : 1);
  return unit && amount > 0 ? { amount, unit } : null;
}

/**
 * Price of one list line, from the snapshot carried on the item. Returns { total, approx, regular }
 * or null when the line has no price. Rules (M2, L19):
 * - qty in a weight/volume unit and a unit price in a compatible unit: qty converted x unit price.
 *   Exact for items sold by weight; "~" for package items (you buy whole packages).
 * - qty in a weight/volume unit without a usable unit price: whole packages from the item's size
 *   ("5 kg" of a "2 lb" bag = ceil(11.02 / 2) = 6 packages), marked "~", with packs set. When the
 *   size can't be read either, null: no price beats a misleading one, and the line isn't counted.
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
    if (f) { total = qty * f * p.unitPrice; approx = !p.byWeight; } else {
      const pack = parsePackSize(p.size);
      const g = pack ? convert(u, pack.unit) : null;
      if (!g) return null;
      const packs = Math.max(1, Math.ceil(r2((qty * g) / pack.amount * 1000) / 1000 - 1e-9));
      total = r2(packs * p.each);
      return { total, approx: true, regular: ratio && ratio > 1 ? r2(total * ratio) : null, packs };
    }
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

export function checkAll(state) {
  return { ...state, items: state.items.map((it) => (it.checked ? it : { ...it, checked: true })) };
}
/** Puts back each line's done state from a { id: checked } snapshot (Undo for Check all / Uncheck all). */
export function restoreChecked(state, snapshot) {
  return { ...state, items: state.items.map((it) => (it.id in snapshot && snapshot[it.id] !== it.checked ? { ...it, checked: snapshot[it.id] } : it)) };
}
export const checkedSnapshot = (state) => Object.fromEntries(state.items.map((it) => [it.id, it.checked]));
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

/**
 * L20 / quick add: one parse for the desktop add bar and the mobile add sheet. A leading amount
 * typed in the name ("2 lb apples", "10000 paper towels") wins over the separate Qty/Unit fields.
 */
export function quickInput(text, qty = '', unit = '') {
  const q = parseQuick(text);
  return { name: q.name, qty: q.qty ?? (qty === '' || qty === null || qty === undefined ? null : qty), unit: q.unit || unit || '' };
}

// ---------- per-store sections (v0.1.5) ----------
/**
 * Section key for a list line: the store the user tagged (a stores.json id, "chain-storeId"),
 * else the store a price came from ("wegmans-90" from chain + store number), else '' (Any store).
 * The same chain-storeId shape covers Tops, ALDI and Trader Joe's when their prices arrive.
 */
export function storeKeyOf(it) {
  if (it.storeId) return it.storeId;
  const p = it.priced;
  return p && p.chain && p.storeNo ? `${p.chain}-${p.storeNo}` : '';
}

/**
 * List sections by store, in first-appearance order, with "Any store" last:
 * [{ key, name, address, chain, items, total }] where total is totals() over the section.
 * storesById is the stores.json directory; a price-only store falls back to the price's label.
 */
export function storeSections(items, storesById = {}, sort = null, order = []) {
  const map = new Map();
  for (const it of items) {
    const k = storeKeyOf(it);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  }
  // The user's store order from the Stores tab first, then other stores as they appear; Any last.
  const rank = new Map(order.map((k, i) => [k, i]));
  const keys = [...map.keys()].filter((k) => k !== '').map((k, i) => [k, rank.has(k) ? rank.get(k) : order.length + i])
    .sort((a, b) => a[1] - b[1]).map(([k]) => k);
  if (map.has('')) keys.push('');
  return keys.map((key) => {
    const s = storesById[key];
    const its = map.get(key);
    const fromPrice = its.find((i) => i.priced?.store)?.priced;
    return {
      key,
      name: key ? (s?.name ?? fromPrice?.store ?? 'Store no longer listed') : 'Any store',
      address: s ? [s.address, s.city].filter(Boolean).join(', ') : '',
      street: s?.address ?? '',
      chain: s?.chain ?? fromPrice?.chain ?? '',
      items: sort ? sortItems(its, sort) : its,
      total: totals(its),
    };
  });
}

// ---------- list sort (v0.1.5) ----------
export const SORTS = ['name', 'price', 'aisle'];
/** Normalises a saved sort choice: { by: 'name'|'price'|'aisle', dir: 'asc'|'desc' }; default A-Z. */
export function cleanSort(x) {
  const by = SORTS.includes(x?.by) ? x.by : 'name';
  return { by, dir: x?.dir === 'asc' ? 'asc' : 'desc' };
}
const COLL = new Intl.Collator('en', { sensitivity: 'base', numeric: true });
export const compareNames = (a, b) => COLL.compare(String(a ?? ''), String(b ?? ''));

/** "Aisle 10" -> ['aisle', 10, '']; "Dairy 2B" -> ['dairy', 2, 'b']; "Produce" -> ['produce', -1, '']. */
export function aisleKey(aisle) {
  const t = String(aisle ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!t) return null;
  const m = /^(.*?)\s*#?\s*(\d+(?:\.\d+)?)\s*(.*)$/.exec(t);
  return m ? [m[1], Number(m[2]), m[3]] : [t, -1, ''];
}
/** Produce aisles ("Produce", "Produce 2") come first in a store walk (spec §8, L21). */
const isProduce = (k) => k[0] === 'produce';
/**
 * Aisle order: Produce first, then natural order (text prefix, then number so 2 comes before 10,
 * then any suffix). Lines without an aisle go last.
 */
export function compareAisles(a, b) {
  const x = aisleKey(a); const y = aisleKey(b);
  if (!x || !y) return x ? -1 : y ? 1 : 0;
  return (isProduce(y) - isProduce(x)) || COLL.compare(x[0], y[0]) || x[1] - y[1] || COLL.compare(x[2], y[2]);
}

/**
 * Sorted copy of list lines (checked lines keep their place in the order; the done styling is
 * unchanged). Name is the tie-break. Price: by line total, high-low or low-high; lines without a
 * price (manual items, or an amount that can't be priced) always go last.
 */
export function sortItems(items, sort) {
  const { by, dir } = cleanSort(sort);
  const idx = new Map(items.map((it, i) => [it, i]));
  const name = (a, b) => compareNames(a.name, b.name) || idx.get(a) - idx.get(b);
  if (by === 'name') return [...items].sort(name);
  if (by === 'aisle') return [...items].sort((a, b) => compareAisles(a.priced?.aisle, b.priced?.aisle) || name(a, b));
  const price = new Map(items.map((it) => [it, linePrice(it)?.total ?? null]));
  const sign = dir === 'asc' ? 1 : -1;
  return [...items].sort((a, b) => {
    const x = price.get(a); const y = price.get(b);
    if (x === null || y === null) return x === null && y === null ? name(a, b) : x === null ? 1 : -1;
    return sign * (x - y) || name(a, b);
  });
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

/** "No price for 5 kg" (or "No price" with no amount) for a line linePrice() can't price (L19/M5). */
export function noPriceText(it) {
  const amt = formatQty(it ?? {});
  return amt ? `No price for ${amt}` : 'No price';
}

/** Toast/status text after adding a catalog line; never throws on an unpriceable amount (M5). */
export function addedText(it) {
  const line = linePrice(it);
  if (line) return `Added ${it.name} (${priceText(line.total, line.approx)})`;
  return `Added ${it.name} (${it?.priced ? noPriceText(it).toLowerCase() : 'no price'})`;
}
