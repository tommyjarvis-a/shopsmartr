# Changelog

All notable changes to ShopSmartR. This project is in **alpha**; data and UI may change.

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
