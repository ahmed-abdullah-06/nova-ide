# Performance measurements (Milestone 10B)

All numbers below were **measured**, not estimated. The raw output of the
final run is committed as `tools/perf/last-results.json`.

## Machine and method

- Development machine: **16 GB RAM, Intel Core i5-1145G7, integrated Intel
  graphics** (the machine specified in the product spec), Windows.
- Build: the packaged Electron application from `pnpm package`, launched with
  an isolated `--user-data-dir` and a DevTools port.
- Driver: `tools/perf/measure.mjs` (no new dependencies). It uses the existing
  CDP client in `tools/verify/cdp.mjs`.
- Wall-clock timings are taken in Node from process spawn, or in the renderer
  with `performance.now()` around the exact operation.
- "Working set" is the sum of `WorkingSetSize` of the application process and
  all of its descendants, read from Windows CIM. "JS heap" is CDP
  `Runtime.getHeapUsage.usedSize` in the renderer.
- Final readings were taken after `HeapProfiler.collectGarbage`.
- The run is a single measurement per metric (not an average). Across the
  repeated development runs, cold start varied roughly **0.6–1.1 s** and idle
  working set roughly **440–450 MB**; treat small differences as noise.

## Fixtures

- Large folder: **6,000 files** in 120 directories (~180 bytes each).
- Large-tree search: filename search for `perfneedle` in that tree (the
  search service caps the delivered result set).
- Long terminal output: a PowerShell command producing **~103,000 characters**
  through the real PTY and the IPC push channel.
- Long chat history: `conversations.json` with **20 conversations × 150
  messages** (3,000 messages), loaded on a fresh process launch.

## Results (final measured run, 2026-11-17)

| Metric | Value |
|---|---|
| Cold start, spawn → renderer bridge + DOM complete | **975 ms** |
| Cold start with the 3,000-message history | **769 ms** |
| Idle working set (whole process tree) | **444.5 MB** |
| Idle renderer JS heap | **14.7 MB** |
| Open 6,000-file folder → explorer title | **34 ms** |
| Open 6,000-file folder → >100 tree nodes rendered | **286 ms** |
| Large-tree search → final result batch | **64 ms** (500 matches, `done=true`) |
| Long terminal output → ~103,000 characters delivered | **995 ms** |
| Working set during long terminal output | **610.8 MB** |
| Working set after closing that terminal | **475.5 MB** |
| Working set after closing the workspace (after GC) | **460.9 MB** |
| Renderer JS heap after closing (after GC) | **13.5 MB** |
| Load 3,000-message history through the bridge | **181 ms** |
| Working set with the large history loaded | **546 MB** |

## Interpretation and fixes

- Memory returns close to the idle baseline after the terminal and workspace
  are closed (460.9 MB vs 444.5 MB idle; renderer heap 13.5 MB vs 14.7 MB).
  No clear leak was found in the measured paths, so no speculative
  optimisation was made.
- Known bounded buffers: terminal scrollback is limited to 5,000 lines by
  xterm.js; task output is capped in `taskService.ts`; search results are
  capped; chat history is capped at 50 conversations × 200 messages.
- The resilience problems found during this work were real and were fixed:
  corrupt JSON settings/conversations are now backed up and recovered, the
  log is bounded/rotated/redacted, and unhandled errors show a safe message.
  See the 10B commit and `tests/unit/{corruptRecovery,appLogger,storeRecovery}.test.ts`.

## Reproducing

1. `pnpm package`
2. `node tools/perf/measure.mjs`
3. Compare the printed values with `tools/perf/last-results.json`.

The harness creates and deletes its own temporary profile and fixture folder.
It never uses the developer's real profile, Ollama service, microphone or
network services.
