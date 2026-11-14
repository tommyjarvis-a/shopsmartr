// Shuffled no-repeat cycle over the love notes. Pure core (advance) plus a storage wrapper.
export const NOTES_KEY = 'shopsmartr:notes:v1';

export function shuffle(n, rng = Math.random) {
  const a = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** A fresh order whose first entry is never `last` (no repeat at the seam between cycles). */
export function newOrder(n, last = -1, rng = Math.random) {
  const order = shuffle(n, rng);
  if (n > 1 && order[0] === last) {
    const k = 1 + Math.floor(rng() * (n - 1));
    [order[0], order[k]] = [order[k], order[0]];
  }
  return order;
}

function validCycle(c, n) {
  return c && c.v === 1 && c.n === n && Array.isArray(c.order) && c.order.length === n
    && Number.isInteger(c.pos) && c.pos >= 0 && c.pos <= n
    && new Set(c.order).size === n && c.order.every((i) => Number.isInteger(i) && i >= 0 && i < n);
}

/** Returns { index, cycle } for the next note; cycle is the new state to persist. */
export function advance(cycle, n, rng = Math.random) {
  if (n <= 0) return { index: -1, cycle };
  let c = validCycle(cycle, n) ? cycle : { v: 1, n, order: newOrder(n, Number.isInteger(cycle?.last) ? cycle.last : -1, rng), pos: 0, last: -1 };
  if (c.pos >= n) c = { ...c, order: newOrder(n, c.last, rng), pos: 0 };
  const index = c.order[c.pos];
  return { index, cycle: { ...c, pos: c.pos + 1, last: index } };
}

export function loadCycle(storage) {
  try { return JSON.parse(storage.getItem(NOTES_KEY)); } catch { return null; }
}

/** Picks the next note and saves the cycle; works in memory if storage is blocked. */
let memoryCycle = null;
export function nextNote(notes, storage = globalThis.localStorage, rng = Math.random) {
  const prev = loadCycle(storage) ?? memoryCycle;
  const { index, cycle } = advance(prev, notes.length, rng);
  memoryCycle = cycle;
  try { storage.setItem(NOTES_KEY, JSON.stringify(cycle)); } catch { /* keep in memory */ }
  return index < 0 ? '' : notes[index];
}
