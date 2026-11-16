// v0.2.4: user-selectable app icon (Designer's v0.3 set, approved by Steven). Saved per device and in
// the full backup. Changes the in-app logo, the favicon and the apple-touch-icon link live; the
// manifest icons stay Love Basket for everyone (a home-screen icon only changes on a re-add).
export const APP_ICON_KEY = 'shopsmartr:appIcon:v1';
export const DEFAULT_APP_ICON = 'love-basket';
/** [id, name, short description] in picker order (default first). */
export const APP_ICONS = [
  ['love-basket', 'Love Basket', 'Default'],
  ['happy-bag', 'Happy Bag', 'Bright'],
  ['heart-checklist', 'Heart Checklist', 'List'],
  ['tomato-heart', 'Tomato Heart', 'Tomato'],
  ['heart-whisk', 'Heart Whisk', 'Dark'],
];
const IDS = new Set(APP_ICONS.map(([id]) => id));
export const cleanAppIcon = (v) => (typeof v === 'string' && IDS.has(v) ? v : DEFAULT_APP_ICON);
export const appIconName = (id) => (APP_ICONS.find(([x]) => x === cleanAppIcon(id)) ?? APP_ICONS[0])[1];
export const iconDir = (id) => `icons/${cleanAppIcon(id)}/`;

export function loadAppIcon(storage = globalThis.localStorage) {
  try { return cleanAppIcon(storage?.getItem(APP_ICON_KEY)); } catch { return DEFAULT_APP_ICON; }
}
export function saveAppIcon(id, storage = globalThis.localStorage) {
  try { storage.setItem(APP_ICON_KEY, cleanAppIcon(id)); return true; } catch { return false; }
}

/** The href each <head> link and the logo should point at for an icon. */
export function iconHrefs(id) {
  const d = iconDir(id);
  return { svg: `${d}favicon.svg`, png32: `${d}favicon-32.png`, png16: `${d}favicon-16.png`, ico: `${d}favicon.ico`, apple: `${d}apple-touch-icon-180.png`, logo: `${d}icon-64.png` };
}

/** Applies an icon to the page: favicons, apple-touch-icon and every .brand logo. */
export function applyAppIcon(id, doc = globalThis.document) {
  const h = iconHrefs(id);
  const set = (sel, href) => { const n = doc.querySelector(sel); if (n && n.getAttribute('href') !== href) n.setAttribute('href', href); };   // unchanged hrefs are left alone (no aborted re-fetch)
  set('#fav-ico', h.ico);
  set('#fav-svg', h.svg);
  set('#fav-32', h.png32);
  set('#fav-16', h.png16);
  set('#apple-icon', h.apple);   // used by iOS only when the app is added (again) to the home screen
  for (const img of doc.querySelectorAll('.brand .logo img, [data-app-icon-img]')) if (img.getAttribute('src') !== h.logo) img.setAttribute('src', h.logo);
  doc.documentElement.dataset.appIcon = cleanAppIcon(id);
  return h;
}
