// Module Worker: decrypt + gunzip + JSON.parse + normalise + index, off the main thread.
// Receives { id, env, key } (key is a non-extractable CryptoKey, structured-cloned).
// Replies { id, ok: true, catalog, index, ms } or { id, ok: false, wrong, message }.
import { decryptWithKey, WrongPassphraseError, FeedFormatError } from './prices.js';
import { prepare } from './catalog.js';

self.onmessage = async (e) => {
  const { id, env, key } = e.data;
  const t0 = performance.now();
  try {
    const steps = {};
    const doc = await decryptWithKey(env, key, undefined, steps);
    const { catalog, index, ms } = prepare(doc, () => performance.now());
    const c = catalog.cols;
    const transfer = [c.price, c.regular, c.unitPrice, c.approxLb, c.flags, c.dept, c.store, index.offsets, index.flat, index.alpha, ...index.byDept].map((a) => a.buffer);
    self.postMessage({ id, ok: true, catalog, index, ms: { ...steps, ...ms, worker: performance.now() - t0 } }, transfer);
  } catch (err) {
    self.postMessage({ id, ok: false, wrong: err instanceof WrongPassphraseError, format: err instanceof FeedFormatError, message: String(err?.message || err) });
  }
};
