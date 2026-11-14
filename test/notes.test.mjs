import test from 'node:test';
import assert from 'node:assert/strict';
import { NOTES } from '../src/notes.js';
import { advance, newOrder, nextNote, NOTES_KEY } from '../src/lovenotes.js';
import { memoryStorage } from '../src/storage.js';

const norm = (s) => s.toLowerCase().replace(/\s+/g, ' ').trim();

// Small seeded PRNG so cycle tests are repeatable.
function rng(seed = 1) {
  let x = seed >>> 0;
  return () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 2 ** 32; };
}

test('at least 300 notes, all unique (case/whitespace-insensitive), short, one line', () => {
  assert.ok(NOTES.length >= 300, `only ${NOTES.length}`);
  assert.equal(new Set(NOTES.map(norm)).size, NOTES.length);
  for (const n of NOTES) {
    assert.ok(n.trim() === n && n.length > 0 && n.length <= 90, n);
    assert.doesNotMatch(n, /[\r\n]/);
  }
});

test('no near-duplicates once the name and punctuation are ignored', () => {
  const k = (s) => norm(s.replace(/\bLauren\b/g, '').replace(/[^\p{L}\p{N} ]/gu, ''));
  assert.equal(new Set(NOTES.map(k)).size, NOTES.length);
});

test('"Lauren" appears in 25%-40% of notes', () => {
  const named = NOTES.filter((n) => /\bLauren\b/.test(n)).length;
  const share = named / NOTES.length;
  assert.ok(share >= 0.25 && share <= 0.40, `named share ${share}`);
});

test('cycle shows every note once before any repeat, with no repeat at the seam', () => {
  const n = 7;
  const r = rng(7);
  let cycle = null;
  let last = -1;
  for (let round = 0; round < 50; round += 1) {
    const seen = new Set();
    for (let i = 0; i < n; i += 1) {
      const step = advance(cycle, n, r);
      assert.notEqual(step.index, last, 'immediate repeat');
      seen.add(step.index);
      last = step.index;
      cycle = step.cycle;
    }
    assert.equal(seen.size, n, 'every note once per cycle');
  }
});

test('newOrder never starts with the last note', () => {
  const r = rng(3);
  for (let i = 0; i < 500; i += 1) assert.notEqual(newOrder(5, i % 5, r)[0], i % 5);
  assert.deepEqual(newOrder(1, 0, r), [0]);
});

test('nextNote persists the cycle across reloads and resets when the note count changes', () => {
  const store = memoryStorage();
  const notes = ['a', 'b', 'c', 'd'];
  const r = rng(11);
  const first = [nextNote(notes, store, r), nextNote(notes, store, r)];
  // "Reload": a fresh call reads the saved cycle and continues it.
  const rest = [nextNote(notes, store, r), nextNote(notes, store, r)];
  assert.deepEqual([...first, ...rest].sort(), notes);
  const saved = JSON.parse(store.getItem(NOTES_KEY));
  assert.equal(saved.pos, 4);
  const next = nextNote(notes, store, r);
  assert.notEqual(next, rest[1]);
  // A different list size starts a new cycle instead of indexing out of range.
  const more = [...notes, 'e'];
  const seen = new Set(Array.from({ length: 5 }, () => nextNote(more, store, r)));
  assert.equal(seen.size, 5);
  store.setItem(NOTES_KEY, '{garbage');
  assert.ok(notes.includes(nextNote(notes, store, r)));
  assert.equal(nextNote([], store, r), '');
});

test('works when storage is blocked', () => {
  const broken = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  const notes = ['a', 'b', 'c'];
  const got = new Set([nextNote(notes, broken), nextNote(notes, broken), nextNote(notes, broken)]);
  assert.equal(got.size, 3);
});
