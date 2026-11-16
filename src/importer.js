// v0.2.6: recipe Import, on the device only. Pure (no DOM, no network): the ingredient-line parser,
// schema.org Recipe (JSON-LD) reading, a pasted-text heuristic, the #fragment hand-off codec used by
// the bookmarklet and the iOS Shortcut, sanitising, and the imported-recipes store
// (shopsmartr:userRecipes:v1). Everything that comes in is treated as untrusted: text only (it is
// rendered with textContent, never innerHTML), tags stripped, control/bidi characters removed, and
// every field length- and count-capped. The app never fetches the recipe page and sends nothing anywhere.
import { prepareRecipes, RECIPES_SCHEMA } from './recipes.js';

export const USER_RECIPES_KEY = 'shopsmartr:userRecipes:v1';
export const USER_RECIPES_SCHEMA = 'shopsmartr.userrecipes/1';
export const IMPORT_CAT = 'imported';
/** Caps. A fragment longer than MAX_FRAGMENT, or one that inflates past MAX_INFLATED, is refused. */
export const CAPS = { title: 160, line: 300, lines: 80, step: 2000, steps: 60, stepsTotal: 20000, url: 600, text: 60000, recipes: 200 };
export const MAX_FRAGMENT = 64000;
export const MAX_INFLATED = 256 * 1024;
export const MAX_JSON_NODES = 20000;
export const FRAGMENT_PREFIX = 'recipes/import/';

// ---------- sanitising ----------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', frac12: '½', frac14: '¼', frac34: '¾', deg: '°', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', eacute: 'é', egrave: 'è', ntilde: 'ñ', reg: '®', trade: '™', copy: '©' };
// C0/C1 controls, zero-width characters, bidi overrides/isolates, BOM and other invisible format characters.
const INVISIBLE = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u2064\u2066-\u206f\ufeff\ufff9-\ufffb]/g;
function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 31 && n < 0x110000 && !(n >= 0xd800 && n < 0xe000) ? String.fromCodePoint(n) : ' ';
    }
    return ENT[e.toLowerCase()] ?? m;
  });
}
/**
 * Untrusted value -> plain one-line text, at most `max` characters: script/style blocks and every tag
 * removed, entities decoded once, invisible characters dropped, whitespace collapsed. '' for non-text.
 */
