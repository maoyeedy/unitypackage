# CLI Product Spec

## TLDR

`unitypackage-tools` is a zero-framework CLI for the full `.unitypackage` lifecycle: extract, pack, inspect, verify, diff, and serve a web UI. It is the robust, automatable, technical surface complementing the web app's browse-and-extract UX. All archive parsing and creation is delegated to `unitypackage-core` (browser-safe library). The CLI itself is a thin shell of command routing, safety guards, output formatting, and filesystem I/O.

## Product Goal

Give Unity developers and CI pipelines a complete set of command-line primitives for working with `.unitypackage` archives. The CLI answers six questions:

1. **extract** — What files are inside, and can I write selected ones to disk?
2. **pack** — Can I create a `.unitypackage` from loose source files with correct `.meta` sidecars?
3. **inspect** — What is the full structure, component-by-component, in human or machine-readable form?
4. **verify** — Is this package structurally sound? Are there duplicate GUIDs, missing metas, unsafe paths?
5. **diff** — What changed between two versions of a package?
6. **web** — Can I open this in a browser?

The CLI avoids teaching Unity project internals unless that knowledge directly helps users inspect, validate, or transform packages. It is format-scoped, not project-scoped.

## In Scope

- **extract**: Write asset, meta, and preview files to disk with glob filter, exact path selection, path-file input, exclude, force, skip-existing, merge, dry-run, and JSON output.
- **pack**: Create `.unitypackage` archives from source files. Read adjacent `.meta` sidecars automatically. Generate importer-aware metas (MonoImporter, TextScriptImporter, DefaultImporter, folderAsset). Support deterministic path-based GUIDs or random GUIDs. Support manifest files for bulk entry. Support configurable gzip level (0-9). Dry-run with JSON output.
- **inspect**: List or tree-format display of package entries. Filter by extension or glob, exclude by glob. JSON output with component-level metadata (byte length, extension, MIME type, preview kind, syntax language, parser diagnostics). SHA-256 of raw package bytes.
- **verify**: Structural and format health checks. Parser diagnostics, GUID/meta consistency, duplicate GUIDs, duplicate paths, case-colliding paths, unsafe pathnames, backslash pathnames, pathnames outside `Assets/`, oversized pathnames, importer mismatches, missing metas, zero-byte assets, malformed tar entries. Strict mode promotes warnings to errors.
- **diff**: GUID-based comparison of two packages. SHA-256 hash comparison per component (asset, meta, preview). Reports added, removed, and changed entries with per-component change detail.
- **web**: Minimal static HTTP server for the built web app. Supports `--port` and `--host`. SPA fallback routing.
- **JSON mode**: All commands support `--json`. Progress and warnings always routed to stderr; stdout is always parseable in JSON mode.
- **Safety guards**: Global `--max-output-bytes` and `--max-entries` prevent OOM/crash on oversized packages.
- **Exit codes**: OK=0, WARN=1, ERROR=2, IO=3, BOMB=4. Typed `CliError` class.
- **Path security**: `sanitizePackagePath` normalizes separators and strips traversal. `sanitizeFsPath` handles Windows reserved names. `isInside` prevents directory traversal during extraction.

## Out Of Scope

- Unity YAML schema validation (verify is format-scoped only).
- Full Unity project validation, import settings validation, or asset pipeline checks.
- Editing paths, GUIDs, metadata, importers, or package contents in place.
- Packing loose non-Asset project files (e.g., `ProjectSettings/`, `Packages/`).
- Remapping GUIDs by path.
- Plugin or hook system.
- Config file (`.unitypackagerc` or environment-based configuration).
- Interactive shell or REPL mode.
- Telemetry, usage reporting, or update checks.
- WebSocket/HMR support in the `web` command.
- GUI or TUI beyond the `web` server.
- Non-`.unitypackage` archive format support (`.zip`, `.tar.gz`, `.unityhub`).

## Not Yet Implemented

These are genuine gaps: commonly expected CLI features that are absent but do not contradict the stated out-of-scope boundaries.

