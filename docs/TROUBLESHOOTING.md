# Troubleshooting

Solutions to common first-run and everyday issues in the V1 build. For the
security model see [SECURITY.md](./SECURITY.md); for what is intentionally not
in V1 see [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md). To find the log, use
**Help → Open Logs Folder** in the application.

## Installation and launch

**Windows SmartScreen says "Windows protected your PC" / publisher unknown.**
The V1 binaries are **unsigned** — no code-signing certificate was used. This
is expected and documented in [PACKAGING.md](./PACKAGING.md); it is not a sign
of tampering in this build. Until the owner signs the installer, choose *More
info → Run anyway* only if you trust where you obtained the installer, or ask
the owner for a signed build. Do not disable SmartScreen globally.

**The installer will not start / the app does not appear.** The Squirrel
installer is per-user; it does not need administrator rights. Run the exact
`A6-0.1.0 Setup.exe` produced by `pnpm make`. If an older copy is already
installed, uninstall it first (Settings → Apps). The portable
`A6-win32-x64` folder can be run directly without installing.

**The app starts but shows a blank window.** Check the log in the logs folder.
A broken preload bridge is guarded (the status bar omits the version instead of
crashing), so a blank window points to a rendering or GPU issue. Try updating
your integrated graphics drivers — the verified dev machine uses Intel
integrated graphics.

**A stale `A6IDE.exe` process remains.** Use Task Manager to end it. The
application is expected to leave no process behind after quit or crash —
`pnpm verify:quitcleanup` checks this. If it happens repeatedly, report it with
the log.

## Provider and AI chat

**"Ollama does not seem to be running" / no models are listed.** The local
provider talks to `http://127.0.0.1:11434` by default. Install and start Ollama
separately, then confirm it responds at that address. The app does **not**
start Ollama and does not download models on its own. If you changed the
address, open the provider settings and check it; a non-loopback address needs
an explicit one-time confirmation.

**The cloud provider is greyed out / requests are refused.** Cloud providers
are disabled by default and need all of: an API key you add in the settings,
the provider switched on, and — when a request carries workspace files — a
per-request context approval. The approval is deliberately not remembered. A
key is stored encrypted and the UI only shows whether one exists.

**Requests are refused with everything configured — is local-only on?** The
header shows a **LOCAL ONLY** badge when local-only mode is enabled. In that
mode the main process blocks every cloud provider and cloud voice, even with a
key and an approval. Turn it off in the settings if you intend to use a cloud
provider.

**Rate limits, timeouts or malformed answers.** These are reported with a
clear message that never contains the key. Retry, or switch provider/model.
Automated tests cover these paths with a mock server; no test makes a paid
call.

## Files and editor

**A file opens as binary / "file too large" / "permission denied".** The app
reads text files up to a 10 MB cap and refuses binary files and unreadable
paths with a structured message. Use an external tool for such files; the cap
protects the editor from freezing.

**"Save conflict" on `Ctrl+S`.** The file changed on disk since you opened it.
The app shows the conflict and lets you decide; it never silently overwrites
external changes.

**An open file changed on disk.** A clean buffer reloads automatically; a dirty
buffer asks before adopting the on-disk text; a deleted file keeps its tab with
a warning.

**A renamed file disappeared from the tree.** Refresh the explorer (the reload
affordance). Renaming now refreshes the parent directory listing; if a stale
row persists, reload the folder.

## Terminal, Git and tasks

**The terminal does not start.** The integrated terminal uses Windows ConPTY
and launches with the workspace as its working directory. Open a workspace
first. The **Stop** button interrupts the running command (Ctrl+C) without
closing the session; closing a session terminates its whole process tree.

**Git actions show no repository / branch switch fails.** Git must be installed
and on your `PATH`. The app never configures remotes or pushes for you. Branch
switching only lists existing local branches, so the value cannot be treated as
a Git option.

**A task does not appear.** The task runner lists the scripts from the
workspace `package.json`. The renderer can only pick a script name, never an
arbitrary command.

## Voice

**No microphone input.** Voice input requires a local whisper.cpp-compatible
executable whose path you configure in the voice settings. The microphone
opens only while a recording session is active, via the microphone button or
the configured push-to-talk key (F8 by default). No audio is written to disk.
The app never downloads a voice engine or model; you supply the files.

**Cloud speech is unavailable.** Selecting the cloud speech engine is refused
with a "not available in this build" message by design — there is no cloud
transport in V1. Read-aloud uses your operating system's offline voices; press
the **Read aloud** button and **Stop** to cancel. No sound is produced
otherwise.

## Agent

**A tool call is waiting for approval.** By default only `read` is allowed
without asking. Workspace edits and commands need your approval; widening a
permission opens a native confirmation dialog from the main process. The model
cannot widen a permission or inject a command. Files outside the workspace,
secret files and `.gitignore`-ignored files are refused by the central policy.

**A proposal shows a conflict.** If a file changed on disk after the agent read
it, accepting the proposal is refused and a conflict is reported — nothing is
overwritten. Review the current file and re-run the task. Reverting a run also
asks per file when a file changed after the run.

**The agent report says "unverified".** A change is only called verified when a
command that passed ran after the last accepted change. Pending proposals,
failed/stopped commands and deviations from the plan are reported honestly as
unresolved.

## Diagnostics

`pnpm verify` drives the real packaged app through 133 checks with an isolated
temporary profile; `pnpm verify:packaging` runs 26 metadata/first-run and
profile-survival checks;
`pnpm verify:fuses` reads back all six hardening fuses; and
`pnpm verify:quitcleanup` checks that no child process survives a crash. Every
run deletes its temporary profile and verifies that your real profile was not
touched. See [PACKAGING.md](./PACKAGING.md) and
[development/PERFORMANCE.md](./development/PERFORMANCE.md) for what was measured.
