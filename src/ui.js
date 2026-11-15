// DOM rendering only. Clones <template>s from index.html and fills them with textContent,
// so a reskin changes markup/CSS and never the logic modules.
import { groupByStore, formatQty, UNITS, linePrice, priceText, money, totals as listTotals } from './list.js';
import { estimate, regularEach } from './catalog.js';

const $ = (sel, root = document) => root.querySelector(sel);
const fromTemplate = (id) => document.getElementById(id).content.firstElementChild.cloneNode(true);

export function setScreen(name) {
  document.body.dataset.screen = name;
  for (const a of document.querySelectorAll('[data-nav]')) {
    if (a.dataset.nav === name) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
}

export function fillUnitSelects() {
  for (const sel of document.querySelectorAll('[data-unit-select]')) {
    sel.replaceChildren(new Option('unit', ''), ...UNITS.map((u) => new Option(u, u)));
  }
}

export function fillStoreSelects(stores) {
  for (const sel of document.querySelectorAll('[data-store-select]')) {
    const keep = sel.value;
    sel.replaceChildren(new Option('Any store', ''), ...stores.map((s) => new Option(s.name, s.id)));
    sel.value = stores.some((s) => s.id === keep) ? keep : '';
  }
}

function chip({ label, chain, name, value, checked, type = 'radio' }) {
  const el = document.createElement('label');
  el.className = 'chip';
  if (chain) el.dataset.chain = chain;
  const input = document.createElement('input');
  input.type = type;
  input.name = name;
  input.value = value;
  input.checked = checked;
  el.append(input);
  if (chain) { const d = document.createElement('span'); d.className = 'dot'; d.setAttribute('aria-hidden', 'true'); el.append(d); }
  const text = document.createElement('span');
  text.className = 'chip-label';
  text.textContent = label;
  el.title = label;
  el.append(text);
  return el;
}

/** Radio chips: [{value, label, chain?}] with one selected value. */
export function renderRadioChips(container, name, options, selected, onChange) {
  container.replaceChildren(...options.map((o) => {
    const c = chip({ ...o, name, checked: o.value === selected });
    c.querySelector('input').addEventListener('change', () => onChange(o.value));
    return c;
  }));
}

export function renderStaticChips(container, stores) {
  container.replaceChildren(...stores.map((s) => {
    const el = document.createElement('span');
    el.className = 'chip chip-static';
    el.dataset.chain = s.chain;
    const d = document.createElement('span');
    d.className = 'dot';
    const t = document.createElement('span');
    t.className = 'chip-label';
    t.textContent = s.name;
    el.title = s.name;
    el.append(d, t);
    return el;
  }));
}

export function renderStores(list, stores, selectedIds, chains, onToggle) {
  const sel = new Set(selectedIds);
  list.replaceChildren(...stores.map((s) => {
    const li = fromTemplate('tpl-store');
    li.dataset.chain = s.chain;
    li.dataset.storeId = s.id;
    $('[data-name]', li).textContent = s.name;
    $('[data-pick-label]', li).textContent = `Shop at ${s.name}`;
    $('[data-addr]', li).textContent = `${s.address}, ${s.city}`;
    $('[data-dist]', li).textContent = Number.isFinite(s.distanceMi) ? `${s.distanceMi.toFixed(1)} mi` : '';
    $('[data-unverified]', li).hidden = s.verified;
    const link = $('[data-link]', li);
    link.href = s.url || chains[s.chain]?.locatorUrl || '#';
    link.setAttribute('aria-label', `Hours and info for ${s.name}, opens the store's website`);
    const box = $('[data-pick]', li);
    box.checked = sel.has(s.id);
    box.addEventListener('change', () => onToggle(s.id, box.checked));
    return li;
  }));
}

export function renderList(container, items, storesById, handlers) {
  if (items.length === 0) {
    const p = document.createElement('p');
    p.className = 'empty';
    p.textContent = handlers.emptyText || 'Your list is empty. Add your first item.';
    container.replaceChildren(p);
    return;
  }
  container.replaceChildren(...groupByStore(items).map((g) => {
    const sec = fromTemplate('tpl-group');
    const store = storesById[g.storeId];
    sec.dataset.storeId = g.storeId;
    if (store) sec.dataset.chain = store.chain;
    $('[data-title]', sec).textContent = g.storeId ? (store?.name ?? 'Store no longer listed') : 'Any store';
    $('[data-title]', sec).title = $('[data-title]', sec).textContent;
    const left = g.items.filter((i) => !i.checked).length;
    $('[data-count]', sec).textContent = left ? `${left} left` : 'done';
    $('[data-items]', sec).replaceChildren(...g.items.map((it) => renderItem(it, handlers)));
    return sec;
  }));
}

function renderItem(it, { onToggle, onEdit, onRemove }) {
  const li = fromTemplate('tpl-item');
  li.dataset.itemId = it.id;
  li.classList.toggle('done', it.checked);
  $('[data-name]', li).textContent = it.name;
  $('[data-qty]', li).textContent = formatQty(it);
  $('[data-notes]', li).textContent = it.notes;
  $('[data-check-label]', li).textContent = `Got ${it.name}`;
  const box = $('[data-check]', li);
  box.checked = it.checked;
  box.addEventListener('change', () => onToggle(it.id, box.checked));
  const edit = $('[data-edit]', li);
  edit.setAttribute('aria-label', `Edit ${it.name}`);
  edit.addEventListener('click', () => onEdit(it.id));
  const p = it.priced;
  if (p) {
    const line = linePrice(it);
    $('[data-price-col]', li).hidden = false;
    const price = $('[data-price]', li);
    price.textContent = priceText(line.total, line.approx);
    price.classList.toggle('price-sale', Boolean(p.onSale));
    const was = $('[data-was]', li);
    if (line.regular) { was.hidden = false; was.textContent = priceText(line.regular, line.approx); }
    $('[data-price-store]', li).textContent = p.store ?? '';
    edit.setAttribute('aria-label', `Edit ${it.name}, ${line.approx ? 'about ' : ''}${money(line.total)}${p.store ? ` at ${p.store}` : ''}`);
  }
  const rm = $('[data-remove]', li);
  rm.setAttribute('aria-label', `Remove ${it.name}`);
  rm.addEventListener('click', () => onRemove(it.id));
  return li;
}

/** rows: [{chain, name, meta, url}] */
export function renderAdRows(rows) {
  for (const list of document.querySelectorAll('[data-ad-list]')) {
    list.replaceChildren(...rows.map((r) => {
      const li = fromTemplate('tpl-ad');
      li.dataset.chain = r.chain;
      $('[data-ini]', li).dataset.chain = r.chain;
      $('[data-name]', li).textContent = r.name;
      $('[data-meta]', li).textContent = r.meta;
      const a = $('[data-link]', li);
      a.href = r.url;
      a.setAttribute('aria-label', `Open ${r.label} for ${r.name} on the store's website`);
      return li;
    }));
  }
}

export function renderProgress(done, total) {
  const box = document.getElementById('progress');
  box.hidden = total === 0;
  document.getElementById('progress-text').textContent = `${done} of ${total} in the cart`;
  document.getElementById('progress-fill').style.setProperty('--pct', total ? `${Math.round((done / total) * 100)}%` : '0%');
}

export function setStatus(el, text, kind = '') {
  el.textContent = text;
  el.dataset.kind = kind;
}

let toastTimer = 0;
export function toast(text, undo) {
  const box = document.getElementById('toast');
  const btn = document.getElementById('toast-undo');
  document.getElementById('toast-text').textContent = text;
  btn.hidden = !undo;
  btn.onclick = undo ? () => { undo(); box.hidden = true; } : null;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; btn.onclick = null; }, 5000);
}

