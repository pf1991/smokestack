// Fails if the built site references an absolute "/" asset path (breaks under a Pages subpath),
// if landing assets are missing, or if the entry JS/CSS gzip budgets are exceeded.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const dist = 'dist';
const bad = /src="\/|href="\/|url\(\/|url\(["']\//;
const required = ['index.html', 'favicon.svg', 'og.png'];

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : [p];
  });
}

if (!existsSync(join(dist, 'index.html'))) {
  console.error('dist/index.html not found; run npm run build first');
  process.exit(1);
}

const missing = required.filter((f) => !existsSync(join(dist, f)));
if (missing.length) {
  console.error('Missing landing assets in dist/: ' + missing.join(', '));
  process.exit(1);
}

const files = [join(dist, 'index.html'), ...walk(dist).filter((f) => f.endsWith('.css'))];
const hits = [];
for (const f of files) {
  readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
    if (bad.test(line)) hits.push(`${f}:${i + 1}: ${line.trim().slice(0, 200)}`);
  });
}
if (hits.length) {
  console.error('Absolute asset paths found:\n' + hits.join('\n'));
  process.exit(1);
}
console.log('dist OK');

const here = dirname(fileURLToPath(import.meta.url));
const bundle = spawnSync(process.execPath, [join(here, 'check-bundle.mjs')], { stdio: 'inherit' });
if (bundle.status !== 0) process.exit(bundle.status ?? 1);
