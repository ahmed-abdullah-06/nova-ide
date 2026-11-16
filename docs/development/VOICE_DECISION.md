# The voice design of NOVA IDE (decision note)

This note compares the options for speech-to-text (STT) and text-to-speech
(TTS) **before** any voice code is written, as the milestone requires. It
records what was decided, why, and what was measured in the packaged
application.

Scope of Milestone 8: "Integrate speech-to-text, integrate text-to-speech,
add microphone controls, add push-to-talk, connect voice with AI
conversations, add stop and interruption controls" (spec §23). The design
must work in the **packaged Electron application** on the development
machine (Windows 11, 16 GB RAM, Intel integrated graphics, 4 cores).

---

## 1. The hard constraints

| Constraint | Source | Consequence |
|---|---|---|
| Audio must not leave the machine by default | spec §14.1, §19.4 | A cloud speech service may only exist as an **opt-in** engine behind the privacy gate and the local-only mode. |
| The renderer must not gain network access | spec §19.1, CSP `connect-src 'self'` | The renderer can never upload audio itself. **Every** audio transfer goes through the main process. |
| Audio must not be written to the disk | milestone 8 requirement | The engine receives the audio over a **pipe** (stdin), not over a file. |
| The agent and the model must never trigger voice actions | spec §10.4 | No agent tool for recording, speaking, downloading or changing voice settings. |
| No dependency without a justification | spec §26.4 | A native module means a toolchain, a rebuild against the Electron ABI and a packaging story with the hardened fuses. |
| 16 GB RAM, integrated GPU | spec §2.1 | A speech model must be small, optional, loaded lazily and unloaded when idle. |

---

## 2. Text-to-speech (the output)

| Option | Offline | Voices | Notes |
|---|---|---|---|
| **`speechSynthesis` of the renderer (the OS voices)** | **yes** — the voices are installed in the operating system | the voices of the system (on Windows: SAPI/OneCore) | No dependency, no network, no permission, works in the packaged app. The rate and the voice can be chosen. The voice list is empty until the first `voiceschanged` event — the panel must handle that honestly. |
| A local Piper process | yes | the voice models of Piper | The spec names Piper (§15.2), but Piper needs a voice model per language (several MB) and a binary that has to be shipped or downloaded. Shipping a downloaded executable means *executing a file that was fetched from the internet* — a decision that does not belong in a basic milestone. |
| A cloud TTS service | no | many | The audio of the answer would leave the machine. Not acceptable as the default, and it would need its own key and gate. |

**Decision: `speechSynthesis` (the offline voices of the operating system).**
The spec names Piper as the *initial* option (§15.2); the offline OS
voices reach the same user-visible result ("read the answer aloud, choose
a voice, control the speed, start and stop") without a new binary, a
model download or a network request. Piper stays listed as planned.

---

## 3. Speech-to-text (the input)

### 3.1 The Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`)

Chromium implements the recognition by **sending the microphone audio to
Google** — the open-source build that Electron uses has no API key for
that service, so the API is present but the service is not.

It was therefore **measured in the packaged application** instead of
assumed (the harness starts the packaged `.exe` with a fake microphone and
asks the renderer):

- the result is recorded in `docs/development/REAL_MODEL_TESTING.md`
  ("what was measured in the packaged app").

**Decision: rejected.** The Web Speech API depends on an undisclosed
cloud service (Google), it sends the microphone audio off the machine
without the user knowing, and it does not work in Electron without that
service. It is not used, not offered in the settings, and it is not
allowed to run.

### 3.2 A local speech-to-text engine (Whisper family)

The spec names **Whisper.cpp** as the initial local option (§15.1).

| Variant | Offline | Packaging | Model | Verdict |
|---|---|---|---|---|
| whisper.cpp compiled into the application (a native Node module) | yes | a C++ toolchain, a rebuild against the Electron ABI, an `afterCopy` hook like `node-pty`, and the hardened fuses must still allow the child process | the GGML model (75 MB – 466 MB) | **Rejected for this milestone**: a native build cannot be produced or proven here, and a native module that is not proven in the packaged `.exe` would be a fake feature. |
| whisper.cpp as an **external process** that the application launches | yes | none — the user installs whisper.cpp (it is a normal program with a normal licence) | the GGML model, downloaded by the application (8D) | **Accepted**: the application speaks a tiny pipe protocol, the model is downloaded by the application with the pattern of Milestone 7, and the audio never touches the disk. |
| a JavaScript/WASM build of whisper | yes | a large WASM blob and a large model | the same | Rejected: it would download a model and a runtime blob and would be far slower than the CPU-only machine can afford. |

**Decision: a local engine that is an external process**, with the
contract:

> The application starts the configured executable, writes the recorded
> audio as a **WAV file into its standard input** and reads the
> recognised text from its standard output.

`whisper-cli.exe` of whisper.cpp satisfies this contract with
`-m <model> -f -` (it reads a WAV file from standard input). The
executable and its arguments are configured by the user in the voice
settings and are validated in the main process; the application never
downloads or executes a binary it fetched itself.

### 3.3 A cloud speech-to-text service

**Decision: accepted as an opt-in engine, off by default.**

It reuses the provider layer that already exists (the OpenAI-compatible
provider: its address, its key in the encrypted credential store, its
loopback policy). The main process only sends the audio when **all** of
the following hold:

1. the user switched the cloud speech engine on,
2. the cloud provider is enabled and has a key,
3. the user approved **this** recording (the approval is never
   remembered), and
4. the local-only mode is **off**.

---

## 4. What the voice can and cannot do

| Action | Allowed | Where it is checked |
|---|---|---|
| Record the microphone | yes, after an explicit user action (the mic button or the push-to-talk key) | the permission handler of the main process + the renderer |
| Put the recognised text into the composer | yes — it is **placed in the input field**, the user reads it, edits it and sends it | the renderer |
| Send a message by voice | **no** | the renderer never calls `send()` after a recognition |
| Act on files, the terminal, Git or the agent by voice | **no** | there is no agent tool for voice (spec §15.4: a spoken command follows the same permission rules — the simplest rule is that a spoken command is only text) |
| Read an answer aloud | yes, with a stop button | the renderer (`speechSynthesis`) |
| Read code blocks aloud | only when the user switches it on | the renderer |
| Read a secret aloud | **no** | the existing `redact` runs before the text is spoken |

---

## 5. The microphone and the permissions

- The main process installs a permission handler that allows **only**
  `media` **and only** for the origin of the application, and **only**
  while a recording session is open. A request that arrives outside a
  session, for another origin, for the camera or for anything else is
  denied.
- The renderer asks for the microphone only after a user gesture (the mic
  button or the push-to-talk key).
- The audio is bounded: at most `maxRecordingSeconds` (60 s by default)
  and at most a fixed number of samples. A recording that is too long is
  stopped automatically.
- The microphone is released on stop, on the loss of the window focus,
  on the end of the session and when the application quits.

---

## 6. The result

| Part | Decision | Dependency | Offline |
|---|---|---|---|
| Speech-to-text | an external local engine (whisper.cpp compatible) over a pipe; an opt-in cloud engine behind the privacy gate | none | yes (local) |
| Speech model | downloaded by the application from the official whisper.cpp model host, with the pattern of Milestone 7 (size, disk check, one download, cancel, delete) | none | yes |
| Text-to-speech | the offline voices of the operating system (`speechSynthesis`) | none | yes |
| Microphone | the browser capture of the renderer, the permission handler of the main process | none | yes |

No new dependency is added to the application.
