// Pure shopping-list model. Every function returns a new state; nothing touches the DOM.
export const UNITS = ['ea', 'lb', 'oz', 'kg', 'g', 'gal', 'qt', 'L', 'ml', 'pack', 'bag', 'box', 'can', 'jar', 'bottle', 'bunch', 'dozen', 'loaf', 'tub', 'cup'];

// Plural / alternate spellings accepted by the quick-add parser.
const UNIT_ALIASES = {
  each: 'ea', lbs: 'lb', pound: 'lb', pounds: 'lb', ounce: 'oz', ounces: 'oz', kgs: 'kg', grams: 'g', gram: 'g',
  gals: 'gal', gallon: 'gal', gallons: 'gal', quart: 'qt', quarts: 'qt', liter: 'L', liters: 'L', litre: 'L', l: 'L',
  packs: 'pack', pkg: 'pack', package: 'pack', bags: 'bag', boxes: 'box', cans: 'can', jars: 'jar', bottles: 'bottle',
  bunches: 'bunch', cups: 'cup', doz: 'dozen', loaves: 'loaf', tubs: 'tub',
};

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
    qty = Math.round(qty * 1000) / 1000;
  }
  return {
    name: name.slice(0, 200),
    qty,
    unit: String(input.unit ?? '').trim().slice(0, 20),
    notes: String(input.notes ?? '').trim().slice(0, 500),
    storeId: input.storeId ? String(input.storeId) : '',
  };
}

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
