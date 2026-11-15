# ShopSmartR

Pick your nearby grocery stores in Western New York and keep one shopping list across them.
**Version 0.1.0-alpha.** Phase 1: stores, list, and links to weekly ads.

- Client-side only: plain HTML, CSS and ES modules. No backend, no build step, no tracking.
- Your list stays in your browser (`localStorage`). Export it as CSV or text.
- Chains: Tops Friendly Markets, Wegmans, ALDI, Trader Joe's.

> ShopSmartR is not affiliated with, endorsed by, or sponsored by Tops, Wegmans, ALDI, or Trader Joe's.
> It does not show official checkout prices. Confirm hours and prices with the store.

## Run locally

```sh
python3 -m http.server 8080    # then open http://localhost:8080
node --test "test/*.test.mjs"  # unit tests (Node 20+)
node tools/validate-data.mjs   # data check (same as CI)
```

## How it works

| File | Role |
|---|---|
| `index.html` | All markup: screens (list, stores, weekly ads), the add/edit sheet, the export menu, and `<template>`s for rows. |
| `tokens.css` | Design tokens (colour, type, spacing, radii, shadows), light and dark. |
| `style.css` | Components and responsive layout. No inline styles in the markup. |
| `src/geo.js` | Zip lookup, haversine distance, radius filter (pure). |
| `src/stores.js` | Store directory schema validation (pure; also used by CI). |
| `src/list.js` | Shopping-list model and quick-add parser (pure, immutable updates). |
| `src/storage.js` | Versioned `localStorage` persistence with safe fallback. |
| `src/export.js` | CSV (RFC 4180, formula-injection guard) and plain-text builders. |
| `src/favorites.js` | Favorites model: staple items, meals, dedupe when adding to the list, persistence, `starRecipe()` hook for phase 2 (pure). |
| `src/notes.js`, `src/lovenotes.js` | The love notes shown in the ⋮ menu, and the shuffled no-repeat cycle that picks them. |
| `src/prices.js` | Optional encrypted price snapshot: decrypt, unlock and key cache (see below). |
| `src/ui.js` | DOM rendering from the templates. |
| `src/app.js` | Wiring: loads data, owns state, routes `#list` / `#favorites` / `#stores` / `#ads`. |

Reskinning touches `tokens.css`, `style.css` and the markup in `index.html`; the logic modules don't
change. The renderer finds elements by `id` and `data-*` hooks, so keep those when restyling.

## Store data

`data/stores.json` is curated by hand (as of **2026-11-14**) for Erie, Niagara, Chautauqua,
Cattaraugus, Allegany, Genesee, Orleans and Wyoming counties.

| Chain | Stores | Source | Verified |
|---|---|---|---|
| Tops | 62 | Tops' official NY store locator page | Yes (store number, address). Zip/coordinates from the geocoders below. |
| Wegmans | 11 | Wegmans' public store list (Buffalo and Jamestown) | Yes |
| ALDI | 21 | A public local-news list of Western NY stores | **No** — shown as "unconfirmed" in the app. ALDI's locator is an Instacart-run page this project doesn't read. |
| Trader Joe's | 2 | locations.traderjoes.com store pages | Yes |

Coordinates: Wegmans' own list, the US Census Bureau Geocoder (public domain), and for six Tops
stores OpenStreetMap Nominatim (© OpenStreetMap contributors, ODbL); two of those are street-level
approximations and say so in `notes`. Zip centroids in `data/zips.json` are Census 2024 Gazetteer ZCTA
internal points (public domain).

**No scraping.** Nothing in this repo fetches retailer sites, Instacart, or Flipp, in the browser
or in CI. The weekly check (`ci/data-check.yml`) only validates the checked-in files. To update the directory, re-check
the official locator pages by hand and edit `data/stores.json` (bump `asOf`).

## Favorites

The Favorites screen has two tabs:

- **Items**: weekly staples (name, qty/unit, optional store tag and note). Each has a + button that
  puts it on the list, and "Add all favorites to this week's list" adds them all.
- **Meals**: named groups of items (create, rename, edit items, delete with Undo). "Add meal" puts
  every item on the list.

