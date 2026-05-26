import fs from 'node:fs';
import path from 'node:path';
import {
  buildMinimal,
  buildNested,
  buildBinary,
  buildTraversal,
  buildDuplicateGuid,
  buildLegacyMetaData,
  buildTruncated,
} from '../fixtures/src/builders.js';

const root = path.resolve(import.meta.dirname!, '..');
const outDir = path.join(root, 'fixtures/generated');

fs.mkdirSync(outDir, { recursive: true });

const fixtures: Array<[string, () => Uint8Array]> = [
  ['minimal.unitypackage', buildMinimal],
  ['nested.unitypackage', buildNested],
  ['binary.unitypackage', buildBinary],
  ['traversal.unitypackage', buildTraversal],
  ['duplicate-guid.unitypackage', buildDuplicateGuid],
  ['legacy-metadata.unitypackage', buildLegacyMetaData],
  ['truncated.unitypackage', buildTruncated],
];

for (const [name, builder] of fixtures) {
  const outPath = path.join(outDir, name);
  fs.writeFileSync(outPath, builder());
  console.log(`Written: ${outPath}`);
}
