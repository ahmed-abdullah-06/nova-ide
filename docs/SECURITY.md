# Security model (V1)

This document describes the security posture of the V1 release candidate as
**implemented and verified** in this repository. It complements
[PRIVACY.md](./PRIVACY.md) (data flows) and the "Security model" section of the
[README](../README.md). Statements here are tied to code and to checks that
actually ran; unresolved items are listed in
[KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md).

## 1. Process isolation

- The renderer runs with `nodeIntegration: false`, `contextIsolation: true`
  and `sandbox: true`. It has **no** Node.js, `ipcRenderer` or raw filesystem
  access.
- Renderer ↔ main communication happens only through a typed, whitelisted
  `contextBridge` preload (`window.nova`). Each invoke channel is validated in
  the main process and guarded by a trusted-sender check; a compile-time
  `ChannelsCovered` guard fails the build if a channel is missing from the
  coverage map.
- Navigation and popup creation are denied; there is no `<webview>`. A Content
  Security Policy is installed via `onHeadersReceived`, restricting the
  renderer's connections to the application.
- Packaged builds use Electron **fuses**: `RunAsNode` off, `CookieEncryption`
  on, `NodeOptions` off, `NodeCliInspect` off, `ASAR integrity` on and
  `OnlyLoadAppFromAsar` on. `pnpm verify:fuses` reads all six back from the
  packaged `A6IDE.exe`; all six are OK.
- No fuse or CSP value was changed during the V1 stabilization work. Any
  future change requires justification and a re-run of the full gate suite.

## 2. Filesystem boundary

- Every filesystem request is re-validated in the main process **immediately
  before it runs**: string/NUL checks, `realpath` canonicalisation of the
  deepest existing ancestor (so symlinks and traversal are exposed), and
  containment via `path.relative` — never a string-prefix comparison.
- Destructive operations refuse the workspace root and re-`lstat` the target,
  so a symlink leaf is unlinked rather than its target. A path whose middle
  component is a file reports `INVALID_PATH` consistently across platforms.
- Read caps (binary sniff, 10 MB text read, 2000-entry directory listing) keep
  hostile or oversized workspaces from freezing the editor.

## 3. Credentials and privacy gate

- Provider API keys are encrypted with the OS (`safeStorage`) and decrypted
  only in the main process. The renderer receives only a `hasKey: boolean`;
  logs and errors are redacted and never contain a key.
- A local provider (Ollama) only talks to a loopback address unless the user
  explicitly confirms a remote address (`remoteConfirmed`). A cloud provider
  needs a key, to be enabled, and a per-request context approval whenever
  workspace content is attached. That approval is never remembered.
- Files that commonly hold secrets (`.env*`, private keys, `.npmrc`,
  `.netrc`, `.ssh`, …), excluded directories and `.gitignore`-ignored files are
  never attached as context.
- **Local-only mode** is enforced in the main process: it blocks every cloud
  provider and cloud voice regardless of keys or approvals. It does not and
  cannot block browser links, your own Ollama downloads, or commands you run
  in the integrated terminal.
- There is no telemetry, analytics, crash-upload or background network service.

## 4. Untrusted content

Workspace files, model output and web links are treated as **data, never as
instructions**. The chat system prompt states this; the agent's tool calls are
checked against an allowlist, canonical path containment and permission
settings before anything happens; model output cannot widen a permission or
open a non-HTTP(S) URL (`assertExternalUrl` only accepts `http:`/`https:`).

The Markdown renderer sanitizes untrusted model output with DOMPurify. During
the 10A audit a dependency override pinned DOMPurify to a patched version; a
regression test guards the override. Two unrelated **moderate, build-time**
`glob`/`minimatch` findings remain and are documented in
[development/PROGRESS.md](./development/PROGRESS.md) — they are not part of the
shipped runtime.

## 5. Agent boundary

- The agent runs in the main process, inside the workspace. One central
  permission policy decides every tool call: allowlist, user level, canonical
  workspace boundary and excluded files. The model can never widen a
  permission.
- File changes are **proposals** shown as a diff; nothing is written until the
  user accepts, and a disk/editor conflict blocks a stale overwrite. A run can
  be reverted, with per-file confirmation for conflicts.
- Forbidden operations have no permission category and stay impossible:
  delete/rename, Git commit/push/reset, package installation, a shell, an
  inline interpreter and anything outside the workspace. Commands may only run
  as an argument array (never a shell string), with a locked working directory,
  a timeout and a capped output.
- The audit log holds metadata only — never file contents, secrets or model
  reasoning — and is bounded to 500 entries.

## 6. Process hygiene

The terminal, task runner, voice engine and other child processes are started
outside the app's process tree and are terminated when the workspace closes,
the run stops, or the app quits. A watchdog kills them if the app dies
unexpectedly. `pnpm verify:quitcleanup` forces a crash and confirms no child
survives; `pnpm verify:packaging` confirms no application process survives a
forced kill.

## 7. Supply chain and release hygiene

- Dependencies are locked in a single `pnpm-lock.yaml`. No new runtime
  dependency was added during V1 stabilization; the DOMPurify change is a
  version override of an existing transitive dependency, pinned in
  `pnpm-workspace.yaml` (pnpm 12 ignores a `pnpm.overrides` field in
  `package.json`).
- `pnpm audit --audit-level high` exits 0. Findings are recorded honestly in
  the 10A entry of the changelog/progress, not suppressed.
- The verification CI (`.github/workflows/verify.yml`) has `contents: read`
  only. It builds and verifies, uploads artifacts, and does **not** publish,
  tag, push or reference secrets.
- No certificate, secret, token or personal path is committed.
  `node tools/release/checklist.mjs` scans tracked files for secret patterns
  and personal paths (test fixtures excluded) and reports 17/17 automated
  checks on the clean tree.

## 8. Known gaps (honest)

- The shipped binaries are **unsigned**; SmartScreen/Gatekeeper warnings apply
  until the owner signs. Signing and notarization are documented owner manual
  steps, not claimed as done.
- Only **Windows x64** was built and verified. macOS/Linux native installers,
  signing and notarization are not implemented.
- The CSP is header-based; no nonce/hash-based strict-dynamic policy was added
  during V1 (a change would require full re-verification).
- A complete real Squirrel install → uninstall cycle was not automated because
  it modifies the developer machine; process-cleanup and clean-location checks
  are the automated proxies and the real cycle is an owner manual step.

Report suspected security issues through your repository's normal owner
channel; do not post a live credential or an unpatched exploit publicly.
