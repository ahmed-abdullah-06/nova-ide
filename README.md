# NOVA IDE

AI-powered, cross-platform desktop integrated development environment.

**Status:** Milestone 4 — AI Providers and Chat (implemented, awaiting review).
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
problems panel and the task runner, and reports every check it performed.

```bash
pnpm package                # the verification needs the packaged build
node tools/verify/quitcleanup.mjs   # no process survives a crash of the app
```

## Production build

```bash
pnpm package        # package the app (asar, hardened fuses)
pnpm make           # build distributable installers (Windows Squirrel, zip)
```

## Features (Milestone 4)

Milestone 3 (terminal, search, Git, problems, tasks) is still in place:

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

Not yet implemented (planned for later milestones): the agent and its
tools, planning and permissions, local models, voice, the extension
marketplace (see spec §23).

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

## Documentation

- [Product specification](./NOVA_IDE_SPEC.md)
- [Development progress](./docs/development/PROGRESS.md)
- [Changelog](./CHANGELOG.md)
