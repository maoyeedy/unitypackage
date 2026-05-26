# unitypackage-tools

CLI for `.unitypackage` files.

```sh
unitypackage-tools extract <package.unitypackage> [output-dir]
unitypackage-tools pack <output.unitypackage> [source path-in-package]...
unitypackage-tools inspect <package.unitypackage> [--json] [--format tree] [--filter <ext>]
unitypackage-tools verify <package.unitypackage> [--json] [--strict]
unitypackage-tools diff <before.unitypackage> <after.unitypackage> [--json]
unitypackage-tools doctor <package.unitypackage>
unitypackage-tools web [--port 5173]
```

## Notes

- `extract --filter <glob>` matches full package pathnames; use `**/*.shader`
  for nested files, not `*.shader`.
- `extract --merge` writes changed files, skips unchanged files, and reports
  changed/skipped counts.
- `extract --no-meta` skips writing Unity `.meta` files.
- `extract` reports traversal entries skipped for output safety.
- `inspect --format tree` renders the package as a directory tree.
- `inspect --filter <ext>` limits displayed entries by extension, such as
  `.cs` or `cs`.
- `verify --strict` exits non-zero when warnings are present.
- `verify` checks `asset.meta` GUID values against archive directory GUIDs and
  reports parser diagnostics.
- `pack --manifest <file.json>` reads `{ "src": "dst" }` entries.
- `pack --gzip-level <0-9>` controls gzip compression level.
- `pack` warns when a destination path does not start with `Assets/`.
- `pack` skips source `.meta` files explicitly; provide asset paths and let the
  tool read adjacent metadata when available.
- `diff` reports added, removed, and changed entries by GUID, pathname, and
  asset hash.
- `doctor` reports format-scoped health checks without Unity YAML schema
  validation.
