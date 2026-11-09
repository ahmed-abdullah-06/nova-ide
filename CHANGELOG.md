# Changelog

All notable changes to NOVA IDE are documented in this file.
Format follows a simplified [Keep a Changelog](https://keepachangelog.com/) approach.

## [Unreleased]

### Added

- Project specification (`NOVA_IDE_SPEC.md`).
- Repository initialized (git).
- Development progress tracking (`docs/development/PROGRESS.md`).
- **Milestone 1 — Desktop Foundation and Editor:**
  - pnpm monorepo workspace (single `pnpm-lock.yaml`, `nodeLinker: hoisted` for Forge).
  - Electron Forge 8 + Vite 8 + React 19 + TypeScript strict build tooling.
  - Secure Electron main process: `nodeIntegration: false`, `contextIsolation: true`,
    `sandbox: true`, no `<webview>`, navigation and popup denial, CSP via
    `onHeadersReceived`.
  - Validated IPC channel whitelist and typed `contextBridge` preload (`window.nova`).
  - IDE shell per spec §6.1: Activity Bar, Sidebar, Editor Area, AI Panel,
    Bottom Panel, Status Bar; dark/light theme tokens.
  - Monaco Editor integration with language workers and in-memory editor tabs.
  - Electron fuses hardened (RunAsNode and CLI inspect disabled, ASAR integrity on).
  - Vitest unit tests (21 passing): tab reducer, language mapping, IPC channels.

### Fixed

- `pnpm make` failed with the scoped package name `@nova/desktop`: added
  `productName`/`author` and explicit packager/maker naming
  (`executableName: NOVAIDE`, Squirrel id `NOVAIDE`) so the NuGet id, nupkg and
  exe paths are valid.
- Renderer crashed (`window.nova` undefined) when the preload bridge was absent;
  the startup bridge call is now guarded and the status bar omits the version
  instead of failing.

## Milestone Status

| Milestone | Status |
|---|---|
| M1 — Desktop Foundation and Editor | Completed |
| M2 — File Explorer and Workspace | Not Started |
| M3 — Tabs, Search, Terminal, and Git | Not Started |
| M4 — AI Provider Integration | Not Started |
| M5 — AI Agent and Tools | Not Started |
| M6 — Planning, Permissions, and Verification | Not Started |
| M7 — Local AI and Model Management | Not Started |
| M8 — Voice Assistant | Not Started |
| M9 — Advanced Computer-Control Agent | Not Started |
| M10 — Extensions, Packaging, and Release | Not Started |
