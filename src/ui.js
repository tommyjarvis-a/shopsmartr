// DOM rendering only. Clones <template>s from index.html and fills them with textContent,
// so a reskin changes markup/CSS and never the logic modules.
import { groupByStore, formatQty, UNITS } from './list.js';

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
  el.append(document.createTextNode(label));
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
    el.append(d, document.createTextNode(s.name));
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
