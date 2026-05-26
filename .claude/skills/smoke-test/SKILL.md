---
name: smoke-test
description: Build CLI then run all manual smoke commands against editor-packed.unitypackage. Reports pass/fail per command.
disable-model-invocation: true
---

```bash
set -e
cd /home/maoyeedy/Repos/unitypackage-workspace/unitypackage

echo "=== build:cli ==="
bun run build:cli

echo "=== inspect --json ==="
node packages/cli/dist/bin.js inspect "fixtures/static/editor-packed.unitypackage" --json

echo "=== verify ==="
node packages/cli/dist/bin.js verify "fixtures/static/editor-packed.unitypackage"

echo "=== extract ==="
rm -rf /tmp/unitypackage-extract-test
node packages/cli/dist/bin.js extract "fixtures/static/editor-packed.unitypackage" /tmp/unitypackage-extract-test

echo "=== fixtures-build ==="
node scripts/fixtures-build.ts

echo "=== DONE ==="
```
