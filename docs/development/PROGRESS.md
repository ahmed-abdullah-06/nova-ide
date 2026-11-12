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
| C.1 | Git contract + preload bridge | Completed | `git:status/stage/unstage/discard/commit/diff/branches/switch-branch` |
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
| G.3 | Unit tests: git | Tested | 23 tests against real repositories: clean, dirty, not-a-repository, git missing, option-like paths and messages, path confinement, branch list and branch switch |
| G.4 | Unit tests: tasks | Tested | 11 tests: script list, success / failure, cancellation, process-tree cleanup |
| G.5 | Unit tests: IPC security | Tested | Per-channel validators and the rejection of messages from an untrusted sender |
| G.6 | Typecheck + full test run | Tested | typecheck exit 0; **179/179 tests pass** (12 files) |
| G.7 | Production build (`pnpm package` + `pnpm make`) | Tested | installer + zip build succeeds |
| G.8 | Runtime verification (CDP, packaged app) | Tested | 43/43 checks: terminal (start, output, focus, stop a running command), search (files, content), source control (branch, switch, stage, commit), problems (real TypeScript diagnostic), tasks (list, run, output, stop) — no console errors |
| G.9 | Crash hygiene (`tools/verify/quitcleanup.mjs`) | Tested | The application is killed while a task runs: no process of the task is left behind |
| G.10 | Documentation (README, CHANGELOG, this file) | Completed |
| G.11 | Editor tabs (spec §23 "Improve editor tabs") | Completed | The full path of a file is shown as the tooltip of the tab, the middle mouse button closes a tab, and a tab with unsaved changes is only closed after a confirmation | |

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

## Milestone 4 — AI Providers and Chat

