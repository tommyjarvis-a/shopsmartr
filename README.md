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
| `index.html` | All markup: screens (list, shop, favorites, stores, weekly ads), the item sheet, the add/edit sheet, the export menu, and `<template>`s for rows. |
| `tokens.css` | Design tokens (colour, type, spacing, radii, shadows), light and dark. |
| `style.css` | Components and responsive layout. No inline styles in the markup. |
| `src/geo.js` | Zip lookup, haversine distance, radius filter (pure). |
| `src/stores.js` | Store directory schema validation (pure; also used by CI). |
| `src/list.js` | Shopping-list model and quick-add parser (pure, immutable updates). |
| `src/storage.js` | Versioned `localStorage` persistence with safe fallback. |
| `src/export.js` | CSV (RFC 4180, formula-injection guard) and plain-text builders. |
| `src/favorites.js` | Favorites model: staple items, meals, dedupe when adding to the list, persistence, `starRecipe()` hook for phase 2 (pure). |
| `src/notes.js`, `src/lovenotes.js` | The love notes shown in the ⋮ menu, and the shuffled no-repeat cycle that picks them. |
| `src/prices.js` | Optional encrypted price feed: envelope v1/v2 (gzip), decrypt, unlock and key cache (see below). |
| `src/catalog.js` | Price catalog: compact columns, token index, store-scoped search/suggestions (exact, prefix, subsequence, one-typo), totals helpers (pure). |
| `src/price-worker.js`, `src/pricefeed.js` | Module Worker that decrypts, inflates, parses and indexes the feed off the main thread, and its main-thread glue/fallback. |
| `src/ui.js` | DOM rendering from the templates. |
| `src/app.js` | Wiring: loads data, owns state, routes `#list` / `#shop` / `#favorites` / `#stores` / `#ads`. |

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

## Optional encrypted price feed (Shop)

The Shop tab shows a household price snapshot from `data/prices.enc`. That file is produced and
published outside this repo (by Steven, on his own machine). The app never fetches a retailer site.
It first reads the small committed manifest `data/prices.json`:

```json
{ "schema": "shopsmartr.pricefeed/1", "available": true, "file": "prices.enc", "updated": "2026-11-15T02:12Z" }
```

Only when `available` is `true` does it request `data/prices.enc` (and show the Shop tab). With no
feed nothing is requested, so there is no 404. The publisher (`publish.sh` in `shopsmartr-data`)
writes the manifest in the same commit as `data/prices.enc`; it may add `dataSchema`, `envelope`,
`itemCount` and `complete`, which the app ignores.

`src/prices.js` matches `decryptJSON` in the private `shopsmartr-data` repo exactly:

- Envelope v1 `{ "v": 1, "kdf": "PBKDF2-SHA256", "iter": 600000, "alg": "AES-GCM-256", "aad": "shopsmartr.prices.enc/v1", "salt", "iv", "ct" }`
  (plain JSON inside), or v2 with `"z": "gzip"` and `"aad": "shopsmartr.prices.enc/v2;z=gzip"` (gzip inside,
  inflated with `DecompressionStream('gzip')`). The aad binds the compression flag, so stripping
  `z` fails authentication. `salt` (16 bytes), `iv` (12) and `ct` (ciphertext + 16-byte tag) are base64.
- Key: PBKDF2-SHA256 over the NFC-normalised passphrase, then AES-GCM-256 with a 128-bit tag.
  Envelopes under 600k iterations are refused.
- The document is `shopsmartr.prices/2` (`{schema, asOf, stores, crawl, items}`; v1 still loads).
  `src/catalog.js` slims items into compact columns and builds a token index once, in a Worker.
- Unlock asks for the household passphrase once. The passphrase is never stored. The non-extractable
  PBKDF2 key and the derived AES key are cached in IndexedDB, so Shop stays unlocked after a refresh
  and after a new snapshot is published. The decrypted catalog is only kept in memory.
  "Forget passphrase" clears the keys. A wrong passphrase shows "Wrong passphrase. Please try again."
- The Shop store choice is stored per device in `localStorage` (`shopsmartr:shopStore:v1`).

`test/fixtures/prices-fake.enc.json` (v1) and `test/fixtures/prices-v2-fake.enc.json` (v2, two fake
stores) were made with the reference `encryptJSON`, throwaway passphrases that appear in the tests,
and **fake** payloads. Never commit real price data or a real passphrase here.

## CI

`ci/data-check.yml` is the weekly workflow (Sunday 12:00 UTC: validate the data files, run the tests,
no crawling). It sits outside `.github/workflows/` because the push token used to create this repo
can't write workflow files. To turn it on, move it to `.github/workflows/data-check.yml` from an
account or token that has the `workflow` scope.

## License

MIT (see `LICENSE`). Steven can change the license at any time.
