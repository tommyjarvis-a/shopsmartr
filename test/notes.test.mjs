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

// Word-sequence similarity (2*LCS / total words), ignoring the name and punctuation.
const words = (s) => s.toLowerCase().replace(/\blauren\b/g, '').replace(/[^a-z' ]/g, ' ').split(/\s+/).filter(Boolean);
function similarity(a, b) {
  const d = Array(b.length + 1).fill(0);
  for (const x of a) {
    let prev = 0;
    for (let j = 1; j <= b.length; j += 1) { const t = d[j]; d[j] = x === b[j - 1] ? prev + 1 : Math.max(d[j], d[j - 1]); prev = t; }
  }
  return (2 * d[b.length]) / (a.length + b.length);
}

test('no two notes share most of their wording (similarity < 0.7)', () => {
  const W = NOTES.map(words);
  const close = [];
  for (let i = 0; i < W.length; i += 1) {
    for (let j = i + 1; j < W.length; j += 1) if (similarity(W[i], W[j]) >= 0.7) close.push(`${NOTES[i]} | ${NOTES[j]}`);
  }
  assert.deepEqual(close, []);
});

// Notes must not assert facts about Steven and Lauren's life that we can't know (kids, pets, a
// house, places, holidays, shared history). "home" is banned too: it presumes a shared place.
const BANNED = [
  'kid', 'kids', 'kiddo', 'child', 'children', 'baby', 'babies', 'son', 'sons', 'daughter', 'daughters',
  'dog', 'dogs', 'puppy', 'pup', 'pups', 'cat', 'cats', 'kitten', 'kitty', 'pet', 'pets',
  'mom', 'mommy', 'mother', 'mama', 'dad', 'daddy', 'father', 'parent', 'parents', 'family', 'grandkids',
  'wedding', 'anniversary', 'honeymoon', 'engaged', 'proposal', 'birthday', 'christmas', 'thanksgiving', 'holidays',
  'house', 'home', 'homes', 'kitchen', 'couch', 'sofa', 'porch', 'fridge', 'yard', 'garden', 'bedroom', 'window',
  'snow', 'snowy', 'snowstorm', 'buffalo', 'bedtime', 'school', 'years',
];

test('no note uses a banned "family fact" word', () => {
  const hits = NOTES.filter((n) => words(n).some((w) => BANNED.includes(w.replace(/'s$/, ''))));
  assert.deepEqual(hits, []);
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