| # | Task | Status | Notes |
|---|---|---|---|
| A.1 | Provider interface (`interfaces/provider.ts`) | Completed | `listModels`, `checkConnection`, a streaming `chat` and a cancel; the messages, the stream events, the errors, the token usage and the finish reasons are normalized (spec §11.2) |
| A.2 | Provider registry and router | Completed | The user picks the provider and the model; the router owns the running requests, really aborts them, caps the parallel requests (3) and the length of an answer (1,000,000 characters) |
| B.1 | Ollama provider | Completed | The official HTTP API (`/api/tags`, `/api/chat`); "not running" and "not installed" are distinguished; the request is aborted when the generation stops; a malformed chunk is reported instead of crashing |
| B.2 | The address of the local provider | Completed | Configurable, but it must point at the loopback interface — an address outside the machine has to be confirmed explicitly |
| C.1 | OpenAI compatible provider | Completed | The OpenAI chat completion API with a configurable address (OpenAI, OpenRouter, a local gateway, …); plain `fetch`, no SDK |
| C.2 | Errors of the cloud provider | Completed | Rate limits with the wait time of the service and a bounded number of retries, timeouts, cancellations, authentication errors, network errors, unknown models and malformed streams; the detail is redacted |
| D.1 | Credentials (`credentials.ts`) | Completed | The key is encrypted with `safeStorage`; it is never returned, never logged and never stored in plaintext (when the system cannot encrypt, the key is not stored) |
| D.2 | Privacy gate (`privacy.ts`) | Completed | A local provider never sends anything off the machine; a cloud provider needs an enabled provider, a key and the approval of the user for the context of *this* request |
| D.3 | Exclusions | Completed | `.env`, private keys, `.npmrc`, `.ssh` and the files that `.gitignore` ignores are never attached |
| E.1 | Chat panel | Completed | Streaming answers (the text is written into the state at most every 100 ms), stop, ask again, the conversations of the workspace, the provider and the model that are used, a LOCAL or CLOUD badge |
| E.2 | Markdown and code blocks | Completed | A small, purpose-built parser that produces text (never markup); the code blocks are highlighted with Monaco and offer a copy button; a link is only opened when it points at http or https |
| E.3 | Conversations | Completed | Plain JSON in the user data directory (the same approach as the recent workspaces); 50 conversations, 200 messages each; no key is ever stored in a conversation |
| E.4 | Provider settings | Completed | The address can be changed, the provider switched on and off, the connection tested and the key added or removed |
| F.1 | Context of a message | Completed | The current file, the selected code and files the user picks can be attached; the panel shows the name, the size and the approximate number of tokens of every item and lets the user remove it |
| F.2 | The limits of the context | Completed | A file that is too large is shortened and marked as such; the limits are never applied silently |
| G.1 | Unit tests: the provider contract | Tested | 15 tests: the interface, the registry, the router (routing, cancellation, the caps, the errors) |
| G.2 | Unit tests: Ollama | Tested | 11 tests against a real mock server: the models, "not running", "not installed", no models, the streaming, the cancellation, a malformed chunk, an unknown model, a remote address |
| G.3 | Unit tests: the cloud provider | Tested | 13 tests against a real mock server: 401, 429 with retry-after, the timeout, the abort during the stream, a malformed stream, a network error, no key in a message |
| G.4 | Unit tests: the credentials and the privacy | Tested | 7 + 19 tests: the key is encrypted and never returned, the gate, the exclusions, the limits |
| G.5 | Unit tests: the context | Tested | 8 tests: a selection is sent as the selected lines, the secret files are skipped, the preview |
| G.6 | Unit tests: the conversations | Tested | 10 tests: the persistence, the caps, a corrupted file, no key in the history |
| G.7 | Unit tests: the Markdown parser | Tested | 15 tests: the blocks, the inline forms, a link that is not http or https stays text |
| G.8 | Typecheck + full test run | Tested | typecheck exit 0; **293/293 tests pass** (22 files) |
| G.9 | Production build (`pnpm package` + `pnpm make`) | Tested | installer + zip build succeeds |
| G.10 | Runtime verification (CDP, packaged app) | Tested | 58/58 checks — the chat really streams an answer through a mock of the local Ollama service, the context is attached and previewed, no console errors |
| G.12 | Isolation of the verification runs | Tested | Every run uses its own, temporary profile directory (`--user-data-dir`), which is deleted afterwards; the harness compares the profile of the user before and after the run, so the settings, the keys and the conversations of the user are never touched |
| G.11 | Documentation (README, CHANGELOG, this file) | Completed | |

### Milestone 4 Definition of Done

- [x] The user can choose a provider and a model; nothing is hard-coded to a
      single service
- [x] The installed models of the local provider are listed (no model is
      assumed and none is pulled automatically)
- [x] A local provider answers without sending anything off the machine
- [x] A cloud provider only works after a key was configured and the provider
      was switched on; it is disabled by default
- [x] The answer streams into the panel, can be stopped and asked again
- [x] Conversations can be created, opened, renamed and deleted, and each one
      keeps its own provider and model
- [x] The answer is rendered as Markdown with highlighted code blocks; the
      output of a model can never execute markup
- [x] Files can be attached as context; the user sees exactly what will be
      sent and can remove every item
- [x] Workspace content is never sent to a cloud provider without the
      approval of the user for that request
- [x] API keys are encrypted with the operating system, stay in the main
      process and never reach the renderer or a log file
- [x] Unit tests pass (293/293), typecheck clean, `pnpm package`/`pnpm make`
      succeed, 53/53 runtime checks pass in the packaged application
- [x] No dependency was added: the Markdown parser is part of the application
      and the code highlighting uses Monaco

**M4 implemented — awaiting review.** Out of scope for M4 (planned): the agent
and its tools, planning and permissions, local model management, voice, the
extension marketplace (see spec §23).

## Milestone 5 — AI Coding Agent (single bounded agent)

