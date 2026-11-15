// Pure price-catalog model. Normalises a decrypted price document (shopsmartr.prices/v1 or
// shopsmartr.prices/2) into compact columns, builds a token index once, and answers prefix
// searches, department filters and add-bar suggestions. No DOM, no network. Everything returned by
// normalizeDoc()/buildIndex() is structured-cloneable, so both can run in a Worker.

import { normUnit } from './list.js';

const num = (x) => (typeof x === 'number' && Number.isFinite(x) ? x : (typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : null));
const str = (x, n = 200) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, n) : (typeof x === 'number' && Number.isFinite(x) ? String(x) : null));
const cents = (x) => (x == null ? null : Math.round(x * 100) / 100);
const ON_SALE = 1;
const BY_WEIGHT = 2;

/** Lowercase, accent-free word tokens. "Crème Fraîche 8-oz" -> ["creme","fraiche","8","oz"]. */
export function tokenize(text) {
  return String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase()
    .replace(/&/g, ' and ').split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

const STR_COLS = ['sku', 'name', 'brand', 'size', 'unit', 'unitPriceText', 'saleText', 'aisle', 'category'];
/** Prices at or above this are treated as bad rows (matches the list's limit). */
export const MAX_PRICE = 1e6;

/** Accepts v1 and v2 documents; drops rows without a name or price, and duplicate SKUs/UPCs. */
export function normalizeDoc(doc) {
  if (!doc || typeof doc !== 'object' || !Array.isArray(doc.items)) throw new Error('Not a price document');
  const schema = String(doc.schema ?? '');
  if (!/^shopsmartr\.prices\/(v1|1|2|v2)$/.test(schema)) throw new Error(`Unsupported price schema ${schema || '(none)'}`);
  const stores = (Array.isArray(doc.stores) ? doc.stores : []).filter((s) => s && s.chain && s.storeId != null)
    .map((s) => ({ chain: String(s.chain), storeId: String(s.storeId), name: str(s.name) ?? `${s.chain} #${s.storeId}` }));
  const storeIdx = new Map(stores.map((s, i) => [`${s.chain}:${s.storeId}`, i]));
  const deptNames = [];
  const deptIdx = new Map();
  const N = doc.items.length;
  const cols = Object.fromEntries(STR_COLS.map((c) => [c, []]));
  const price = new Float64Array(N); const regular = new Float64Array(N); const unitPrice = new Float64Array(N);
  const approxLb = new Float64Array(N); const flags = new Uint8Array(N);
  const dept = new Uint16Array(N); const store = new Uint16Array(N);
  const seen = new Set();
  let n = 0;
  for (const raw of doc.items) {
    if (!raw || typeof raw !== 'object') continue;
    const name = str(raw.name) ?? str(raw.staple);
    const p = cents(num(raw.price));
    if (!name || p == null || p < 0 || p >= MAX_PRICE) continue;
    const chain = str(raw.chain, 40) ?? stores[0]?.chain ?? 'store';
    const sid = str(raw.storeId, 40) ?? stores[0]?.storeId ?? '';
    const sku = str(raw.sku, 40) ?? str(raw.productID, 40);
    const dupKey = `${chain}:${sid}:${str(raw.upc, 40) ? `u${raw.upc}` : sku ? `s${sku}` : `n${name}`}`;
    if (seen.has(dupKey)) continue;
    seen.add(dupKey);
    const sk = `${chain}:${sid}`;
    if (!storeIdx.has(sk)) { storeIdx.set(sk, stores.length); stores.push({ chain, storeId: sid, name: `${chain} #${sid}` }); }
    const dn = str(raw.department, 80) ?? (str(raw.staple) ? 'Staples' : 'Other');
    if (!deptIdx.has(dn)) { deptIdx.set(dn, deptNames.length); deptNames.push(dn); }
    let reg = cents(num(raw.regularPrice));
    const sale = Boolean(raw.onSale) || (reg != null && reg > p);
    if (!(sale && reg != null && reg > p)) reg = null;
    cols.sku.push(sku); cols.name.push(name); cols.brand.push(str(raw.brand, 80)); cols.size.push(str(raw.size, 40)); cols.unit.push(str(raw.unit, 20));
    cols.unitPriceText.push(str(raw.unitPriceText, 40)); cols.saleText.push(str(raw.saleText, 80));
    cols.aisle.push(str(raw.aisle, 40)); cols.category.push(str(raw.category, 80));
    price[n] = p; regular[n] = reg ?? NaN; unitPrice[n] = cents(num(raw.unitPrice)) ?? NaN;
    approxLb[n] = num(raw.approxWeightLb) ?? NaN;
    flags[n] = (sale ? ON_SALE : 0) | (raw.soldByWeight ? BY_WEIGHT : 0);
    dept[n] = deptIdx.get(dn); store[n] = storeIdx.get(sk);
    n += 1;
  }
  const counts = new Array(deptNames.length).fill(0);
  const storeCounts = new Array(stores.length).fill(0);
  for (let i = 0; i < n; i += 1) { counts[dept[i]] += 1; storeCounts[store[i]] += 1; }
  stores.forEach((s, i) => { s.count = storeCounts[i]; });
  const departments = deptNames.map((name, i) => ({ name, count: counts[i] })).sort((a, b) => (a.name < b.name ? -1 : 1));
  return {
    schema, asOf: str(doc.asOf), stores, deptNames, departments, n,
    cols: { ...cols, price: price.slice(0, n), regular: regular.slice(0, n), unitPrice: unitPrice.slice(0, n), approxLb: approxLb.slice(0, n), flags: flags.slice(0, n), dept: dept.slice(0, n), store: store.slice(0, n) },
  };
}

const nan = (x) => (Number.isNaN(x) ? null : x);

/** Materialises one row as a plain object (only for the rows on screen). */
export function getItem(cat, i) {
  const c = cat.cols;
  const s = cat.stores[c.store[i]];
  return {
    idx: i, key: `${s.chain}:${s.storeId}:${c.sku[i] ?? `#${i}`}`, chain: s.chain, storeId: s.storeId,
    sku: c.sku[i], name: c.name[i], brand: c.brand[i], size: c.size[i], unit: c.unit[i],
    price: c.price[i], regularPrice: nan(c.regular[i]), unitPrice: nan(c.unitPrice[i]), unitPriceText: c.unitPriceText[i],
    onSale: Boolean(c.flags[i] & ON_SALE), saleText: c.saleText[i], aisle: c.aisle[i],
    department: cat.deptNames[c.dept[i]], category: c.category[i],
    soldByWeight: Boolean(c.flags[i] & BY_WEIGHT), approxWeightLb: nan(c.approxLb[i]),
  };
}

/** Stable key for a catalog store, e.g. "wegmans:90". */
export const storeKey = (s) => `${s.chain}:${s.storeId}`;

/** Stores that actually have priced items, in feed order: [{ key, idx, chain, storeId, name, label, count }]. */
export function priceStores(cat) {
  if (!cat) return [];
  return cat.stores.map((s, idx) => ({ ...s, idx, key: storeKey(s), label: storeLabel(s) })).filter((s) => s.count > 0);
}

/** The saved store key if it is still in the feed, else the first store with prices (or null). */
export function pickStore(cat, savedKey) {
  const list = priceStores(cat);
  return (list.find((s) => s.key === savedKey) ?? list[0])?.key ?? null;
}

/** Departments with item counts for one store (all stores when storeKey is empty). */
export function storeDepartments(cat, key = '') {
  const si = key ? cat.stores.findIndex((s) => storeKey(s) === key) : -1;
  if (key && si < 0) return [];
  const counts = new Array(cat.deptNames.length).fill(0);
  const { dept, store } = cat.cols;
  for (let i = 0; i < cat.n; i += 1) if (si < 0 || store[i] === si) counts[dept[i]] += 1;
  return cat.deptNames.map((name, i) => ({ name, count: counts[i] })).filter((d) => d.count > 0).sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** Price per item used for totals. By-weight items get an estimate (approx: true). */
export function estimate(it) {
  if (!it || it.price == null) return null;
  if (it.soldByWeight) {
    const each = it.approxWeightLb && it.unitPrice ? cents(it.unitPrice * it.approxWeightLb) : it.price;
    return { each, approx: true };
  }
  return { each: it.price, approx: false };
}

/** Short store label, e.g. "Wegmans #90". */
export function storeLabel(it) {
  const c = String(it.chain ?? '');
  const chain = c === 'traderjoes' ? "Trader Joe's" : c === 'aldi' ? 'ALDI' : c.charAt(0).toUpperCase() + c.slice(1);
  return `${chain} #${it.storeId}`;
}

// ---------- index ----------
/**
 * Token index built once: sorted unique tokens; postings flattened into one Int32Array as
 * (row << 2 | weight) with weight name 3, brand 2, category/department 1. Also an alphabetical
 * row order and per-department row lists in that order.
 */
export function buildIndex(cat) {
  const { n, cols } = cat;
  const post = new Map();
  const nameKey = new Array(n);
  const add = (t, v) => { const a = post.get(t); if (a) { if (a[a.length - 1] >> 2 === v >> 2) { if ((a[a.length - 1] & 3) < (v & 3)) a[a.length - 1] = v; } else a.push(v); } else post.set(t, [v]); };
  const deptTok = cat.deptNames.map((d) => tokenize(d));
  for (let i = 0; i < n; i += 1) {
    const nt = tokenize(cols.name[i]);
    nameKey[i] = nt.join(' ');
    const base = i << 2;
    for (const t of nt) add(t, base | 3);
    if (cols.brand[i]) for (const t of tokenize(cols.brand[i])) add(t, base | 2);
    if (cols.category[i]) for (const t of tokenize(cols.category[i])) add(t, base | 1);
    for (const t of deptTok[cols.dept[i]]) add(t, base | 1);
  }
  const tokens = [...post.keys()].sort();
  const offsets = new Int32Array(tokens.length + 1);
  let total = 0;
  tokens.forEach((t, k) => { offsets[k] = total; total += post.get(t).length; });
  offsets[tokens.length] = total;
  const flat = new Int32Array(total);
  tokens.forEach((t, k) => flat.set(post.get(t), offsets[k]));
  const alpha = Int32Array.from({ length: n }, (_, i) => i).sort((a, b) => (nameKey[a] < nameKey[b] ? -1 : nameKey[a] > nameKey[b] ? 1 : a - b));
  const byDept = cat.deptNames.map(() => []);
  for (const i of alpha) byDept[cols.dept[i]].push(i);
  return { tokens, offsets, flat, nameKey, alpha, byDept: byDept.map((a) => Int32Array.from(a)) };
}

function lowerBound(arr, x) {
  let lo = 0; let hi = arr.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < x) lo = mid + 1; else hi = mid; }
  return lo;
}

