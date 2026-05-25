# unitypackage

Tools for inspecting, extracting, verifying, diffing, and packing Unity
`.unitypackage` archives.

This monorepo contains:
- `packages/core`: browser-safe parser and package creation library. Public imports stay on the package root (`unitypackage-core`); runtime source is split by domain under `packages/core/src`.
- `packages/cli`: Node CLI for extract, inspect, verify, pack, diff, and doctor workflows.
- `apps/web`: English-only React/Vite PWA workspace for local browser inspection and extraction.
- `fixtures`: generated and editor-exported packages used by tests and smoke checks.

The project was rewritten from:
- https://github.com/maoyeedy/package-packer
- https://github.com/maoyeedy/package-extractor
- https://github.com/maoyeedy/package-extractor-react


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
