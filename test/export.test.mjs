import test from 'node:test';
import assert from 'node:assert/strict';
import { csvCell, toCSV, toText, CSV_HEADER } from '../src/export.js';

const stores = { 'wegmans-83': { name: 'Wegmans Sheridan Dr.', address: '5275 Sheridan Drive', city: 'Williamsville', state: 'NY', zip: '14221' } };
const items = [
  { id: 'a', name: 'Milk, 2%', qty: 1, unit: 'gal', notes: 'the "good" one', storeId: 'wegmans-83', checked: false },
  { id: 'b', name: '=HYPERLINK("x")', qty: null, unit: '', notes: 'line1\nline2', storeId: '', checked: true },
  { id: 'c', name: 'Eggs', qty: 12, unit: 'ea', notes: '', storeId: 'gone-1', checked: false },
];

test('csvCell escaping', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('x\ny'), '"x\ny"');
  assert.equal(csvCell('=1+1'), "'=1+1");
  assert.equal(csvCell('@cmd'), "'@cmd");
  assert.equal(csvCell(null), '');
  assert.equal(csvCell(0), '0');
});

test('toCSV builds header + rows with CRLF', () => {
  const csv = toCSV(items, stores);
  assert.ok(csv.startsWith(CSV_HEADER.join(',') + '\r\n'));
  assert.ok(csv.endsWith('\r\n'));
  assert.ok(csv.includes('no,"Milk, 2%",1,gal,Wegmans Sheridan Dr.,"5275 Sheridan Drive, Williamsville, NY 14221","the ""good"" one"'));
  assert.ok(csv.includes(`yes,"'=HYPERLINK(""x"")",,,Any store,,"line1\nline2"`));
  assert.ok(csv.includes('Unknown store (gone-1)'));
  assert.equal(toCSV([], stores), CSV_HEADER.join(',') + '\r\n');
});

test('toText groups by store, marks checked, flattens newlines', () => {
  const txt = toText(items, stores, { date: '2026-11-14' });
  const lines = txt.trimEnd().split('\n');
  assert.equal(lines[0], 'ShopSmartR shopping list');
  assert.equal(lines[1], '2026-11-14');
  assert.ok(lines.includes('== Wegmans Sheridan Dr. =='));
  assert.ok(lines.includes('[ ] 1 gal Milk, 2% — the "good" one'));
  assert.ok(lines.includes('[x] =HYPERLINK("x") — line1 line2'));
  assert.ok(lines.indexOf('== Any store ==') > lines.indexOf('== Unknown store (gone-1) =='));
  assert.match(toText([]), /\(empty list\)/);
});

test('L6: CSV download gets a UTF-8 BOM only when asked', async () => {
  const { CSV_BOM } = await import('../src/export.js');
  const plain = toCSV(items, stores);
  assert.ok(plain.startsWith('Done,'));
  const withBom = toCSV([{ id: 'u', name: 'Crème fraîche 🧀 日本茶', qty: null, unit: '', notes: '', storeId: '', checked: false }], {}, { bom: true });
  assert.equal(withBom.charCodeAt(0), 0xFEFF);
  assert.equal(CSV_BOM, '\uFEFF');
  assert.equal(new TextEncoder().encode(withBom).slice(0, 3).join(','), '239,187,191');
});
