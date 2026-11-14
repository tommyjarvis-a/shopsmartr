#!/usr/bin/env node
// Weekly CI check: validates the curated data files. Reads local files only; never fetches anything.
import { readFile } from 'node:fs/promises';
import { validateStoresDoc, countByChain } from '../src/stores.js';
import { lookupZip } from '../src/geo.js';

const root = new URL('../', import.meta.url);
const stores = JSON.parse(await readFile(new URL('data/stores.json', root), 'utf8'));
const zips = JSON.parse(await readFile(new URL('data/zips.json', root), 'utf8'));
const errs = validateStoresDoc(stores);
if (zips.schema !== 'shopsmartr.zips/1' || !zips.zips || Object.keys(zips.zips).length < 50) errs.push('zips.json missing or too small');
for (const [z, v] of Object.entries(zips.zips ?? {})) {
  if (!/^\d{5}$/.test(z) || !Array.isArray(v) || v.length !== 2 || !v.every(Number.isFinite)) { errs.push(`zips.json: bad row ${z}`); break; }
}
if (!lookupZip('14221', zips.zips)) errs.push('zips.json: 14221 missing');
const ageDays = (Date.now() - Date.parse(stores.asOf)) / 864e5;
if (errs.length) {
  console.error(`Data check FAILED (${errs.length} problem(s)):`);
  for (const e of errs) console.error(`  - ${e}`);
  process.exit(1);
}
const counts = countByChain(stores.stores);
const unverified = stores.stores.filter((s) => !s.verified).length;
console.log(`Data OK: ${stores.stores.length} stores ${JSON.stringify(counts)}, ${unverified} unconfirmed, ${Object.keys(zips.zips).length} zips, asOf ${stores.asOf}.`);
if (ageDays > 180) console.log(`::warning::stores.json asOf is ${Math.round(ageDays)} days old; consider re-checking the store directory by hand.`);
