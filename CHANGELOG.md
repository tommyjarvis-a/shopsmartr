# Changelog

All notable changes to Happy Wife Helper (formerly ShopSmartR; the repo keeps the shopsmartr name). This project is in **alpha**; data and UI may change.

## [0.2.6-alpha.1] - 2026-11-16 (alpha)

Hotfix for Tester's v0.2.6-alpha gate (566ff52): one High (M11, privacy) and four Lows.

### Security
- **M11: an imported recipe never loads a remote image.** In v0.2.6 the import preview fetched the payload's photo
  URL the moment an import link opened (before Save), and again on every card, Cook row, Favorites tile and the
  detail page, so anyone who sent a `#recipes/import` link could plant a tracking pixel that learns the opener's IP,
  browser and timing. Now:
  - Imported recipes show the themed pot placeholder (with the Imported tag) everywhere: preview, detail, Cook,
    Favorites › Recipes and My recipes. The photo URL from JSON-LD, pasted text, the bookmarklet / Shortcut
    payload, a saved v0.2.6 row, a backup file or a Favorites snapshot is dropped, never stored or requested.
  - **Decision: no "Load photo" button for imported recipes.** The tightened CSP below only lets the browser load
    images from the recipe feed's host. A tap-to-load for an arbitrary site's photo would need either a wider
    `img-src` (which reopens M11 for every link, since the CSP can't tell a tap from an automatic load) or a fetch
    through a server (there is none, and `connect-src` is `'self'`). Keeping the placeholder only is the
    privacy-safe choice: opening, previewing, saving and viewing an imported recipe makes zero requests outside
    the app's own site.
  - **CSP `img-src` is now `'self' data: blob: https://images.wegmans.com`** (was `'self' https: data: blob:`).
    images.wegmans.com is the only photo host in the recipe feed (the crawler's parser test and every fixture
    recipe); the price feed carries no images. Feed photos are also filtered in code (`src/imghost.js`
    `feedImage`: https, exact host, no credentials, port or odd characters), so a feed or Favorites row with any
    other host shows the placeholder instead of a CSP error. Inline script hashes are unchanged and still pinned.
  - Import was re-checked for other requests: no favicons, prefetch/preconnect, CSS `url()` or link previews; the
    source link is a plain `rel="noopener noreferrer"` link that only opens when tapped.

### Fixed
- **L55:** the L53 fix went too far. Chicken Broth, Vegetable Broth, Beef Stock, Chicken/Pork Sausage and
  Strawberry Jam on the list count again for a bare broth / stock / sausage / jam line (Already on your list,
  Cook ranking), so Add missing no longer bumps those lines a second time. Oil and juice stay strict: Coconut Oil
  isn't "oil" and Apple Juice isn't "juice". A bare list name still doesn't cover a flavoured line.
- **L56:** the Restore sheet names the file's imported recipes ("Favorites, store picks, 2 imported recipes and
  settings are replaced too. Your current imported recipes are removed." / Merge: "Its 2 imported recipes are
  added too (yours are kept)."), and the toasts count them: "Backup restored · 1 item, 2 imported recipes,
  2 settings", "Backup merged · 1 item, 1 imported recipe added".
- **L57:** Cook "Missing N:" uses a new `--color-miss-text` token, at least 4.5:1 on both the surface and the page
  background in all 5 themes, light and dark (Tomato light #8F5C00, 5.7:1; Blueberry and Espresso light darkened
  too). `--color-orange-text` stays as the non-text star colour.
- **L58:** pasting more than 60,000 characters says "That's too large to import (over 60,000 characters). Paste just
  the ingredients and steps." instead of being cut mid-JSON and reporting no ingredients.

### Tests
- test/v026a1.test.mjs: CSP img-src exact host and pinned hashes, `feedImage` host checks, image URLs dropped from
  every import path and from Favorites snapshots, feed photos kept only on the host, renderer wiring; L55 both
  sides and Add missing; L56 wording and toast counts; L57 contrast per theme block; L58 cap. Updated the L53/L51
  and L50 tests for the new behaviour.

## [0.2.6-alpha] - 2026-11-16 (alpha)

Recipes Phase 2: **Cook from my list** and **Import a recipe**. Everything runs on the device; nothing is sent anywhere.

### Added
- **Cook from my list** (Recipes › Cook from my list): recipes ranked by how much of them is already on your list,
  using the same foodRelation rules as matching (a recipe shows when 3+ of its ingredients, or half, are on the
  list). Each row shows "N of M on your list" with a bar, what's still missing, and a low-to-high **to buy** range
  for just the missing lines. Sorts: Coverage (default), Time, Price, A–Z, Rating; the Cook sort is saved apart
  from Browse. The landing card says how many recipes are 1–2 items away. Detail's **Add missing to list** works
  as before (merge, "Added N, updated M", Undo, 500 ms guards).
- **Import a recipe** (Recipes › Import): paste the recipe text (ingredient and step headings are found, or
  guessed), a page's JSON-LD, or an import link. A preview shows the title, servings and time (editable), every
  ingredient line as parsed (lines without an amount are flagged and added as written), and the steps, with Edit
  for both lists. Pasting a plain web link explains that the app doesn't open other websites.
- **Bookmarklet** "Happy Wife" and an **iOS Shortcut** "Happy Wife Import" (docs/import-shortcut.md) read the
  schema.org Recipe on the page you're on (or its text) and open the app with it in the link's #fragment
  (compressed, size-capped, never sent to a server). The app clears the fragment on arrival, validates and
  sanitizes it, and shows the preview. In Safari a "Copy for the home-screen app" button hands it to the
  home-screen app, which keeps separate storage. About › Import a recipe has short steps for both.
- **My recipes**: imported recipes are saved on this device, starred in Favorites › Recipes with an Imported tag,
  listed on the Recipes page, and work with list matching, Cook ranking, prices, Add missing and the cost range.
  Detail shows "Imported from <site>" and **Delete recipe** (with Undo).
- **Backup**: the full backup includes imported recipes (`userRecipes`, additive to backup/2; Replace takes the
  file's, Merge keeps this device's copy of any duplicate) and the Cook sort. v1 and older v2 files still load.
- **Content Security Policy** (meta): scripts only from the app (inline scripts pinned by hash, no eval),
  `connect-src 'self'`, no plugins, `base-uri`/`form-action` self. `tools/csp-hashes.mjs` prints the hashes.

### Fixed
- **L53:** a flavoured product on the list no longer counts as the bare ingredient: Coconut Oil isn't "oil",
  Apple Juice isn't "juice", Chicken Broth isn't "broth" for **Already on your list**, Cook ranking or Add missing.
  The L51 fallback still offers those products as picks when nothing plainer exists. (Vegetable Oil still counts
  as oil, and Vanilla Ice Cream as ice cream.)
- **L54:** at tablet widths (768–1200px) the Recipe detail no longer squeezes its info column next to the photo:
  the info moves below the photo when it would get less than 20rem, the Servings label keeps its room (the
  stepper wraps under it on a narrow card), and Missing / On your list sit side by side only from 1200px.

### Tests
- test/v026-lows.test.mjs (L53, L54). test/v026.test.mjs: line parser, JSON-LD and text parsing, sanitising (script tags, handlers, javascript: links,
  bidi characters, huge fields), the fragment codec (damaged, oversized, zip bomb, wrong version), the bookmarklet
  run against a fake page (no network calls), Cook ranking and sorts, the backup round trip and old files, the key
  registry and the CSP.

## [0.2.5-alpha.1] - 2026-11-15 (alpha)

The iPhone home-screen bottom-bar fix and Tester's Lows from the v0.2.4 gate (26ec923), on top of themes v2. The v0.2.5-alpha tag was already
pushed before these landed, so they ship as 0.2.5-alpha.1 (tags are never moved).

### Fixed
- **Home-screen app on iPhone: tab bar floating above the screen edge.** v0.2.5's theme rules added the
  home-indicator safe area to the tab bar's `bottom` *and* its `padding-bottom`, so in the home-screen app
  (inset about 34px) the bar sat 34px up with page content showing beneath it, and the sticky
  **Add missing to list** bar and the running-total bar (still placed at a fixed 72px + inset) were half
  hidden behind it. Safari with its toolbar has no inset, so it looked fine there. The inset is now applied
  once (a flush bar sits at `bottom: 0` and pads it; Coconut & Lagoon's floating bar lifts by it instead),
  and everything that stacks on the tab bar (Add bar, total bar, store breakdown, Add item button, toasts,
  page bottom padding) follows the bar's measured height (`--tabbar-h`, ResizeObserver), so a theme's
  taller or floating bar can't overlap them. Full-height layouts use `100dvh` with a `100vh` fallback.
- **L50:** the Replace description in Load now reads "Favorites and store picks are replaced too" for a
  file without settings (and "Favorites, store picks and settings" with them).
- **L51:** bare broth, stock, jam, jelly, preserves, sausage, oil and juice no longer match nothing when every
  product has a food word in front: with no plainer product they offer Chicken/Beef/Vegetable Broth,
  Chicken Stock, Strawberry Jam, Chicken Sausage, ranked behind any plain product. "oil" offers
  Vegetable Oil alongside Canola. The M10 look-alikes (Ice Cream for cream, Peanut Butter, Banana
  Bread, Almond Milk) stay out. The list check agrees (Chicken Broth on the list covers "broth").
- **L52:** Brown Sugar and Sugar no longer cover each other, and Green Beans no longer count as beans.
  A flavour word in front of a multi-word ingredient keeps it the same food, so Vanilla Ice Cream on the list
  counts for "ice cream" and Add missing no longer bumps that line.

### Tests
- New test/v025-lows.test.mjs (7 tests: L50, L51 ×4, L52 ×2) and test/bottom-bars.test.mjs (3 tests, bottom-bar regression). 251 tests in total.

## [0.2.5-alpha] - 2026-11-15 (alpha)

**Themes.** Five approved themes (Designer's themes v2), each with its own colours, fonts, icon set,
corners and tab bar, in Light, Dark or Auto. Cook from my list and Import follow in v0.2.6.

### Added
- **⋮ › Theme** (the row hidden in v0.2.4 now shows the current theme) opens the Theme sheet from
  Designer's picker-v2: an **Auto / Light / Dark** control, then one card per theme with a mini
  preview drawn from that theme's tokens in the current mode (page colour, header, "Aa" in its
  heading face, card shape and style, button shape and active-tab marker).
  - **Tomato & Parmesan** (default): the shipped colours, now in Nunito, shipped icons, pill tab.
  - **Blueberry & Lemon**: cool white + slate, Inter, Lucide thin-line icons, 10 px corners, top
    indicator on the active tab.
  - **Blackberry & Lavender**: lavender surfaces, Fraunces headings, Phosphor duotone icons,
    elevated 22 px cards, top-rounded tab bar.
  - **Coconut & Lagoon**: sea-salt aqua, Quicksand, Phosphor fill icons, flat tinted cards, a
    floating pill tab bar with a solid lagoon bubble.
  - **Espresso & Mango**: greige paper + charcoal, DM Serif Display headings, IBM Plex Mono prices,
    Phosphor light icons, 6 px corners, mango underline on the active tab.
  - Picks apply right away. Auto follows the phone's setting, live.
- **Saved per device** in `shopsmartr:theme:v1` and `shopsmartr:mode:v1`. Both are registered
  as settings in the key registry, so the **full backup** carries them. Replace restores them;
  Merge only fills in one this device doesn't have; Undo puts them back. The App icon picker stays
  separate.
- **No flash on load.** A small inline script in `<head>` reads the saved theme and mode and sets
  `data-theme` / `data-mode` before first paint. A second one, straight after the icon sprite,
  puts the theme's icons in from a local copy (`shopsmartr:spriteCache:v1`, excluded from
  backups and refreshed when the app version changes).
- **Only the active theme's fonts download.** The page holds only that theme's `@font-face`
  rules (`<style id="theme-fonts">`, swapped on change), self-hosted from `fonts/` with
  `font-display: swap`, no font CDN. Per theme: Tomato 38 KB (Nunito), Blueberry 47 KB (Inter),
  Blackberry 18 KB (Fraunces), Lagoon 28 KB (Quicksand), Espresso 24 KB + 15 KB (DM Serif
  Display, plus IBM Plex Mono once prices show).
- **Theme sheet previews** show each name in its own heading face using tiny subsets
  (`fonts/preview/`, only the glyphs of the five names and "Aa", ~20 KB for all five, loaded
  the first time the sheet opens) instead of the ~150 KB of full faces the spec mentions. The
  subsets carry their own family names ("HWH Preview …") because Quicksand's licence reserves
  its name for modified versions.
- Fonts: SIL OFL 1.1, licence files in `fonts/`. Icons: Lucide (ISC) and Phosphor (MIT), licence
  files in `icons/sprites/`. Each theme's sprite is fetched once when picked; icons a set
  doesn't have (the About link icon) come from the default set.

### Changed
- `tokens.css` colour blocks are replaced by Designer's `themes-v2.css`; the light/dark override
  attribute is now `data-mode` (it was an unused `data-theme="light|dark"`).
- `style.css` gains Designer's `chip-border.css` (unselected chips get the ≥3:1
  `--color-control-border` outline), `theme-picker.css`, `picker-v2.css` and
  `theme-shape-v2.css` (identity tokens mapped onto app classes). The Add item button sits
  above the total bar for every tab-bar style.
