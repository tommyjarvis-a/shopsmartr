import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/list.js';
import { saveState, loadState, memoryStorage, STORAGE_KEY, deserialize } from '../src/storage.js';

test('round-trip through storage', () => {
  const store = memoryStorage();
  let s = L.emptyState();
  s = L.addItem(s, { name: 'Milk', qty: 1, unit: 'gal', storeId: 'wegmans-83', notes: 'say "2%", please' }, 'a');
  s = L.addItem(s, { name: 'Eggs' }, 'b');
  s = L.toggleItem(s, 'b');
  s = { ...L.setSelectedStores(s, ['wegmans-83', 'aldi-x']), zip: '14221', radiusMi: 25 };
  assert.equal(saveState(s, store), true);
  assert.deepEqual(loadState(store), s);
});

test('empty, corrupt and foreign data fall back safely', () => {
  const store = memoryStorage();
  assert.deepEqual(loadState(store), L.emptyState());
  store.setItem(STORAGE_KEY, '{not json');
  assert.deepEqual(loadState(store), L.emptyState());
  store.setItem(STORAGE_KEY, JSON.stringify({ version: 99, items: [{ id: 'a', name: 'x' }] }));
  assert.deepEqual(loadState(store), L.emptyState());
});

test('invalid rows are dropped, bad fields clamped', () => {
  const s = deserialize(JSON.stringify({
    version: 1,
    items: [{ id: 'a', name: 'ok', qty: 2 }, { id: 'b', name: '' }, { name: 'no id' }, { id: 'c', name: 'neg', qty: -3 }, null],
    selectedStoreIds: ['x', 5],
    zip: 14221,
    radiusMi: 9999,
  }));
  assert.deepEqual(s.items.map((i) => i.id), ['a']);
  assert.deepEqual(s.selectedStoreIds, ['x']);
  assert.equal(s.zip, '');
  assert.equal(s.radiusMi, 10);
});

test('storage failures are swallowed', () => {
  const broken = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('quota'); } };
  assert.equal(saveState(L.emptyState(), broken), false);
  assert.deepEqual(loadState(broken), L.emptyState());
});

test('L5: unreadable saved data is backed up and reported, not silently dropped', async () => {
  const { loadStateWithStatus, BACKUP_KEY } = await import('../src/storage.js');
  for (const raw of ['{not json', JSON.stringify({ version: 2, items: [] })]) {
    const store = memoryStorage();
    store.setItem(STORAGE_KEY, raw);
    const r = loadStateWithStatus(store);
    assert.equal(r.problem, 'unreadable');
    assert.equal(r.backedUp, true);
    assert.equal(store.getItem(BACKUP_KEY), raw);
    assert.deepEqual(r.state, L.emptyState());
  }
  const ok = memoryStorage();
  assert.deepEqual(loadStateWithStatus(ok), { state: L.emptyState(), problem: null, backedUp: false });
  saveState(L.addItem(L.emptyState(), { name: 'Milk' }, 'a'), ok);
  const r2 = loadStateWithStatus(ok);
  assert.equal(r2.problem, null);
  assert.equal(r2.state.items[0].name, 'Milk');
  assert.equal(ok.getItem(BACKUP_KEY), null);
  const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('x'); }, removeItem() {} };
  assert.equal(loadStateWithStatus(blocked).problem, 'unavailable');
  const readOnly = { getItem: () => null, setItem() { throw new Error('QuotaExceeded'); }, removeItem() {} };
  assert.equal(loadStateWithStatus(readOnly).problem, 'unavailable');
  assert.equal(loadStateWithStatus(undefined).problem, 'unavailable');
});