export function cleanText(x, max = CAPS.line) {
  if (typeof x === 'number' && Number.isFinite(x)) x = String(x);
  if (typeof x !== 'string') return '';
  let s = x.length > CAPS.text * 2 ? x.slice(0, CAPS.text * 2) : x;
  s = s.replace(/<(script|style|template|iframe|object|svg)\b[\s\S]*?<\/\1\s*>/gi, ' ').replace(/<[^>]*>/g, ' ').replace(/<[^>]*$/, ' ');
  s = decodeEntities(s).replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  return s.length > max ? s.slice(0, max).trim() : s;
}
/** Only plain https links, no credentials, no quotes/spaces/angle brackets; '' otherwise. */
export function cleanUrl(x) {
  if (typeof x !== 'string') return '';
  const s = x.trim();
  if (s.length > CAPS.url || !/^https:\/\/[^\s"'<>\\`]+$/i.test(s)) return '';
  try { const u = new URL(s); if (u.protocol !== 'https:' || u.username || u.password) return ''; return u.href.length <= CAPS.url ? u.href : ''; } catch { return ''; }
}
/** "www.example.com" for the source line; '' when there is no usable link. */
export function sourceDomain(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; }
}

// ---------- ingredient lines ----------
const VULGAR = { '¼': '1/4', '½': '1/2', '¾': '3/4', '⅐': '1/7', '⅑': '1/9', '⅒': '1/10', '⅓': '1/3', '⅔': '2/3', '⅕': '1/5', '⅖': '2/5', '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8' };
const WORD_NUM = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, half: 0.5, dozen: 12 };
const UNIT_ALIAS = [
  ['tablespoons', 'tbsp'], ['tablespoon', 'tbsp'], ['tbsps', 'tbsp'], ['tbsp', 'tbsp'], ['tbs', 'tbsp'], ['tbl', 'tbsp'], ['T', 'tbsp'],
  ['teaspoons', 'tsp'], ['teaspoon', 'tsp'], ['tsps', 'tsp'], ['tsp', 'tsp'], ['t', 'tsp'],
  ['containers', 'container'], ['container', 'container'], ['packages', 'pkg'], ['package', 'pkg'], ['pkgs', 'pkg'], ['pkg', 'pkg'], ['packets', 'pkg'], ['packet', 'pkg'],
  ['milliliters', 'ml'], ['millilitres', 'ml'], ['milliliter', 'ml'], ['millilitre', 'ml'], ['ml', 'ml'],
  ['kilograms', 'kg'], ['kilogram', 'kg'], ['kg', 'kg'],
  ['fluid ounces', 'floz'], ['fluid ounce', 'floz'], ['fl oz', 'floz'], ['fl. oz', 'floz'],
  ['ounces', 'oz'], ['ounce', 'oz'], ['oz', 'oz'], ['pounds', 'lb'], ['pound', 'lb'], ['lbs', 'lb'], ['lb', 'lb'],
  ['gallons', 'gallon'], ['gallon', 'gallon'], ['gal', 'gallon'], ['quarts', 'quart'], ['quart', 'quart'], ['qt', 'quart'],
  ['pints', 'pint'], ['pint', 'pint'], ['pt', 'pint'], ['liters', 'l'], ['litres', 'l'], ['liter', 'l'], ['litre', 'l'],
  ['grams', 'g'], ['gram', 'g'], ['cloves', 'clove'], ['clove', 'clove'], ['pinches', 'pinch'], ['pinch', 'pinch'],
  ['dashes', 'dash'], ['dash', 'dash'], ['splashes', 'splash'], ['splash', 'splash'], ['handfuls', 'handful'], ['handful', 'handful'],
  ['bottles', 'bottle'], ['bottle', 'bottle'], ['bunches', 'bunch'], ['bunch', 'bunch'], ['scoops', 'scoop'], ['scoop', 'scoop'],
  ['leaves', 'leaf'], ['leaf', 'leaf'], ['slices', 'slice'], ['slice', 'slice'], ['pieces', 'piece'], ['piece', 'piece'],
  ['sticks', 'stick'], ['stick', 'stick'], ['sprigs', 'sprig'], ['sprig', 'sprig'], ['stalks', 'stalk'], ['stalk', 'stalk'],
  ['strips', 'strip'], ['strip', 'strip'], ['heads', 'head'], ['head', 'head'], ['links', 'link'], ['link', 'link'],
  ['drops', 'drop'], ['drop', 'drop'], ['cans', 'can'], ['can', 'can'], ['bags', 'bag'], ['bag', 'bag'], ['boxes', 'box'], ['box', 'box'],
  ['jars', 'jar'], ['jar', 'jar'], ['ears', 'ear'], ['ear', 'ear'], ['ribs', 'rib'], ['rib', 'rib'], ['sheets', 'sheet'], ['sheet', 'sheet'],
  ['inches', 'inch'], ['inch', 'inch'], ['cups', 'cup'], ['cup', 'cup'], ['c', 'cup'],
  ['whole', 'whole'], ['large', 'large'], ['medium', 'medium'], ['small', 'small'], ['each', 'each'], ['cm', 'cm'], ['g', 'g'], ['l', 'l'],
];
const esc = (a) => a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s*');
// Case-sensitive single letters ("T" = tbsp, "t" = tsp, "c" = cup, "g", "l") are only units straight after a number.
const UNIT_RE = new RegExp(`^(${UNIT_ALIAS.map(([a]) => esc(a)).join('|')})\\.?(?=[\\s,(]|$)`, 'i');
function unitOf(word) {
  const raw = word.replace(/\.$/, '').replace(/\s+/g, ' ');
  if (raw === 'T') return 'tbsp';
  if (raw === 't') return 'tsp';
  const hit = UNIT_ALIAS.find(([a]) => a.toLowerCase() === raw.toLowerCase());
  return hit ? hit[1] : null;
}
const NUM = '(?:\\d+\\s+\\d+\\s*/\\s*\\d+|\\d+\\s*/\\s*\\d+|\\d+(?:[.,]\\d+)?|\\.\\d+)';
const QTY_RE = new RegExp(`^(${NUM})(?:\\s*(?:-|–|—|to|or)\\s*(${NUM}))?`, 'i');
function num(s) {
  const t = String(s).replace(/\s*\/\s*/g, '/').replace(',', '.').trim();
  let m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(t);
  if (m) return Number(m[3]) ? Number(m[1]) + Number(m[2]) / Number(m[3]) : null;
  m = /^(\d+)\/(\d+)$/.exec(t);
  if (m) return Number(m[2]) ? Number(m[1]) / Number(m[2]) : null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
/** "1½" -> "1 1/2", "½" -> "1/2", "1⁄2" -> "1/2". */
export function plainFractions(s) {
  return String(s).replace(/(\d)?\s*([¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞])/g, (m, d, f) => `${d ? `${d} ` : ''}${VULGAR[f]}`).replace(/\u2044/g, '/');
}
const PREP_RE = /\b(chopped|minced|diced|sliced|grated|shredded|crushed|cubed|peeled|trimmed|halved|quartered|softened|melted|beaten|divided|rinsed|drained|cut into [^,]+|thinly sliced|finely chopped|at room temperature|room temperature|for serving|for garnish|to serve|plus more [^,]+|or more [^,]+)\b/i;

/**
 * One ingredient line -> { text, base, qty, qtyText, unit, prep, optional, alt } (the recipe feed's
 * shape, so matching, Add missing and costs treat it like a Wegmans line). "1 (15 oz) can black
 * beans, drained" -> qty 1, unit can, alt "15 oz", base "black beans", prep "drained". Ranges buy
 * the larger amount. Returns null for an empty or header-only line.
 */
export function parseIngredientLine(input) {
  let text = cleanText(plainFractions(cleanText(input, CAPS.line)), CAPS.line).replace(/^[-–—*•·▪▫◦‣⁃▢□☐✓✔︎\s]+/, '').trim();
  if (!text || /^(ingredients?|for the [^:]+|[^:]{1,40}):$/i.test(text)) return null;
  let rest = text;
  let qty = null; let qtyText = null; let unit = null; let alt = null;
  const q = QTY_RE.exec(rest);
  if (q) {
    const a = num(q[1]); const b = q[2] != null ? num(q[2]) : null;
    if (a != null && a > 0 && a < 1e5) {
      qty = b != null && b > a && b < 1e5 ? b : a;
      qtyText = q[0].replace(/\s+/g, ' ').trim();
      rest = rest.slice(q[0].length).trim();
    }
  } else {
    const w = /^(a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half a|half|a dozen|dozen)\s+/i.exec(rest);
    if (w) {
      const key = w[1].toLowerCase().replace(/^half a$/, 'half').replace(/^a dozen$/, 'dozen');
      const after = rest.slice(w[0].length);
      // "a pinch of", "two cloves", "one onion"; but not "a few", "an extra".
      if (WORD_NUM[key] && !/^(few|little|bit|extra|handful of more)\b/i.test(after)) { qty = WORD_NUM[key]; qtyText = w[1]; rest = after.trim(); }
    }
  }
  const juice = qty == null ? /^(juice|zest|juice and zest|zest and juice) of (\d+|a|an|one|two|three|half an?|½)\s+(.+)$/i.exec(rest) : null;
  if (juice) {
    const n = /^\d+$/.test(juice[2]) ? Number(juice[2]) : (WORD_NUM[juice[2].toLowerCase()] ?? 1);
    return { text, base: juice[3].replace(/\([^)]*\)/g, ' ').replace(/,.*$/, '').trim().slice(0, 160), qty: Math.max(1, Math.ceil(n)), qtyText: juice[2], unit: null, unitType: null, prep: juice[1].toLowerCase(), optional: false, alt: null, section: null };
  }
  const paren = /^\(([^)]{1,40})\)\s*/.exec(rest);
  if (qty != null && paren && /\d/.test(paren[1])) { alt = paren[1].trim(); rest = rest.slice(paren[0].length); }
  if (qty != null) {
    const u = UNIT_RE.exec(rest);
    if (u) {
      const word = u[1];
      const single = word.length === 1;
      const cu = unitOf(word);
      // single letters only right after a number, and only if a word follows ("2 c flour", not "2 t")
      if (cu && (!single || /^\s+\S/.test(rest.slice(u[0].length)))) { unit = cu; rest = rest.slice(u[0].length).trim(); }
    }
    rest = rest.replace(/^of\s+/i, '');
    const p2 = /^\(([^)]{1,40})\)\s*/.exec(rest);
    if (!alt && p2 && /\d/.test(p2[1])) { alt = p2[1].trim(); rest = rest.slice(p2[0].length); }
  } else if (/^(pinch|dash)\s+of\b/i.test(rest)) {
    qty = 1; qtyText = '1'; unit = unitOf(/^(pinch|dash)/i.exec(rest)[1]); rest = rest.replace(/^(pinch|dash)\s+of\s+/i, '');
  }
  const optional = /\(optional\)|,\s*optional\b|^optional\b|\boptional$/i.test(rest);
  let base = rest.replace(/\([^)]*\)/g, ' ').replace(/\boptional\b:?/gi, ' ');
  let prep = null;
  const comma = base.indexOf(',');
  if (comma > 0) { prep = base.slice(comma + 1).replace(/\s+/g, ' ').trim() || null; base = base.slice(0, comma); }
  base = base.replace(/\b(to taste|as needed|for garnish|for serving)\b/gi, ' ').replace(/\s+/g, ' ').replace(/^[\s,.;:-]+|[\s,.;:-]+$/g, '').trim();
  if (!prep) { const m = PREP_RE.exec(base); if (m && m.index > 0 && /\b(cut into|for|plus|or more|at room)/i.test(m[0])) { prep = base.slice(m.index).trim(); base = base.slice(0, m.index).trim(); } }
  if (!base) base = text.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  base = base.slice(0, 160);
  return { text, base, qty, qtyText, unit, unitType: null, prep: prep ? prep.slice(0, 160) : null, optional, alt: alt ? alt.slice(0, 60) : null, section: null };
}

