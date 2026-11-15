# Changelog

All notable changes to ShopSmartR. This project is in **alpha**; data and UI may change.

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
