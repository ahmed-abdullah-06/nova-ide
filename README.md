# NOVA IDE

AI-powered, cross-platform desktop integrated development environment.

**Status:** Milestone 2 — Workspace and File Explorer (implemented, awaiting review).
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
```

## Production build

```bash
pnpm package        # package the app (asar, hardened fuses)
pnpm make           # build distributable installers (Windows Squirrel, zip)
```

## Features (Milestone 2)

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

Not yet implemented (planned for later milestones): project-wide search,
integrated terminal, Git integration, AI features (see spec §23).

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

## Documentation

- [Product specification](./NOVA_IDE_SPEC.md)
- [Development progress](./docs/development/PROGRESS.md)
- [Changelog](./CHANGELOG.md)
