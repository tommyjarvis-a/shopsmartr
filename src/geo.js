// Pure geography helpers: zip lookup, haversine distance, radius filter.
const EARTH_RADIUS_MI = 3958.7613;
const toRad = (d) => (d * Math.PI) / 180;

/** Great-circle distance in miles between {lat, lon} points. */
export function haversineMiles(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Returns a 5-digit zip string or null. Accepts "14221" and "14221-1234". */
export function normalizeZip(input) {
  const m = /^\s*(\d{5})(?:-\d{4})?\s*$/.exec(String(input ?? ''));
  return m ? m[1] : null;
}

/** Look up a zip centroid in a zips table ({ "14221": [lat, lon] }). */
export function lookupZip(zip, zipTable) {
  const z = normalizeZip(zip);
  const hit = z && zipTable ? zipTable[z] : null;
  return hit ? { zip: z, lat: hit[0], lon: hit[1] } : null;
}

/**
 * Stores within radiusMi of origin, nearest first, each with a `distanceMi`.
 * Optional chains: array of chain ids to keep (empty/undefined = all).
 */
export function storesNear(stores, origin, radiusMi, chains) {
  const keep = chains && chains.length ? new Set(chains) : null;
  return stores
    .filter((s) => (!keep || keep.has(s.chain)) && Number.isFinite(s.lat) && Number.isFinite(s.lon))
    .map((s) => ({ ...s, distanceMi: haversineMiles(origin, s) }))
    .filter((s) => s.distanceMi <= radiusMi)
    .sort((a, b) => a.distanceMi - b.distanceMi || a.name.localeCompare(b.name));
}

/** Nearest store per chain (within radius) — handy for "closest of each". */
export function nearestPerChain(nearby) {
  const out = {};
  for (const s of nearby) if (!out[s.chain]) out[s.chain] = s;
  return out;
}