| # | Task | Status | Notes |
|---|---|---|---|
| A.1 | Agent runtime (`main/agent/agentLoop.ts`) | Completed | A plan/act/observe loop that is separate from the provider layer and from the tool executor: the loop decides, the provider talks to the model, the executor runs the tools (spec §10.1, §10.5) |
| A.2 | Optional tool-call capability | Completed | The provider interface grows one optional capability: a request may carry the tools and a stream may report a tool call (`AIStreamEvent` → `toolCall`); a provider that does not support them never receives them. The OpenAI compatible and the Ollama adapter translate native tool calls |
| A.3 | Structured-output protocol | Completed | Without native tool calls the agent uses a strict JSON protocol (`{"thought","tool"}` / `{"thought","final"}`); a code fence or a sentence around the JSON is tolerated; a malformed answer is repaired **once** and then reported as a failure of the run — it never changes the behaviour of the application |
| A.4 | The limits of a run | Completed | Max steps (12), max wall-clock time (5 min), max characters of an answer (200 000), max consecutive failures (3) and the detection of a repeated action (the same tool with the same arguments twice in a row) |
| A.5 | The state machine | Completed | `idle` → `running` → `waitingForApproval` → `completed` / `failed` / `cancelled`; only **one** run at a time; the progress events are task scoped and concise — the private reasoning of the model is never exposed |
| A.6 | Real cancellation | Completed | The abort signal stops the in-flight model request **and** the running command; the router now reports a cancelled request as finished, so a caller that waits for the answer is never left hanging |
| B.1 | The tool registry (`main/agent/tools.ts`) | Completed | Every tool defines its name, its description, its schema and its permission level — the registry is the only place that knows the tools |
| B.2 | The read-only tools | Completed | `list_directory`, `read_file`, `search_files` (the search service of Milestone 3), `git_status` and `git_diff` (the Git wrapper of Milestone 3) |
| B.3 | The write tools | Completed | `write_file` and `apply_edit` — they create a **proposal**, they never write to the disk (spec §12.1) |
| B.4 | The command tool | Completed | `run_command`: the scripts of the workspace through the task runner of Milestone 3, or a command as an argument array (never a shell string); the working directory is locked to the workspace, the output is capped, the command can be stopped and it is terminated with its children |
| B.5 | The central permission policy (`main/agent/permissions.ts`) | Completed | One place decides every call: the tool allowlist, the permission level of the user, the workspace boundary (the canonical check of Milestone 2 — a symbolic link out of the workspace is refused too) and the excluded files. The agent and the model can never widen a permission |
| B.6 | The forbidden operations | Completed | No delete, no rename, no `git commit/push/reset/rebase/merge/tag/checkout/switch/clean`, no installation of a package, no shell (`sh`, `bash`, `cmd`, `powershell`), no interpreter with an inline program (`node -e`, `python -c`), nothing outside the workspace |
| B.7 | The validation of the arguments | Completed | Every argument is validated against the schema of the tool: an unknown property, a missing required property, a wrong type, an oversized string and an array of the wrong item type are errors |
| C.1 | The proposals (`main/agent/proposalStore.ts`) | Completed | Path, content before and after, unified diff, the mtime the agent read; the proposals of a run are kept apart from the proposals of another run |
| C.2 | The diff | Completed | A small unified diff generator in the repository (the longest-common-subsequence algorithm) — no dependency was added |
| C.3 | The review UI | Completed | The diff editor of Monaco shows the content before and after the change; Accept / Reject per change, plus Accept all / Reject all; nothing is written before the change is accepted |
| C.4 | The conflict on accept | Completed | The write goes through the file service of Milestone 2: when the file changed on disk since the agent read it, a conflict is reported and **nothing** is written |
| C.5 | The checkpoints | Completed | Every run keeps the content of the files it changed, so the whole run can be reverted; the checkpoints live in the application data directory and are capped (20) |
| C.6 | The final summary | Completed | The files that were inspected, the changes that were proposed, the commands that ran with their exit code, the errors and the problems that were not solved |
| D.1 | The privacy gate of a run | Completed | The gate of Milestone 4 decides whether the run may start; a cloud provider needs the approval of the user for **this** run (the provider, the model and the scope are shown); the approval is never remembered |
| D.2 | The redaction | Completed | The results of the tools are redacted before they go back to the model, so a secret that slipped into an output cannot leave the machine; the audit log holds metadata only |
| D.3 | The hardening against prompt injection | Completed | The system prompt states that the content of files, of commands and of search results is data and never instructions; a test with a file that tries to override the rules proves that nothing changes |
| E.1 | The agent panel | Completed | Task input, provider and model with the LOCAL/CLOUD badge, live timeline, approval prompts (a command, the scope of a cloud provider), the proposals with the diff review, the Stop button and the final report |
| E.2 | The failure states | Completed | The model cannot be reached, the output of the model is malformed, a permission was denied, a limit (steps or time) was reached, a command failed and a conflict on accept are all reported |
| E.3 | The sidebar | Completed | The "AI Agent" entry shows the real state of the current run — the placeholder is gone |
| F.1 | Unit tests: the agent loop | Tested | 18 tests: the parsing of the answer, the step limit, the detection of a loop, the repair of a malformed answer, the number of failures, an unknown tool, invalid arguments, the cancellation and the injection fixture |
| F.2 | Unit tests: the permissions | Tested | 28 tests: the tool levels, the traversal, the absolute path, the symbolic link out of the workspace (a junction), the secret files, the forbidden commands and the validation of the arguments |
| F.3 | Unit tests: the proposals | Tested | 17 tests: the diff, the proposals of a run, the checkpoints, the revert, the conflict on accept and the refusal of a path outside the workspace |
| F.4 | Unit tests: the IPC | Tested | The validators of the new channels (task, run id, approval answer, proposal id) and the whitelist of the channels |
| F.5 | Typecheck + full test run | Tested | typecheck exit 0; **376/376 tests pass** (27 files) |
| F.6 | Production build (`pnpm package` + `pnpm make`) | Tested | installer + zip build succeeds |
| F.7 | Runtime verification (CDP, packaged app) | Tested | 78/78 checks — the agent runs against a mock provider: the task, the timeline, the proposal, the review, the accept writes the file, the reject leaves the disk unchanged, the Stop cancels the run, the run can be reverted; no console errors |
| F.8 | Crash hygiene (`tools/verify/quitcleanup.mjs`) | Tested | The application is killed while a task runs: no process of the task is left behind; the profile of the user is not touched |
| F.9 | Documentation (README, CHANGELOG, this file) | Completed | |