- Meta `theme-color` and the manifest `theme_color` stay tomato (the spec doesn't change them).

### Tests
- `test/v025.test.mjs` (9 tests): theme registry and settings classes, token blocks for every
  theme and mode, persistence, the full backup round trip (Replace, Merge fills only a missing
  setting, junk dropped), the early-apply script run for every theme × mode (it must write the
  same fonts as `src/themes.js`), font loading for only the active theme, licences, sprites, and
  the menu row + sheet markup. Two v0.2.4 tests were updated for the shown Theme row and the
  new version.

## [0.2.4-alpha] - 2026-11-15 (alpha)

ShopSmartR is now **Happy Wife Helper**. This release also adds app icons, an About sheet, one
global ⋮ menu on every tab, Wegmans-only store views, and full-restore backups. Themes ship in
v0.2.5, and Cook from my list and Import in v0.2.6.

### Changed
- **New name: Happy Wife Helper.** It's used in the tab title, the top-bar wordmark, the manifest
  (`name`), messages and download names. The name under the home-screen icon is **"Happy Wife"**
  (`short_name` and `apple-mobile-web-app-title`). Backups are saved as
  `happy-wife-helper-backup-YYYY-MM-DD.json`, and exports as `happy-wife-helper-list-…` and
  `happy-wife-helper-favorites-…`.
  These keep the old name, so no data is lost: the repo, the Pages URL, every `shopsmartr:*`
  storage key, the feed files (`data/prices.enc`, `data/recipes.enc` and their manifests), the
  backup format id (`shopsmartr.backup/2`), the encryption AAD strings, and the hidden
  password-manager username ("ShopSmartR household"), so saved passphrases still autofill.
- **One ⋮ menu on every tab** (Designer's v2 layout). The love note is on top. A **This list**
  section shows on List only: Export… (CSV, text, copy, Favorites CSV), Check all, Uncheck all,
  and Clear checked items. Next come **Backup** (Back up, Restore…) and **Settings** (App icon,
  Household size, Weekly ads), then **About**. Clear list, My stores and the desktop
  "Save & export" button are gone; on desktop the side nav's **More** opens the same menu.
  **Weekly ads** can be opened from the menu even when Shop is hidden. The Theme row is in the
  markup but hidden until v0.2.5.
- **Only Wegmans is shown.** Other chains are hidden by a flag (`HIDDEN_CHAINS` in
  `src/stores.js`). This covers the store dropdowns and chips, the Stores finder, Shop's store
  list, all-store search, suggestions, the On-sale list, recipe matching and Weekly ads. The
  store button counts only shown picks. Your data isn't touched: list lines, Favorites and store
  picks tied to Tops and the others stay saved and in backups. Their list lines still show,
  under their own store and after the Wegmans sections. Editing one keeps its store, and
  emptying the Set brings everything back.

### Added
- **App icon picker** (⋮ › App icon) with the 5 approved icons: Love Basket (default), Happy Bag,
  Heart Checklist, Tomato Heart and Heart Whisk.
  - Choosing one changes the in-app logo, the favicon and the `apple-touch-icon` link right away.
  - The choice is saved on this device (`shopsmartr:appIcon:v1`) and included in the full backup.
  - The sheet explains that the iPhone home-screen icon only changes when the app is added
    again. It also warns that the home-screen app keeps its own list and Favorites, so removing
    it may erase them. Then it walks through: (1) Back up first, with a one-tap button; (2)
    remove the icon, open the link in Safari, then Share › Add to Home Screen; (3) open the new
    icon and Restore.
- **Web app manifest** (`manifest.webmanifest`, `id` "./"), which `index.html` was missing before.
  It uses the Love Basket "any" and maskable icons, and `theme_color` stays tomato (`#C8321F`).
- **About** (⋮ › About) shows the name, the version, "Made by Steven Moran", the GitHub repo
  and a clear link to the live app. It has **Copy link** (Clipboard API, falling back to
  select-and-copy) and short Add to Home Screen steps, with a "Back up first" reminder. Links
  open in Safari (`target=_blank rel=noopener`), including from the installed app.
- **Full-restore backups.** A new registry (`src/keys.js`) sorts every `shopsmartr:*` key into
  three groups:
  - **backup:** the list, Favorites with saved recipes, the Shop store, and ingredient swaps.
  - **settings:** list sort, household size, app icon, the recipe store and sort, plus theme
    and mode placeholders for v0.2.5.
  - **exclude:** local safety copies, bookkeeping and the love-note rotation. The derived feed
    keys (IndexedDB `shopsmartr-keys`), decrypted data and cached feeds never go into a file.
  Back up writes the settings into a new `prefs` section of `shopsmartr.backup/2`. This is
  additive, so v0.2.3 can still read new files, and v1 and v2 files still load. Restore shows
  the file's date, time and counts (including settings) before the Merge or Replace choice.
  - Replace restores every setting in the file.
  - Merge only fills in settings this device doesn't have yet.
  - Undo puts the old settings back.
  A unit test fails if code uses a `shopsmartr:*` key that isn't classified.

### Fixed (Tester's v0.2.3 gate, 5c67b97 NO-GO)
- **M10 (Medium): "Already on your list" matched too loosely.** The recipe detail's list check
  (`onListItem`) used word containment. Peanut Butter counted as butter, Chicken Broth as
  chicken, Cream Cheese as cream, Banana Bread as bread, Corn Tortillas as corn, Garlic Salt as
  garlic, Pineapple Juice as pineapple and Vanilla Ice Cream as ice, so **Add missing silently
  skipped those lines**.
  - The list check and product matching (`matchRows`) now share one rule, `foodRelation()` in
    `src/recipes.js`. Words after the ingredient's main word may only be a cut, class or pack word
    (Chicken Breast, Garlic Bulb). Words in front may not name another food (Peanut Butter, Ice
    Cream, Banana Bread, Almond Milk). Cream Cheese is never cream.
  - True matches still count: Unsalted Butter → butter, Chicken Breast or Thighs → chicken,
    Heavy (Whipping) Cream → cream, Russet Potatoes → potato, "Butter, unsalted" → unsalted
    butter. A plain "butter" on the list covers "unsalted butter".
  - Processed forms (Chicken Nuggets, Popcorn Chicken) don't cover a plain ingredient. Frozen
    still does (Frozen Peas → peas).
  - Under the same rule, products like Banana Bread for "bread" or Coconut Milk for "milk" are no
    longer offered.
- **L45: a processed word in front of the main word** (Popcorn, Rotisserie, Breaded, Buffalo…
  Chicken) now drops a match level and sorts behind real cuts. A bare "chicken" picks Breast or
  Thighs, not Popcorn Chicken. These stay available as lower Swap options.
- **L46:** Ice Cream, Sour Cream and Whipped Cream are never offered for a bare "cream", whatever
  the catalog holds (no bagged-ice product is needed any more). So they are never Swap options and
  never set the cost range. Heavy Cream and Heavy Whipping Cream lead.
- **L47: a count against a weight-sold pack.** "2 potato" against Russet Potatoes 5 lb used to
  buy two 5 lb bags. It now buys **one pack**, flagged "1 pack for 2 · check the size". Per-each
  products still buy one per piece, "12 ct" packs still divide, and "2 cans" still buys 2.
- **L48: desktop focus after Add or Undo.** Focus used to land on the hidden phone button
  (falling to the page body). It now goes to the first visible target: the side panel's Undo
  after Add; its Add button (or the title) after Undo; and the title once the 6-second Undo
  window ends. Phones keep the CTA.
- **L49:** an old `#ads` link opens the Weekly ads sheet over Shop (or the list when Shop is
  hidden), then rewrites the address to `#shop` with `history.replaceState`. Bookmarks and
  reloads stop saying `#ads`.
- About sheet: the Share icon in "Tap Share" sits inline in the text instead of on its own line.

### Tests
- `test/v024.test.mjs` adds 13 tests: rename strings, manifest, icons, picker and About copy,
  the menu layout, the key registry (including the unclassified-key guard), the backup round
  trip and junk prefs, and v1/v2 compatibility. Hidden chains are tested with the flag on and
  off for the catalog, recipe matching and list grouping. The v0.1.5 store-order regression is
  rewritten to run with the flag on and off.
- `test/v024-matching.test.mjs` adds 37 tests for the gate fixes: each M10 false pair (14) and
  true pair (16), the shared-rule agreement check, the qa9-style detail, L45, L46 (options and
  cost range), L47, and code-path checks for L48/L49. The browser checks for L48/L49 and M10 are in
  the v024 gate probe. Older tests that expected Ice/Sour Cream or Banana Bread as low-ranked
  options were updated to the stricter rule.

## [0.2.3-alpha] - 2026-11-15 (alpha)

Recipes, second slice: what you already have, match review with Swap, and Add missing. Hidden
stores without prices, the global ⋮ menu and full-restore backups follow in v0.2.4; Cook from my
list and Import in v0.2.5.

### Added
- **Missing / Already on your list.** Recipe ingredients are split into two groups using the
  same name matching as "Uses my list"; checked (bought) items count as on your list. The header
  reads "Ingredients · N of M on your list", and lines you have show their store.
- **Add missing to list** opens a match review sheet (a centered Review dialog on desktop):
  - "Matched at" store picker (remembered on this device; it also sets the card costs).
  - One row per missing line ("For 1½ lb green beans") with a checkbox, the product, size and
    price; unchecked rows are skipped.
  - **Swap**: up to 4 alternatives with size and unit price, picked with one tap (a radio
    group, arrow keys work). Your pick is remembered per ingredient and store, and fixes both
    ends of the recipe's cost range to that product.
  - "No match. Add as text" for lines without a product, and "Search <store> for something
    else", which opens Shop searching that store.
  - "Add N to list" with the total. Adding merges into matching open lines (as in v0.2.1), the
    toast and button say "Added N items" / "Updated N items" with Undo for 6 seconds, and a
    double tap or a held Enter still adds once (v0.2.2).
- **Desktop right-hand panel** on a recipe: the missing lines with checkboxes, Review and Add N,
  plus a compact My list grouped by store with "in recipe" tags.
- **"in recipe" badge** on list lines added from a recipe; tap it to open that recipe.
- **Backups include saved recipes (backup/2).** Save list writes `shopsmartr.backup/2` with
  `favorites.recipes`. Load accepts /1 and /2: Replace with a /1 file keeps this device's saved
  recipes, Merge combines them. The Load summary counts saved recipes.

### Changed
- **Weekly ads moved to Shop.** The Ads tab is gone (tabs: List · Shop · Recipes · Favorites, on
  mobile and in the desktop nav). A "Weekly ads" icon button at the top of Shop opens the ad
  links in a small sheet (a popover on desktop); Esc, the backdrop or a click outside closes it
  and focus returns to the button. Links open in a new tab. Old `#ads` links and a saved Ads tab
  open Shop.
- **Bare "cream" and "bread" pick the everyday product.** A one-word ingredient prefers its
  plain form (Heavy or Whipping Cream, Sandwich or White Bread, Whole Milk, Long Grain White
  Rice). A product whose name puts another food before the head noun (Ice Cream, Banana Bread)
  drops a level instead of being rejected, so it is still offered when nothing better exists.
  A bare "cream" stays off Cream Cheese.
- **Plain forms first (L44).** A bare "chicken" or "potato" leads with the plain product, not
  Nuggets, Patties, Wedges, Fries or Chips (ahead of the shorter-name and price tiebreaks); the
  processed forms stay as Swap alternatives.

### Fixed
- **Celery hearts, pineapple chunks and corn on the cob are priced (L43).**
- **No focus ring after a tap (iOS).** Opening Recipes no longer leaves a blue ring on "Browse
  recipes" (or on a heading, tab or a sheet's opener). Rings are keyboard-only app-wide
  (`:focus-visible`, no tap highlight; after a tap or click, programmatic focus draws none) and
  come back on the next key press.
- The closed match sheet no longer stays visible on desktop (found while building this slice).

## [0.2.2-alpha] - 2026-11-15 (alpha)

Second Recipes hotfix (Tester gate on 24f2513). Match review, Swap, "Already on your list", Add
missing and backup/2 move to v0.2.3; Cook from my list and Import to v0.2.4.

### Fixed
- **One-word ingredients match again (M9).** v0.2.1's L39 fix rejected every product whose name
  ended in another word, so "parmesan", "ricotta", "cheddar", "avocado" and "chicken" showed
  No match. A one-word ingredient now matches when the words after it are a class, cut or
  variety of the same food (Parmesan Cheese, Chicken Breast, Chicken Thighs, Avocados Hass,
  Garlic Bulb, Turkey Slices), and is still rejected when they name another food (Ice Cream,
  Garlic Ham, Potato Chips).
- **Toast and button say the same thing (L41):** "Added 3 items", "Updated 2 items" or "Added 1,
  updated 2", with "· Undo" on the button.
- **Holding Enter adds once (L42).** Key auto-repeat no longer flips between add and Undo, and a
  tap right after Undo doesn't add again.

## [0.2.1-alpha] - 2026-11-15 (alpha)

Hotfix for the v0.2.0 Recipes slice (Tester gate on ce512d3). Match review, Swap, "Already on
your list", Add missing and backup/2 later moved to v0.2.3; Cook from my list and Import to v0.2.4.

### Fixed
- **Add all merges into your list (M7).** An ingredient whose product is already an open line
  with the same name, store and unit adds to that line's quantity instead of a second line, so
  two recipes with limes give one Limes line. The line keeps its first recipe link. The toast
  says "Added N, updated M"; Undo removes what was added and puts merged lines back exactly.
  Bought (checked) lines are left alone.
- **A double tap on Add all adds once (M8).** Undo appears where the button was, so taps on it
  are ignored for half a second after the add.
- **Recipe search allows one typo (L35)** in words of 5+ letters, like Shop search: "spagetti",
  "marinera".
- **No stray "null" under the steps (L36)** when a recipe has no source link.
- **Recipes with nothing priced say so (L37):** "2 ingredients not priced at Wegmans #80".
- **"fl oz" (L38)** instead of "floz"/"flozs".
- **Fewer wrong matches (L39).** A one-word ingredient that only describes the product is no
  longer matched: "ice" is not Ice Cream and "garlic" is not Garlic Ham. Pack words at the end
  of a name still count ("Garlic Bulb" is garlic).
- **Warm CTA shadow (L40)** instead of the old green one.

## [0.2.0-alpha] - 2026-11-15 (alpha)

First Recipes slice. Still alpha; recipes and prices are saved household snapshots (encrypted,
opened with the household passphrase), not official checkout prices. Match review, Swap,
"Already on your list", Add missing and backup/2 follow in v0.2.3 (moved from v0.2.1); Cook
from my list and Import in v0.2.4.

### Added
- **Recipes tab** in the middle of the tab bar: List · Shop · Recipes · Favorites · Ads. Stores
  moves to a store button in the app bar (with your store count); the desktop sidebar keeps
  Stores and adds Recipes between Shop and Favorites.
- **Recipe snapshot loader** (`data/recipes.json` + `recipes.enc`, decrypted in the Worker). The
  household passphrase that opens prices opens recipes too; the recipe key is cached separately
  (`aes-recipes`), only the key, never the recipes. With no snapshot the tab says so.
- **Browse**: search (titles and ingredients), 12 category tiles, quick picks (Under 30 min,
  Under $15, 5 ingredients or fewer, Uses my list), 24 cards a page with Show more, and sorts
  Time · Price (low/high) · A–Z · Rating. Rating only appears when a recipe in the results has
  one; Price only once prices are open. The sort is remembered on this device.
- **Recipe cards**: photo (linked from the source, never stored here), time, rating only when
  rated, and the cost range "$12–$21 to buy" (whole packs at your Shop store, pantry basics left
  out), with a star.
- **Recipe detail**: servings stepper starting at your household size, every amount rescaled
  (¼ ½ ¾ ⅓ ⅔), "Buys 2" when you have to buy more than the recipe uses, ≈ price per line,
  "N not priced", the pantry line ("Pantry basics, not added: salt, black pepper"), numbered
  steps with time pills, and a desktop layout with ingredients and steps side by side.
- **Add all to list**: puts the best match for every non-pantry ingredient on your list (the
  ingredient's name when nothing matched), each line showing "for <recipe>"; Undo for 6 s.
- **Favorites › Recipes**: star a recipe to save it; a grid, newest first, unstar with Undo.
  Favorites reads "N staples · N recipes · N meals"; the storage line counts saved recipes.
- **Household size** (⋮ menu, or Change on the Recipes tab), default 3.

### Fixed
- **L34: the Load list pill counted Favorites before the duplicate combine** ("12 Favorites"
  for a file that loads 9). It now counts after the combine.
- The ⋮ menu stays on screen on short desktop windows (it scrolls when taller than the window).

### Notes
- Saved recipes aren't in Save list files until backup/2 (v0.2.1); Load list › Replace keeps
  the saved recipes on this device.

## [0.1.10-alpha] - 2026-11-15 (alpha)

Fix release for the v0.1.9 gate (M6, L32, L33). Still alpha; prices are a saved household
snapshot, not official checkout prices.

### Fixed
- **M6: no more duplicate favorites from the Favorites tab.** Every way of adding or editing a
  staple now uses the same name + store identity as the stars: the Favorites-tab add, the edit
  sheet (a rename or store change into another favorite), the Shop and list stars, and Load list
  merge/replace. Adding one that exists says "Milk is already in your Favorites…" and changes
  nothing.
- **M6: the duplicate clean-up on load is one-time.** The "Combined N duplicate…" notice shows
  once per device, and the copy it names (`shopsmartr:favorites:v1.predupe.bak`) is written once
  and never overwritten. If old duplicates ever turn up again they are combined quietly into a
  timestamped copy (`…predupe.<time>.bak`); only the newest 3 such copies are kept.
- **L32: double-clicking "Save list first" on desktop no longer closes the reopened confirm.**
  Backdrop clicks are ignored while the dialog is arming and for 300 ms after it opens.
- **L33: Favorites wording.** The plural names the Favorites collection ("3 Favorites"); one item
  is "1 favorite" (Load list pill and summary, duplicate notice).
- Stale contrast comment on the filled star (3.8:1 on white; non-text, needs 3:1).

## [0.1.9-alpha] - 2026-11-15 (alpha)

Tomato & Parmesan theme (light + dark), outlined destructive buttons, control outlines now 3:1.
Theme only: no JavaScript changes. Still alpha; prices are a saved household snapshot, not
official checkout prices.

### Changed
- **New colours in both themes** (`tokens.css`): warm white page and Parmesan-cream sections, a
  tomato primary, gold sun and star, crimson-rose danger, store dots retuned for each theme, and
  warm (non-green) shadows. Dark follows the OS setting (or `data-theme="dark"`). Only colour and
  shadow tokens changed; type, spacing, radii and sizing are unchanged.
- **Destructive buttons are outlined, not filled:** a 2px crimson outline on a pale tint (Clear,
  Remove, Load list → Replace), with a trash icon in confirm dialogs. In confirm dialogs Cancel
  is neutral, so only the safe action (tomato fill) and the destructive one carry colour. Windows
  High Contrast keeps the outline.
- The two remaining hard-coded green shadows (total bar and its breakdown) are now warm.
- The browser bar colour follows the theme (`theme-color` `#FFFCF6` light / `#121213` dark).

### Accessibility
- Checked against WCAG 2.2 AA in the rendered app in both themes at 360/390/414/1280 px:
  text at least 4.5:1 (lowest: aisle pill on a checked row, 4.84:1 light / 5.09:1 dark), and
  checkboxes, radios, inputs, the Cancel outline, danger outline, stars, selected chips, store
  dots and focus ring at least 3:1. Control outlines move from about 1.5:1 to 3.1:1 or more.

## [0.1.8-alpha] - 2026-11-15 (alpha)

Small fix release for the Lows from the QA gate on 0.1.7-alpha (d4e65be). Still alpha; prices are
a saved household snapshot, not official checkout prices.

### Changed
- **One favorite identity for Shop and the list (L30).** A favorite is now the normalized name +
  store (the chosen store, else the price's store). The unit is an amount, not part of the
  identity, so "2 lb Mini Apples" starred on the list shows filled on the same Shop result and
  can't be favorited twice. Different stores stay separate. Load list uses the same rule for
  Favorites; list lines still merge on name + unit + store (their quantities add).
- **Old duplicates are combined once (L30).** On load, favorites that are now the same identity
  become one: the first is kept as it was (its qty, unit and store), empty fields are filled from
  the others and different notes are joined. The old set is copied to
  `shopsmartr:favorites:v1.predupe.bak` first, and a notice says how many were combined. If the
  copy can't be written, nothing changes. Meals are never touched. A Replace from an older file
  is combined the same way.
- **"Favorites" is capitalized (L31)** in the remove toast and label on the Favorites tab, the
  empty state, "Add all Favorites to this week's list", the unreadable-data notice, Load list
  messages and the file summary ("4 Favorites"). The singular "favorite" is unchanged.

### Fixed
- **L28:** an open ⋮ or sort menu now sits above the Undo toast, so tapping a menu item always runs
  that item instead of the toast's Undo. The toast stays up and its Undo works once the menu closes.
- **L29:** a double tap on "Save list first" saves once. The reopened confirm ignores taps for
  0.6 s, and Save list ignores a repeat while a save is running or within 0.8 s of the last one.
  A deliberate second save after that still works.

## [0.1.7-alpha] - 2026-11-15 (alpha)

Favorite stars and list actions. Still alpha; prices are a saved household snapshot, not official
checkout prices.

### Added
- **Favorite star** on every Shop result (including "On sale this week") and every list row.
  Outlined = not a favorite; filled = a favorite. Tapping an outlined star adds it to Favorites
  right away. Tapping a filled star asks "Remove <item> from Favorites?" (Cancel / Remove) and
  removes it only on Remove (with an Undo toast). Stars use the same favorite identity as the
  Favorites tab and Load list merge (normalized name + unit + store, the chosen store or else the
  price's store) and stay in sync both ways. 44px targets, `aria-pressed`, "Add/Remove <item>
  to/from Favorites" labels; a star never opens the item sheet or checks the row. The confirm
  dialog keeps focus inside, Esc is Cancel, and focus returns to the star.
- **Check all** in the ⋮ menu beside the existing Uncheck all, with an Undo toast that puts back
  each line's previous done state. Uncheck all now offers the same Undo.

### Changed
- **Clear checked items asks first.** The existing action now opens a confirm that says it can't be
  undone and recommends saving: "Save list first" runs Save list and comes back to the confirm,
  plus Cancel and a destructive Clear. A copy of the list is kept in
  `shopsmartr:beforeClear:v1.bak`; the existing Undo toast is unchanged. Favorites, meals and
  stores are never touched.
- Check all, Uncheck all and Clear checked items are disabled when they'd do nothing
  (including an empty list).

### Fixed
- **L27** – Load list Replace now remembers the file's saveId, so merging the same file later is
  refused ("This file was already loaded on …"); Undo of the Replace forgets it again.

## [0.1.6-alpha] - 2026-11-15 (alpha)

Fixes from the QA gate on 0.1.5-alpha (aca2720). Still alpha; prices are a saved household
snapshot, not official checkout prices.

**Note:** the `v0.1.5-alpha` tag points at 582300d and does **not** include aca2720 (Load list
merge keeps a line done if either copy is done), which was pushed to main after the tag. This
release and its tag include it.

### Fixed
- **M4 – store headers stick again.** The sticky box is now the section's `h2` (it was the button
  inside it, which can't leave its own h2). Headers pin under the mobile app bar (60px) or at the
  top on wide screens while that store's rows scroll, then leave with their section.
- **M5 – no raw error for an amount that can't be priced.** Adding e.g. "5 kg" of a $3.49 each
  item now says "Added Brown Rice Bag (no price for 5 kg)" instead of "Cannot read properties of
  null (reading 'total')". Every `linePrice` consumer handles "no price".
- **L21** – Aisle sort puts Produce first, then natural order (text, then number), no aisle last.
- **L22** – the sort choice is device-only: it isn't written to saved files, and a sort in an
  older (0.1.5) file is ignored on load.
- **L23** – each saved file has a random `saveId`. Merging a file this device already merged, or a
  file saved from this list, warns ("This file was already merged on Nov 15, 2026") and skips;
  Replace is still allowed. Undo of a merge forgets it again.
- **L24** – Load list refuses files over 5 MB (checked before reading) or over 5,000 items, with a
  message that says so.
- **L25** – duplicate ids in a loaded file: exact copies are dropped (and counted in the summary),
  different rows that share an id get new ids, so removing one row never removes another.
- **L26** – desktop sort buttons, the direction toggle and Collapse all are 44px tall.
- Picking the same file twice in Load list works (the file input is reset after each pick).

## [0.1.5-alpha] - 2026-11-15 (alpha)

Store-by-store list, sorting, and saving the list to a file. Fixes the Lows from the 0.1.4-alpha
recheck (4afb575). Still alpha; prices are a saved household snapshot, not official checkout prices.

### Added
- **List grouped by store.** Items are grouped under sticky store headers (keyed by chain + store
  number, so Tops, ALDI and Trader Joe's slot in the same way). Each header shows the store name,
  its address from `stores.json`, the subtotal (or "No prices") and "N left · x/y priced". Headers
  collapse, and each store's collapsed state is remembered on this device. Stores follow the
  Stores-tab order. Unpriced and manual items go under their chosen store, otherwise "Any store",
  which is always last. A list with one store shows no headers, just a faint store line.
  A row shows "● Wegmans price" only when its price comes from a different store than its section.
- **Totals by store.** The grand total stays in the mobile total bar, and a chevron opens the
  per-store breakdown. On wide screens a "Trip by store" card has jump links and the grand total.
  The text export has per-store headers with addresses and subtotals.
- **Aisle on every row** (a pill on the second line), in the text export ("store, aisle") and in
  the CSV Aisle column.
- **Sort** A–Z (case-insensitive), Price (line total, high/low; lines without a price always last),
  or Aisle (natural order: Aisle 2 before Aisle 10; lines without an aisle last), with the name as
  the tiebreaker, applied within each store. On phones it's a 44px chip that opens a menu; on wide
  screens it's a toolbar with a direction toggle and Collapse all. Checking an item never moves
  it. The choice is saved in `shopsmartr:listSort:v1`.
- **Save list / Load list** in the ⋮ menu. Save list writes `shopsmartr-list-YYYY-MM-DD.json`
  (schema `shopsmartr.backup/1`: app version, time, the list, favorites and meals, store picks,
  settings and sort). It never contains the passphrase or any key. It uses the share sheet when
  the browser can share files, otherwise a download. Load list checks the file, shows what's in it,
  and offers Merge (the default; matching name + unit + store lines are combined, quantities add,
  a line done in either copy stays done, newer price kept; anything else is added as a new row) or Replace (red confirm "Replace my list", a 10-second Undo, and a copy of the
  current list in `shopsmartr:beforeLoad:v1.bak`).
- **Save reminder.** "Last saved N days ago — Save list" after 7 days, or "Not saved to a file yet"
  3 days after a list first has items. × hides it for 7 days.
- **Storage status** in the menu ("Kept in this browser only", last saved, and the result of
  `navigator.storage.persist()`).
- New design token `--color-danger-soft` (light and dark).

### Fixed
- **L18** – subsequence and typo matches only come from names and brands. Departments and
  categories match exactly or by prefix only, so "frzn" no longer lists the whole Frozen
  department. A subsequence must also cover at least half the word ("mlk" doesn't match "multipack").
- **L19** – a weight or volume quantity on a package item with no convertible unit price counts
  whole packages from the size (5 kg of a "2 lb bag" = 6 bags, marked ~). If the size can't be read,
  the line shows "No price for 3 lb" and isn't counted in the total.
- **L20** – pressing Enter in the mobile add sheet without picking a suggestion parses the quantity
  and unit like the desktop add bar ("2 lb apples" → apples, 2 lb).

## [0.1.4-alpha] - 2026-11-14 (alpha)

Fixes from the QA gate on 0.1.3-alpha (7c1a626). Still alpha; prices are a saved household
snapshot, not official checkout prices.

### Fixed
- **M2 – line totals respect the unit.** One function (`linePrice` in `src/list.js`) now prices a
  line for the list rows, the running total, the CSV and the text export:
  - sold-by-weight items with a weight quantity use the per-lb price (2 lb at $3.99/lb = $7.98,
    not 2 × the estimated piece price); lb, oz, g and kg convert into each other;
  - package items with a weight or volume quantity use the unit price when it converts (marked ~);
  - when no compatible unit price exists the line shows one package price marked ~ instead of an
    invented number; count quantities ("3", "2 ea", "1 pkg") are a package count.
  - Adding the same product again only merges into a line with the same unit.
- **M3 – typo search against word prefixes.** One edit is allowed against a word or its prefixes
  of length ±1, so "bananna" finds Bananas (ranked at or above Banana Bread). Add-bar suggestions
  use the same matcher.
- **L12** – the struck regular price next to a sale estimate is on the same basis (per estimated
  piece for by-weight items, per line on the list), not the per-lb price.
- **L13** – stricter matching for short words: subsequences need 3+ letters and the same first
  letter (word start), typo matching needs 5+ letters and only runs when nothing matches exactly
  or by prefix. "rice" no longer matches Ice Cream or "price"; "chkn brst" still works.
- **L14** – prices up to $999,999.99 are kept (rows at $1M or more are dropped as bad data);
  money shows thousands separators ($1,234.56); quantities are capped at 9,999.
- **L15** – every form control is 16px on phones, including the Shop store dropdown, so iOS
  Safari no longer zooms on focus.
- **L16** – a damaged price file (bad gzip or JSON after decrypting) now says so ("The price file
  is damaged (gzip)") in the console and on the unlock card instead of "Failed to fetch"; nothing is
  cached for an unreadable file. Note: if the manifest is published ahead of `prices.enc`, the
  browser itself still logs the 404 for that request; the app handles it and stays usable.
- **L17** – the Qty field in the add sheet is at least 44px wide at 360px.
- Shop render is faster: money formatting reuses one number formatter.

## [0.1.3-alpha] - 2026-11-14 (alpha)

Prices move into the shopping flow. Everything below is alpha; prices are a saved household
snapshot, not official checkout prices.

### Added
- **Shop** tab (List · Shop · Favorites · Stores · Ads; shown only when a price feed is published).
  Unlock once with the household passphrase, then:
  - a **store dropdown** listing only stores that have price data (from the feed's `stores[]` and
    the items' chain + store id). The choice is remembered on this device in
    `shopsmartr:shopStore:v1`; if that store leaves the feed, the first available store is used.
  - a **sticky search** under the dropdown that filters as you type (~150 ms debounce), scoped to the
    selected store. Matches names, brands, categories and departments; every word must match as an
    exact word, a prefix, a subsequence ("chkn brst" → chicken breast) or with one typo for words of
    4+ letters ("bananna"). Ranked exact > prefix > subsequence > typo, name > brand > department.
    The clear (×) button empties the box and keeps focus there.
  - department chips and department cards with counts for the selected store, an **On sale this
    week** list built from real sale items (no made-up popularity), 50 results per page with
    "Show more", and a no-results state with "Add “…” without price".
  - an **item sheet** (bottom sheet on phones, dialog on desktop): size, price, Sale badge with the
    regular price struck through, unit price, aisle, store, a quantity stepper and Add to list.
- **Priced list rows**: items added from Shop or a suggestion keep the price, unit price, aisle, SKU
  and the source store (chain, store number) they were added from. Rows show that price and store
  tag; changing the Shop store later never changes them. Adding the same product again bumps the qty.
- **Running total**: sticky bar above the tabs on phones, in the list header on desktop. Est. total
  (all priced items), In cart (checked), Left (unchecked), and how many items are priced/unpriced.
  By-weight items use an estimate (unit price × typical weight) and show "~".
- **Price suggestions** under the add bar (desktop) and in the add sheet (phones): up to 5 matches
  from the selected store plus "Add “…” without price". Arrow keys + Enter pick one; plain Enter
  still adds free text. Same matcher as Shop search.
- CSV export gains Price each, Line total, Estimate, Unit price, Aisle, SKU, Price from and Prices as
  of columns; the text export shows line prices and the totals.
- Price feed envelope **v2** (gzip inside, `aad` binds `z=gzip`) alongside v1, and document schema
  `shopsmartr.prices/2`. Decrypt, gunzip, parse, compact column store and token index run in a
  module Worker (main-thread fallback). Only the key is cached (IndexedDB); the decrypted catalog
  is never stored.

### Changed
- The old price snapshot section on Weekly ads is gone; prices live in Shop.

### Fixed
- L10: export file names use the local date, not the UTC date.
- L11: a list row's quantity stays on the same line as the end of a long name, so a wrapped row
  never starts with "· 1".
- The Favorites Items/Meals tabs and the favorite/meal add inputs are 44 px tall.

## [0.1.2-alpha] - 2026-11-14 (alpha)

Fixes for the v0.1.1 QA recheck (M1, L8, L9).

### Fixed
- M1: long meal names no longer push the page wider than the phone. The meal header is a
  `minmax(0, 1fr) auto` grid, so the name wraps (the full name is also in the button's title) and
  "Add meal" always stays on screen. The `.meals` grid uses `minmax(0, 1fr)`.
- Overflow sweep for similar rows: list and favorite rows wrap long unbroken names; store rows wrap
  long names and addresses; list group headers ellipsize long store names (full name in the
  title); chips ellipsize instead of overflowing; desktop grid columns use `minmax(0, 1fr)`; the
  toast is centred without `translateX`, so a long message wraps and its Undo button stays on screen.
- L8: unreadable favorites are copied to `shopsmartr:favorites:v1.bak` and a notice says so, the same as
  the list. Notices now stack when more than one applies, and favorites saves also warn when the
  browser blocks storage.
- L9: love notes rewritten to be fact-free. 67 notes that assumed kids, pets, a house, places,
  holidays or shared history were replaced, along with the near-duplicates and odd wording from QA.
  Still 321 notes, 102 (32%) with Lauren's name. New tests enforce a banned-word list and a
  word-similarity limit.

## [0.1.1-alpha] - 2026-11-14 (alpha)

Fixes for the v0.1.0 QA gate (low findings L1–L7) plus Favorites and love notes.

### Added
- **Favorites** screen (new tab) with **Items** (weekly staples: add, edit name/qty/unit/store/note,
  remove with Undo, one-tap add to the list, "Add all favorites to this week's list") and **Meals**
  (named groups of items: create, rename, edit items, delete with Undo, one-tap "Add meal").
  Adding skips anything already on the list and unchecked, and a toast gives the counts.
  Model in `src/favorites.js`; saved in `localStorage` (`shopsmartr:favorites:v1`).
- Favorites export: a `== Favorites ==` section in the text export and a separate favorites CSV.
- Phase-2 hook `starRecipe()` that turns a recipe into a meal (not used by the UI yet).
- **Love notes**: a small note from Steven to Lauren at the top of the ⋮ menu, changing each time it
  opens. 321 notes in `src/notes.js`; shuffled no-repeat cycle in `src/lovenotes.js`.
- Favicon and Apple touch icon from Designer's ShopSmartR refresh icon (`favicon.ico`, `icons/`).
- `data/prices.json` price-feed manifest.

### Fixed
- L1: no console errors on load. The app reads `data/prices.json` and only requests `data/prices.enc`
  when the manifest says a feed exists; added the favicon so `/favicon.ico` no longer 404s.
- L2: "Hours & info" link now has a 44 px tall tap target.
- L3: editing an item with no quantity no longer sets it to 1.
- L4: checking an item (and other row actions) keeps keyboard focus on the same control; after a
  remove, focus moves to the next row.
- L5: unreadable saved data is copied to `shopsmartr:v1.bak` and a notice explains it; a notice also
  warns when the browser won't let the list be saved.
- L6: CSV downloads start with a UTF-8 BOM so Excel shows accents and emoji correctly.
- L7: clearing the zip and pressing Enter clears the old results.
- Enter in a sheet's text field now saves instead of closing the sheet (close buttons are no longer
  the form's default submit button).
- `package.json` test script quoting (`npm test` works again).

## [0.1.0-alpha] - 2026-11-14 (alpha)

First phase-1 build.

### Added
- Curated Western NY store directory (`data/stores.json`, as of 2026-11-14): 62 Tops, 11 Wegmans,
  21 ALDI (unconfirmed), 2 Trader Joe's, each with an official store or locator link.
- Census ZCTA centroid table for NY 140xx–149xx zips (`data/zips.json`) and haversine radius search.
- Stores screen: zip, 5/10/25 mi distance, chain filter, multi-select nearby stores.
- Shopping list: add (desktop quick-add bar with "2 lb apples" parsing; mobile add sheet), edit,
  check off (items stay in place, struck through), remove with Undo, quantity/unit, notes, store
  tag, per-store groups and filter, progress banner. Saved in `localStorage`.
- Export menu: CSV download, text download, copy as text, Web Share (where supported),
  uncheck all, clear checked items (with Undo).
- Weekly ads screen linking to each chain's official ad page only.
- Phase-1 design (light default, automatic dark variant via `prefers-color-scheme`).
- Optional encrypted price snapshot (`src/prices.js`), compatible with `decryptJSON` from
  shopsmartr-data: PBKDF2-SHA256 (600k) + AES-GCM-256 with AAD. A one-time passphrase unlock, keys
  cached on the device, a "wrong passphrase" message, and "Forget passphrase". The UI is hidden when
  `data/prices.enc` is absent. No price data or passphrase is in the repo (the test fixture is fake).
- Weekly data-check workflow (`ci/data-check.yml`, Sunday 12:00 UTC): validates the data files and
  runs the tests, with no crawling. Not active until it's moved into `.github/workflows/`.
- Unit tests (`node --test`): zip/radius, list model, quick-add parser, persistence, CSV/text export
  escaping, data schema, price-envelope crypto and unlock flow.
