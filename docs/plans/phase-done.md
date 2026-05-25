# Phases 0-3 Complete

## Phase 0 — Test Coverage Gaps
Audited real Unity-exported packages against the documented gzip tar record model. Backfilled parser and creator tests for edge cases (preview.png, multi-line pathnames, non-ASCII, malformed data, duplicates, folder-only records). Documented the GUID validation boundary (32-hex dir names preserved as-is). Cleared CLI lint blockers.

## Phase 1 — Immediate Gaps
Exposed structured diagnostics from the core parser, added `preview.png` to parsed entries, and rejected duplicate GUIDs on creation. CLI extraction got `--no-meta`, traversal summaries, Assets/ path warnings, and skipped `.meta` logging. Web app switched to GUID-aware parsing, added error fallback, drag-active drop zone, and a functional preview toggle.

## Phase 2 — CLI Completeness
Built out the full CLI surface: extract `--filter` and `--merge`, inspect `--format tree` / `--filter`, verify `--strict` with GUID checks, manifest-based pack with gzip levels and bounded concurrency, plus diff and doctor commands. Added stderr progress reporting for large packages. All new flags and commands tested.

## Phase 3 — Web Robustness
Moved parsing and download-all ZIP creation off the main thread via Vite module workers. Virtualized large file lists with `@tanstack/react-virtual`. Added raw text previews, URL-persisted settings (excludeMeta, categorize, language), visible parser diagnostics, blob URL refresh, and light/dark theme CSS variables.
