# User Guide

This guide describes how to use the V1 desktop application. It is written for
a first-time user on Windows. The app is a local-first IDE: it works entirely
on your machine unless you explicitly enable a cloud provider.

## 1. Getting started

1. Install with the generated `A6-0.1.0 Setup.exe` (or run the portable build).
   The installer is per-user; no administrator rights are required. If you used
   the earlier NOVA IDE build, your settings, encrypted keys and conversations
   are preserved — the app keeps reading its existing profile.
2. On first launch there is no workspace open. Use **File → Open Folder**
   (or `Ctrl+Shift+O`) to choose a project directory.
3. The layout has five regions: the **activity bar** (left icons), the
   **sidebar** (explorer/search/source control/agent), the **editor**, the
   **AI panel**, the **bottom panel** (problems/output/terminal/tasks), and the
   **status bar**.

## 2. Editing files

- The explorer lists one directory level at a time. Click a folder to expand
  it; folders load lazily, so very large projects stay responsive.
- Double-click a file to open it in Monaco. Open files become tabs; reopening
  the same file reuses its tab and editor model.
- `Ctrl+S` saves the active file. A dot on the tab means unsaved changes.
- Right-click in the explorer to create, rename or delete files and folders.
  Deletion asks for confirmation. `F2` renames the selected item.
- **Save As** is available for untitled tabs.
- If a file changes on disk while it is open: a clean buffer reloads
  automatically; a dirty buffer asks before adopting the on-disk content; a
  deleted file keeps its tab with a warning.
- Binary files, oversized files (>10 MB read cap) and unreadable files show a
  clear message instead of opening.

## 3. Terminal

- The bottom panel hosts a real terminal (Windows ConPTY). A session starts
  automatically when you open a workspace, or create more with the **+**
  button.
- Commands run with the workspace as the working directory.
- The **Stop** button sends Ctrl+C to interrupt the running command without
  closing the session. Closing a session terminates the whole process tree.
- Closing the workspace or quitting the app terminates every session and its
  children; a watchdog also kills them if the app crashes.

## 4. Search

- The sidebar search searches by **file name** or by **file content**.
- It respects `.gitignore`, skips build output and binary files, and streams
  results incrementally. Results are capped (500) to keep it fast.
- Clicking a result opens the file at the matching line.

## 5. Source control (Git)

The source control view shows the current branch, staged/unstaged/untracked
files and lets you stage, unstage, discard (with confirmation), commit, view a
diff and switch between local branches. Git must be installed and on your
`PATH`. The app never configures remotes or pushes for you.

## 6. Problems and tasks

- **Problems** lists the diagnostics the language services report for open
  files (severity, position, source).
- **Tasks** lists the scripts in your workspace `package.json`. Starting a
  script shows live output and its exit code; **Stop** terminates it with its
  children. The renderer can only choose a script name, never an arbitrary
  command.

## 7. AI chat

The AI panel requires you to pick a **provider** and a **model**. Nothing is
hard-coded to a single service.

- **Local (Ollama)** is enabled by default and talks to a local Ollama service
  on `127.0.0.1:11434`. No model is downloaded automatically. Change the
  address in the provider settings; a non-loopback address needs one explicit
  confirmation.
- **Cloud (OpenAI-compatible)** is disabled by default. Add an API key and
  switch it on to use it. The key is encrypted by the operating system, stays
  in the main process and is never shown to the page or written to a log.
- Type a message and press Enter. The answer streams in; you can **stop** it
  and **ask again**. Answers are rendered as Markdown with highlighted code.
- You can attach the current file, a selection, or picked files as context.
  The panel shows each item's name, size and approximate token count. Secret
  files (`.env`, private keys, `.npmrc`, `.ssh`, …) and `.gitignore`-ignored
  files are never attached.
- When a request carries workspace content to a **cloud** provider, you must
  approve that context for **each request**; the approval is never remembered.
- Conversations are saved locally (50 conversations, 200 messages each) and
  each keeps its own provider and model.

## 8. Coding agent

The agent works in the main process, inside your workspace.

1. Describe a task in plain language and choose a provider/model. A **LOCAL**
   or **CLOUD** badge is always shown.
2. The agent first produces a **plan**. You can approve it, edit the step
   descriptions, or reject it (which stops the run). A plan is advisory and
   can never grant a permission or inject a command.
3. Tool calls are checked against a central permission policy: only `read` is
   allowed without asking by default. **Workspace edits** and **commands**
   need your approval; widening a permission opens a native confirmation.
   The agent cannot delete/rename files, commit/push, install packages, use a
   shell, or leave the workspace.
4. File changes are **proposals** shown as a diff. Nothing is written until
   you accept. If the file changed on disk meanwhile, a conflict is reported
   and nothing is overwritten. You can revert a whole run.
5. The final report separates what changed from what was actually verified
   (a command that passed after the last change) and lists errors honestly.

Agent audit metadata (tool calls, commands, approvals) is kept locally in
`agent-audit.json` with no file contents or secrets.

## 9. Local models

The AI settings → **Models** section talks to your Ollama service. It lists
installed models with their real facts, shows which are loaded in memory, and
gives a hardware-based fit estimate (advice only). Model details
(license, context length, capabilities) are read from Ollama; an unreported
capability shows as *unknown*. You can download a model (after confirming the
internet fetch and seeing free disk space), stop a download, delete a model
(after confirmation) and unload one from memory. A model in use cannot be
deleted or unloaded. The app never downloads an engine or model on its own,
and the agent has no tool to manage models.

## 10. Voice

- **Voice input**: set a local whisper.cpp-compatible executable in the voice
  settings, then use the microphone button (or the configured push-to-talk
  key). Audio is resampled to 16 kHz mono, piped to the executable and never
  written to disk. The recognised text lands in the composer for you to
  review — it is never sent automatically.
- **Read aloud**: with an answer shown, press **Read aloud** to have your
  operating system's offline voices speak it. Secrets are redacted and code
  blocks are skipped. **Stop** cancels at once. No sound is produced unless
  you press the button.

A cloud speech engine is not available in this build. The app never downloads
a voice engine or model; you supply the files.

## 11. Local-only mode

The header shows a **LOCAL ONLY** badge when local-only mode is on. In the
main process it blocks every cloud AI provider and the cloud speech engine,
even if a key or approval exists. It does not block links you open in your
browser, downloads performed by your local Ollama service, or commands you run
yourself in the terminal.

## 12. Privacy and data

Everything the app stores lives in your user data directory on the local disk.
There is no telemetry, analytics or background network service. See
[PRIVACY.md](./PRIVACY.md) for the full data-flow description, and
[SECURITY.md](./SECURITY.md) for the security model.

## 13. Getting help

See [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) for common issues, and
[KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) for what is intentionally not in
V1. To find the application log, use **Help → Open Logs Folder**.
