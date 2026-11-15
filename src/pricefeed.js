// Main-thread glue for the encrypted price feed: a decode() for prices.js unlock functions that runs
// the heavy work in src/price-worker.js, with a main-thread fallback when Workers are unavailable.
import { decryptWithKey, WrongPassphraseError } from './prices.js';
import { prepare } from './catalog.js';

export function makeDecoder() {
  let worker = null;
  try { worker = new Worker(new URL('./price-worker.js', import.meta.url), { type: 'module' }); } catch { worker = null; }
  let seq = 0;
  const pending = new Map();
  if (worker) {
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); p(e.data); } };
    worker.onerror = () => { for (const p of pending.values()) p({ ok: false, message: 'worker failed' }); pending.clear(); worker = null; };
  }
  async function onMain(env, key) {
    const steps = {};
    const doc = await decryptWithKey(env, key, undefined, steps);
    const r = prepare(doc, () => performance.now());
    return { ...r, ms: { ...steps, ...r.ms }, where: 'main' };
  }
  return async function decode(env, key) {
    if (!worker) return onMain(env, key);
    const id = (seq += 1);
    const res = await new Promise((resolve) => { pending.set(id, resolve); worker.postMessage({ id, env, key }); });
    if (res.ok) return { catalog: res.catalog, index: res.index, ms: res.ms, where: 'worker' };
    if (res.wrong) throw new WrongPassphraseError();
    if (res.message === 'worker failed') return onMain(env, key);
    throw new Error(res.message);
  };
}