| Gap | Notes |
| --- | ----- |
| **Shell auto-completion** | No completion scripts for bash, zsh, fish. Install step could generate them. |
| **No color/ANSI output** | All output is plain text. No `--color` / `--no-color`, no syntax highlighting in terminal. |
| **`web` is a bare server** | No browser auto-open, no request logging, no CORS headers, no HTTPS, no configurable root. Client-side routing relies entirely on the web app's own SPA fallback. |
| **No `cat` / pipe-to-stdout** | Cannot extract a single entry's asset content to stdout for piping (`unitypackage-tools cat pkg Assets/Foo.cs \| head`). |
| **No `--quiet` flag** | Cannot suppress all human output (progress lines on stderr). Workaround: redirect stderr to `/dev/null`. |
| **No progress bars** | TTY-aware progress bars instead of text lines (`Extract progress: wrote 100/202 file(s)`). |
| **No batch/multi-package commands** | Commands operate on one or two packages. No glob-based batch processing (`unitypackage-tools verify *.unitypackage`). |
| **No `info` command** | A one-line quick summary without full `inspect` output. |
| **No CI-specific output format** | No GitHub Actions annotations, GitLab CI artifacts, or Jenkins-compatible reporting. |
| **No `pack` directory recursion with automatic mapping** | Currently requires explicit source→dest pairs or manifest. Directory input maps the folder name as the destination path segment. |
| **No `extract` ZIP output** | Cannot extract to a `.zip` file directly (unlike the web app's Download Selected ZIP / All ZIP). |

## CLI Boundary

The CLI is the robust, technical, and automatable surface. These capabilities are CLI-only:

- **pack**: create `.unitypackage` files from source files.
- **verify**: expose parser and analysis diagnostics, including warnings that may not matter to a normal user.
- **inspect**: detailed JSON/tree output for automation and debugging.
- **diff**: package-to-package comparison.
- **web**: serve the web UI locally.

The web app is the easiest path for casual browsing and extraction. The CLI is the power-tool surface. Neither duplicates the other's primary workflows.

## Product Constraints

- CLI must remain self-contained with no runtime dependencies beyond `unitypackage-core` (workspace). No `commander`, `yargs`, `chalk`, or other CLI framework dependencies.
- JSON mode must keep stdout parseable at all times. Every warning, progress line, and error must go to stderr.
- Safety guards must prevent resource exhaustion on malicious or malformed packages.
- Path security must prevent directory traversal attacks during extraction.
- All archive parsing and creation logic must live in `unitypackage-core`, never directly in CLI commands.
- Exit codes must be stable and documented. Scripts depend on them.
- `web` command must not require a separate build step for the user. The `build:cli` pipeline pre-bundles the web assets.

## Acceptance Checks

- `unitypackage-tools extract pkg.unitypackage out --filter "**/*.shader"` writes only `.shader` files.
- `unitypackage-tools extract pkg.unitypackage out --path Assets/Scripts/Foo.cs --with-meta` writes the asset and its `.meta` sidecar.
- `unitypackage-tools extract pkg.unitypackage out --dry-run --json` produces parseable JSON with planned writes and no side effects.
- `unitypackage-tools pack out.unitypackage src/Foo.cs Assets/Foo.cs` produces a valid `.unitypackage` that round-trips through extract.
- `unitypackage-tools pack out.unitypackage src/Foo.cs Assets/Foo.cs --manifest manifest.json` reads the manifest and packs all entries.
- `unitypackage-tools inspect pkg.unitypackage --json` outputs parseable JSON with component-level metadata.
- `unitypackage-tools inspect pkg.unitypackage --format tree` renders a directory tree for `Assets/`.
- `unitypackage-tools verify pkg.unitypackage --strict` exits non-zero for packages with warnings.
- `unitypackage-tools diff a.unitypackage b.unitypackage --json` outputs parseable JSON with added/removed/changed entries.
- `unitypackage-tools web --port 4173 --host 127.0.0.1` serves the web app and logs the URL to stdout.
- Safety guards (`--max-output-bytes`, `--max-entries`) stop parse-consuming commands before resource exhaustion.
- Extracting a package with `../` traversal paths does not write files outside the output directory.
