// Bottom-bar layout (hotfix for Steven's iPhone): the tab bar's real footprint, from the screen edge to its top, goes in
// --tabbar-h on <html> so the sticky Add bar, total bar, FAB, toast and the page's bottom padding stack right on it.
// The tab bar's own position never comes from JS (no visualViewport or keyboard offsets): CSS keeps it at the bottom.

/** Pixels from the viewport bottom to the tab bar's top, or null when the bar isn't laid out (desktop, hidden). */
export function tabbarStackHeight(offsetHeight, bottom) {
  const h = Number(offsetHeight);
  if (!Number.isFinite(h) || h <= 0) return null;
  const b = Number.parseFloat(bottom);
  return Math.round((h + (Number.isFinite(b) && b > 0 ? b : 0)) * 100) / 100;
}

/** Keep --tabbar-h in step with the tab bar (size, theme, rotation). Returns the update function. */
export function watchTabbar(doc = document, win = window) {
  const bar = doc.querySelector('.tabbar');
  const root = doc.documentElement;
  const update = () => {
    const px = bar ? tabbarStackHeight(bar.offsetHeight, win.getComputedStyle(bar).bottom) : null;
    if (px == null) root.style.removeProperty('--tabbar-h'); else root.style.setProperty('--tabbar-h', `${px}px`);
  };
  update();
  if (bar && 'ResizeObserver' in win) new win.ResizeObserver(update).observe(bar);
  if ('MutationObserver' in win) new win.MutationObserver(update).observe(root, { attributes: true, attributeFilter: ['data-theme', 'data-mode'] });
  win.addEventListener('resize', update);
  win.addEventListener('orientationchange', update);
  return update;
}