// Match classes, best first. A row's per-token weight is class * 4 + field (name 3, brand 2, dept/category 1),
// so any exact match outranks any prefix match, and so on; within a class, name beats brand beats department.
export const EXACT = 4;
export const PREFIX = 3;
export const SUBSEQ = 2;
export const FUZZY = 1;

/** True when q is t with exactly one insertion, deletion or substitution (lengths differ by <= 1). */
export function editDistance1(q, t) {
  const lq = q.length; const lt = t.length;
  if (Math.abs(lq - lt) > 1 || q === t) return false;
  let i = 0; let j = 0; let edits = 0;
  while (i < lq && j < lt) {
    if (q.charCodeAt(i) === t.charCodeAt(j)) { i += 1; j += 1; continue; }
    if ((edits += 1) > 1) return false;
    if (lq > lt) i += 1; else if (lt > lq) j += 1; else { i += 1; j += 1; }
  }
  return edits + (lq - i) + (lt - j) <= 1;
}

/** "chkn" in "chicken": same first letter, the rest in order (a consonant-skeleton style abbreviation). */
export function isSubsequence(q, t) {
  if (q.length < 2 || q.length >= t.length || q.charCodeAt(0) !== t.charCodeAt(0)) return false;
  let i = 1;
  for (let j = 1; j < t.length && i < q.length; j += 1) if (t.charCodeAt(j) === q.charCodeAt(i)) i += 1;
  return i === q.length;
}

