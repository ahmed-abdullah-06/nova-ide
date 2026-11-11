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
- **Milestone 2 — Workspace and File Explorer:**
  - Workspace open/close via the native folder dialog, persisted recent
    workspaces (`recent-workspaces.json` in userData).
  - Lazy file tree (one directory level per expand, 2000-entry cap, no
    full-disk indexing) with file-type icons, reload, and error/retry states.
  - Files open in Monaco; tabs are keyed by file path, so reopening reuses the
    existing tab and editor model.
  - Create / rename / delete files and folders from the explorer context menu
    or keyboard, with explicit confirmation before deletion.
  - Save (`Ctrl+S`) with dirty tracking, Save As for untitled tabs, and
    structured save-conflict (`CONFLICT`) handling.
  - External-change detection for open files: clean buffers reload, dirty
    buffers prompt before adopting disk content, deleted files keep the tab
    open with a warning.
  - Structured `FsResult` errors (binary file, file too large, permission
    denied, not found, already exists, invalid name, outside workspace, …)
    surfaced as user-readable notifications.
  - Workspace path security: input validation, `realpath` canonicalisation,
    `path.relative` containment (no string-prefix checks), root protection,
    symlink-leaf-safe deletion, and pre-mutation revalidation.
  - IPC additions (`workspace:*`, `files:*`, `fsExternalChange`) with compile-time
    channel coverage; preload exposes only the narrow `NovaFsApi` bridge.
  - Unit tests: `pathSecurity.test.ts` (22) and `fileOperations.test.ts` (23)
    against real temp directories — 94/94 tests passing in total.
- **Milestone 3 — Developer Tools:**
  - Integrated terminal in the bottom panel: several sessions on a real
    pseudo-terminal (Windows ConPTY), live output, resize, copy, and a kill
    that terminates the whole process tree.
  - Project and file search in the sidebar: by file name or by file content,
    honouring `.gitignore`, skipping build output and binary files, with
    incremental results, a result cap (500) and cancellation.
  - Git integration in the sidebar: branch, staged / unstaged / untracked
    files, the diff of a file, stage, unstage, discard (behind a confirmation)
    and commit.
  - Problems panel in the bottom panel: the diagnostics that the language
    services report for the open files (severity, position, source); the
    panel only shows markers that the language services really produced.
  - Task runner in the bottom panel: the scripts of the workspace
    `package.json` can be started, their output and exit code are shown, and
    a running task can be stopped together with its child processes.
  - `node-pty` 1.1.0 (Microsoft) provides the pseudo-terminal. It ships
    prebuilt N-API binaries, so no C++ toolchain and no Electron rebuild are
    needed on the build machine; the native module is shipped unpacked next
    to the ASAR.
  - Process hygiene (spec §19.6): every child process is terminated when the
    workspace closes or the application quits, and a watchdog terminates the
    children of an application that died unexpectedly — no process outlives
    the application.
  - Reusable runtime verification harness (`tools/verify/`): it drives the
    packaged application through the Chrome DevTools Protocol and checks the
    terminal, the search, the source control, the problems panel and the task
    runner (36/36 checks), plus a separate check that no process survives a
    crash of the application.
  - Unit tests for the terminal, the search, the git wrapper, the task runner
    and the IPC security of the new channels — 172/172 tests passing in total.

### Fixed

- `pnpm make` failed with the scoped package name `@nova/desktop`: added
  `productName`/`author` and explicit packager/maker naming
  (`executableName: NOVAIDE`, Squirrel id `NOVAIDE`) so the NuGet id, nupkg and
  exe paths are valid.
- Renderer crashed (`window.nova` undefined) when the preload bridge was absent;
  the startup bridge call is now guarded and the status bar omits the version
  instead of failing.
- Renaming a file did not refresh its parent directory listing, so the renamed
  row disappeared from the tree and follow-up actions targeted stale paths.
- Rebuilding state on `path-removed` broke reference-equality no-ops when no
  tab matched the removed path.
- Only the first affected tab's Monaco model was re-keyed when a renamed file
  was open in multiple tabs.
- A path whose middle component was a file resolved to `NOT_FOUND` on Windows
  but `INVALID_PATH` on POSIX; canonicalisation now reports `INVALID_PATH`
  consistently on all platforms.

## Milestone Status

| Milestone | Status |
|---|---|
| M1 — Desktop Foundation and Editor | Completed |
| M2 — File Explorer and Workspace | Implemented (awaiting review) |
| M3 — Developer Tools (Terminal, Search, Git, Problems, Tasks) | Implemented (awaiting review) |
| M4 — AI Provider Integration | Not Started |
| M5 — AI Agent and Tools | Not Started |
| M6 — Planning, Permissions, and Verification | Not Started |
| M7 — Local AI and Model Management | Not Started |
| M8 — Voice Assistant | Not Started |
| M9 — Advanced Computer-Control Agent | Not Started |
| M10 — Extensions, Packaging, and Release | Not Started |
