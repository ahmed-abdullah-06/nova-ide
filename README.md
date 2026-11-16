# NOVA IDE

AI-powered, cross-platform desktop integrated development environment.

**Status:** Milestone 7 - Local Model Management (implemented, awaiting review).
See [`NOVA_IDE_SPEC.md`](./NOVA_IDE_SPEC.md) for the full product specification and
[`docs/development/PROGRESS.md`](./docs/development/PROGRESS.md) for the development checklist.

## Architecture (current)

Modular pnpm monorepo:

```text
nova-ide/
├── apps/desktop/     Electron app: secure main process, preload bridge, React renderer
├── packages/         Shared packages (created gradually as milestones require them)
└── tests/            Unit / integration / e2e tests
```

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | ≥ 22.17 (Electron Forge 8 requirement) |
| pnpm | 12.x (`npm install -g pnpm`) |
| Git | any recent |

## Setup

```bash
pnpm install        # installs all workspace dependencies (single pnpm-lock.yaml)
```

## Development

```bash
pnpm dev            # start the Electron app with Vite dev server + HMR
pnpm typecheck      # TypeScript checks (tests + all workspaces)
pnpm test           # run unit tests (Vitest)
pnpm verify         # runtime verification of the packaged app (Chrome DevTools Protocol)
```

The runtime verification drives the real application: it starts the packaged
build, opens a workspace, uses the terminal, the search, the source control, the
problems panel, the task runner, the chat and the coding agent (against a mock
provider), approves and edits a plan, changes a permission category, reviews a
revert conflict and checks the verification report, manages the local models
(the list, the details, a download with its progress, the stop of a download,
the confirmation of a deletion and the new model in the list of the chat), and
reports every check it performed.

Every run uses its own, temporary profile directory, which is deleted
afterwards — the settings, the API keys and the conversations of the user are
never touched.

```bash
pnpm package                # the verification needs the packaged build
pnpm verify:fuses           # the fuses of the packaged executable are read back
node tools/verify/quitcleanup.mjs   # no process survives a crash of the app
```

## Production build

```bash
pnpm package        # package the app (asar, hardened fuses)
pnpm make           # build distributable installers (Windows Squirrel, zip)
```

## Features (Milestone 7)

Milestone 6 (planning, permissions and verification), Milestone 5 (the coding
agent), Milestone 4 (the provider layer and the chat) and Milestone 3
(terminal, search, Git, problems, tasks) are still in place:

- Open a workspace folder through the native folder picker; recent workspaces
  are remembered between launches.
- Lazy-loaded file tree (one directory level at a time, no full-disk indexing)
  with file-type icons, expand/collapse, and a reload affordance.
- Open files in Monaco; tabs are keyed by path so reopening a file reuses the
  existing tab and editor model.
- Create / rename / delete files and folders from the tree (context menu or
  keyboard), each destructive action behind an explicit confirmation.
- Save with `Ctrl+S`, dirty indicators per tab, and Save As for untitled tabs.
- External-change detection on open files: clean buffers reload, dirty buffers
  prompt before adopting the on-disk content, deleted files keep the tab open
  with a warning.
- Structured, user-readable errors for binary files, oversized files, missing
  folders, permission problems, and save conflicts.

Milestone 3 adds the developer tools:

- **Integrated terminal** in the bottom panel: several sessions, a real
  pseudo-terminal (Windows ConPTY), resize, copy, a "Stop" button that
  interrupts the running command, and a kill that terminates the whole
  process tree.
- **Project and file search** in the sidebar: by file name or by file content,
  honouring `.gitignore`, skipping build output and binary files, with
  incremental results and a bounded result count.
- **Git integration** in the sidebar: branch (with a switcher for the other
  local branches), staged / unstaged / untracked files, the diff of a file,
  stage, unstage, discard (behind a confirmation) and commit.
- **Problems panel** in the bottom panel: the diagnostics that the language
  services report for the open files, with severity, position and source.
- **Task runner** in the bottom panel: the scripts of the workspace
  `package.json` can be started, their output and exit code are shown, and a
  running task can be stopped together with its child processes.

Milestone 4 adds the AI assistant:

- **Provider layer** in the main process: a provider-neutral interface
  (list models, check the connection, stream an answer, cancel), a
  registry and a router. Nothing is hard-coded to a single model.
- **Ollama** for local models: the installed models are listed, the
  address is configurable (and must point at this machine unless it is
  confirmed explicitly), and no model is ever pulled automatically.
- **OpenAI compatible** for cloud services (OpenAI, OpenRouter, …): the
  address is configurable, the provider is disabled until a key is
  configured, and rate limits, timeouts and errors are reported clearly.
- **Credentials** are encrypted with the operating system
  (`safeStorage`) and stay in the main process; the renderer only sees
  whether a key is configured.
