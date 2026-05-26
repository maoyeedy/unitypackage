# P3 -- Collapse parse API surface

## Goal

Reduce the public parse API to one buffered function with optional
`chunkSize`, and one iterator. Rename the iterator to reflect that it does
not actually stream gzip or tar. Drop the misleading `bytesRead` /
`bytesTotal` fields from the progress event.

## Files

- `packages/core/src/parse.ts` -- collapse `parseUnityPackageStreamed` into
  `parseUnityPackageEntries(data, { chunkSize?, ... })`; rename
  `parseUnityPackageStream` to `iterUnityPackageEntries`.
- `packages/core/src/index.ts` -- update the re-export list.
- `packages/core/src/parse.test.ts` -- rename test groups and assert that
  `chunkSize` is honored by `parseUnityPackageEntries`.
- `apps/web/src/parsePackage.worker.ts` -- call the single
  `parseUnityPackageEntries` (since the streamed / entries split is gone).
  P1 has already removed the try/catch fallback.
- `packages/core/README.md` -- update the three function-reference sections.
- `docs/reference/format.md` -- update the parser bullet that lists the
  four parse functions.

## Surface

Breaking. After this phase:

- `parseUnityPackageEntries(data, options?)` is the only buffered entry
  point. `options` includes `maxOutputBytes`, `maxEntries`, `chunkSize`.
- `iterUnityPackageEntries(bytes, options?)` is the generator that yields
  entries and diagnostics. Same `options` shape. `onProgress` is
  `(event: { entryCount: number }) => void` only.
- `parseUnityPackageStreamed` -- removed.
- `parseUnityPackageStream` -- removed (renamed to
  `iterUnityPackageEntries`).
- `StreamParseProgressEvent.bytesRead` and `.bytesTotal` -- removed.

The flat alias `parseUnityPackage` stays as-is (small surface, no harm).

### Open call

The rename `parseUnityPackageStream -> iterUnityPackageEntries` is the
default. Alternative: keep `parseUnityPackageStream` with sharpened JSDoc
that says it is a synchronous-generator over an already-buffered tar parse
(no memory streaming). If the user objects to the rename during apply,
fall back to the kept-name option and add the docstring instead.

### Specifics

1. Delete `parseUnityPackageStreamed` from `packages/core/src/parse.ts`.
   Move its `chunkSize` option onto `ParseUnityPackageOptions`.

2. Update `parseUnityPackageEntries` to accept the optional `chunkSize`
   (default 256 KiB to match the prior `gunzipBounded` default; the prior
   `parseUnityPackageStreamed` default of 64 KiB is dropped). Both
   `parseUnityPackageEntries` and `iterUnityPackageEntries` route through
   the same `gunzipBounded(data, maxOutputBytes, chunkSize)` call.

3. Rename `parseUnityPackageStream` to `iterUnityPackageEntries`. Update
   its JSDoc to call out:
   - gzip and tar are fully buffered before the generator yields the first
     entry;
   - the only "stream" is iteration over an already-decoded entry list;
   - the function exists for callers that want incremental UI updates
     between entries, not memory bounding.

4. Drop `bytesRead` and `bytesTotal` from `StreamParseProgressEvent`.
   Remove the `Date.now()` throttle in the generator; emit
   `onProgress({ entryCount })` once per entry (cheap; consumers can
   throttle on their side if needed).

5. Update `apps/web/src/parsePackage.worker.ts` to call
   `parseUnityPackageEntries` directly. The worker's progress reporting
   was not consuming `bytesRead`, so no UI change.

6. Update `packages/core/README.md` and `docs/reference/format.md` to
   reflect three parse entry points: `parseUnityPackage` (flat alias),
   `parseUnityPackageEntries`, `iterUnityPackageEntries`.

## Exit criteria

- `bun run check` passes.
- `cd apps/web && bunx playwright test` passes.
- `packages/core/src/index.ts` exports `parseUnityPackage`,
  `parseUnityPackageEntries`, and `iterUnityPackageEntries`. No
  `parseUnityPackageStreamed`. No `parseUnityPackageStream` (unless the
  open-call fallback was chosen).
- `StreamParseProgressEvent` (renamed to e.g. `IterEntriesProgressEvent`)
  has only an `entryCount` field.
- `packages/core/README.md` and `docs/reference/format.md` match the new
  API; no broken references.
- A `parseUnityPackageEntries(bytes, { chunkSize: 8 })` test exists and
  asserts the same result as the default-chunkSize call against the same
  input.
