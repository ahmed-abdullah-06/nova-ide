# Architecture overview (V1)

A short, code-oriented map of the V1 application. For the security rationale
see [../SECURITY.md](../SECURITY.md) and for data flows see
[../PRIVACY.md](../PRIVACY.md).

## 1. Process model

The Electron app has three isolated layers:

```
┌────────────────────────┐   contextBridge      ┌──────────────────────────┐
│ Renderer (React/Vite)  │ ─── window.nova ───▶ │ Preload (sandboxed)      │
│ nodeIntegration: false │ ◀── typed results ── │ contextIsolation: true   │
│ contextIsolation: true │                      └────────────┬─────────────┘
│ sandbox: true          │                                   │ ipcRenderer.invoke
└────────────────────────┘                                   ▼
                                              ┌──────────────────────────┐
                                              │ Main process             │
                                              │ services + IPC handlers  │
                                              │ (all privileged work)    │
                                              └──────────────────────────┘
```

- **Main** owns every privileged operation: filesystem, provider HTTP,
  credentials, Git, terminal/tasks, agent runtime, model management, voice
  sessions and persistence. All state and all trust decisions live here.
- **Preload** exposes a narrow, typed API (`NovaApi`) and nothing else. It is
  the only bridge; the renderer cannot reach `ipcRenderer` or Node directly.
- **Renderer** is a React 19 SPA bundled by Vite 8 with Monaco. It renders UI
  and sends intent; it never performs privileged work itself.

## 2. Monorepo layout

```
a6/
├── apps/desktop/
│   ├── src/main/         main process: window, ipc/, services, agent/, providers/, voice/
│   ├── src/preload/      contextBridge API (window.nova — kept as a stable internal id)
│   ├── src/renderer/     React UI, reducers, components, Monaco
│   ├── src/shared/       ipc-types.ts, contracts, result types (imported by all layers)
│   ├── forge.config.mts  Forge packaging, makers, fuses, metadata
│   └── package.json
├── tests/                unit + integration tests (Vitest)
├── tools/
│   ├── verify/           CDP runtime harness, isolation, fuses, quitcleanup, packaging
│   ├── perf/             measured performance harness
│   └── release/          notice generator, icon generator + release checklist
├── docs/                 user, security, privacy, packaging, performance, release docs
└── NOVA_IDE_SPEC.md      historical specification (name kept for reference)
```

The workspace uses pnpm 12 with `nodeLinker: hoisted` (Electron Forge
requirement) and a single lockfile.

## 3. IPC contract

`apps/desktop/src/shared/ipc-types.ts` is the single source of truth:

- `IpcChannels` + `IpcInvokeMap` map each channel to its argument tuple and
  result type, with compile-time coverage of invoke and push channels.
- Every handler is registered with an argument validator and a trusted-sender
  check (`assertNoArgs`, per-channel validators). Push channels are keyed by a
  run/download id so a stale listener cannot act on a foreign event.
- `FsResult<T>` / `AiResult<T>` discriminated unions carry structured errors;
  messages are user-readable and redacted.

## 4. Subsystems

| Subsystem | Location | Responsibility |
|---|---|---|
| Workspace & files | `main/workspaceService.ts`, `main/fileSystemService.ts`, `main/pathSecurity.ts` | Native folder picker, canonical path containment, one-level tree, conflict-aware save, external-change watcher |
| Terminal & tasks | `main/terminal/`, `main/tasks/` | ConPTY sessions, argument-array command execution, process-tree kill, watchdog |
| Search & Git | `main/search/`, `main/git/` | Bounded `.gitignore`-aware search; serialised Git wrapper (status/diff/branch) |
| Providers | `main/providers/` | Provider-neutral chat interface, Ollama + OpenAI-compatible adapters, credential store, privacy gate, shared HTTP module |
| Agent | `main/agent/` | Bounded plan/act/observe loop, tool executor, central permission policy, proposals, checkpoints, verification engine, audit |
| Local models | `main/providers/ollama/` | Catalog (`/api/tags`, `/api/ps`, `/api/show`), hardware fit, download/delete/unload, defaults |
| Voice | `main/voice/` | Main-process recording session, whisper.cpp-compatible engine, OS `speechSynthesis` reader, local-only gate |
| Persistence | `main/` stores | Plain JSON files in `userData` (see PRIVACY.md), bounded histories and audit |

## 5. Security boundaries in the design

- All privilege is in main; the renderer only expresses intent.
- Path containment uses `realpath` + `path.relative`, never string prefixes.
- Credentials never leave main; only a `hasKey` flag crosses the bridge.
- Model output is data: an allowlist, permission policy and workspace boundary
  gate every agent action; proposals require user acceptance.
- Child processes run outside the app tree and are killed on quit/crash.
- Fuses and a header CSP harden the packaged renderer; all six fuses are read
  back by `pnpm verify:fuses`.

## 6. Build and verification pipeline

- `pnpm dev` — Vite dev server + Electron with HMR.
- `pnpm typecheck` — `tsc --noEmit` for tests, main and renderer, across all
  workspaces.
- `pnpm test` — Vitest unit/integration suite.
- `pnpm package` — Electron Forge packages the app (ASAR, `node-pty` unpacked,
  hardened fuses).
- `pnpm make` — Windows Squirrel installer + portable zip.
- `pnpm verify` — 133 CDP checks driving the real packaged app with a mock
  provider/engine and a **fresh isolated profile** seeded before launch.
- `pnpm verify:fuses`, `pnpm verify:quitcleanup`, `pnpm verify:packaging` —
  fuse read-back, crash-cleanup and 26 clean-location/first-run/profile-survival
  checks.
- `pnpm perf:measure`, `pnpm generate:notices`, `pnpm generate:icons`,
  `pnpm verify:release` — measured performance, third-party notice generation,
  icon rasterization and release hygiene.

Every verification run uses a temporary `--user-data-dir` (or a fake `APPDATA`
root for the packaged survival check), deletes it afterwards, and fingerprints
the real user profile before and after to prove it was not touched. During
startup the main process pins `userData` to the legacy `NOVA IDE` directory so
the 10G rename cannot strand existing data; an explicit `--user-data-dir` is
always respected.

## 7. Packaging

`forge.config.mts` is the single source of product metadata: executable name
`A6IDE`, product name `A6`, Squirrel id `A6IDE`, and one `PRODUCT_COPYRIGHT`
constant wired through `appCopyright` (the field Electron Packager actually
writes into the exe's `LegalCopyright`). See
[../PACKAGING.md](../PACKAGING.md) for verified metadata, produced artifacts,
platform coverage and signing limitations.