### Milestone 5 Definition of Done

- [x] A task can be given to the agent and the run is visible step by step
- [x] The agent can read the workspace, search it and inspect the repository
- [x] A change is a proposal with a diff; it is written only after the user
      accepts it, and a conflict on accept overwrites nothing
- [x] A command needs the approval of the user and can never leave the
      workspace
- [x] The permission of every tool call is decided in one central place; the
      model can never widen it
- [x] A cloud provider needs the approval of the user for every run, and the
      LOCAL/CLOUD badge is always visible
- [x] A run is bounded (steps, time, size, failures, loops), can be stopped
      at any moment and never leaves a process behind
- [x] The renderer still has no Node/filesystem access; every new channel is
      whitelisted and validated, and the renderer never supplies file content
      or a command
- [x] Unit tests pass (376/376), typecheck clean, `pnpm package`/`pnpm make`
      succeed, 78/78 runtime checks pass in the packaged application
- [x] No dependency was added: the diff generator, the agent loop and the
      protocol are part of the application

**M5 implemented — awaiting review.** Out of scope for M5 (planned):
multi-agent systems, the planner of Milestone 6, the local model management
of Milestone 7, voice, the extension marketplace (see spec §23).

## Milestones 6–10

Not Started (see `NOVA_IDE_SPEC.md` §23 for scope).


