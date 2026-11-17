# Privacy and data flows

This document describes the data flows of the V1 build as implemented in this
repository. It is written against the code in `apps/desktop/src/main` and is
intentionally explicit about what is *not* implemented. If a statement here
cannot be traced to code, it should be corrected.

## 1. Where data is stored

All application state lives in the Electron `userData` directory on the local
disk. The files below are plain JSON except where noted:

| File / directory | Content |
|---|---|
| `app-settings.json` | The local-only switch. |
| `providers.json` | Provider settings. API keys are **encrypted blobs** (base64 of `safeStorage.encryptString` output), never plaintext. |
| `conversations.json` | Chat conversation history (messages you sent and model replies). |
| `local-model-defaults.json` | Preferred local model / Ollama defaults. |
| `voice-settings.json` | Voice engine selection, executable path and arguments. |
| `agent-permissions.json` | Agent permission levels and cloud-context flag. |
| `agent-audit.json` | Redacted audit summaries of agent decisions and timestamps. |
| `agent-checkpoints/` | Local snapshots used to preview or revert agent changes. |
| `recent-workspaces.json` | Paths of workspaces you opened. |

API keys are decrypted by `safeStorage` only inside the main process
(`providers/credentials.ts`) and are never returned to the renderer. The
renderer receives only a `hasKey: boolean` flag. Credential error logs contain
the error message, never the key.

There is **no telemetry, analytics, crash-reporting upload, or background
network service** in this build. The executable does not phone home.

## 2. What stays local

The following never leave the machine as part of normal operation:

- Editor buffers, file contents, search results, terminal output and Git
  operations. Git remotes are only contacted when *you* run a Git command that
  needs a remote (for example `git push`); that is your shell, not the app.
- Voice recordings. With the local engine (`voice/localEngine.ts`) the WAV
  bytes are piped to the executable you configured in the settings; the audio
  is **not** written to disk and **not** sent over the network by the app. The
  engine runs without a shell, is bounded, times out, and is killed on cancel.
- Agent tool decisions, permission settings, audit entries, checkpoints and
  conversation history.

## 3. What can leave the machine

Only these paths can cause data to leave the computer, and each requires an
explicit action or approval by you:

1. **Chat / agent requests to an AI provider.** The text you type, the system
   prompt and any files you explicitly attach are assembled by
   `providers/privacy.ts` and sent to the provider you selected. Limits: at
   most 40,000 characters per file and 120,000 characters of total context per
   request; attached files are truncated to the budget and the UI tells you.
   The following are **never attached**: files matching secret patterns
   (`.env*`, `*.pem`, `*.key`, `id_rsa`, `.npmrc`, `.netrc`, `credentials`,
   `secrets.*`, …), files inside excluded directories (`.git`, `node_modules`,
   `.ssh`, `.aws`, `.gnupg`, `.kube`, `.azure`), files ignored by `.gitignore`,
   binary files, and paths outside the workspace.
   - **Local provider (Ollama)**: enabled by default, address defaults to a
     loopback URL. Requests go only to that address. If you configure a
     non-loopback address you must confirm it (`remoteConfirmed`), otherwise
     the request is refused.
   - **Cloud provider (OpenAI-compatible, default `https://api.openai.com/v1`)**:
     disabled by default. It needs all of: an API key you added, the provider
     switched on, and — when the request carries workspace content — a
     per-request context approval shown in the UI. That approval is **never**
     remembered for the next request (`checkPrivacyGate`).
2. **Model downloads.** Pulling/updating a local model asks your configured
   Ollama service to fetch a model (for example from Ollama's public model
   library). The download happens because you started a pull; the app itself
   does not download models in the background.
3. **External links.** A link in a model reply can be opened in your system
   browser via `shell.openExternal`. Only `http:` and `https:` URLs are
   accepted (`assertExternalUrl`); other schemes are refused. This is an
   action you trigger, and once opened the browser makes its own requests.

## 4. What needs explicit approval

| Action | Approval |
|---|---|
| Send attached workspace files to a cloud provider | Per-request context approval; not remembered. |
| Use a non-loopback provider address | One-time confirmation of the remote address. |
| Agent reads / edits / runs commands | Default settings permit only `read` without asking. `workspace` and `command` actions need your approval; widening a permission shows a main-process confirmation dialog. The agent cannot widen its own permissions. |
| Cloud-context use by the agent | Separate `allowCloudContext` flag, default off. |
| Microphone capture | Permission handler grants `media`/audio only for the app origin and only while a recording session is open; everything else is denied. |
| Cloud speech engine | Needs per-recording approval — **but the engine is not available in this V1 build**: selecting it is refused with a "not available in this build" message. |

## 5. What local-only mode blocks

When **Local-only** is on (`app-settings.json` → `localOnly: true`), the main
process refuses:

- every **cloud AI provider** in chat and in the agent (`checkPrivacyGate`
  receives the current local-only flag), even if a key and a context approval
  exist;
- the **cloud speech engine** in the voice service, even if a per-recording
  approval exists (defence in depth; the engine is already unavailable).

Local-only mode does **not** and cannot reasonably block: links you choose to
open in your browser, model downloads performed by your local Ollama service,
or commands you run yourself in the integrated terminal (including network
commands). Treat the terminal as you would any shell.

## 6. Untrusted content

Workspace files, model output and web content opened via external links are
treated as **untrusted data**, never as instructions. The chat system prompt
says so explicitly; the agent's tool calls are checked against an allowlist,
path canonicalisation and permission settings before anything happens; and
model output cannot widen a permission or open a non-HTTP(S) URL.
