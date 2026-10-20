// Keeps the cache-busting query string in index.html in sync with package.json.
// `npm version` runs this automatically; `--check` (used by `npm run check`) only verifies.
import { readFile, writeFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const { version } = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const html = await readFile(new URL('index.html', root), 'utf8');
const stamped = html.replace(/\?v=[^"']+/g, `?v=${version}`);

if (process.argv.includes('--check')) {
  if (stamped !== html) {
    console.error(`index.html cache-buster does not match package.json version ${version}. Run: node scripts/stamp-version.mjs`);
    process.exit(1);
  }
} else if (stamped !== html) {
  await writeFile(new URL('index.html', root), stamped);
  console.log(`Stamped index.html with ?v=${version}`);
}
