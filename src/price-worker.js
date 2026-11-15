// Module Worker: decrypt + gunzip + JSON.parse + normalise + index, off the main thread.
// Receives { id, env, key } (key is a non-extractable CryptoKey, structured-cloned).
// Replies { id, ok: true, catalog, index, ms } or { id, ok: false, wrong, message }.
import { decryptWithKey, WrongPassphraseError, FeedFormatError } from './prices.js';
import { prepare } from './catalog.js';
import { prepareRecipes } from './recipes.js';

self.onmessage = async (e) => {
  const { id, env, key, kind } = e.data;
  const t0 = performance.now();
  try {
    const steps = {};
    const doc = await decryptWithKey(env, key, undefined, steps);
    if (kind === 'recipes') {   // v0.2.0: decrypt + validate the recipe snapshot
      const t1 = performance.now();
      const recipes = prepareRecipes(doc);
      self.postMessage({ id, ok: true, recipes, ms: { ...steps, prepare: performance.now() - t1, worker: performance.now() - t0 } });
      return;
    }
    const { catalog, index, ms } = prepare(doc, () => performance.now());
    const c = catalog.cols;
    const transfer = [c.price, c.regular, c.unitPrice, c.approxLb, c.flags, c.dept, c.store, index.offsets, index.flat, index.alpha, ...index.byDept].map((a) => a.buffer);
    self.postMessage({ id, ok: true, catalog, index, ms: { ...steps, ...ms, worker: performance.now() - t0 } }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, wrong: err instanceof WrongPassphraseError, format: err instanceof FeedFormatError, message: String(err?.message || err) });
  }
};
