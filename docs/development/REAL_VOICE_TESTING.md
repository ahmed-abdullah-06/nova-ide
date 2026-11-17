# Testing the voice assistant with real hardware (manual)

The automated tests never use the microphone, a real speech engine, a real
speech model or a cloud speech service. `pnpm verify` starts the **packaged**
application with Chromium's fake audio device and a mock engine (the command
interpreter echoes a marker), both in an isolated profile. No model is
downloaded and nothing is sent anywhere.

Real-hardware behaviour must still be checked by a person before the
milestone is accepted. This document is that procedure.

> **Status: NOT RUN.** This manual procedure was written but was not executed
> on the development machine. Only the automated checks listed at the end of
> this document were run, and they all passed.

## 1. Safety rules

- Use a throwaway workspace with no secrets and no work you cannot afford to
  lose. Recognised text is only inserted into the composer, but a person may
  still edit and send it afterwards.
- Do not paste secrets into the chat: the read-aloud redacts what it can
  recognise, but redaction is a last line of defence, not a guarantee.
- Keep the local-only mode on while testing. A cloud speech engine is not
  shipped in this build; the only effect of switching it on in a hand-edited
  settings file should be a refusal.
- The application never downloads an engine or a model. Both files must
  already be on the machine; the file picker only chooses files.
- Stop the recording and the speech when you are done. Closing the AI panel
  or quitting the application also releases the microphone and stops any
  speech process.

## 2. Prerequisites

| Item | Notes |
|---|---|
| The packaged application | `pnpm package`, then start `apps/desktop/out/NOVA IDE-win32-x64/NOVAIDE.exe` (or `pnpm dev`) |
| A working microphone | With a system input level that is not muted |
| A whisper.cpp-compatible executable | For example `whisper-cli.exe` from a local whisper.cpp build, placed anywhere on this machine |
| A model file in the whisper.cpp format | For example `ggml-base.bin`, downloaded **by hand** from the upstream project; the application never fetches it |
| OS speech voices | Windows voices installed for `speechSynthesis` (the default voice is enough) |

## 3. Checklist

### 3.1 Permission and capture

1. Open the AI panel and its settings. In the **Voice** section, switch the
   assistant on and select **Local engine (whisper.cpp compatible)**.
2. Choose the executable and the model with the two **Browse…** buttons.
   Both fields must show absolute paths. Save the settings.
3. Press **Mic** in the composer. The button must become **Stop**, and the
   elapsed seconds must increase. The first press may show the operating
   system's microphone permission prompt: allow it once for this app.
4. Deny the prompt in a second run (after removing the permission in the OS
   settings): the panel must show a microphone error, not crash, and the
   button must return to **Mic**.
5. Hold the configured push-to-talk key (F8 by default) and release it; the
   recording must start and stop with the key. Holding the key must not start
   several recordings.

### 3.2 Recognition and review

1. Say a short sentence while recording and press **Stop**.
2. The recognised text must appear in the composer input. **No message may be
   sent**: the chat must not show a new user message or an answer.
3. Edit the text, then press **Send** yourself. Only now may a request go to
   the provider.
4. Record a longer message than the configured limit: the recording must stop
   on its own, the text must still land in the composer, and a notice must
   explain that the limit was reached.
5. Press **Mic** and then cancel (the button becomes **Cancel** while the
   engine works): the transcript must not appear and the engine process must
   exit.

### 3.3 Read-aloud

1. Ask a question that produces a normal answer. Click **Read aloud** on the
   answer: the button must change to **Stop reading** and the OS voice must
   speak the text.
2. Click **Stop reading** (or the toolbar's **Stop reading**): the sound must
   stop at once.
3. Put a fenced code block in the answer. It must be skipped by default; the
   **Read code blocks aloud** setting must include it after saving.
4. Switch the voice and the speed in the voice settings, save, and read the
   answer again: the new settings must be used.
5. Answer with a secret in the text: the read-aloud must say `[redacted]`.

### 3.4 Privacy gates

1. Switch on the local-only mode in the provider settings. The header must
   show **LOCAL ONLY** and the cloud option in the voice settings must be
   disabled.
2. Even if the setting is changed by hand to `cloud`, a recording must be
   refused with a message that names the local-only mode. No audio may leave
   the machine.
3. Quit the application while a recording or a recognition is running. On
   restart no microphone permission and no engine process may be left behind.

## 4. What was run instead

The automated gates that **were** run for Milestone 8:

- `pnpm typecheck` — exit 0;
- `pnpm test` — 677/677 tests in 46 files;
- `pnpm package` and `pnpm make` — exit 0;
- `pnpm verify` — 133/133 checks in the packaged application with the fake
  audio device and the mock engine, isolated profile, no console errors;
- `pnpm verify:fuses` — all six fuses as expected;
- `pnpm verify:quitcleanup` — no child survives a crash of the app.

None of these uses a real microphone, a real speech engine, a real model or a
cloud speech service.
