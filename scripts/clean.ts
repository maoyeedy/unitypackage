import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname!, '..');

const targets: string[] = [
  'packages/core/dist',
  'packages/cli/dist',
  'packages/cli/assets/web',
  'apps/web/dist',
  'apps/web/dev-dist',
  'fixtures/dist',
  'fixtures/generated',
  'coverage',
];

const tsbuildinfos = [
  'packages/core/tsconfig.tsbuildinfo',
  'packages/core/tsconfig.esm.tsbuildinfo',
  'packages/cli/tsconfig.tsbuildinfo',
  'fixtures/tsconfig.tsbuildinfo',
  'apps/web/tsconfig.tsbuildinfo',
  'apps/web/tsconfig.app.tsbuildinfo',
  'apps/web/tsconfig.node.tsbuildinfo',
];

const tarballs = ['*.tgz'];

let removed = 0;

for (const rel of targets) {
  const abs = path.join(root, rel);
  if (fs.existsSync(abs)) {
    fs.rmSync(abs, { recursive: true, force: true });
    console.log(`Removed: ${rel}/`);
    removed++;
  }
}

for (const rel of tsbuildinfos) {
  const abs = path.join(root, rel);
  if (fs.existsSync(abs)) {
    fs.rmSync(abs, { force: true });
    console.log(`Removed: ${rel}`);
    removed++;
  }
}

for (const pattern of tarballs) {
  const dir = path.dirname(path.join(root, pattern));
  if (!fs.existsSync(dir)) continue;
  for (const entry of fs.readdirSync(dir)) {
    if (entry.endsWith('.tgz')) {
      const abs = path.join(dir, entry);
      fs.rmSync(abs, { force: true });
      console.log(`Removed: ${entry}`);
      removed++;
    }
  }
}

if (removed === 0) {
  console.log('Nothing to clean.');
} else {
  console.log(`Cleaned ${removed} target(s).`);
}
