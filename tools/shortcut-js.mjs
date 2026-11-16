// Prints the JavaScript for the "Happy Wife Import" iOS Shortcut's "Run JavaScript on Web Page" action.
// Usage: node tools/shortcut-js.mjs [appUrl]   (default: the live app). See docs/import-shortcut.md.
import { shortcutScript } from '../src/importer.js';
import { LIVE_URL } from '../src/brand.js';
process.stdout.write(`${shortcutScript(process.argv[2] || LIVE_URL)}\n`);
