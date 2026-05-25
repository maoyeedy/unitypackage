# unitypackage

Tools for inspecting, extracting, verifying, diffing, and packing Unity
`.unitypackage` archives.

This monorepo contains:
- `packages/core`: browser-safe parser and package creation library.
- `packages/cli`: Node CLI for extract, inspect, verify, pack, diff, and doctor workflows.
- `apps/web`: English-only React/Vite PWA workspace for local browser inspection and extraction.
- `fixtures`: generated and editor-exported packages used by tests and smoke checks.

The project was rewritten from:
- https://github.com/maoyeedy/package-packer
- https://github.com/maoyeedy/package-extractor
- https://github.com/maoyeedy/package-extractor-react

## Web App

The web app runs fully in the browser. It parses `.unitypackage` files in a
worker, shows a tree view by default, can group files by extension, previews the
selected record on the right, syntax-highlights text previews with Unity file
associations, and shows derived metadata such as GUID, package path, kind, MIME
guess, byte size, paired meta/preview state, duplicates, and related parser
diagnostics.

Extract mode supports ZIP downloads for all files or selected records. Tree and
extension views support checkbox selection, drag-sweep selection within the
middle explorer pane, folder select-all, extension select-all, and clear
selection. Search filters scope folder and extension select-all to the visible
records. Pack mode is prepared as a staging shell, but `.unitypackage` export
stays disabled until `docs/plans/web/new-api.md` wires the final browser package
creation API.

```sh
bun run dev:web
bun run --filter @unitypackage-tools/web test
bun run --filter @unitypackage-tools/web build
```

## Workspace Commands

```sh
bun install
bun run check
bun run build
bun run build:cli
bun run test
bun run pack:dry
```

Useful package-scoped commands:

```sh
bun run --filter unitypackage-core test
bun run --filter unitypackage-tools test
bun run --filter @unitypackage-tools/web typecheck
```

## CLI Smoke

After `bun run build`, common manual checks are:

```sh
node packages/cli/dist/bin.js inspect "fixtures/static/editor-packed.unitypackage" --json
node packages/cli/dist/bin.js verify "fixtures/static/editor-packed.unitypackage"
node packages/cli/dist/bin.js doctor "fixtures/static/editor-packed.unitypackage"
node packages/cli/dist/bin.js diff fixtures/generated/minimal.unitypackage fixtures/generated/nested.unitypackage --json
```

## Plans And References

- `docs/reference/format.md`: `.unitypackage` format notes.
- `docs/reference/ctx7.md`: pre-resolved Context7 IDs for dependencies.
- `docs/plans/phase-done.md`: completed phase summary.
- `docs/plans/web/modern-interface-rewrite.md`: implemented web rewrite plan.
- `docs/plans/web/new-api.md`: next web/core API integration plan.