export function download(filename, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---------- Shop ----------
/** Price shown for a catalog item: shelf price, or "~$x.xx" estimate for by-weight items. */
export function itemPriceText(it) {
  const est = estimate(it);
  return priceText(est.each, est.approx);
}

function fillPrice(root, it) {
  const price = $('[data-price]', root);
  price.textContent = itemPriceText(it);
  price.classList.toggle('price-sale', it.onSale);
  $('[data-sale]', root).hidden = !it.onSale;
}

export function catRow(it, onOpen) {
  const li = fromTemplate('tpl-cat-row');
  const btn = li.firstElementChild;
  btn.dataset.idx = it.idx;
  $('[data-name]', btn).textContent = it.name;
  const sale = it.onSale && it.regularPrice;
  $('[data-meta]', btn).textContent = [it.size, sale || it.soldByWeight ? it.unitPriceText : '', it.aisle].filter(Boolean).join(' · ');
  fillPrice(btn, it);
  const was = $('[data-was]', btn);
  if (sale) { was.hidden = false; was.textContent = priceText(regularEach(it), it.soldByWeight); }
  $('[data-unit]', btn).textContent = sale ? '' : (it.soldByWeight ? 'est. each' : (it.unitPriceText ?? ''));
  btn.setAttribute('aria-label', `${it.name}, ${it.soldByWeight ? 'about ' : ''}${money(estimate(it).each)}${it.onSale ? ', on sale' : ''}`);
  btn.addEventListener('click', () => onOpen(it.idx, btn));
  return li;
}

const initials = (name) => name.replace(/&/g, ' ').split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).join('').slice(0, 2);

export function deptCard(d, onPick) {
  const b = fromTemplate('tpl-dept-card');
  $('[data-ini]', b).textContent = initials(d.name);
  $('[data-name]', b).textContent = d.name;
  $('[data-count]', b).textContent = `${d.count.toLocaleString('en-US')} item${d.count === 1 ? '' : 's'}`;
  b.addEventListener('click', () => onPick(d.name));
  return b;
}

