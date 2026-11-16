/**
 * v0.2.6-alpha.1 (M11): the only remote images the app ever loads are Wegmans recipe photos from the
 * recipe feed, hotlinked from the host below. This list must match index.html's CSP img-src.
 * Imported (user) recipes never load a remote image: their photo URL is dropped on import.
 */
export const IMG_HOSTS = Object.freeze(['images.wegmans.com']);
const SAFE = /^https:\/\/([a-z0-9.-]+)\/[A-Za-z0-9\-._~%/?=&+,;:@!*()]*$/;
/** A feed photo URL -> the same URL when it is https on an allowed host with no odd characters, else null. */
export function feedImage(u) {
  if (typeof u !== 'string' || u.length > 600) return null;
  const m = SAFE.exec(u);
  if (!m || !IMG_HOSTS.includes(m[1])) return null;
  try { const p = new URL(u); return p.protocol === 'https:' && IMG_HOSTS.includes(p.hostname) && !p.username && !p.password && !p.port ? u : null; } catch { return null; }
}
