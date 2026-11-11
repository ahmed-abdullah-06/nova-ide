# NOVA IDE — Development Progress

Status values: **Not Started · In Progress · Implemented · Tested · Completed**
A task may only be marked **Completed** after its acceptance criteria have passed (spec §26.9).

## Milestone 1 — Desktop Foundation and Editor

| # | Task | Status | Notes |
|---|---|---|---|
| 0.1 | Install / enable pnpm | Completed | pnpm 12.18.0 via `npm -g` (corepack blocked by no-admin) |
| 0.2 | Initialize git repository | Completed | |
| 0.3 | `.gitignore`, `CHANGELOG.md`, this file | Completed | |
| 1.1 | Root workspace `package.json` | Completed | `pnpm -r` scripts, `packageManager: pnpm@12.18.0` |
| 1.2 | `pnpm-workspace.yaml` | Completed | `nodeLinker: hoisted` (Forge requirement), `allowBuilds` map |
| 1.3 | `tsconfig.base.json`, `.npmrc`, `.env.example`, `README.md` | Completed | Strict TS, no `any` |
| 1.4 | Install M1 dependencies with pnpm (single lockfile) | Completed | Electron 45.2.3, Forge 8.0.1, Vite 8, React 19.3, Monaco 0.57, Vitest 5.1 |
| 2.1 | Secure main process (`window.ts`, security flags) | Completed | `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`, no webview, navigation/popup denial |
| 2.2 | Security helpers (sender validation, IPC whitelist) | Completed | CSP via `onHeadersReceived`, validated sender |
| 2.3 | Validated IPC handlers (`app:info`, …) | Completed | Arg validators per channel |
| 2.4 | Secure preload bridge (`contextBridge`, typed API) | Completed | Only `NovaApi` exposed; renderer has no `ipcRenderer`/Node access |
| 2.5 | Forge + Vite configs (main/preload/renderer) | Completed | Named entries → `main.cjs`/`preload.cjs`; FusesPlugin; Squirrel + ZIP makers |
| 3.1 | Renderer entry + app shell | Completed | Spec §6.1 grid: ActivityBar · Sidebar · Editor · AI panel · Terminal · StatusBar |
| 3.2 | IDE layout components | Completed | Unfinished areas labeled "planned" with milestone badges (M2/M3/M4) |
| 3.3 | Design tokens + dark/light themes + `useTheme` | Completed | |
| 4.1 | Monaco Editor integration | Completed | Lazy-loaded; workers configured (`monacoSetup.ts`) |
| 4.2 | Editor tabs (open/close/activate/dirty, in-memory buffers) | Completed | Real file I/O = M2; unsaved close uses `window.confirm` |
| 4.3 | Basic editor shortcuts | Completed | Tab management shortcuts |
| 5.1 | Vitest unit tests | Completed | `tests/unit/`: tabsReducer, language, ipcChannels |
| 5.2 | `pnpm typecheck` + `pnpm test` pass | Tested | typecheck exit 0; **21/21 tests pass** |
| 5.3 | Dev run (`pnpm dev`) — manual DoD check | Tested | Verified via CDP: all six regions render, `window.nova` bridge live, no console errors |
| 5.4 | Production build (`pnpm make`) verified | Tested | `NOVA IDE-0.1.0 Setup.exe` + zip produced; packaged app boots from ASAR and renders fully |
| 5.5 | Security configuration verification | Tested | Fuses read back from packaged `NOVAIDE.exe`: RunAsNode OFF, CookieEncryption ON, NodeOptions OFF, NodeCliInspect OFF, AsarIntegrity ON, OnlyLoadAppFromAsar ON |
| 5.6 | Documentation updates (README, CHANGELOG, this file) | Completed | |

### Milestone 1 Definition of Done

- [x] Desktop application launches
- [x] Main interface renders
- [x] Monaco editor works
- [x] Code can be edited
- [x] Multiple tabs work
- [x] Security settings are correct
- [x] Application builds successfully

**M1 completed** — dev and packaged builds verified via Chrome DevTools Protocol
(DOM geometry + screenshot + console), unit tests 21/21, fuses confirmed in the
packaged executable.

## Milestone 2 — Workspace and File Explorer

