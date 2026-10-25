// Hard gzip budgets for the Pages entry assets. Run after `npm run build`.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

const dist = 'dist';
const assets = join(dist, 'assets');

/** Soft KiB ceilings (~20% above R5 measured: JS ~250 KB gzip, CSS ~17 KB gzip). */
const BUDGET = {
  js: 320 * 1024,
  css: 40 * 1024,
};

function kib(n) {
  return `${(n / 1024).toFixed(1)} KiB`;
}

if (!existsSync(assets)) {
  console.error('dist/assets not found; run npm run build first');
  process.exit(1);
}

const names = readdirSync(assets);
const entryJs = names.find((n) => /^index-.*\.js$/.test(n));
const entryCss = names.find((n) => /^index-.*\.css$/.test(n));
if (!entryJs || !entryCss) {
  console.error('entry index-*.js / index-*.css not found in dist/assets');
  process.exit(1);
}

const rows = [
  { kind: 'js', file: join(assets, entryJs), max: BUDGET.js },
  { kind: 'css', file: join(assets, entryCss), max: BUDGET.css },
];

let failed = false;
for (const r of rows) {
  const raw = readFileSync(r.file);
  const gz = gzipSync(raw).length;
  const line = `${r.file}: raw ${kib(raw.length)}, gzip ${kib(gz)} (budget ${kib(r.max)})`;
  if (gz > r.max) {
    console.error(`OVER BUDGET ${line}`);
    failed = true;
  } else {
    console.log(line);
  }
}

if (failed) process.exit(1);
console.log('bundle OK');
