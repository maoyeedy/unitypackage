# P2 -- CLI `verify` consumes core diagnostics

## Goal

Drop the second `gunzipSync` and the second tar-walk inside
`packages/cli/src/commands/verify.ts`. Replace with consumption of the
existing core diagnostic codes that already cover the same warnings, so the
bomb guard from `gunzipBounded` (P1 of the prior plan) actually applies to
every decompression path in `verify`.

## Files

- `packages/cli/src/commands/verify.ts` -- delete `listTarFiles` and the
  `for (const tarFile of listTarFiles(new Uint8Array(raw)))` block; map
  `unexpected-guid-directory-file` and `entries-outside-guid-directory`
  parser diagnostics to the `UNEXPECTED_FILE` finding code.
- `packages/cli/src/commands/verify.test.ts` -- re-cover the
  `UNEXPECTED_FILE` path by asserting on output for a fixture that contains
  a stray file inside a GUID directory; no behavior change expected.

## Surface

No CLI behavior change for callers. After this phase:

- `verify` decompresses each archive exactly once, via the core's
  bounded path.
- `verify.ts` no longer imports `gunzipSync` from `node:zlib`.
- The `TarFile` interface in `verify.ts` is deleted.

### Specifics

1. Delete `listTarFiles` (verify.ts:198-220) and the
   `for (const tarFile of listTarFiles(...))` loop (verify.ts:78-84).

2. In the existing parser-diagnostic mapping loop (verify.ts:60-69), do not
   skip `unexpected-guid-directory-file` and `entries-outside-guid-directory`.
   Map both to the `UNEXPECTED_FILE` code (the existing CLI vocabulary) with
   the message and path carried by the diagnostic. The mapping should reuse
   the same `PARSER_<code>` convention used for the other diagnostics --
   either reuse `PARSER_UNEXPECTED_GUID_DIRECTORY_FILE` (already produced
   automatically by the existing mapping) or special-case both codes to
   emit `UNEXPECTED_FILE` for backward-compatible JSON output.

3. Confirm the existing `if (diagnostic.code === 'ignored-preview') continue;`
   filter stays in place -- that part of `CLAUDE.md` ("Pitfalls" section)
   stays accurate.

4. Drop `import { gunzipSync } from 'node:zlib';` and the `TarFile`
   interface.

## Exit criteria

- `bun run check` passes.
- `verify` against `fixtures/static/editor-packed.unitypackage` produces the
  same JSON `findings` array as before, modulo cosmetic message wording for
  the unexpected-file finding (which now flows through the parser
  diagnostic message).
- `packages/cli/src/commands/verify.ts` has no `gunzipSync` import,
  no `listTarFiles`, and no `TarFile` interface.
- A test asserts `UNEXPECTED_FILE` is reported when a fixture contains a
  stray file like `<guid>/garbage.txt` (add a minimal generated fixture if
  none exists today).
