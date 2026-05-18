# Publishing

## Setup

```sh
npm login && npm whoami
npm view unitypackage-core version    # should 404
npm view unitypackage-tools version   # should 404
```

Ensure each package dir has `README.md`. `LICENSE` symlinks already in place.

## Pre-publish

```sh
bun run build
bun run pack:dry
```

Verify tarball contents: `dist/`, `README.md`, `LICENSE` for each.

## Version bump

Edit `packages/core/package.json` and `packages/cli/package.json` (semver). CLI: replace `"unitypackage-core": "workspace:*"` with `"^<version>"`.

## Publish order (strict)

1. `npm publish --workspace unitypackage-core`
2. `npm publish --workspace unitypackage-tools`

Both run `prepublishOnly` (build + lint + test) automatically.

## After

```sh
npm view unitypackage-core          # verify version
npm view unitypackage-tools         # verify version
git add packages/core/package.json packages/cli/package.json
git commit -m "chore: release v<version>"
git tag v<version>
git push && git push --tags
```