// ---------- schema.org Recipe ----------
const isObj = (x) => Boolean(x) && typeof x === 'object' && !Array.isArray(x);
const hasType = (o, t) => [].concat(o?.['@type'] ?? []).some((x) => typeof x === 'string' && x.toLowerCase() === t.toLowerCase());
/** The first schema.org Recipe in parsed JSON(-LD), searching arrays, @graph and nested objects (bounded). */
export function findRecipeObject(json) {
  const queue = [json]; let seen = 0;
  while (queue.length && seen < MAX_JSON_NODES) {
    const o = queue.shift(); seen += 1;
    if (Array.isArray(o)) { queue.push(...o.slice(0, 500)); continue; }
    if (!isObj(o)) continue;
    if (hasType(o, 'Recipe')) return o;
    for (const [k, v] of Object.entries(o)) if (v && typeof v === 'object' && k !== 'recipeInstructions') queue.push(v);
  }
  return null;
}
/** <script type="application/ld+json"> blocks in pasted page source (text only, never parsed as HTML). */
export function jsonLdBlocks(text) {
  const out = [];
  const re = /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi;
  let m; let n = 0;
  while ((m = re.exec(String(text))) && n < 50) { n += 1; try { out.push(JSON.parse(m[1].trim())); } catch { /* bad JSON: skipped */ } }
  return out;
}
/** ISO 8601 duration "PT1H20M" -> 80 (minutes); null when unreadable or absurd. */
export function isoMinutes(s) {
  const m = /^P(?:(\d{1,3})D)?(?:T(?:(\d{1,4})H)?(?:(\d{1,5})M)?(?:(\d{1,6}(?:\.\d+)?)S)?)?$/i.exec(String(s ?? '').trim());
  if (!m || !(m[1] || m[2] || m[3] || m[4])) return null;
  const v = Math.round(Number(m[1] ?? 0) * 1440 + Number(m[2] ?? 0) * 60 + Number(m[3] ?? 0) + Number(m[4] ?? 0) / 60);
  return v >= 0 && v < 100000 ? v : null;
}
/** "4 servings", ["4", "4 tacos"], 6, "Serves 4-6" -> 4 (the first number); null otherwise. */
export function servingsOf(y) {
  for (const v of [].concat(y ?? []).slice(0, 5)) {
    const m = /(\d{1,3})/.exec(typeof v === 'number' ? String(v) : cleanText(v, 60));
    if (m) { const n = Number(m[1]); if (n >= 1 && n <= 100) return n; }
  }
  return null;
}
function stepTexts(x, out = [], depth = 0) {
  if (out.length >= CAPS.steps || depth > 6 || x == null) return out;
  if (typeof x === 'string') {
    // one block of text: split on line breaks or numbered steps
    for (const part of x.split(/\n+|(?:^|\s)(?=\d{1,2}[.)]\s+[A-Z])/)) { const t = cleanText(part, CAPS.step).replace(/^(step\s*)?\d{1,2}[.):]\s*/i, ''); if (t) out.push(t); if (out.length >= CAPS.steps) break; }
    return out;
  }
  if (Array.isArray(x)) { for (const s of x.slice(0, 200)) stepTexts(s, out, depth + 1); return out; }
  if (isObj(x)) {
    if (x.itemListElement) return stepTexts(x.itemListElement, out, depth + 1);
    const t = cleanText(typeof x.text === 'string' ? x.text : x.name, CAPS.step);
    if (t) out.push(t);
  }
  return out;
}
function imageOf(im) {
  for (const v of [].concat(im ?? []).slice(0, 5)) {
    const u = cleanUrl(typeof v === 'string' ? v : (v?.url ?? v?.contentUrl));
    if (u) return u;
  }
  return '';
}
/** schema.org Recipe object -> an import draft (sanitised and capped). */
export function draftFromJsonLd(r, pageUrl = '') {
  if (!isObj(r)) return null;
  return sanitizeDraft({
    title: r.name ?? r.headline, url: cleanUrl(r.url) || pageUrl, image: imageOf(r.image), servings: servingsOf(r.recipeYield ?? r.yield),
    times: { prep: isoMinutes(r.prepTime), cook: isoMinutes(r.cookTime), total: isoMinutes(r.totalTime) },
    lines: [].concat(r.recipeIngredient ?? r.ingredients ?? []).slice(0, 200),
    steps: stepTexts(r.recipeInstructions),
  });
}

