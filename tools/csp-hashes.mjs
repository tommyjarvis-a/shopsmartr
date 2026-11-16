// v0.2.6: prints the sha256 CSP sources for index.html's inline scripts (run after editing one, then
// update the Content-Security-Policy meta). test/v026.test.mjs fails when they don't match.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
export function inlineScriptHashes(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => `'sha256-${createHash('sha256').update(m[1], 'utf8').digest('base64')}'`);
}
if (import.meta.url === `file://${process.argv[1]}`) console.log(inlineScriptHashes(readFileSync(new URL('../index.html', import.meta.url), 'utf8')).join(' '));
