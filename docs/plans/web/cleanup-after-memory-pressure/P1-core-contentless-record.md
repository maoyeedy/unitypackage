# P1 -- core: export `ContentlessRecord` projection [DONE 2026-05-27]

Shipped: new `ContentlessRecord` type alias in `packages/core/src/component.ts` and re-exported it in `packages/core/src/index.ts`.
Adopted: modified `apps/web/src/packageModel.ts` to extend `ContentlessRecord` in `PackageFileRecord`.
