// Fails if the built site references an absolute "/" asset path (breaks under a Pages subpath).
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dist = 'dist';
const bad = /src="\/|href="\/|url\(\/|url\(["']\//;

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