- **Privacy gate**: a local provider never sends anything off the
  machine; a cloud provider needs the context of a request to be
  approved, and files that usually hold secrets (`.env`, private keys,
  files that `.gitignore` ignores) are never sent.
- **Chat panel** in the layout: streaming answers, stop and ask again,
  conversations with their own provider and model, Markdown with
  highlighted code blocks, and the files that are attached to a message
  with their size and token count.

Milestone 5 adds the coding agent:

- **Agent mode in the AI panel**: a task is written in plain language, the
  provider and the model are chosen (with the LOCAL or CLOUD badge), the run
  is started, watched on a live timeline and stopped at any moment.
- **A bounded agent loop** in the main process: plan, act, observe. The
  output of the model is never trusted — a malformed answer is repaired once
  and then reported, never obeyed. A run is bounded by the number of steps,
  the wall-clock time, the size of the answer, the number of failures in a
  row and a detection of repeated actions. Only one run runs at a time.
- **Tools**: `list_directory`, `read_file`, `search_files` (the search of
  Milestone 3), `git_status` and `git_diff` (the Git wrapper of Milestone 3)
  read the workspace; `write_file` and `apply_edit` prepare a change;
  `run_command` runs a script of the workspace through the task runner of
  Milestone 3, or a command as an argument array (never a shell string).
- **One central permission policy**: it decides every tool call — the tool
  allowlist, the permission level of the user, the workspace boundary (the
  canonical check of Milestone 2, so a symbolic link out of the workspace is
  refused too) and the excluded files (`.env`, private keys, `.ssh`, `.git`,
  `node_modules`, the files that `.gitignore` ignores, binary files and
  oversized files). The model can never widen a permission.
- **Reviewable changes**: a change is a proposal with a unified diff, shown
  in the diff editor of Monaco. Nothing is written to the disk before the
  user accepts it; when the file changed on disk in the meantime, a conflict
  is reported and nothing is overwritten. A checkpoint of every run allows
  reverting the whole run.
- **Privacy**: a local provider needs no approval; a cloud provider needs the
  explicit approval of the user for *this* run, showing the provider, the
  model and the scope. The approval is never remembered. The results of the
  tools are redacted before they go back to the model, and the content of
  files, of commands and of search results is treated as data, never as
  instructions.
- **Honest reports**: the final report lists the files that were inspected,
  the changes that were proposed, the commands that ran with their exit code,
  the errors and the problems the agent could not solve. The agent never
  claims a success that no command proved.

Milestone 6 adds planning, permissions and verification:

- **An explicit plan before the agent acts**: a separate planner asks the
  model for a short plan (steps, likely files, expected command) and the run
  waits in `waitingForPlan`. The plan is shown before the first tool call and
  can be approved, edited or rejected. Only the step descriptions are
  editable — a plan can never change a permission, a command or a file. A
  rejected plan stops the run; an unusable plan is repaired once and then a
  visible minimal plan is shown instead of failing silently.
- **Deviations are reported**: the plan is advisory. When the agent changes a
  file or runs a command that is not in the approved plan, the timeline and
  the final report say so; nothing is blocked or hidden.
- **Permission categories**: *Read the workspace*, *Prepare file changes* and
  *Run commands*. Each shows its default. Narrowing a category is applied at
  once; widening one asks for a native confirmation of the main process,
  which the renderer and the model cannot bypass. Forbidden operations
  (delete, install, git commit/push, shells, anything outside the workspace)
  have no category and stay impossible.
- **A verification engine**: the report separates what was changed from what
  was verified. A change is only called verified when a command that passed
  ran after the last accepted change; pending proposals, failed or stopped
  commands and plan differences are reported as unresolved.
- **Test execution**: the `run_tests` tool runs a script of the workspace
  `package.json` only (a safe name, never an arbitrary shell string), through
  the existing task runner and its approval, and records it as a test.
- **Bounded error recovery**: a failed model call is retried once, at most
  twice per run, with a visible `recovery` event. Recovery never retries a
  cancelled run and the consecutive-failure limit still stops a broken
  provider.
- **Persistent audit history**: the metadata-only log (tool calls, commands,
  permission changes, approvals, proposals, runs) is written to
  `agent-audit.json` in the application data directory, bounded to 500
  entries, and shown in the agent panel. It never contains file content, a
  secret or the reasoning of the model.
- **Conflict-aware revert (M5 carry-over)**: a file that changed on the disk
  or in a dirty editor buffer after the run is only reverted after an
  explicit per-file confirmation. The revert dialog shows each conflict, only
  the confirmed conflicts are overwritten, and the safe files are restored by
  the same action.
- **Bounded context (M5 carry-over)**: the history sent to the model is
  bounded per provider and model, older tool results are shortened, a
  visible notice records it, and the system rules and the task are never
  dropped.
- **Real-model procedure**: the manual check with Ollama and with a cloud key
  is documented in
  [`docs/development/REAL_MODEL_TESTING.md`](./docs/development/REAL_MODEL_TESTING.md);
  automated tests use mock servers only and never make a paid call.

