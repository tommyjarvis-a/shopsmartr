// v0.2.5: themes v2 (Designer's spec-v2, approved by Steven). Five themes, each with its own colours, fonts,
// icon set, corners and tab bar, as [data-theme] token blocks in tokens.css. Light/Dark/Auto is [data-mode].
// Saved per device (THEME_KEY / MODE_KEY in keys.js, both 'settings', so a full backup carries them).
// Only the active theme's @font-face rules are in the page (<style id="theme-fonts">), so a device
// downloads only that theme's font files. The inline boot script in index.html applies all of this
// before first paint; test/v025.test.mjs checks the boot script matches this file.
// THEMES below is generated from design/v03-themes/src/themes-v2.json (preview values per mode).
export const THEME_KEY = 'shopsmartr:theme:v1';
export const MODE_KEY = 'shopsmartr:mode:v1';
/** Local copy of the active theme's merged icon sprite, so a reload shows the right icons at once (not in backups). */
export const SPRITE_CACHE_KEY = 'shopsmartr:spriteCache:v1';
export const DEFAULT_THEME = 'tomato-parmesan';
export const MODES = ['auto', 'light', 'dark'];
export const MODE_NAMES = { auto: 'Auto', light: 'Light', dark: 'Dark' };
export const FONT_DIR = 'fonts/';
export const THEMES = [
  {
    id: "tomato-parmesan",
    name: "Tomato & Parmesan",
    desc: "Default · friendly, rounded, tomato red",
    fonts: [
      {
        family: "Nunito Variable",
        file: "nunito-latin-wght-normal.woff2",
        weight: "200 1000"
      }
    ],
    preview: {
      font: "\"HWH Preview Rounded\", ui-rounded, system-ui, sans-serif",
      fontFile: "nunito-preview.woff2",
      light: {
        bg: "#FFFCF6",
        appbar: "#FFFCF6",
        "appbar-border": "0 solid transparent",
        text: "#2A1714",
        accent: "#F4B21B",
        card: "#FFFFFF",
        "card-border": "1px solid #EEE2CE",
        "card-shadow": "none",
        primary: "#D63A25",
        "primary-strong": "#C8321F",
        star: "#B47500",
        "tab-on": "#FDE4DD",
        "tab-ul": "transparent",
        "r-xl": "24px",
        "r-card": "16px",
        "r-ctl": "999px",
        "h-weight": "800",
        "h-track": "-0.01em"
      },
      dark: {
        bg: "#121213",
        appbar: "#121213",
        "appbar-border": "0 solid transparent",
        text: "#F8F4F1",
        accent: "#FFC94D",
        card: "#1B1B1D",
        "card-border": "1px solid #38383B",
        "card-shadow": "none",
        primary: "#EE4B37",
        "primary-strong": "#FF6B57",
        star: "#FFC94D",
        "tab-on": "#43201C",
        "tab-ul": "transparent",
        "r-xl": "24px",
        "r-card": "16px",
        "r-ctl": "999px",
        "h-weight": "800",
        "h-track": "-0.01em"
      }
    },
    chrome: {
      light: "#FFFCF6",
      dark: "#121213"
    },
    radiusControl: "999px"
  },
  {
    id: "blueberry-lemon",
    name: "Blueberry & Lemon",
    desc: "Crisp slate + blue, lemon accent",
    fonts: [
      {
        family: "Inter Variable",
        file: "inter-latin-wght-normal.woff2",
        weight: "100 900"
      }
    ],
    preview: {
      font: "\"HWH Preview Grotesk\", system-ui, sans-serif",
      fontFile: "inter-preview.woff2",
      light: {
        bg: "#F6F8FC",
        appbar: "#FFFFFF",
        "appbar-border": "1px solid #DCE3EE",
        text: "#0E1626",
        accent: "#FACC15",
        card: "#FFFFFF",
        "card-border": "1px solid #DCE3EE",
        "card-shadow": "none",
        primary: "#3B4FE0",
        "primary-strong": "#3044D0",
        star: "#9A6A00",
        "tab-on": "transparent",
        "tab-ul": "#3B4FE0",
        "r-xl": "18px",
        "r-card": "12px",
        "r-ctl": "10px",
        "h-weight": "700",
        "h-track": "-0.025em"
      },
      dark: {
        bg: "#0B1220",
        appbar: "#121B2D",
        "appbar-border": "1px solid #2A364D",
        text: "#F1F5FB",
        accent: "#FDE047",
        card: "#121B2D",
        "card-border": "1px solid #2A364D",
        "card-shadow": "none",
        primary: "#6B7BFF",
        "primary-strong": "#9AA6FF",
        star: "#FDE047",
        "tab-on": "transparent",
        "tab-ul": "#6B7BFF",
        "r-xl": "18px",
        "r-card": "12px",
        "r-ctl": "10px",
        "h-weight": "700",
        "h-track": "-0.025em"
      }
    },
    chrome: {
      light: "#F6F8FC",
      dark: "#0B1220"
    },
    radiusControl: "10px"
  },
  {
    id: "blackberry-lavender",
    name: "Blackberry & Lavender",
    desc: "Moody lavender, soft and plush",
    fonts: [
      {
        family: "Fraunces",
        file: "fraunces-latin-600-normal.woff2",
        weight: "500 700"
      }
    ],
    preview: {
      font: "\"HWH Preview Serif\", Georgia, serif",
      fontFile: "fraunces-preview.woff2",
      light: {
        bg: "#FBF8FE",
        appbar: "#F1EAFA",
        "appbar-border": "0 solid transparent",
        text: "#23162F",
        accent: "#E8A33A",
        card: "#FFFFFF",
        "card-border": "1px solid transparent",
        "card-shadow": "0 2px 6px rgba(0,0,0,.18)",
        primary: "#7B2E91",
        "primary-strong": "#6A2580",
        star: "#9C6206",
        "tab-on": "#FFFFFF",
        "tab-ul": "transparent",
        "r-xl": "30px",
        "r-card": "22px",
        "r-ctl": "999px",
        "h-weight": "600",
        "h-track": "0"
      },
      dark: {
        bg: "#150F1D",
        appbar: "#2A2136",
        "appbar-border": "0 solid transparent",
        text: "#F7F1FC",
        accent: "#F2C14E",
        card: "#1E1729",
        "card-border": "1px solid transparent",
        "card-shadow": "0 2px 6px rgba(0,0,0,.18)",
        primary: "#A46BD6",
        "primary-strong": "#C9A2F0",
        star: "#F2C14E",
        "tab-on": "#1E1729",
        "tab-ul": "transparent",
        "r-xl": "30px",
        "r-card": "22px",
        "r-ctl": "999px",
        "h-weight": "600",
        "h-track": "0"
      }
    },
    chrome: {
      light: "#FBF8FE",
      dark: "#150F1D"
    },
    radiusControl: "999px"
  },
  {
    id: "coconut-lagoon",
    name: "Coconut & Lagoon",
    desc: "Airy aqua, coral pops, playful",
    fonts: [
      {
        family: "Quicksand Variable",
        file: "quicksand-latin-wght-normal.woff2",
        weight: "300 700"
      }
    ],
    preview: {
      font: "\"HWH Preview Geometric\", ui-rounded, system-ui, sans-serif",
      fontFile: "quicksand-preview.woff2",
      light: {
        bg: "#F3FBFD",
        appbar: "#F3FBFD",
        "appbar-border": "0 solid transparent",
        text: "#0B2530",
        accent: "#FF7A66",
        card: "#DDF2F7",
        "card-border": "1px solid transparent",
        "card-shadow": "none",
        primary: "#0B86AB",
        "primary-strong": "#067696",
        star: "#C2381F",
        "tab-on": "#067696",
        "tab-ul": "transparent",
        "r-xl": "28px",
        "r-card": "20px",
        "r-ctl": "999px",
        "h-weight": "700",
        "h-track": "0"
      },
      dark: {
        bg: "#06161D",
        appbar: "#06161D",
        "appbar-border": "0 solid transparent",
        text: "#EEF9FC",
        accent: "#FF8F7A",
        card: "#132B36",
        "card-border": "1px solid transparent",
        "card-shadow": "none",
        primary: "#1D9FC6",
        "primary-strong": "#5DD0EE",
        star: "#FF9A87",
        "tab-on": "#5DD0EE",
        "tab-ul": "transparent",
        "r-xl": "28px",
        "r-card": "20px",
        "r-ctl": "999px",
        "h-weight": "700",
        "h-track": "0"
      }
    },
    chrome: {
      light: "#F3FBFD",
      dark: "#06161D"
    },
    radiusControl: "999px"
  },
  {
    id: "espresso-mango",
    name: "Espresso & Mango",
    desc: "Greige + charcoal, one mango pop",
    fonts: [
      {
        family: "DM Serif Display",
        file: "dm-serif-display-latin-400-normal.woff2",
        weight: "400 700"
      },
      {
        family: "IBM Plex Mono",
        file: "ibm-plex-mono-latin-600-normal.woff2",
        weight: "400 700"
      }
    ],
    preview: {
      font: "\"HWH Preview Display\", Georgia, serif",
      fontFile: "dm-serif-display-preview.woff2",
      light: {
        bg: "#F4F1EC",
        appbar: "#F4F1EC",
        "appbar-border": "2px solid #1C1916",
        text: "#1C1916",
        accent: "#FFB01F",
        card: "#FFFEFB",
        "card-border": "1px solid #D6CFC4",
        "card-shadow": "none",
        primary: "#2B2622",
        "primary-strong": "#2B2622",
        star: "#A35F00",
        "tab-on": "transparent",
        "tab-ul": "#A35F00",
        "r-xl": "10px",
        "r-card": "6px",
        "r-ctl": "6px",
        "h-weight": "400",
        "h-track": "0"
      },
      dark: {
        bg: "#12110F",
        appbar: "#12110F",
        "appbar-border": "2px solid #F5F0E8",
        text: "#F5F0E8",
        accent: "#FFB547",
        card: "#1B1917",
        "card-border": "1px solid #36322D",
        "card-shadow": "none",
        primary: "#8F877C",
        "primary-strong": "#EFE7DA",
        star: "#FFB547",
        "tab-on": "transparent",
        "tab-ul": "#FFB547",
        "r-xl": "10px",
        "r-card": "6px",
        "r-ctl": "6px",
        "h-weight": "400",
        "h-track": "0"
      }
    },
    chrome: {
      light: "#F4F1EC",
      dark: "#12110F"
    },
    radiusControl: "6px"
  }
];