| # | Task | Status | Notes |
|---|---|---|---|
| A.1 | Shared IPC contract (`shared/ipc-types.ts`) | Completed | `IpcChannels`/`IpcInvokeMap` extended with compile-time `ChannelsCovered` guard; `FsResult<T>` discriminated union; `fsExternalChange` push channel |
| A.2 | Structured results + error mapping (`results.ts`) | Completed | errno → `FsErrorCode` table; logs action+errno only, never contents/stacks (spec §25) |
| A.3 | Path security (`pathSecurity.ts`) | Completed | `isValidEntryName`, `relateToRoot` (`path.relative`, no string-prefix), `resolveWorkspaceRoot`, `resolveInWorkspace` (NUL/input checks → lexical resolve → `realpath` of deepest existing ancestor → containment → `allowRoot`/`mustExist`); file-in-the-middle → `INVALID_PATH` on all platforms |
| A.4 | External-change watcher (`fileWatcher.ts`) | Completed | Bounded watch set (500), 1 s `fs.watchFile` polling, mtime echo suppression, own-write detection |
| B.1 | Filesystem service (`fileSystemService.ts`) | Completed | One-level `readDirectory` (2000-entry cap), text read (10 MB cap, NUL sniff + fatal UTF-8), conflict-aware save (50 MB cap), create/rename/delete with revalidation; delete resolves parent canonically and `lstat`s the leaf |
| B.2 | Workspace service (`workspaceService.ts`) | Completed | Native folder dialog, canonical root, recent workspaces persisted as JSON in userData |
| B.3 | IPC handlers (`ipc/workspace.ts`, `ipc/files.ts`) + preload bridge | Completed | Arg validation per channel; renderer sees only the narrow `NovaFsApi` |
| C.1 | Renderer workspace state (`workspaceReducer`, store) | Completed | Root/expanded/selection/loading/error + `pendingInput` for inline create-rename |
| C.2 | Explorer UI (`Explorer`, `FileTreeNode`, icons) | Completed | Auto-expands root, lazy per-level load, retry button, file-type icons, StrictMode-safe loading |
| C.3 | Shell wiring (Sidebar, StatusBar, App, notifications) | Completed | `Ctrl+Shift+E` focus explorer, `Ctrl+Shift+O` open folder, notification host |
| D.1 | CRUD hook (`useFileOperations.ts`) | Completed | Create/rename/delete with `window.confirm` on delete; rename re-keys tab ids + Monaco models and reloads the parent directory |
| D.2 | Save flow (tabsReducer `mark-saved`, App `Ctrl+S`, Monaco content sync) | Completed | Dirty tracking, per-tab save, conflict prompts |
| D.3 | External-change bridge (`useExternalFileChanges.ts`) | Completed | Clean → reload + toast; dirty → confirm before adopting disk; missing → warning, tab kept |
| D.4 | Context menu + inline input (`ExplorerContextMenu`, `InlineInput`) | Completed | Right-click create/rename/delete, F2/Enter/Esc inline editing |
| E.1 | Unit tests: path security (`pathSecurity.test.ts`) | Tested | 22 tests: name validation, root relation (incl. sibling-prefix trap), traversal/absolute escapes, symlink + dangling-symlink + file-in-the-middle cases (temp dirs only) |
| E.2 | Unit tests: filesystem service (`fileOperations.test.ts`) | Tested | 23 tests against the real service with only the Electron dialog mocked: workspace guard, ordering, read/save/conflict/caps, CRUD refusals, symlink-leaf delete, watch sync |
| E.3 | Typecheck + full test run | Tested | typecheck exit 0; **94/94 tests pass** (6 files) |
| E.4 | Production build (`pnpm package` + `pnpm make`) | Tested | installer + zip build succeeds |
| E.5 | Runtime verification (CDP, dev instance) | Tested | 69/69 checks: open workspace, lazy tree, open-in-Monaco, tab reuse, CRUD, save/dirty, external changes, boundary refusals, structured error messages |
| E.6 | Documentation (README, CHANGELOG, this file) | Completed | |

### Milestone 2 Definition of Done

- [x] Users can open a real project folder (native dialog, recent workspaces)
- [x] File tree lists one level lazily; folders expand/collapse
- [x] Files open in Monaco; reopening reuses the existing tab/model
- [x] Create/rename/delete files and folders with confirmation
- [x] `Ctrl+S` saves; dirty indicators track unsaved changes
- [x] External changes to open files are detected and handled (reload/confirm/warn)
- [x] Binary and unsupported files show a structured message instead of opening
- [x] All fs operations confined to the active workspace (realpath + containment,
      no string-prefix checks; root and symlink-leaf protections)
- [x] IPC remains validated; renderer still has no Node/fs access; M1 behavior intact
- [x] Unit tests pass (94/94), typecheck clean, `pnpm package`/`pnpm make` succeed

**M2 implemented — awaiting review.** Out of scope for M2 (planned): Guardian,
Line Companions, Swarm Rebuild, multi-agent, Project Brain, Runtime Detective,
voice, extension marketplace, cloud sync.

## Milestone 3 — Developer Tools