/** True when q is within one edit of t or of a prefix of t of length |q|-1..|q|+1 ("bananna" ~ "bananas"). */
export function nearPrefix(q, t) {
  if (t.length < q.length - 1) return false;
  for (let L = q.length - 1; L <= q.length + 1 && L <= t.length; L += 1) if (editDistance1(q, t.slice(0, L))) return true;
  return false;
}

/** Minimum query-token lengths for the looser rules (L13: keeps "rice" from matching "ice"/"price"). */
export const MIN_SUBSEQ = 3;
export const MIN_FUZZY = 5;

/**
 * Index tokens matching one query token: [[tokenIndex, class], ...]. Memoised per index, so typing
 * one more letter only resolves the last token.
 * - exact / prefix: binary-searched range of the sorted token list;
 * - subsequence (3+ letters): same first letter, so it always starts at a word start;
 * - fuzzy (5+ letters, and only when the token has no exact or prefix hit): one edit against the
 *   word or against a word prefix of length |q|-1..|q|+1.
 */
export function matchToken(index, q) {
  const memo = index.qmemo ?? (index.qmemo = new Map());
  const hit = memo.get(q);
  if (hit) return hit;
  const { tokens } = index;
  const out = [];
  const seen = new Set();
  for (let k = lowerBound(tokens, q); k < tokens.length && tokens[k].startsWith(q); k += 1) {
    out.push([k, tokens[k] === q ? EXACT : PREFIX]); seen.add(k);
  }
  const direct = out.length;
  const word = !/^\d+$/.test(q);
  if (q.length >= MIN_SUBSEQ && word) {
    const c = q[0];
    const next = String.fromCharCode(c.charCodeAt(0) + 1);
    for (let k = lowerBound(tokens, c), end = lowerBound(tokens, next); k < end; k += 1) {
      if (!seen.has(k) && isSubsequence(q, tokens[k])) { out.push([k, SUBSEQ]); seen.add(k); }
    }
  }
  if (q.length >= MIN_FUZZY && word && direct === 0) {
    const n = tokens.length;
    for (let k = 0; k < n; k += 1) if (!seen.has(k) && nearPrefix(q, tokens[k])) { out.push([k, FUZZY]); seen.add(k); }
  }
  if (memo.size > 500) memo.clear();
  memo.set(q, out);
  return out;
}

