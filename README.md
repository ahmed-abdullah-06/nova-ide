# NOVA IDE

AI-powered, cross-platform desktop integrated development environment.

**Status:** Milestone 1 — Desktop Foundation and Editor (in progress).
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

## Security model (Milestone 1 baseline)

- Renderer runs with `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.
- Renderer ↔ main communication only through a typed, whitelisted preload bridge.
- Packaged builds use Electron fuses: `RunAsNode` off, ASAR integrity validation on,
  app loaded only from ASAR.

## Documentation

- [Product specification](./NOVA_IDE_SPEC.md)
- [Development progress](./docs/development/PROGRESS.md)
- [Changelog](./CHANGELOG.md)
