# Core — Phases 0-1 Complete

## Phase 0 — Test Coverage Gaps
Audited real Unity-exported packages against the documented gzip tar record model. Backfilled parser and creator tests for edge cases (preview.png, multi-line pathnames, non-ASCII, malformed data, duplicates, folder-only records). Documented the GUID validation boundary (32-hex dir names preserved as-is).

## Phase 1 — Immediate Gaps
Exposed structured diagnostics from the core parser, added `preview.png` to parsed entries, and rejected duplicate GUIDs on creation.