// ---------- pasted text ----------
const ING_H = /^(?:ingredients?|you(?:'|’)?ll need|what you need|shopping list)\s*:?$/i;
const STEP_H = /^(?:instructions?|directions?|method|preparation|steps?|how to make(?: it)?)\s*:?$/i;
const NOTE_H = /^(?:notes?|nutrition(?: facts)?|tips?|storage|equipment)\s*:?$/i;
const looksLikeIngredient = (l) => l.length <= 140 && (QTY_RE.test(plainFractions(l).replace(/^[-–*•·▢□\s]+/, '')) || /^[-–*•·▢□]\s/.test(l) || /^(a|an|one|two|three|pinch|dash)\s/i.test(l)) && !/[.!?]\s+\S+.*[.!?]$/.test(l);
/**
 * Recipe text (or a page's copied text, or its source with JSON-LD) -> an import draft, or null.
 * Uses "Ingredients" / "Instructions" headings when present; otherwise short lines that start with an
 * amount or a bullet are ingredients and longer sentences are steps. "Serves 4" sets servings.
 */
export function parseRecipeText(input, pageUrl = '') {
  const raw = typeof input === 'string' ? input.slice(0, CAPS.text) : '';
  if (!raw.trim()) return null;
  // structured data first: page source with JSON-LD, or the JSON itself
  if (/application\/ld\+json/i.test(raw)) { for (const j of jsonLdBlocks(raw)) { const r = findRecipeObject(j); if (r) return draftFromJsonLd(r, pageUrl); } }
  const t = raw.trim();
  if (/^[[{]/.test(t)) { try { const r = findRecipeObject(JSON.parse(t)); if (r) return draftFromJsonLd(r, pageUrl); } catch { /* not JSON: read as text */ } }
  const lines = raw.replace(/\r\n?/g, '\n').replace(/<br\s*\/?>/gi, '\n').split('\n').map((l) => cleanText(l, CAPS.step)).filter(Boolean);
  let title = ''; let servings = null; const ings = []; const steps = [];
  let mode = 'auto';
  for (const l of lines) {
    const s = /^(?:serves|servings|yield|yields|makes)\s*:?\s*(\d{1,3})\b/i.exec(l) ?? /\b(?:serves|servings:?)\s*(\d{1,3})\b/i.exec(l);
    if (s && l.length < 60) { if (!servings && Number(s[1]) >= 1 && Number(s[1]) <= 100) servings = Number(s[1]); continue; }
    if (ING_H.test(l)) { mode = 'ing'; continue; }
    if (STEP_H.test(l)) { mode = 'step'; continue; }
    if (NOTE_H.test(l)) { mode = 'skip'; continue; }
    if (/^(prep|cook|total|active)\s*time\b/i.test(l) && l.length < 60) continue;
    if (mode === 'skip') continue;
    if (mode === 'ing') { if (l.length > 160 && /[.!?]$/.test(l)) { mode = 'step'; steps.push(l); } else ings.push(l); continue; }
    if (mode === 'step') { steps.push(l.replace(/^(step\s*)?\d{1,2}[.):]\s*/i, '')); continue; }
    // no heading yet
    if (!title && !looksLikeIngredient(l) && l.length <= 120 && !/[.!?]$/.test(l)) { title = l; continue; }
    if (looksLikeIngredient(l)) ings.push(l);
    else if (l.length > 40) steps.push(l.replace(/^(step\s*)?\d{1,2}[.):]\s*/i, ''));
  }
  if (!ings.length) return null;
  return sanitizeDraft({ title: title || 'Imported recipe', url: pageUrl, servings, lines: ings, steps });
}

// ---------- the draft (preview) and saved user recipes ----------
/**
 * Any object -> { title, url, image, servings, times, lines, steps } with only these fields, all
 * cleaned and capped. lines are ingredient lines as written; parsing happens on use.
 */
export function sanitizeDraft(x) {
  if (!isObj(x)) return null;
  const lines = [];
  for (const l of Array.isArray(x.lines) ? x.lines.slice(0, 400) : []) {
    const t = cleanText(typeof l === 'string' ? l : (isObj(l) ? l.text ?? l.name : ''), CAPS.line);
    if (t && !ING_H.test(t)) lines.push(t);
    if (lines.length >= CAPS.lines) break;
  }
  const steps = []; let total = 0;
  for (const s of Array.isArray(x.steps) ? x.steps.slice(0, 400) : []) {
    const t = cleanText(typeof s === 'string' ? s : (isObj(s) ? s.text : ''), CAPS.step);
    if (!t) continue;
    if (total + t.length > CAPS.stepsTotal || steps.length >= CAPS.steps) break;
    steps.push(t); total += t.length;
  }
  const mins = (v) => (Number.isInteger(v) && v >= 0 && v < 100000 ? v : null);
  const tm = isObj(x.times) ? x.times : {};
  const serv = Number.isInteger(x.servings) && x.servings >= 1 && x.servings <= 100 ? x.servings : null;
  return { title: cleanText(x.title, CAPS.title) || 'Imported recipe', url: cleanUrl(x.url), image: cleanUrl(x.image), servings: serv, times: { prep: mins(tm.prep), cook: mins(tm.cook), total: mins(tm.total) }, lines, steps };
}
/** Draft -> preview model: parsed lines; noAmount marks lines without an amount (sun-tinted row). */
export function previewOf(draft) {
  const ings = draft.lines.map((l) => parseIngredientLine(l)).filter(Boolean);
  return { draft, ings, noAmount: ings.filter((i) => i.qty == null).length };
}

const ID_RE = /^u-[a-z0-9]{6,32}$/;
export function newUserRecipeId(rand = () => Math.random()) {
  let s = '';
  const c = globalThis.crypto?.getRandomValues ? globalThis.crypto.getRandomValues(new Uint8Array(10)) : null;
  for (let i = 0; i < 10; i += 1) s += ((c ? c[i] : Math.floor(rand() * 256)) % 36).toString(36);
  return `u-${s}`;
}
/** A saved user recipe row: { id, title, url, image, servings, times, lines, steps, importedAt }, or null. */
export function cleanUserRecipe(r) {
  if (!isObj(r) || typeof r.id !== 'string' || !ID_RE.test(r.id)) return null;
  const d = sanitizeDraft(r);
  if (!d || !d.lines.length) return null;
  const at = Date.parse(r.importedAt);
  return { id: r.id, ...d, importedAt: new Date(Number.isFinite(at) ? at : 0).toISOString() };
}
export function cleanUserRecipes(rows) {
  const out = []; const seen = new Set();
  for (const r of Array.isArray(rows) ? rows.slice(0, 5000) : []) { const c = cleanUserRecipe(r); if (c && !seen.has(c.id)) { seen.add(c.id); out.push(c); } if (out.length >= CAPS.recipes) break; }
  return out;
}
export function makeUserRecipe(draft, { id = newUserRecipeId(), now = new Date() } = {}) {
  const r = cleanUserRecipe({ ...sanitizeDraft(draft), id, importedAt: new Date(now).toISOString() });
  if (!r) throw new Error('No ingredients to save');
  return r;
}
export function loadUserRecipes(storage = globalThis.localStorage) {
  try { const raw = JSON.parse(storage?.getItem(USER_RECIPES_KEY) ?? 'null'); return cleanUserRecipes(raw?.recipes); } catch { return []; }
}
/** Writes the store; returns false when storage is full or blocked (the caller tells the user). */
export function saveUserRecipes(rows, storage = globalThis.localStorage) {
  try { storage.setItem(USER_RECIPES_KEY, JSON.stringify({ schema: USER_RECIPES_SCHEMA, recipes: cleanUserRecipes(rows) })); return true; } catch { return false; }
}
/** Saved rows -> recipe objects in the feed's prepared shape (cat "imported", imported: true). */
export function prepareUserRecipes(rows) {
  const doc = { schema: RECIPES_SCHEMA, recipes: rows.map((r) => ({ id: r.id, title: r.title, cat: IMPORT_CAT, servings: r.servings, times: r.times, image: r.image || null, url: r.url || null, ing: r.lines.map((l) => parseIngredientLine(l)).filter(Boolean), steps: r.steps })) };
  const out = prepareRecipes(doc).recipes;
  for (const r of out) r.imported = true;
  return out;
}

// ---------- #fragment hand-off (bookmarklet and Shortcut -> app) ----------
// Payload: "1j.<base64url JSON>" or "1z.<base64url deflate-raw JSON>". The JSON is the compact form the
// bookmarklet builds: { v: 1, t, u, im, s, pt, ct, tt, i: [lines], p: [steps] } from JSON-LD, or
// { v: 1, t, u, x: "page text" } when the page has none.
const b64urlToBytes = (s) => {
  const b = s.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b + '='.repeat((4 - (b.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};
const bytesToB64url = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
async function inflateCapped(bytes) {
  if (typeof DecompressionStream !== 'function') throw new Error('This browser can\'t open compressed imports. Paste the recipe text instead.');
  const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const parts = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > MAX_INFLATED) { try { await reader.cancel(); } catch { /* already closed */ } throw new Error('That recipe is too large to import.'); }
    parts.push(value);
  }
  const all = new Uint8Array(n); let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  return all;
}
/** Thrown with a message that can be shown as is. */
export class ImportError extends Error {}
/**
 * Fragment payload -> draft. Rejects (ImportError) anything too long, not base64url, not inflating
 * within MAX_INFLATED, not JSON, or with no ingredients. The page URL must be https.
 */
export async function decodePayload(payload) {
  const p = String(payload ?? '');
  if (!p) throw new ImportError('Nothing to import.');
  if (p.length > MAX_FRAGMENT) throw new ImportError('That recipe is too large to import. Paste the ingredients instead.');
  const m = /^1([jz])\.([A-Za-z0-9_-]+)$/.exec(p);
  if (!m) throw new ImportError('That import link is damaged. Try the bookmarklet again, or paste the recipe text.');
  let bytes;
  try { bytes = b64urlToBytes(m[2]); } catch { throw new ImportError('That import link is damaged. Try the bookmarklet again, or paste the recipe text.'); }
  if (m[1] === 'z') { try { bytes = await inflateCapped(bytes); } catch (e) { throw new ImportError(/too large|can't open/.test(e.message) ? e.message : 'That import link is damaged. Try the bookmarklet again, or paste the recipe text.'); } }
  if (bytes.length > MAX_INFLATED) throw new ImportError('That recipe is too large to import.');
  let j;
  try { j = JSON.parse(new TextDecoder('utf-8', { fatal: false }).decode(bytes)); } catch { throw new ImportError('That import link is damaged. Try the bookmarklet again, or paste the recipe text.'); }
  return draftFromCompact(j);
}
/** The bookmarklet's compact object -> draft (or ImportError). */
export function draftFromCompact(j) {
  if (!isObj(j) || j.v !== 1) throw new ImportError('That import link is from a different version. Update the bookmarklet from About.');
  const pageUrl = cleanUrl(j.u);
  let d;
  if (typeof j.x === 'string') d = parseRecipeText(j.x, pageUrl);
  else {
    const toMin = (v) => (typeof v === 'number' ? (Number.isFinite(v) && v >= 0 ? Math.round(v) : null) : isoMinutes(v));
    d = sanitizeDraft({ title: j.t, url: pageUrl, image: j.im, servings: servingsOf(j.s), times: { prep: toMin(j.pt), cook: toMin(j.ct), total: toMin(j.tt) }, lines: Array.isArray(j.i) ? j.i : [], steps: stepTexts(j.p) });
  }
  if (d && !cleanText(d.title) && typeof j.t === 'string') d.title = cleanText(j.t, CAPS.title) || 'Imported recipe';
  if (d && typeof j.t === 'string' && d.title === 'Imported recipe') d.title = cleanText(j.t, CAPS.title).replace(/\s+[|–—-]\s+[^|–—-]{2,40}$/, '') || d.title;
  if (!d || !d.lines.length) throw new ImportError('Couldn\'t read a recipe on that page. Paste the text instead.');
  return d;
}
/** Draft -> compact object -> payload (used by tests, the "Copy for the home-screen app" button). */
export async function encodePayload(draft, { compress = true } = {}) {
  const d = sanitizeDraft(draft);
  const j = { v: 1, t: d.title, u: d.url, im: d.image, s: d.servings ?? '', pt: d.times.prep, ct: d.times.cook, tt: d.times.total, i: d.lines, p: d.steps };
  const bytes = new TextEncoder().encode(JSON.stringify(j));
  if (compress && typeof CompressionStream === 'function') {
    const z = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    return `1z.${bytesToB64url(z)}`;
  }
  return `1j.${bytesToB64url(bytes)}`;
}
/** "#recipes/import/<payload>" -> payload, or '' when the hash isn't an import hand-off. */
export function payloadFromHash(hash) {
  const h = String(hash ?? '').replace(/^#/, '');
  return h.startsWith(FRAGMENT_PREFIX) ? h.slice(FRAGMENT_PREFIX.length) : '';
}
/** A pasted "…/shopsmartr/#recipes/import/<payload>" link (copied from Safari for the home-screen app) -> payload. */
export function payloadFromLink(text) {
  const m = /#recipes\/import\/(1[jz]\.[A-Za-z0-9_-]+)\s*$/.exec(String(text ?? '').trim());
  return m ? m[1] : '';
}

// ---------- the bookmarklet (runs on the recipe page, in the user's browser) ----------
/**
 * Source of the bookmarklet. It reads the page's JSON-LD Recipe (or, when there is none, the
 * selected text or the page text), caps every field, compresses when the browser can, and opens
 * the app with the data after "#", which browsers never send to a server. It makes no requests.
 */
export function bookmarkletSource(appUrl, { allowLocal = false } = {}) {
  const app = cleanUrl(appUrl) || (allowLocal && /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/[\w./-]*$/.test(String(appUrl)) ? String(appUrl) : '');
  if (!app) throw new Error('App URL must be https');
  const code = `(async()=>{const A=${JSON.stringify(app)};const T=(x,n)=>String(x==null?'':typeof x==='object'?(x.text||x.name||''):x).replace(/\\s+/g,' ').trim().slice(0,n);`
    + `let r=null;for(const s of document.querySelectorAll('script[type="application/ld+json"]')){let j;try{j=JSON.parse(s.textContent)}catch(e){continue}const q=[j];let k=0;while(q.length&&!r&&k++<5000){const o=q.shift();if(!o||typeof o!=='object')continue;if(Array.isArray(o)){q.push(...o);continue}if([].concat(o['@type']||[]).some(t=>String(t).toLowerCase()==='recipe')){r=o;break}for(const v of Object.values(o))if(v&&typeof v==='object')q.push(v)}if(r)break}`
    + `let d;if(r){const p=[];const w=x=>{if(!x||p.length>=60)return;if(typeof x==='string'){p.push(T(x,2000));return}if(Array.isArray(x)){x.forEach(w);return}if(x.itemListElement)w(x.itemListElement);else p.push(T(x,2000))};w(r.recipeInstructions);`
    + `const im=[].concat(r.image||[])[0];d={v:1,t:T(r.name,160),u:location.href.slice(0,600),im:T(typeof im==='string'?im:im&&(im.url||im.contentUrl),600),s:T([].concat(r.recipeYield||[])[0],40),pt:T(r.prepTime,20),ct:T(r.cookTime,20),tt:T(r.totalTime,20),i:[].concat(r.recipeIngredient||r.ingredients||[]).slice(0,80).map(x=>T(x,300)),p:p.filter(Boolean)}}`
    + `else{d={v:1,t:T(document.title,160),u:location.href.slice(0,600),x:String(getSelection()+''||document.body.innerText).slice(0,40000)}}`
    + `const b=new TextEncoder().encode(JSON.stringify(d));let z=b,f='1j.';if(window.CompressionStream){try{z=new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());f='1z.'}catch(e){z=b}}`
    + `let s='';for(let i=0;i<z.length;i+=32768)s+=String.fromCharCode(...z.subarray(i,i+32768));const P=f+btoa(s).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');`
    + `if(P.length>${MAX_FRAGMENT}){alert('This recipe is too large to send. Copy the ingredients and paste them in Import.');return}location.href=A+'#${FRAGMENT_PREFIX}'+P})()`;
  return `javascript:${encodeURIComponent(code).replace(/%20/g, ' ').replace(/%2C/g, ',').replace(/%3A/g, ':').replace(/%3D/g, '=').replace(/%3B/g, ';').replace(/%28/g, '(').replace(/%29/g, ')')}`;
}
/** Same extractor, for the Shortcut's "Run JavaScript on Web Page" action: finishes with completion(payload link). */
export function shortcutScript(appUrl, opts) {
  const src = decodeURIComponent(bookmarkletSource(appUrl, opts).slice('javascript:'.length));
  return src.replace(/location\.href=A\+'#recipes\/import\/'\+P\}\)\(\)$/, "completion(A+'#recipes/import/'+P)})()")
    .replace("alert('This recipe is too large to send. Copy the ingredients and paste them in Import.');return", "completion('');return");
}
