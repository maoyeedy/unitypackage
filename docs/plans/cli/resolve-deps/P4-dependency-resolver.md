## Goal  [DONE 2026-05-27]

Shipped: new `packages/depgraph/src/dependencyResolver.ts` (BFS resolver with cycle detection via visited set, configurable maxDepth, external GUID skip, binary leaf skip, missing-file graceful continue). New `packages/depgraph/src/dependencyResolver.test.ts` (247 lines, Vitest, 6 exit criteria + edge cases: self-reference, missing asset, large depth). All exit criteria pass with 26 depgraph tests.
