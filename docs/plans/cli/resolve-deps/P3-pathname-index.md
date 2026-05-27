## Goal  [DONE 2026-05-27]

Shipped: created `packages/depgraph/src/pathnameIndex.ts` (buildPathnameIndex with recursive walk, IndexStats, AbortSignal support, SKIP_DIRS filtering); modified `packages/depgraph/tsconfig.json` (added `"types": ["node"]`); created `packages/depgraph/src/pathnameIndex.test.ts` (5 tests covering valid indexing, relative paths, duplicate GUID counting, malformed-meta resilience, directory skipping). All tests pass.
