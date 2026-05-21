# unitypackage-tools

CLI for `.unitypackage` files.

```sh
unitypackage-tools extract <package.unitypackage> [output-dir]
unitypackage-tools pack <output.unitypackage> [source path-in-package]...
unitypackage-tools inspect <package.unitypackage> [--json]
unitypackage-tools verify <package.unitypackage> [--json]
unitypackage-tools web [--port 5173]
```

## Notes

- `extract --no-meta` skips writing Unity `.meta` files.
- `extract` reports traversal entries skipped for output safety.
- `pack` warns when a destination path does not start with `Assets/`.
- `pack` skips source `.meta` files explicitly; provide asset paths and let the
  tool read adjacent metadata when available.
