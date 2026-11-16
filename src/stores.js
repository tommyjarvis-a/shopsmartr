// Store directory schema checks. Shared by the app, tests and the weekly CI check.
export const CHAINS = ['tops', 'wegmans', 'aldi', 'traderjoes'];
/**
 * v0.2.4: chains hidden from every picker and price view (store dropdowns, Stores finder, Shop,
 * Weekly ads, suggestions, recipe matching). Only Wegmans has a price feed today, so the others are
 * hidden behind this flag. Their stores stay in data/stores.json, and the household's data that
 * points at them (list lines, Favorites, store picks) is never changed: hidden-chain lines still show
 * on the list under their own store, and everything comes back when the Set is emptied.
 * It is a live Set on purpose: tests (and a future setting) clear or refill it at run time.
 */
export const HIDE_NON_WEGMANS = true;
export const HIDDEN_CHAINS = new Set(HIDE_NON_WEGMANS ? ['tops', 'aldi', 'traderjoes'] : []);
export const isShownChain = (chain) => !HIDDEN_CHAINS.has(chain);
/** The chains offered in the app, in CHAINS order. */
export const shownChains = () => CHAINS.filter(isShownChain);
/** Stores the app offers (finder, pickers, ads): everything not on a hidden chain. */
export const shownStores = (stores) => stores.filter((s) => s && isShownChain(s.chain));
/** Runs fn with the hidden set temporarily replaced (tests: flag on and off). */
export function withHiddenChains(chains, fn) {
  const before = [...HIDDEN_CHAINS];
  HIDDEN_CHAINS.clear(); for (const c of chains) HIDDEN_CHAINS.add(c);
  try { return fn(); } finally { HIDDEN_CHAINS.clear(); for (const c of before) HIDDEN_CHAINS.add(c); }
}
const REQUIRED = ['id', 'chain', 'name', 'address', 'city', 'state', 'zip', 'lat', 'lon', 'url', 'verified', 'source'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Returns an array of human-readable problems; empty means the document is valid. */
export function validateStoresDoc(doc) {
  const errs = [];
  if (!doc || typeof doc !== 'object') return ['document is not an object'];
  if (doc.schema !== 'shopsmartr.stores/1') errs.push('schema must be "shopsmartr.stores/1"');
  if (!ISO_DATE.test(doc.asOf ?? '') || Number.isNaN(Date.parse(doc.asOf))) errs.push('asOf must be a YYYY-MM-DD date');
  const chains = doc.chains ?? {};
  for (const c of CHAINS) {
    const ch = chains[c];
    if (!ch) { errs.push(`chains.${c} missing`); continue; }
    if (!ch.name) errs.push(`chains.${c}.name missing`);
    if (!isHttps(ch.locatorUrl)) errs.push(`chains.${c}.locatorUrl must be https`);
    if (!ch.weeklyAd || !isHttps(ch.weeklyAd.url) || !ch.weeklyAd.label) errs.push(`chains.${c}.weeklyAd needs label and https url`);
  }
  if (!Array.isArray(doc.stores) || doc.stores.length === 0) return [...errs, 'stores must be a non-empty array'];
  const ids = new Set();
  const sources = doc.sources ?? {};
  doc.stores.forEach((s, i) => {
    const at = `stores[${i}]${s && s.id ? ` (${s.id})` : ''}`;
    for (const k of REQUIRED) if (s?.[k] === undefined || s[k] === null || s[k] === '') errs.push(`${at}: ${k} missing`);
    if (!s) return;
    if (ids.has(s.id)) errs.push(`${at}: duplicate id`);
    ids.add(s.id);
    if (!CHAINS.includes(s.chain)) errs.push(`${at}: unknown chain "${s.chain}"`);
    if (!/^\d{5}$/.test(s.zip ?? '')) errs.push(`${at}: zip must be 5 digits`);
    if (!/^[A-Z]{2}$/.test(s.state ?? '')) errs.push(`${at}: state must be a 2-letter code`);
    if (!(Number.isFinite(s.lat) && s.lat >= -90 && s.lat <= 90)) errs.push(`${at}: lat out of range`);
    if (!(Number.isFinite(s.lon) && s.lon >= -180 && s.lon <= 180)) errs.push(`${at}: lon out of range`);
    if (s.url && !isHttps(s.url)) errs.push(`${at}: url must be https`);
    if (typeof s.verified !== 'boolean') errs.push(`${at}: verified must be boolean`);
    if (s.source && !sources[s.source]) errs.push(`${at}: source "${s.source}" not described in sources`);
    if (s.coordsSource && !sources[s.coordsSource]) errs.push(`${at}: coordsSource "${s.coordsSource}" not described in sources`);
  });
  return errs;
}

function isHttps(u) {
  try { return new URL(u).protocol === 'https:'; } catch { return false; }
}

export function indexById(stores) {
  return Object.fromEntries(stores.map((s) => [s.id, s]));
}

export function countByChain(stores) {
  const out = Object.fromEntries(CHAINS.map((c) => [c, 0]));
  for (const s of stores) out[s.chain] = (out[s.chain] ?? 0) + 1;
  return out;
}
