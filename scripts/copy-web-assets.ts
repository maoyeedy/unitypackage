import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname!, '..');
const src = path.join(root, 'apps/web/dist');
const dest = path.join(root, 'packages/cli/assets/web');

if (!fs.existsSync(src)) {
  console.error(`Error: ${src} does not exist. Run 'bun run build:web' first.`);
  process.exit(1);
}

if (!fs.existsSync(path.join(src, 'index.html'))) {
  console.error(`Error: ${src}/index.html missing — web build may be incomplete.`);
  process.exit(1);
}

fs.rmSync(dest, { recursive: true, force: true });
fs.cpSync(src, dest, { recursive: true });

if (!fs.existsSync(path.join(dest, 'index.html'))) {
  console.error('Error: copy verification failed — index.html not found in dest.');
  process.exit(1);
}

console.log(`Copied ${src} → ${dest}`);
