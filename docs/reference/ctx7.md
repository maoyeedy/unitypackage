# Context7 Library IDs

Dependencies from each package's `package.json`, split by runtime vs dev. Workspace references (`workspace:*`) are internal -- no Ctx7 ID.

## Root

| Scope | Dep | ID |
|-------|-----|----|
| dev | `@eslint/js` | `/eslint/eslint` |
| dev | `@types/node` | no separate ctx7 ID; see `/microsoft/typescript` |
| dev | `eslint` | `/eslint/eslint` |
| dev | `globals` | `/sindresorhus/globals` |
| dev | `typescript` | `/microsoft/typescript` |
| dev | `typescript-eslint` | `/typescript-eslint/typescript-eslint` |
| dev | `vitest` | `/vitest-dev/vitest` |

## packages/core

| Scope | Dep | ID |
|-------|-----|----|
| runtime | `fflate` | `/101arrowz/fflate` |

## packages/cli

| Scope | Dep | ID |
|-------|-----|----|
| runtime | `yaml` | `/eemeli/yaml` |
| runtime | `unitypackage-core` | *(workspace -- internal)* |

## apps/web

| Scope | Dep | ID |
|-------|-----|----|
| runtime | `@shikijs/langs` | `/shikijs/shiki` |
| runtime | `@shikijs/themes` | `/shikijs/shiki` |
| runtime | `@tanstack/react-virtual` | `/tanstack/virtual` |
| runtime | `fflate` | `/101arrowz/fflate` |
| runtime | `lucide-react` | `/lucide-icons/lucide` |
| runtime | `react` | `/facebook/react` |
| runtime | `react-dom` | *(part of `/facebook/react`)* |
| runtime | `shiki` | `/shikijs/shiki` |
| runtime | `unitypackage-core` | *(workspace -- internal)* |
| runtime | `workbox-window` | no separate ctx7 ID; see vite-plugin-pwa docs |
| dev | `@playwright/test` | `/microsoft/playwright` |
| dev | `@types/react` | *(part of `/facebook/react`)* |
| dev | `@types/react-dom` | *(part of `/facebook/react`)* |
| dev | `@vitejs/plugin-react-swc` | `/vitejs/vite` (SWC variant; no separate ID) |
| dev | `eslint-plugin-react-hooks` | *(part of `/facebook/react`)* |
| dev | `eslint-plugin-react-refresh` | no ctx7 ID found |
| dev | `vite` | `/vitejs/vite` |
| dev | `vite-plugin-pwa` | `/vite-pwa/vite-plugin-pwa` |
| dev | `vitest` | `/vitest-dev/vitest` |

## Notes

- Use `/tanstack/virtual` for web explorer virtualization questions, including `useVirtualizer`, `getVirtualItems()`, `getTotalSize()`, and virtual row `index/start/size` behavior used by `apps/web/src/App.tsx`.
- Use `/facebook/react` for React event and hook behavior in the web app; keep browser pointer selection details grounded in current React DOM docs when changing drag selection.
