# P5 -- Cross-package API consistency

## Goal

Resolve three boundary inconsistencies that today force consumers to
translate between near-identical names or live with silent data loss in
round-trips.

## Files

- `packages/core/src/guid.ts` -- widen `isValidGuid` to accept either case.
- `packages/core/src/guid.test.ts` -- add an uppercase / mixed-case
  acceptance test.
- `packages/core/src/model.ts` -- (no change expected) `UnityPackageEntry`
  already carries `preview?: Uint8Array`.
- `packages/core/src/create.ts` -- accept `preview?: Uint8Array` on
  `CreateUnityPackageEntry`; emit `<guid>/preview.png` when present.
- `packages/core/src/create.test.ts` -- add a parse -> create -> parse
  round-trip test that asserts `preview` byte equality.
- `packages/core/src/pathname.ts` -- rename `PathnameRejectionReason`
  variant `'oversized-tar-entry'` to `'oversized-pathname-tar'` (matches the
  diagnostic code on the create side).
- `packages/core/src/create.ts` -- emit distinct codes
  `'oversized-pathname'` (200-char rule) vs `'oversized-pathname-tar'`
  (100-byte tar entry name rule).
- `apps/web/src/packageModel.ts` `validatePackDraft` -- drop the
  `oversized-tar-entry` -> `oversized-pathname` translation step; consume
  whatever code core emits.
- `packages/cli/src/commands/pack.ts` -- same; surface the core code
  directly in CLI output.

## Surface

Breaking. After this phase:

- `isValidGuid('ABCDEF1234567890ABCDEF1234567890')` returns `true`.
- `createMinimalMeta(uppercaseGuid)` and `createMinimalMetaFor(...)` no
  longer throw on uppercase input -- they lowercase internally before
  emitting the template (round-trip identity is preserved).
- `CreateUnityPackageEntry` has an optional `preview: Uint8Array` field.
  When present, `tryCreateUnityPackage` writes `<guid>/preview.png` to the
  tar.
- `CreateUnityPackageDiagnosticCode` includes both `'oversized-pathname'`
  and `'oversized-pathname-tar'`. `PathnameRejectionReason` matches.

### Open call

For the diagnostic code split, two options:

- **(A) Split into two distinct codes** -- `'oversized-pathname'`
  (200-char) and `'oversized-pathname-tar'` (100-byte tar). Most precise;
  consumers can surface different messages. Default.
- **(B) Collapse to one `'oversized-pathname'`** -- both checks raise the
  same code with different messages. Simpler API; consumers lose the
  ability to discriminate.

Pick (A) unless the user requests (B) during apply.

### Specifics

1. `isValidGuid`: change the pattern from `/^[0-9a-f]{32}$/` to
   `/^[0-9a-fA-F]{32}$/`. Update the JSDoc to call out that the function
   accepts either case and downstream emitters lowercase internally.
   Lowercase the input inside `createMinimalMeta`, `createMinimalMetaFor`,
   `createMinimalFolderMeta`, and `writeMetaGuid` (P4) before string
   interpolation -- the emitted YAML must always carry lowercase guids.

2. `CreateUnityPackageEntry.preview`: when present, `tryCreateUnityPackage`
   emits a `<guid>/preview.png` tar member alongside `<guid>/asset.meta`
   and `<guid>/asset`. Member order: `pathname`, `asset.meta`, `asset`
   (existing order preserved), then `preview.png` last. This keeps the
   tar layout deterministic for callers that did not opt in.

3. The 100-byte tar entry name check in `tryCreateUnityPackage` needs to
   account for `<guid>/preview.png` (17 bytes overhead + 32 guid + 1 slash =
   50 bytes; not the worst case, `<guid>/asset.meta` at 43 bytes overhead
   is still worse, so existing check stays correct, but the check site
   should mention preview in the worst-case set for future-proofing).

4. Diagnostic codes:
   - Rename `pathname.ts` `PathnameRejectionReason = 'oversized-tar-entry'`
     to `'oversized-pathname-tar'`.
   - Change `create.ts` so the 100-byte tar name check emits
     `code: 'oversized-pathname-tar'` (was `'oversized-pathname'` until
     today) and the 200-char body check keeps `code: 'oversized-pathname'`.
   - Update `CreateUnityPackageDiagnosticCode` to include both literals.

5. Consumer cleanups:
   - `apps/web/src/packageModel.ts` `validatePackDraft`: drop the
     `pathVal.reason === 'oversized-tar-entry'` branch that re-emits as
     `'oversized-pathname'`. Map the two reasons to two pack-draft codes:
     `'oversized-pathname'` and `'oversized-pathname-tar'` (extend
     `PackDraftDiagnosticCode`).
   - `packages/cli/src/commands/pack.ts`
     `formatCreateDiagnostic`: should already work with the new codes
     since it only stringifies; verify the CLI output reads naturally.

## Exit criteria

- `bun run check` passes.
- `cd apps/web && bunx playwright test` passes.
- Round-trip assertion (parse -> create -> parse) preserves `preview` bytes
  exactly for at least one fixture that has previews
  (`fixtures/static/editor-packed.unitypackage`).
- `isValidGuid('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')` returns true; the
  emitted meta YAML still contains a lowercase `guid:` line.
- No consumer translates `'oversized-tar-entry'` to `'oversized-pathname'`;
  both consumers surface the core code directly.
- `CreateUnityPackageEntry.preview` is documented in the README's create
  section.
