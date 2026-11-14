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
| `src/prices.js` | Inert stub for a future encrypted price feed (see below). |
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
or in CI. The weekly Action only validates the checked-in files. To update the directory, re-check
the official locator pages by hand and edit `data/stores.json` (bump `asOf`).

## Future: encrypted price feed

`src/prices.js` can load `data/prices.enc`, a JSON envelope
`{ "v": 1, "kdf": "PBKDF2-SHA256", "iter": n, "salt": b64, "iv": b64, "ct": b64 }`, decrypt it with
WebCrypto AES-GCM using a key derived from a household passphrase, and cache the non-extractable key
on the device (IndexedDB). It is not used by the UI yet; with no file present nothing is shown.
Never commit real price data or a passphrase here (`data/prices.enc` is git-ignored).

## License

MIT (see `LICENSE`). Steven can change the license at any time.
