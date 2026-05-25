# Context7 Library IDs

## Runtime

| Dep | ID |
|---|---|
| Node.js | `/nodejs/node` |
| fflate | `/101arrowz/fflate` |
| yaml | `/eemeli/yaml` |
| react | `/facebook/react` |
| react-dom | *(part of `/facebook/react`)* |
| @tanstack/react-virtual | `/tanstack/virtual` |
| lucide-react | `/lucide-icons/lucide` |
| shiki | `/shikijs/shiki` |
| workbox-window | *(part of vite-plugin-pwa docs; no separate ID recorded)* |
| chalk | `/chalk/chalk` |

Workspace deps (`unitypackage-core`) are internal — no Ctx7 ID.

## Dev

| Dep | ID |
|---|---|
| bun | `/oven-sh/bun` |
| typescript | `/microsoft/typescript` |
| vitest | `/vitest-dev/vitest` |
| eslint | `/eslint/eslint` |
| typescript-eslint | `/typescript-eslint/typescript-eslint` |
| vite | `/vitejs/vite` |
| vite-plugin-pwa | `/vite-pwa/vite-plugin-pwa` |

## Notes

- Use `/tanstack/virtual` for web explorer virtualization questions, including `useVirtualizer`, `getVirtualItems()`, `getTotalSize()`, and virtual row `index/start/size` behavior used by `apps/web/src/App.tsx`.
- Use `/facebook/react` for React event and hook behavior in the web app; keep browser pointer selection details grounded in current React DOM docs when changing drag selection.
