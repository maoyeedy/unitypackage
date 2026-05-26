# unitypackage-core

Browser-safe `.unitypackage` parser and writer.

## API

```ts
import { parseUnityPackage, parseUnityPackageEntries, createUnityPackage } from 'unitypackage-core';
```

See source for full type definitions. No Node.js or browser globals required beyond `Uint8Array` and `TextEncoder`/`TextDecoder`.

`parseUnityPackageEntries(data)` returns GUID-aware entries and preserves array
compatibility. The returned array also exposes a non-enumerable `diagnostics`
property with structured parser diagnostics.

`UnityPackageEntry.preview` contains optional `preview.png` thumbnail bytes when
present. Flat `parseUnityPackage(data)` output ignores previews.

`createUnityPackage(entries)` rejects duplicate GUIDs before writing the
archive.