| # | Task | Status | Notes |
|---|---|---|---|
| A.1 | Terminal contract + preload bridge | Completed | `terminal:create/write/resize/kill` plus the `terminal:data` / `terminal:exit` push channels; the renderer only ever gets a session id |
| A.2 | Terminal service (`terminalService.ts`) | Completed | `node-pty` 1.1.0 (Microsoft) with prebuilt N-API binaries — no C++ toolchain, no Electron rebuild; the shell always starts inside the workspace, the requested working directory is re-validated; the process tree is terminated before the shell itself |
| A.3 | Terminal panel (`TerminalPanel`, `TerminalView`, `useTerminalSessions`) | Completed | Several sessions, live output (buffered output is replayed to a late subscriber), resize, copy; a session starts automatically as soon as a workspace is open |
| A.4 | Stop a running command | Completed | The "Stop" button sends Ctrl+C to the shell: the command is interrupted, the session stays usable |
| A.5 | Packaging of the native module | Completed | `node-pty` is `external` in the Vite main build and is copied unpacked next to the ASAR by a Forge `afterCopy` hook; verified in the packaged app |
| B.1 | Search contract + preload bridge | Completed | `search:query` / `search:cancel` plus the `search:results` push channel |
| B.2 | Search service (`searchService.ts`, `gitignore.ts`) | Completed | Runs in the main process, `.gitignore` honoured, build output and binary files skipped, incremental results, result cap (500), file cap (20000), cancellable |
| B.3 | Search view (`SearchView`, `useSearch`) | Completed | File name / content mode, debounced input, the previous request is cancelled, results open in the editor at the matching line |
| C.1 | Git contract + preload bridge | Completed | `git:status/stage/unstage/discard/commit/diff` |
| C.2 | Git service (`gitService.ts`) | Completed | Argument arrays only (`shell: false`), `--` separator, commit message through stdin (`-F -`), 30 s timeout, 8 MB output cap, trimmed environment without interactive prompts |
| C.3 | Source control view (`SourceControlView`, `useGit`) | Completed | Branch, staged / unstaged / untracked files, diff, stage / unstage / discard (confirmed) / commit |
| C.4 | Branch switching (spec §16) | Completed | The local branches are listed and one of them can be checked out; the name is matched against the list, so it can never be a git option; the git commands are serialised, because concurrent commands on one repository wait for the index lock |
| D.1 | Problems panel (`ProblemsPanel`, `problemMarkers.ts`, `useProblems.ts`) | Completed | Only markers that the language services really reported; severity, position and source; the badge of the panel tab shares the same store |
| E.1 | Task contract + preload bridge | Completed | `task:list/run/cancel` plus the `task:output` / `task:status` push channels |
| E.2 | Task service (`taskService.ts`) | Completed | Only the scripts of the workspace `package.json` can be started (the renderer sends a name, never a command); the script runs in a pseudo-terminal; stopping terminates the whole process tree |
| E.3 | Task panel (`TaskOutputPanel`, `useTasks`) | Completed | Script list, live output, status with the exit code, stop button |
| F.1 | Process hygiene | Completed | The quit is delayed until the process trees are gone; a detached watchdog kills the children of an application that died unexpectedly (spec §19.6) |
| G.1 | Unit tests: terminal | Tested | 14 tests: lifecycle, working-directory boundary, output, exit reporting, session cap |
| G.2 | Unit tests: search | Tested | 20 tests: ignore rules, node_modules, binary files, result cap, cancellation, batched delivery |
| G.3 | Unit tests: git | Tested | 16 tests against real repositories: clean, dirty, not-a-repository, git missing, option-like paths and messages, path confinement |
| G.4 | Unit tests: tasks | Tested | 11 tests: script list, success / failure, cancellation, process-tree cleanup |
| G.5 | Unit tests: IPC security | Tested | Per-channel validators and the rejection of messages from an untrusted sender |
| G.6 | Typecheck + full test run | Tested | typecheck exit 0; **172/172 tests pass** (12 files) |
| G.7 | Production build (`pnpm package` + `pnpm make`) | Tested | installer + zip build succeeds |
| G.8 | Runtime verification (CDP, packaged app) | Tested | 43/43 checks: terminal (start, output, focus, stop a running command), search (files, content), source control (branch, switch, stage, commit), problems (real TypeScript diagnostic), tasks (list, run, output, stop) — no console errors |
| G.11 | Editor tabs (spec §23 "Improve editor tabs") | Completed | The full path of a file is shown as the tooltip of the tab, the middle mouse button closes a tab, and a tab with unsaved changes is only closed after a confirmation |
| G.9 | Crash hygiene (`tools/verify/quitcleanup.mjs`) | Tested | The application is killed while a task runs: no process of the task is left behind |
| G.10 | Documentation (README, CHANGELOG, this file) | Completed | |

### Milestone 3 Definition of Done

- [x] An integrated terminal runs real commands in the workspace, and a
      running command can be interrupted without closing the session
- [x] Several terminal sessions can be open at the same time
- [x] A terminal session and its children are terminated when it is closed,
      when the workspace closes and when the application quits
- [x] The workspace can be searched by file name and by file content
- [x] The search respects `.gitignore`, skips build output and binary files,
      and can be cancelled
- [x] The repository state (branch, changes) is visible, files can be
      staged, unstaged, discarded and committed, and another local branch can
      be checked out
- [x] The problems panel lists the diagnostics of the open files
- [x] The scripts of the workspace `package.json` can be started, their output
      and exit code are shown, and they can be stopped with their children
- [x] The renderer still has no Node/filesystem access; every new channel is
      whitelisted and validated
- [x] Unit tests pass (179/179), typecheck clean, `pnpm package`/`pnpm make`
      succeed, 43/43 runtime checks pass in the packaged application
- [x] No process outlives the application — not after a clean quit and not
      after a crash

**M3 implemented — awaiting review.** Out of scope for M3 (planned): AI
provider integration, agent tools, planning and permissions, local models,
voice, extensions (see spec §23).

## Milestones 4–10

Not Started (see `NOVA_IDE_SPEC.md` §23 for scope).