/** Department chips: "All" + departments; buttons with aria-checked (radiogroup). */
export function renderDeptChips(container, depts, selected, onPick) {
  const mk = (value, label) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = `chip${value === selected ? ' on' : ''}`;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(value === selected));
    b.tabIndex = value === selected ? 0 : -1;
    b.dataset.dept = value;
    b.textContent = label;
    b.addEventListener('click', () => onPick(value));
    return b;
  };
  container.replaceChildren(mk('', 'All'), ...depts.map((d) => mk(d.name, d.name)));
}

export function sugOption(it, id) {
  const o = fromTemplate('tpl-sug');
  o.id = id;
  $('[data-name]', o).textContent = it.name;
  $('[data-meta]', o).textContent = [it.size, it.aisle].filter(Boolean).join(' · ');
  fillPrice(o, it);
  return o;
}

export function customOption(text, id) {
  const o = document.createElement('div');
  o.className = 'sug-opt custom';
  o.id = id;
  o.setAttribute('role', 'option');
  o.setAttribute('aria-selected', 'false');
  const b = document.createElement('span'); b.className = 'body';
  const n = document.createElement('span'); n.className = 'name';
  n.textContent = `Add “${text}” without price`;
  b.append(n); o.append(b);
  return o;
}

/** Running total in the mobile bar and the desktop header. Hidden when nothing is priced. */
export function renderTotals(items) {
  const t = listTotals(items);
  const show = t.priced > 0;
  document.body.classList.toggle('has-total', show);
  for (const id of ['totalbar', 'list-total']) {
    const box = document.getElementById(id);
    box.hidden = !show;
    if (!show) continue;
    $('[data-total-est]', box).textContent = `Est. ${id === 'totalbar' ? 'total ' : ''}${priceText(t.all, t.approx)}`;
    $('[data-total-split]', box).textContent = `In cart ${money(t.inCart)} · ${priceText(t.remaining, t.approxRemaining)} left`;
    $('[data-total-count]', box).textContent = `${t.priced} priced${t.unpriced ? ` · ${t.unpriced} unpriced` : ''}`;
  }
  return t;
}

// ---------- Favorites ----------
function favMeta(it, storesById) {
  const store = it.storeId ? (storesById[it.storeId]?.name ?? 'Store no longer listed') : '';
  return [store, it.notes].filter(Boolean).join(' · ');
}

function favRow(it, storesById, { onEdit, onAdd, onRemove }) {
  const li = fromTemplate('tpl-fav');
  li.dataset.favId = it.id;
  const store = storesById[it.storeId];
  if (store) li.dataset.chain = store.chain;
  $('[data-name]', li).textContent = it.name;
  $('[data-qty]', li).textContent = formatQty(it);
  $('[data-meta]', li).textContent = favMeta(it, storesById);
  const edit = $('[data-fav-edit]', li);
  edit.setAttribute('aria-label', `Edit ${it.name}`);
  edit.addEventListener('click', () => onEdit(it.id));
  const add = $('[data-fav-add]', li);
  if (onAdd) {
    add.setAttribute('aria-label', `Add ${it.name} to list`);
    add.addEventListener('click', () => onAdd(it.id));
  } else add.remove();
  const rm = $('[data-fav-remove]', li);
  rm.setAttribute('aria-label', `Remove ${it.name} from favorites`);
  rm.addEventListener('click', () => onRemove(it.id));
  return li;
}

export function renderFavItems(container, items, storesById, handlers) {
  container.replaceChildren(...items.map((it) => favRow(it, storesById, handlers)));
}

let mealSeq = 0;
export function renderMeals(container, meals, storesById, h) {
  container.replaceChildren(...meals.map((m) => {
    const sec = fromTemplate('tpl-meal');
    sec.dataset.mealId = m.id;
    $('[data-name]', sec).textContent = m.name;
    $('[data-meal-rename]', sec).title = m.name;
    $('[data-count]', sec).textContent = `${m.items.length} item${m.items.length === 1 ? '' : 's'}`;
    const ren = $('[data-meal-rename]', sec);
    ren.setAttribute('aria-label', `Rename or delete ${m.name}`);
    ren.addEventListener('click', () => h.onRename(m.id));
    const add = $('[data-meal-add]', sec);
    add.setAttribute('aria-label', `Add ${m.name} to list`);
    add.disabled = m.items.length === 0;
    add.addEventListener('click', () => h.onAddMeal(m.id));
    $('[data-items]', sec).replaceChildren(...m.items.map((it) => favRow(it, storesById, {
      onEdit: (id) => h.onEditItem(m.id, id),
      onRemove: (id) => h.onRemoveItem(m.id, id),
    })));
    const form = $('[data-meal-item-form]', sec);
    const input = form.elements.text;
    input.id = `meal-item-${(mealSeq += 1)}`;
    const label = $('[data-meal-item-label]', sec);
    label.htmlFor = input.id;
    label.textContent = `Add an item to ${m.name}`;
    form.addEventListener('submit', (e) => { e.preventDefault(); h.onAddItem(m.id, input.value, input); });
    return sec;
  }));
}
