# Changelog

All notable changes to ShopSmartR. This project is in **alpha**; data and UI may change.

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

 - 2026-11-14 (alpha)

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
