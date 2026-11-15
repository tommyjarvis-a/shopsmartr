// CSV and plain-text export. Pure string builders; the UI turns them into downloads.
import { groupByStore, formatQty, linePrice, totals, priceText, money } from './list.js';

/** Local calendar date for file names, e.g. 2026-11-14 (not the UTC date: L10). */
export function localDateStamp(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** UTF-8 byte-order mark so Excel opens accented text and emoji correctly. */
export const CSV_BOM = '\uFEFF';

export const CSV_HEADER = ['Done', 'Item', 'Qty', 'Unit', 'Store', 'Address', 'Notes', 'Price each', 'Line total', 'Estimate', 'Unit price', 'Aisle', 'SKU', 'Price from', 'Prices as of'];

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

const fixed = (n) => (Number.isFinite(n) ? n.toFixed(2) : '');
function priceCells(it) {
  const p = it.priced;
  if (!p) return ['', '', '', '', '', '', '', ''];
  const line = linePrice(it);
  return [fixed(p.each), fixed(line.total), line.approx ? 'yes' : 'no', p.unitPriceText ?? '', p.aisle ?? '', p.sku ?? '', p.store ?? '', p.asOf ?? ''];
}

export function toCSV(items, storesById = {}, { bom = false } = {}) {
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
      ...priceCells(it),
    ]);
  }
  return (bom ? CSV_BOM : '') + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

const oneLine = (s) => String(s ?? '').replace(/\s*\r?\n\s*/g, ' ');

function favLine(it, storesById) {
  const q = formatQty(it);
  const store = it.storeId ? ` @ ${storeLabel(it.storeId, storesById)}` : '';
  const note = it.notes ? ` — ${oneLine(it.notes)}` : '';
  return `- ${q ? `${q} ` : ''}${oneLine(it.name)}${store}${note}`;
}

/** Plain-text "Favorites" section (staples, then each meal). Empty string when there are none. */
export function favoritesToText(fav, storesById = {}) {
  if (!fav || (!fav.items.length && !fav.meals.length)) return '';
  const lines = ['== Favorites ==', '', 'Staples:'];
  if (fav.items.length) for (const it of fav.items) lines.push(favLine(it, storesById));
  else lines.push('(none)');
  for (const m of fav.meals) {
    lines.push('', `Meal: ${oneLine(m.name)}`);
    if (m.items.length) for (const it of m.items) lines.push(favLine(it, storesById));
    else lines.push('(no items)');
  }
  return lines.join('\n') + '\n';
}

export const FAVORITES_CSV_HEADER = ['Type', 'Meal', 'Item', 'Qty', 'Unit', 'Store', 'Notes'];

/** Separate favorites CSV: one row per staple (Type "staple") and per meal item (Type "meal"). */
export function favoritesToCSV(fav, storesById = {}, { bom = false } = {}) {
  const rows = [FAVORITES_CSV_HEADER];
  const row = (type, meal, it) => [type, meal, it.name, it.qty ?? '', it.unit, it.storeId ? storeLabel(it.storeId, storesById) : '', it.notes];
  for (const it of fav.items) rows.push(row('staple', '', it));
  for (const m of fav.meals) {
    if (!m.items.length) rows.push(['meal', m.name, '', '', '', '', '']);
    for (const it of m.items) rows.push(row('meal', m.name, it));
  }
  return (bom ? CSV_BOM : '') + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function toText(items, storesById = {}, { title = 'ShopSmartR shopping list', date, favorites = null } = {}) {
  const lines = [title];
  if (date) lines.push(date);
  for (const g of groupByStore(items)) {
    lines.push('', `== ${storeLabel(g.storeId, storesById)} ==`);
    for (const it of g.items) {
      const q = formatQty(it);
      const note = it.notes ? ` — ${it.notes.replace(/\s*\r?\n\s*/g, ' ')}` : '';
      const lp = linePrice(it);
      const price = lp ? ` — ${priceText(lp.total, lp.approx)}${it.priced.store ? ` (${it.priced.store}${it.priced.aisle ? `, ${it.priced.aisle}` : ''})` : ''}` : '';
      lines.push(`[${it.checked ? 'x' : ' '}] ${q ? `${q} ` : ''}${it.name.replace(/\s*\r?\n\s*/g, ' ')}${price}${note}`);
    }
  }
  if (items.length === 0) lines.push('', '(empty list)');
  const t = totals(items);
  if (t.priced) {
    lines.push('', `Estimated total: ${priceText(t.all, t.approx)} (${t.priced} priced item${t.priced === 1 ? '' : 's'}${t.unpriced ? `, ${t.unpriced} without a price` : ''})`);
    if (t.inCart) lines.push(`In cart ${money(t.inCart)} · ${priceText(t.remaining, t.approxRemaining)} left`);
  }
  const favText = favoritesToText(favorites, storesById);
  return lines.join('\n') + '\n' + (favText ? `\n${favText}` : '');
}
