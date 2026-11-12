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
  - Branch switching (spec §16): the local branches are listed and one of
    them can be checked out. The name is matched against the list, so it can
    never be interpreted as a git option; the git commands are serialised,
    because concurrent commands on one repository wait for the index lock.
  - The terminal can interrupt a running command ("Stop" sends Ctrl+C to the
    shell, the session stays usable).
  - The editor tabs show the full path of a file, can be closed with the
    middle mouse button, and confirm the loss of unsaved changes.
  - The search shows a progress indicator while it runs.
  - Unit tests for the terminal, the search, the git wrapper, the task runner
    and the IPC security of the new channels — 179/179 tests passing in total.
- **Milestone 4 — AI Providers and Chat:**
  - Provider layer in the main process: a provider-neutral interface (list
    models, check the connection, stream an answer, cancel), a registry and a
    router that owns the running requests. The messages, the stream events,
    the errors, the token usage and the finish reasons are normalized, so
    the interface never depends on a specific service.
  - Ollama for local models: the installed models are listed (no model is
    assumed, none is pulled automatically), "not running" and "not
    installed" are distinguished, and the generation can really be aborted.
  - OpenAI compatible adapter for cloud services (OpenAI, OpenRouter, a
    local gateway, …) with a configurable address. It is disabled until a
    key is configured; rate limits (with the wait time of the service and a
    bounded number of retries), timeouts, cancellations, authentication
    errors, network errors, unknown models and malformed streams are
    reported with clear messages that never contain the key.
  - Credentials are encrypted with the operating system (`safeStorage`) and
    stay in the main process. The renderer only learns whether a key is
    configured; the detail of an error answer is redacted before it reaches
    the panel.
  - Privacy gate: a local provider never sends anything off the machine. A
    cloud provider needs an enabled provider, a key and the approval of the
    user for the context of *this* request. Files that usually hold
    secrets (`.env`, private keys) and files that `.gitignore` ignores are
    never attached.
  - Chat panel in the layout: streaming answers, stop and ask again,
    conversations with their own provider and model, a LOCAL or CLOUD badge,
    Markdown with highlighted code blocks and a copy button. The Markdown
    parser is part of the application, so the output of a model can never
    execute markup.
  - Context of a message: the current file, the selected code or files the
    user picks. The panel shows the name, the size and the approximate
    number of tokens of every item, and every item can be removed before
    the message is sent. A file that is too large is shortened and marked
    as such — the limits are never applied silently.
  - The conversations are stored as plain JSON in the user data directory,
    the same way the recent workspaces are stored. SQLite is not used: the
    data is a handful of small, flat records, so a database would add a
    native dependency and a migration system for a few hundred kilobytes of
    history.
  - No dependency was added: the Markdown parser is part of the application
    and the code highlighting uses Monaco, which is loaded already.
  - Unit tests for the provider contract, the Ollama and the cloud adapter
    (against real mock servers), the credentials, the privacy gate, the
    context and the conversations — 293/293 tests passing in total.