function bucketByLength(tokens) {
  const b = [];
  tokens.forEach((t, k) => { (b[t.length] ?? (b[t.length] = [])).push(k); });
  return b;
}

// Scratch arrays reused across searches (sized to the catalog), reset through the touched list.
function scratch(index, n) {
  if (!index.scratch || index.scratch.hits.length < n) {
    index.scratch = { hits: new Uint8Array(n), score: new Uint16Array(n), best: new Uint8Array(n) };
  }
  if (!index.rank) {
    index.rank = new Int32Array(n);
    index.alpha.forEach((row, r) => { index.rank[row] = r; });
  }
  return index.scratch;
}

/**
 * Search; every query token must match a word of the row's name, brand, category or department as
 * an exact word, a prefix, a subsequence ("chkn" -> chicken) or with one typo (4+ letters).
 * Ranked exact > prefix > subsequence > fuzzy, name > brand > department; then shorter names, then
 * A-Z. Optional store and department filters; paged. Returns { total, offset, rows }.
 * An empty query lists the store/department alphabetically.
 */
export function searchRows(cat, index, query, { department = '', store = '', offset = 0, limit = 40 } = {}) {
  const qt = [...new Set(tokenize(query))].slice(0, 12);
  const d = department ? cat.deptNames.indexOf(department) : -1;
  const si = store ? cat.stores.findIndex((s) => storeKey(s) === store) : -1;
  if ((department && d < 0) || (store && si < 0)) return { total: 0, offset, rows: [] };
  if (!qt.length) {
    let list = d >= 0 ? index.byDept[d] : index.alpha;
    if (si >= 0 && cat.stores.length > 1) list = browseList(cat, index, d, si);
    return { total: list.length, offset, rows: Array.from(list.subarray(offset, offset + limit)) };
  }
  // Rarest-looking (longest) token first keeps the candidate set small.
  qt.sort((a, b) => b.length - a.length);
  const { hits, score, best } = scratch(index, cat.n);
  const { offsets, flat } = index;
  let cand = [];
  for (let qi = 0; qi < qt.length; qi += 1) {
    const touched = [];
    for (const [k, cls] of matchToken(index, qt[qi])) {
      const base = cls * 4;
      for (let p = offsets[k], e = offsets[k + 1]; p < e; p += 1) {
        const v = flat[p]; const row = v >> 2;
        if (hits[row] !== qi) continue;
        const w = base + (v & 3);
        if (best[row] === 0) touched.push(row);
        if (w > best[row]) best[row] = w;
      }
    }
    for (const row of touched) { hits[row] = qi + 1; score[row] += best[row]; best[row] = 0; }
    for (const row of cand) if (hits[row] === qi) { hits[row] = 0; score[row] = 0; } // dropped out
    cand = touched;
    if (!cand.length) break;
  }
  const phrase = tokenize(query).join(' ');
  const keys = new Float64Array(cand.length);
  let m = 0;
  const { store: storeCol, dept } = cat.cols;
  for (const row of cand) {
    const ok = hits[row] === qt.length && (d < 0 || dept[row] === d) && (si < 0 || storeCol[row] === si);
    if (ok) {
      const nk = index.nameKey[row];
      const sc = score[row] + (nk.startsWith(phrase) ? 8 : 0) + (nk === phrase ? 8 : 0);
      keys[m] = ((1023 - Math.min(sc, 1023)) * 256 + Math.min(nk.length, 255)) * 1048576 + index.rank[row];
      m += 1;
    }
    hits[row] = 0; score[row] = 0;
  }
  const sorted = keys.subarray(0, m).sort();
  const rows = [];
  for (let i = offset; i < Math.min(m, offset + limit); i += 1) rows.push(index.alpha[sorted[i] % 1048576]);
  return { total: m, offset, rows };
}

