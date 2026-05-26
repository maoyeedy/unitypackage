# unitypackage-tools

CLI for `.unitypackage` files.

## Common flows

```sh
unitypackage-tools inspect <package.unitypackage>
unitypackage-tools inspect <package.unitypackage> --json
unitypackage-tools inspect <package.unitypackage> --format tree --filter cs

unitypackage-tools extract <package.unitypackage> ./out --filter "**/*.shader"
unitypackage-tools extract <package.unitypackage> ./out --path Assets/Scripts/MyScript.cs --path Assets/Textures/Icon.png
unitypackage-tools extract <package.unitypackage> ./out --path Assets/Scripts/MyScript.cs --with-meta
unitypackage-tools extract <package.unitypackage> ./out --merge

unitypackage-tools pack out.unitypackage ./Assets/MyScript.cs Assets/MyScript.cs
unitypackage-tools pack out.unitypackage --manifest manifest.json
unitypackage-tools pack out.unitypackage ./Loose.cs Assets/Loose.cs --random-guids

unitypackage-tools verify <package.unitypackage> --strict
unitypackage-tools diff <before.unitypackage> <after.unitypackage> [--json]
unitypackage-tools web [--port 5173] [--host 127.0.0.1]

unitypackage-tools inspect <package.unitypackage> --max-output-bytes 1073741824 --max-entries 100000
```

## Notes

- `extract --filter <glob>` matches full package pathnames; use `**/*.shader`
  for nested shader files, not `*.shader`.
- `extract --path <pathname>` selects exact package output paths and can be
  repeated. It cannot be combined with `--filter`.
- Normal extraction writes Unity `.meta` sidecars by default. Exact `--path`
  selections write only the requested paths unless `--with-meta` is passed.
- `extract --with-meta` expands exact asset `--path` selections to include
  matching `.meta` sidecars. It requires `--path`; `--no-meta` overrides it.
- `extract --merge` writes changed files, skips unchanged files, and reports
  changed/skipped counts.
- `extract --no-meta` skips writing Unity `.meta` files.
- `inspect --format tree` renders the package as a directory tree.
- `inspect --filter <ext>` limits displayed entries by extension, such as
  `.cs` or `cs`.
- `verify --strict` exits non-zero when warnings are present.
- `--max-output-bytes <n>` and `--max-entries <n>` are global safety
  limits for parse-consuming commands. They stop parsing packages that exceed
  decompressed byte or parsed entry limits; they are not filtering options.
- `pack --manifest <file.json>` reads `{ "src": "dst" }` entries.
- `pack --gzip-level <0-9>` controls gzip compression level.
- `pack --random-guids` gives generated metas random GUIDs for ad-hoc
  packages. It is not reproducible across runs. Adjacent `.meta` sidecars
  still win and are preserved exactly.
- `pack` warns when a destination path does not start with `Assets/`.
- `pack` reads adjacent `.meta` files when available and skips source `.meta`
  paths passed explicitly; provide asset paths, not metadata paths.
- `diff` reports added, removed, and changed entries by GUID, pathname, and
  asset hash.
- `verify` reports `.unitypackage` format health checks; it is not a full Unity
  project validator and does not perform Unity YAML schema validation.
