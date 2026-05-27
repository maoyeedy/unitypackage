# Agentic debug: memory-pressure freeze on file click

## Context7 library ID

For searching usage and best practices:

```
/chromedevtools/chrome-devtools-mcp
```

Query examples:
- "How to use take_heapsnapshot and get_heapsnapshot_retainers to find what retains large Uint8Array buffers"
- "How to start a performance trace and analyze GC pause events with performance_analyze_insight"
- "Best practices for debugging memory leaks with chrome-devtools-mcp"

## Prerequisites

- `chrome-devtools-mcp@latest` installed (assumed)
- `apps/web` production build served at `http://localhost:4173` (run `bun run check` then `cd apps/web && bunx vite preview --port 4173 --strictPort`)
- The fix phases from `memory-pressure-freeze-on-file-click.md` are NOT applied yet (we are debugging the unfixed state)

Confirm the MCP server is configured in your client:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest"]
    }
  }
}
```

Launch with `--experimentalMemory=true` to enable the detailed heap analysis tools:

```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "npx",
      "args": ["-y", "chrome-devtools-mcp@latest", "--experimentalMemory=true"]
    }
  }
}
```

## Step 1: Open the app and load the Polytope package

```mcp
navigate_page url="http://localhost:4173/"
```

Then upload the fixture file. The MCP server does not provide a native file-upload tool for the drop zone; use the `upload_file` tool if a file input is available, or manually drag the file. After the parse completes, verify:

```mcp
evaluate_script function="() => document.querySelector('.statusbar-op')?.textContent"
```

Expect output containing `Parsed 139 files from Polytope_URP.unitypackage`.

## Step 2: Capture baseline heap snapshot

Before clicking any file, capture a heap snapshot as the baseline:

```mcp
take_heapsnapshot filePath="./snap-baseline.heapsnapshot"
```

## Step 3: Click the first file and measure

Click the first non-meta record (auto-selected on load). Use `take_snapshot` to get the a11y tree, then `click` on the first file row.

```mcp
take_snapshot
```

Find the first file row uid from the snapshot output, then:

```mcp
click uid="<file-row-uid>"
```

## Step 4: Click the large TerrainData asset

Navigate to the search box, type "TerrainData_6dc76592", then click the matching row.

The freeze will occur here. The MCP server may time out waiting for the page to respond. If it does, pass a longer `timeout` to `navigate_page` or `wait_for`.

After the freeze ends (2-5 s), capture the second heap snapshot:

```mcp
take_heapsnapshot filePath="./snap-after-terraindata.heapsnapshot"
```

## Step 5: Capture the peak (click another file after the first spike)

After the TerrainData click, the freeze may be shorter. Click any small file now. This is when the user observed memory spiking to 1.48 GB.

```mcp
take_heapsnapshot filePath="./snap-after-second-click.heapsnapshot"
```

## Step 6: Analyze heap snapshots

With `--experimentalMemory=true`, use the detailed analysis tools:

### 6a. Get summary stats for each snapshot

```mcp
get_heapsnapshot_summary filePath="./snap-baseline.heapsnapshot"
get_heapsnapshot_summary filePath="./snap-after-terraindata.heapsnapshot"
get_heapsnapshot_summary filePath="./snap-after-second-click.heapsnapshot"
```

Compare `totalSize`, `jsObjectSize`, `stringsSize`, and `externalSize` across the three. Look for:

- A large jump in `externalSize` -- this would confirm that `ArrayBuffer` backing stores are being duplicated by structured clone.
- A large jump in `jsObjectSize` -- this would suggest many small wrapper objects (React fiber nodes, detached DOM, SidecarSelectableRecord arrays) are being retained.

### 6b. Get detailed class distribution

```mcp
get_heapsnapshot_details filePath="./snap-after-terraindata.heapsnapshot"
```

Look at the aggregates for:
- `Uint8Array` -- count and total size. If the count is 2x the number of entries in the package, each buffer was cloned once.
- `ArrayBuffer` -- same check. External memory.
- `System / JSArrayBuffer` -- backing store size.
- `Object` / `Window` / `Document` / `HTMLElement` -- detached DOM trees.
- `Promise` / `FiberNode` -- stale React state.

### 6c. Find retainers of a specific Uint8Array

Find a node ID for a large Uint8Array from the details output, then:

```mcp
get_heapsnapshot_retainers filePath="./snap-after-terraindata.heapsnapshot" nodeId=<node-id>
```

The retainer chain will show how the buffer is reachable from JS roots. Expected chain for the structured-clone hypothesis:

```
window → React root → App fiber → useState(records) → records[] → PackageFileRecord.content → Uint8Array → ArrayBuffer
```

If there is a SECOND copy with a different retainer path, structured clone occurred.

## Step 7: Performance trace during the freeze

Start a trace before clicking the TerrainData file:

```mcp
performance_start_trace autoStop=false filePath="./trace-freeze.json.gz"
```

Then click the TerrainData file (via `take_snapshot` + `click`). After the freeze ends (2-5 s), stop the trace:

```mcp
performance_stop_trace filePath="./trace-freeze.json.gz"
```

### 7a. Analyze the trace for GC events

Use `performance_analyze_insight` to get details:

```mcp
performance_analyze_insight insightSetId="<insight-set-id>" insightName="MainThread"
```

In the trace file, look for:
- **Long yellow "Task" blocks** with label "MajorGC" or "v8.markCompact" -- these are the stop-the-world pauses.
- **Duration of each GC event.** The sum of Major GC durations should match the perceived freeze time.
- **Memory counters** (JSHeapUsedSize, JSHeapTotalSize) before and after each GC. A large drop indicates freed objects; a sustained high value after GC indicates retained live objects.

If Major GC accounts for >80% of the freeze time, the diagnosis is confirmed: the freeze is V8 mark-sweep triggered by the cloned buffer heap, not by JS execution (React reconciliation, layout).

## Step 8: Evaluate structured clone hypothesis via script

Run this script to measure the actual memory held by records:

```mcp
evaluate_script function="() => {
  // Access React fiber internals via the actual app state
  // This assumes the app exposes __REACT_DEVTOOLS_GLOBAL_HOOK__ or similar
  // Fallback: iterate the records array if accessible
  const records = document.querySelector('#root')?._reactRootContainer?._internalRoot?.current?.memoizedState;
  // ... walk the fiber tree to find useState(records) ...
  // Return the total byteLength of all content buffers
}"
```

A simpler approach: check `performance.memory` (non-standard but available in Chromium):

```mcp
evaluate_script function="() => ({
  jsHeapSizeLimit: performance.memory?.jsHeapSizeLimit,
  totalJSHeapSize: performance.memory?.totalJSHeapSize,
  usedJSHeapSize: performance.memory?.usedJSHeapSize,
})"
```

Run this:
1. Before package load (baseline)
2. After package load
3. After clicking TerrainData
4. After second click

The `totalJSHeapSize` values at each step quantify the clone cost.

## Expected findings

Based on the code analysis:

| Finding | Evidence to look for |
|---------|---------------------|
| **Worker structured clone duplicates all buffers** | `externalSize` in snap-after-terraindata is ~2x the package decompressed size (~220 MB). `Uint8Array` count = 2x entry count. |
| **GC mark-sweep is the freeze, not JS execution** | Trace shows 2-5 s of `MajorGC` / `v8.markCompact` events. JS "Task" blocks are short (<50 ms). |
| **`toSidecarSelectableRecords` allocates per click** | Snap-after-second-click shows many `Object` / `Array` instances from the mapping. Check `get_heapsnapshot_details` aggregates for `Array` count growth. |
| **`PreviewPanelContent` key-remount creates detached DOM** | Look for `Detached HTMLElement` subtrees in the retainer graph. |
| **Download ZIP worker re-clones on every click** | Only if a download was triggered during the trace. Check `externalSize` after ZIP click. |

## If freeze is NOT GC (alternative diagnosis)

If the trace shows long JS "Task" blocks instead of GC events, the freeze is from synchronous JavaScript execution on the main thread. In that case:

1. Use `performance_analyze_insight` on the insight set to find which function / script file dominates the task time.
2. The stack trace in the insight will point to the specific React component or hook that is synchronously processing the file data.

This would indicate that preview classification or metadata extraction is doing content processing even for `'unsupported'` files -- contradicting the code analysis.

## Summary of tools used

| Tool | When to use |
|------|-------------|
| `take_heapsnapshot` | Captures JS heap for offline analysis. Take 3: baseline, after first spike, after peak. |
| `get_heapsnapshot_summary` | Quick comparison of total/external size across snapshots. |
| `get_heapsnapshot_details` | Find specific constructor counts (Uint8Array, ArrayBuffer, Array, Object). |
| `get_heapsnapshot_retainers` | Trace why a specific object is retained -- confirms clone vs. leak. |
| `get_heapsnapshot_class_nodes` | List all instances of a specific class (e.g., all Uint8Array nodes) by ID. |
| `performance_start_trace` / `stop_trace` | Capture the freeze timeline. |
| `performance_analyze_insight` | Decompose the trace into labeled events (GC, layout, script). |
| `evaluate_script` | Probe `performance.memory`, React fiber state, and DOM metrics live. |

## Re-run after fix

After applying P1-P4 from the fix plan, re-run the same procedure. The key pass thresholds:

- Post-parse `totalJSHeapSize` should be approximately **half** of the pre-fix value (P1 removes the clone).
- `externalSize` should equal the package decompressed size (~110 MB), not 2x.
- Performance trace should show **no Major GC events longer than 50 ms** during file clicks.
- `get_heapsnapshot_class_nodes` should show Uint8Array count = number of entries in the package (not 2x).