- **Milestone 5 — AI Coding Agent (single bounded agent):**
  - Agent runtime in the main process (`main/agent/`), split into three
    modules: the agent loop (plan/act/observe), the provider adapter and the
    tool executor. The loop decides what to do, the provider talks to the
    model and the executor runs the tools.
  - The provider interface grows one **optional** capability: a request may
    carry the tools and a stream may report a tool call. The OpenAI
    compatible and the Ollama adapter translate native tool calls; a model
    that does not use them falls back to a strict JSON protocol
    (`{"thought","tool"}` / `{"thought","final"}`) with a bounded repair
    attempt. The output of a model is never trusted.
  - Hard limits of a run: the number of steps, the wall-clock time, the size
    of an answer, the number of failures in a row and the detection of a
    repeated action. Only one run runs at a time; the run states are `idle`,
    `running`, `waitingForApproval`, `completed`, `failed` and `cancelled`.
    The progress events are concise and never expose the private reasoning
    of the model.
  - Tools: `list_directory`, `read_file`, `search_files`, `git_status` and
    `git_diff` read the workspace (reusing the search and the Git service of
    Milestone 3); `write_file` and `apply_edit` prepare a **proposal**;
    `run_command` runs a script of the workspace through the task runner of
    Milestone 3 or a command as an argument array (never a shell string).
  - One central permission policy decides every tool call: the tool
    allowlist, the permission level of the user, the workspace boundary (the
    canonical check of Milestone 2, so a symbolic link out of the workspace is
    refused too) and the excluded files (`.env`, private keys, `.ssh`, `.git`,
    `node_modules`, the files that `.gitignore` ignores, binary files and
    oversized files). The model can never widen a permission.
  - Not available in this milestone: deleting and renaming files, `git
    commit/push/reset/rebase/merge/tag/checkout/switch/clean`, the
    installation of a package, a shell, an interpreter with an inline program
    and everything outside the workspace.
  - Reviewable changes: a proposal carries the path, the content before and
    after and a unified diff; the diff editor of Monaco shows it, and every
    change is accepted or rejected on its own (plus "accept all" / "reject
    all"). Nothing is written before the change is accepted; when the file
    changed on disk in the meantime, a conflict is reported and nothing is
    overwritten. Every run keeps a checkpoint, so the whole run can be
    reverted.
  - Privacy: a local provider needs no approval, a cloud provider needs the
    approval of the user for *this* run (the provider, the model and the
    scope are shown, and the approval is never remembered). The results of
    the tools are redacted before they go back to the model, and the content
    of files, of commands and of search results is treated as data, never as
    instructions.
  - Agent mode in the AI panel: task input, provider and model with the
    LOCAL/CLOUD badge, live timeline, approval prompts, the proposals with
    the diff review, a Stop button and an honest final report (the files that
    were inspected, the commands with their exit code, the errors and the
    problems that were not solved). The "AI Agent" entry of the sidebar shows
    the real state of the run — the placeholder is gone.
  - Ten new IPC channels (whitelisted, with a validator per channel and a
    trusted-sender check) and two push channels keyed by the run id. The
    renderer never supplies file content or a command.
  - Audit log of the agent with metadata only: every tool call, every
    permission decision, every approval and every result — never a secret,
    never the content of a file.
  - No dependency was added: the unified diff generator, the agent loop and
    the JSON protocol are part of the application.
  - Unit tests for the agent loop (18), the permissions (28), the proposals
    (17) and the validators of the new channels — 376/376 tests passing in
    total. The runtime verification drives the agent in the packaged
    application against a mock provider (78/78 checks): the task, the
    timeline, the proposal, the diff review, the accept writes the file, the
    reject leaves the disk unchanged, the Stop cancels the run and the
    checkpoint of the run can be reverted.

### Fixed

- Cancelling a request of the provider router aborted the underlying request
  but never settled the promise of the caller, so a consumer that waited for
  the answer (the chat and the agent) stayed hanging forever. The router now
  reports a cancelled request as finished (`finish` / `cancelled`).
- The permission check of the agent compared the paths lexically, so a
  symbolic link inside the workspace that pointed outside of it was not
  refused. The check uses the canonical resolution of Milestone 2 now, so
  the link is followed and the file behind it is recognised as outside.
- The unified diff of a proposal marked the changed lines in the wrong order
  and counted the trailing newline as an extra line.
- The verification harness started the application with the profile of the
  user, so a test run overwrote the settings of the providers (the address
  of Ollama was left pointing at the mock server of the harness), the API
  keys and the conversations. Every run now uses its own, temporary profile
  directory (`--user-data-dir`) that is deleted afterwards, and the
  harness compares the profile of the user before and after the run, so a
  regression that touches it is reported.
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
| M4 — AI Providers and Chat | Implemented (awaiting review) |
| M5 — AI Coding Agent (single bounded agent) | Implemented (awaiting review) |
| M6 — Planning, Permissions, and Verification | Not Started |
| M7 — Local AI and Model Management | Not Started |
| M8 — Voice Assistant | Not Started |
| M9 — Advanced Computer-Control Agent | Not Started |
| M10 — Extensions, Packaging, and Release | Not Started |
