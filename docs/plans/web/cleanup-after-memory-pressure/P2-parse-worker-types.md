# P2 -- parse worker: drop `WorkerHeavyRecord` + casts; Set-based transfer [DONE 2026-05-27]

Shipped: deleted `WorkerHeavyRecord` and updated `entriesToRecords` to return `{ records, contents }`.
Optimized: replaced `transfer.includes` array check with `Set<ArrayBuffer>` lookup in `parsePackage.worker.ts`.
Cleaned up: removed redundant `as unknown as` and `as Record<string, Uint8Array<ArrayBuffer>>` type casts.
