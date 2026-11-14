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
| `src/prices.js` | Optional encrypted price snapshot: decrypt, unlock and key cache (see below). |
| `src/ui.js` | DOM rendering from the templates. |
| `src/app.js` | Wiring: loads data, owns state, routes `#list` / `#stores` / `#ads`. |

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

## Optional encrypted price snapshot

The Weekly ads screen can show a household price snapshot from `data/prices.enc`. That file is
produced and published outside this repo (by Steven, on his own machine). The app never fetches a
retailer site; it only reads its own `data/prices.enc` if one exists. With no file, the price UI is
hidden.

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