export const THEME_IDS = THEMES.map((t) => t.id);
const BY_ID = new Map(THEMES.map((t) => [t.id, t]));
export const cleanTheme = (v) => (typeof v === 'string' && BY_ID.has(v) ? v : DEFAULT_THEME);
export const cleanMode = (v) => (MODES.includes(v) ? v : 'auto');
export const themeOf = (id) => BY_ID.get(cleanTheme(id));
export const themeName = (id) => themeOf(id).name;

export function loadTheme(storage = globalThis.localStorage) {
  try { return cleanTheme(storage?.getItem(THEME_KEY)); } catch { return DEFAULT_THEME; }
}
export function loadMode(storage = globalThis.localStorage) {
  try { return cleanMode(storage?.getItem(MODE_KEY)); } catch { return 'auto'; }
}
export function saveTheme(id, storage = globalThis.localStorage) {
  try { storage.setItem(THEME_KEY, cleanTheme(id)); return true; } catch { return false; }
}
export function saveMode(m, storage = globalThis.localStorage) {
  try { storage.setItem(MODE_KEY, cleanMode(m)); return true; } catch { return false; }
}

/** The @font-face rules for one theme only (the boot script writes the same text). */
export function fontFaceCSS(id) {
  return themeOf(id).fonts.map((f) => `@font-face{font-family:"${f.family}";src:url("${FONT_DIR}${f.file}") format("woff2");font-weight:${f.weight};font-style:normal;font-display:swap}`).join('');
}
/** @font-face rules for the Theme sheet previews: tiny subsets (theme names + "Aa") under their own family names. */
export function previewFontCSS() {
  return THEMES.map((t) => `@font-face{font-family:${t.preview.font.split(',')[0]};src:url("${FONT_DIR}preview/${t.preview.fontFile}") format("woff2");font-display:swap}`).join('');
}
/** 'light' | 'dark': the mode in effect (Auto follows the OS). */
export function effectiveMode(mode, win = globalThis) {
  const m = cleanMode(mode);
  if (m !== 'auto') return m;
  try { return win.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch { return 'light'; }
}
/** Inline custom properties for a theme card's mini preview, in the given mode. */
export function previewStyle(id, mode) {
  const t = themeOf(id);
  const v = t.preview[mode === 'dark' ? 'dark' : 'light'];
  return [...Object.entries(v).map(([k, x]) => `--pv-${k}:${x}`), `--pv-font-h:${t.preview.font.replace(/"/g, "'")}`].join(';');
}

// ---------- icon sprite ----------
const spriteCache = new Map();
let spriteToken = 0;
/** Theme symbols plus any default symbol the theme set lacks (e.g. i-link), so every <use> resolves. */
export function mergeSprite(themeSvgText, defaultInner, DOMParserCtor = globalThis.DOMParser) {
  const doc = new DOMParserCtor().parseFromString(themeSvgText, 'image/svg+xml');
  const syms = [...doc.querySelectorAll('symbol[id]')];
  const have = new Set(syms.map((s) => s.id));
  const base = new DOMParserCtor().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${defaultInner}</svg>`, 'image/svg+xml');
  const extra = [...base.querySelectorAll('symbol[id]')].filter((s) => !have.has(s.id));
  const ser = (n) => n.outerHTML;
  return [...syms, ...extra].map(ser).join('');
}
/** Swaps the inline sprite (#icon-sprite) to a theme's icon set. Tomato's set is the inline default. */
export async function applySprite(id, { doc = globalThis.document, storage = globalThis.localStorage, version = '' } = {}) {
  const sp = doc.getElementById('icon-sprite');
  if (!sp) return false;
  const tid = cleanTheme(id);
  const token = ++spriteToken;
  const win = doc.defaultView ?? globalThis;
  const def = win.HWH_SPRITE0 ?? (win.HWH_SPRITE0 = sp.innerHTML);
  if (tid === DEFAULT_THEME) {
    if (sp.dataset.set !== DEFAULT_THEME) { sp.innerHTML = def; sp.dataset.set = DEFAULT_THEME; }
    try { storage?.removeItem(SPRITE_CACHE_KEY); } catch { /* blocked */ }
    return true;
  }
  let inner = spriteCache.get(tid);
  if (!inner) {
    // The boot script may already have put this set in from the local copy; it is refreshed when the app version changes.
    let cached = null;
    try { cached = JSON.parse(storage?.getItem(SPRITE_CACHE_KEY) ?? 'null'); } catch { cached = null; }
    if (cached && cached.theme === tid && cached.v === version && typeof cached.svg === 'string') inner = cached.svg;
    else {
      try {
        const r = await fetch(`icons/sprites/${tid}.svg?v=${encodeURIComponent(version)}`);
        if (!r.ok) return false;
        inner = mergeSprite(await r.text(), def);
      } catch { return false; }
    }
    spriteCache.set(tid, inner);
  }
  if (token !== spriteToken) return false;   // a later pick won
  if (sp.dataset.set !== tid || sp.innerHTML !== inner) { sp.innerHTML = inner; sp.dataset.set = tid; }
  try { storage?.setItem(SPRITE_CACHE_KEY, JSON.stringify({ theme: tid, v: version, svg: inner })); } catch { /* full: next reload fetches */ }
  return true;
}

/** Applies theme + mode to the page now: data attributes, the theme's fonts, colour-scheme; the sprite follows. */
export function applyTheme(id, mode, { doc = globalThis.document, storage = globalThis.localStorage, version = '' } = {}) {
  const tid = cleanTheme(id);
  const m = cleanMode(mode);
  const root = doc.documentElement;
  root.dataset.theme = tid;
  if (m === 'auto') delete root.dataset.mode; else root.dataset.mode = m;
  let st = doc.getElementById('theme-fonts');
  if (!st) { st = doc.createElement('style'); st.id = 'theme-fonts'; doc.head.append(st); }
  const css = fontFaceCSS(tid);
  if (st.textContent !== css) st.textContent = css;
  return applySprite(tid, { doc, storage, version });
}
