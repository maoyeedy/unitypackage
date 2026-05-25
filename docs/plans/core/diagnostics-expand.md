## Context

`parseUnityPackageEntries` returns a `.diagnostics` array alongside parsed entries.
Currently it covers only parse-layer structural issues (`malformed-tar-entry`,
`empty-pathname`, `non-standard-guid`, `ignored-preview`). Several meaningful
data-integrity conditions are silently ignored: duplicate GUIDs, missing asset or
meta files, zero-byte assets, and overly long pathnames. CLI `verify`/`doctor`
auto-forward all diagnostics as `PARSER_*` warnings; the web detail panel renders
them per-record.

## Scope

**In:**
- 5 new `UnityPackageParseDiagnosticCode` variants emitted from `packages/core`
- Per-record routing in `apps/web/src/packageModel.ts`
- Test coverage in core, web unit tests, and CLI command tests
- `oversized-entry-name` checked at both parse time and create time

**Out:**
- Unity YAML / `.meta` schema validation
- Any changes to `parseUnityPackage` (flat alias) surface
- UI changes beyond what the existing record detail panel already renders

## New codes

| Code | Condition | Emitted from |
|---|---|---|
| `duplicate-guid` | Same GUID prefix appears more than once | `mapUnityEntries` |
| `asset-missing` | Entry has `pathname` + meta but no `asset` file | `mapUnityEntries` |
| `meta-missing` | Entry has `pathname` + `asset` but no `asset.meta`/`metaData` | `mapUnityEntries` |
| `zero-byte-asset` | `asset` file present but `byteLength === 0` | `mapUnityEntries` |
| `oversized-entry-name` | Pathname content > 200 chars (extraction risk); or at create time, before writing | `mapUnityEntries` + `createUnityPackage` |

## Phases

### Phase 1 -- Core: emit new codes

**Goal:** add the 5 codes to the type union and emit from `mapUnityEntries` /
`createUnityPackage`.

**Files:** `packages/core/src/index.ts`, `packages/core/src/index.test.ts`

**Changes:**
- Extend `UnityPackageParseDiagnosticCode` union with all 5 new literals.
- In `mapUnityEntries`, track seen GUIDs with a `Map<string, number>`; on second
  occurrence emit `duplicate-guid` with `guid` set and `path` set to the colliding
  `<guid>/pathname` path.
- After resolving `asset`, `meta`, emit `asset-missing` (path: `<guid>/asset`) when
  `asset` is undefined; emit `meta-missing` (path: `<guid>/asset.meta`) when `meta`
  is undefined.
- Emit `zero-byte-asset` (path: `<guid>/asset`) when `asset?.byteLength === 0`.
- Decode pathname, check `pathname.length > 200`, emit `oversized-entry-name`
  (path: `<guid>/pathname`) with the actual length in the message.
- In `createUnityPackage`, check `pathname.length > 200` before writing; push an
  `oversized-entry-name` diagnostic into a local array and include it on the
  returned result (requires changing `createUnityPackage`'s return type to also
  carry `.diagnostics`, or accept a diagnostics out-param -- pick whichever is
  cleaner; see note below).
- Add unit tests covering each new code with synthetic fixture data.

> **Note on `createUnityPackage` return type:** if adding `.diagnostics` to the
> return is a larger surface change than desired, the create-time check can instead
> throw a descriptive error (consistent with the existing GUID-duplicate throw) and
> skip the diagnostic path for now. Decide at implementation time.

**Exit criteria:** `bun run --filter unitypackage-core test` passes with new cases.

---

### Phase 2 -- Web: per-record routing

**Goal:** new diagnostics appear on the correct record in the detail panel.

**Files:** `apps/web/src/packageModel.ts`, `apps/web/src/packageModel.test.ts`

**Routing rules for `getRecordDiagnostics`:**

| Code | Route to component |
|---|---|
| `duplicate-guid` | `'asset'` (primary component) |
| `asset-missing` | `'meta'` (only component that exists in this case) |
| `meta-missing` | `'asset'` (only component that exists in this case) |
| `zero-byte-asset` | `'asset'` (path already ends `/asset`; existing routing covers this) |
| `oversized-entry-name` | `'asset'`, fallback to `'meta'` |

Add explicit `code`-based branches in `getRecordDiagnostics` for codes where the
`path`-suffix routing would route to a component that doesn't exist for that entry
(`asset-missing`, `meta-missing`, `duplicate-guid`, `oversized-entry-name`).

Add unit test asserting each code lands on the expected record category.

**Exit criteria:** `bun run --filter @unitypackage-tools/web test` passes; no
TypeScript errors (`bun run --filter @unitypackage-tools/web typecheck`).

---

### Phase 3 -- CLI: test coverage

**Goal:** verify CLI commands surface the new codes.

**Files:** `packages/cli/src/commands.test.ts`

**Changes:** CLI `verify` and `doctor` already forward all diagnostics as
`PARSER_*` warnings generically -- no code changes needed. Add test cases (or
extend the existing "reports parser diagnostics" test) to assert the new codes
appear in `verify` / `doctor` output for a synthetic fixture that triggers each
condition.

**Exit criteria:** `bun run --filter unitypackage-tools test` passes.

---

### Phase 4 -- Gate

**Goal:** full suite clean.

```
bun run check
```

Smoke:
```
node packages/cli/dist/bin.js verify fixtures/static/editor-packed.unitypackage
node packages/cli/dist/bin.js doctor fixtures/static/editor-packed.unitypackage
```

Check that neither the editor-packed fixture nor the generated fixtures regress
(they should produce zero new diagnostics unless they genuinely trigger a condition).

## Critical files

- `packages/core/src/index.ts` -- type union + emission logic
- `packages/core/src/index.test.ts` -- core unit tests
- `apps/web/src/packageModel.ts` -- `getRecordDiagnostics` routing
- `apps/web/src/packageModel.test.ts` -- web unit tests
- `packages/cli/src/commands.test.ts` -- CLI integration tests
