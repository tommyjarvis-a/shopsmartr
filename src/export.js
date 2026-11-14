// CSV and plain-text export. Pure string builders; the UI turns them into downloads.
import { groupByStore, formatQty } from './list.js';

export const CSV_HEADER = ['Done', 'Item', 'Qty', 'Unit', 'Store', 'Address', 'Notes'];

/** RFC 4180 cell escaping, plus a guard against spreadsheet formula injection. */
export function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function storeLabel(storeId, storesById) {
  if (!storeId) return 'Any store';
  const s = storesById[storeId];
  return s ? s.name : `Unknown store (${storeId})`;
}

export function toCSV(items, storesById = {}) {
  const rows = [CSV_HEADER];
  for (const it of items) {
    const s = storesById[it.storeId];
    rows.push([
      it.checked ? 'yes' : 'no',
      it.name,
      it.qty ?? '',
      it.unit,
      storeLabel(it.storeId, storesById),
      s ? `${s.address}, ${s.city}, ${s.state} ${s.zip}` : '',
      it.notes,
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function toText(items, storesById = {}, { title = 'ShopSmartR shopping list', date } = {}) {
  const lines = [title];
  if (date) lines.push(date);
  for (const g of groupByStore(items)) {
    lines.push('', `== ${storeLabel(g.storeId, storesById)} ==`);
    for (const it of g.items) {
      const q = formatQty(it);
      const note = it.notes ? ` — ${it.notes.replace(/\s*\r?\n\s*/g, ' ')}` : '';
      lines.push(`[${it.checked ? 'x' : ' '}] ${q ? `${q} ` : ''}${it.name.replace(/\s*\r?\n\s*/g, ' ')}${note}`);
    }
  }
  if (items.length === 0) lines.push('', '(empty list)');
  return lines.join('\n') + '\n';
}