Adding never duplicates: a favorite is skipped when an item with the same name (ignoring case,
spacing and accents) is already on the list and **not checked**. A checked item counts as bought, so
the favorite is added again. A toast reports how many were added and skipped. Favorites are saved in
`localStorage` under `shopsmartr:favorites:v1`. If that value can't be read, it is copied to
`shopsmartr:favorites:v1.bak` and a notice says so, the same as the list (`shopsmartr:v1.bak`).

Export: "Download text" and "Copy as text" end with a `== Favorites ==` section (staples, then each
meal). "Favorites CSV" in the ⋮ menu (or Export on the Favorites screen) downloads a separate
`shopsmartr-favorites-YYYY-MM-DD.csv` with columns `Type, Meal, Item, Qty, Unit, Store, Notes`
(`Type` is `staple` or `meal`; an empty meal gets one row with just its name).

Phase-2 hook: `starRecipe(favorites, { id, title, url, ingredients: [{ name, qty, unit }] })` turns a
recipe into a meal tagged `source: { type: 'recipe', id, url }`; starring the same recipe again updates
that meal instead of adding a second one.

## Love notes

The ⋮ menu (Export on desktop) opens with a short note from Steven to Lauren in a small pink card.
There are 321 hand-written one-liners in `src/notes.js`; about a third use her name. They are shown in
a shuffled order saved in `localStorage` (`shopsmartr:notes:v1`), so none repeats until every note has
been shown, and a new shuffle never starts with the note you just saw. The repo is public, so keep
any additions sweet and family-friendly, and fact-free: nothing about kids, pets, a house, places,
holidays or shared history that may not be true. `test/notes.test.mjs` checks uniqueness, near-
duplicates, a banned-word list for those topics, the count (at least 300), the length and the named
share (25–40%).

## Optional encrypted price snapshot

The Weekly ads screen can show a household price snapshot from `data/prices.enc`. That file is
produced and published outside this repo (by Steven, on his own machine). The app never fetches a
retailer site. It first reads the small committed manifest `data/prices.json`:

```json
{ "schema": "shopsmartr.pricefeed/1", "available": false, "file": "prices.enc", "updated": null }
```

Only when `available` is `true` does it request `data/prices.enc`. With no feed, nothing is
requested, so there is no 404 in the console, and the price UI stays hidden. The publisher
(`publish.sh` in `shopsmartr-data`) writes `data/prices.json` with `"available": true` and the
publish time in the same commit as `data/prices.enc`.

`src/prices.js` matches `decryptJSON` in the private `shopsmartr-data` repo exactly:

- Envelope `{ "v": 1, "kdf": "PBKDF2-SHA256", "iter": 600000, "alg": "AES-GCM-256", "aad": "shopsmartr.prices.enc/v1", "salt", "iv", "ct" }`;
  `salt` (16 bytes), `iv` (12 bytes) and `ct` (ciphertext plus the 16-byte GCM tag) are standard base64.
- Key: PBKDF2-SHA256 over the NFC-normalised passphrase, then AES-GCM-256. Decryption uses the
  envelope's `aad` as additional data and a 128-bit tag. Envelopes under 600k iterations are refused.
- Unlock asks for the household passphrase once. The passphrase is never stored. The non-extractable
  PBKDF2 key and the derived AES key are cached in this browser's IndexedDB, so the snapshot stays
  unlocked after a refresh and after a new snapshot is published. "Forget passphrase" clears them.
  A wrong passphrase shows "Wrong passphrase. Please try again."

`test/fixtures/prices-fake.enc.json` was made with the reference `encryptJSON`, a throwaway passphrase
that appears in the test, and a **fake** payload. Never commit real price data or a real passphrase
(`data/prices.enc` is git-ignored here; publishing it is a deliberate step outside this repo).

## CI

`ci/data-check.yml` is the weekly workflow (Sunday 12:00 UTC: validate the data files, run the tests,
no crawling). It sits outside `.github/workflows/` because the push token used to create this repo
can't write workflow files. To turn it on, move it to `.github/workflows/data-check.yml` from an
account or token that has the `workflow` scope.

## License

MIT (see `LICENSE`). Steven can change the license at any time.