Milestone 7 adds the management of the local models:

- **A catalog of the installed models** in the settings of the AI panel: the
  name, the size on the disk, the parameter size, the quantization, the
  family and the day the model was changed - read from the HTTP API of
  Ollama (`/api/tags`). The models that are loaded in the memory come from
  `/api/ps` and are marked as such.
- **The details of a model** come from `/api/show`: the license, the context
  length and the capabilities that Ollama reports. A capability that Ollama
  did not report is shown as *unknown* - the application never claims that a
  model can call tools when it does not know it.
- **Hardware-aware guidance**: the main process reads the real facts of the
  machine (total and free memory, processors, free space of the drive that
  holds the models). Every model gets a fit estimate - *likely fine*, *slow*
  or *may not fit* - that compares its size with the free memory. The
  estimate is advice only and never blocks the user. No graphics card is
  assumed.
- **Only one large model at a time**: before a local request loads a model, a
  large model that is loaded and not used by a running request is unloaded.
  A model that a running chat or agent run uses is never unloaded.
- **Downloading a model**: the panel asks for the name, shows the free space
  of the drive and states that the model comes from the registry of Ollama
  over the internet. The download starts only after the user confirms it. The
  progress (percent, bytes, speed) is throttled, one download runs at a
  time, and the button that stops it really aborts the transfer.
- **Deleting and unloading**: the deletion asks for a confirmation that shows
  the name and the size of the model; the unload releases the copy in the
  memory and keeps the file on the disk. A model that a running request uses
  cannot be deleted or unloaded.
- **Defaults per use**: a default model for the chat and one for the agent,
  stored in the application data directory. The panel warns when Ollama does
  not report that the model of the agent can call tools, and it says that
  small models are unreliable for agent work.
- **The management is a user action**: the agent has no tool that downloads,
  deletes or unloads a model, and the permission policy of the agent is
  unchanged.

Not yet implemented (planned for later milestones): multi-agent systems,
voice, the advanced computer control of Milestone 9, the extension
marketplace and the release automation (see spec §23).

## Security model

- Renderer runs with `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- Renderer ↔ main communication only through a typed, whitelisted preload bridge;
  the renderer has no Node.js or raw filesystem API access.
- Every filesystem request is re-validated in the main process immediately
  before it runs: string/NUL checks, `realpath` canonicalisation (symlinks and
  traversal exposed), and containment via `path.relative` — never a string-prefix
  comparison. Destructive operations additionally refuse the workspace root and
  re-lstat the target (a symlink leaf is unlinked, never its target).
- Packaged builds use Electron fuses: `RunAsNode` off, ASAR integrity validation on,
  app loaded only from ASAR.
- The terminal and the task runner start their processes outside the process
  tree of the application. A watchdog terminates them (together with their
  children) if the application dies unexpectedly, so no process outlives the
  app.
- The AI requests are made by the main process only; the renderer cannot
  reach a provider (the content security policy of the renderer allows
  connections to the application only). API keys are encrypted with the
  operating system, never returned to the renderer and redacted from every
  log message.
- The coding agent works in the main process and stays inside the
  workspace. Every tool call passes the central permission policy; the
  renderer can only approve a request that already exists for the active
  run, and it never supplies file content or a command. The agent cannot
  delete or rename files, commit, push, install a package, use a shell or
  run anything outside the workspace.
- The agent may only run a command as an argument array (no shell string)
  with the working directory locked to the workspace, a timeout and a cap on
  the output; a command that runs is terminated together with its children
  when the run is stopped or the application quits.
- The changes of the agent are proposals: nothing is written before the user
  accepts them, the file service of Milestone 2 detects a conflict, and the
  audit log of the agent holds metadata only — never a secret, never the
  content of a file, never the reasoning of the model.
- Permission categories are stored and validated in the main process. The
  renderer can only ask for a change; narrowing is applied directly, while
  widening opens a native dialog of the main process. The plan of a run is
  advisory: it is displayed and can be edited in its descriptions only, and
  every tool call still passes the one central permission policy.
- Reverting a run never overwrites a file that changed after the run unless
  the user confirms that file in the revert dialog; the main process checks
  the disk itself and also accepts the paths of dirty editor buffers.
- The management of the local models happens in the main process only. The
  renderer sends a *name* - never an address, a path or a command - and the
  name is validated before the request is built, so a URL, a path or a shell
  fragment can never reach Ollama. The address must point at this machine
  unless the user confirmed it explicitly, a download only starts after the
  user confirmed it, and the agent has no tool that manages a model.

## Documentation

- [Product specification](./NOVA_IDE_SPEC.md)
- [Development progress](./docs/development/PROGRESS.md)
- [Real-model testing (manual)](./docs/development/REAL_MODEL_TESTING.md)
- [Changelog](./CHANGELOG.md)