// Alphabetical rows for one store (and department), memoised on the index object.
function browseList(cat, index, d, si) {
  const memo = index.browse ?? (index.browse = new Map());
  const k = `${si}:${d}`;
  if (!memo.has(k)) {
    const src = d >= 0 ? index.byDept[d] : index.alpha;
    memo.set(k, src.filter((i) => cat.cols.store[i] === si));
  }
  return memo.get(k);
}

/** Real on-sale items for one store, biggest saving first (for the Shop idle view). */
export function onSale(cat, index, store, limit = 6) {
  const si = cat.stores.findIndex((s) => storeKey(s) === store);
  const { flags, store: sc, price, regular } = cat.cols;
  const rows = [];
  for (const i of index.alpha) if ((flags[i] & ON_SALE) && (si < 0 || sc[i] === si) && regular[i] > price[i]) rows.push(i);
  rows.sort((a, b) => (regular[b] - price[b]) - (regular[a] - price[a]) || a - b);
  return rows.slice(0, limit).map((i) => getItem(cat, i));
}

export function search(cat, index, query, opts) {
  const r = searchRows(cat, index, query, opts);
  return { total: r.total, offset: r.offset, items: r.rows.map((i) => getItem(cat, i)) };
}

/** Add-bar suggestions: top matches for the item-name part of quick-add text (min 2 letters). */
export function suggest(cat, index, name, { limit = 6, store = '' } = {}) {
  const q = String(name ?? '').trim();
  if (!cat || !index || q.replace(/[^\p{L}\p{N}]/gu, '').length < 2) return [];
  return search(cat, index, q, { limit, store }).items;
}

/** Unit the item's unit price is quoted in ("lb", "oz", "ea"...), from unit or unitPriceText. */
export function unitOf(it) {
  const tail = /\/\s*([a-z. ]+)$/i.exec(it.unitPriceText ?? '')?.[1];
  return normUnit(tail) || normUnit(it.unit);
}

/** Regular (pre-sale) price on the same basis as estimate(): per estimated piece for by-weight items. */
export function regularEach(it) {
  if (!it.onSale || !it.regularPrice) return null;
  const est = estimate(it);
  return Math.round(est.each * (it.regularPrice / it.price) * 100) / 100;
}

/** Fields copied onto a list item added from the catalog. directory = stores.json rows by id. */
export function pricedFields(cat, it, directory = {}) {
  const est = estimate(it);
  const dirId = `${it.chain}-${it.storeId}`;
  return {
    storeId: directory[dirId] ? dirId : '',
    priced: {
      each: est.each, approx: est.approx, regular: it.regularPrice, onSale: it.onSale,
      unitPriceText: it.unitPriceText, size: it.size, aisle: it.aisle, sku: it.sku,
      store: storeLabel(it), chain: it.chain, storeNo: it.storeId, asOf: cat.asOf,
      shelf: it.price, unitPrice: it.unitPrice, unitOf: unitOf(it), byWeight: it.soldByWeight,
    },
  };
}

/** Decrypted document -> { catalog, index, ms } (used by the Worker and as a main-thread fallback). */
export function prepare(doc, now = () => Date.now()) {
  const t0 = now();
  const catalog = normalizeDoc(doc);
  const t1 = now();
  const index = buildIndex(catalog);
  return { catalog, index, ms: { normalize: t1 - t0, index: now() - t1 } };
}
