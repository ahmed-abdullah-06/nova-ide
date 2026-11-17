# Known limitations (V1 release candidate)

An honest list of what V1 does **not** do, what is out of scope, and what is
still an owner decision. This is the canonical "not implemented / not verified"
record for the release; see also the spec-vs-V1 conflict table in
[development/PROGRESS.md](./development/PROGRESS.md) and the manual steps in
[RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md).

## Out of V1 scope by owner decision

- **No extension system or marketplace**, no plugin management UI. The M10
  spec task list names extension architecture and plugin management; they are
  marked **planned**, not implemented.
- **No auto-update server.** The Squirrel artifacts support updates in
  principle, but no update service, channel or endpoint exists.
- **No computer-control agent (Milestone 9).** M9 is deferred by owner
  decision; no computer-control capability is claimed.
- **No multi-agent support.** A single bounded agent runs at a time.
- **No V2 features.** Advanced workflows beyond the V1 definition of done are
  not present.

## Platform and packaging limits

- **Windows x64 only is verified.** The specified dev machine is 16 GB RAM,
  Intel Core i5-1145G7 with integrated Intel graphics. No macOS or Linux
  machine was available.
- **No native macOS/Linux installers.** No DMG/zip-for-darwin, `.deb`, `.rpm`
  or AppImage maker is configured. Adding them needs new build dependencies and
  a host per platform.
- **Binaries are unsigned.** No certificate or notarization was used.
  SmartScreen/Gatekeeper warnings are expected until the owner signs; signing
  and notarization are documented manual steps, not claimed as done.
- **No real Squirrel install → uninstall cycle was run** (it modifies the
  developer machine). Automated clean-location launch and process-cleanup
  checks are the proxies; the real cycle is an owner manual step.
- The Squirrel nuspec still carries Electron's default `iconUrl`. A real
  HTTPS-hosted icon URL must be supplied before a public release.
- The current `LICENSE` is a conservative all-rights-reserved default because
  no license was specified. The owner must replace it for any public
  open-source release.

## Testing honesty

- Automated tests use **mock** providers/engines. No real Ollama model, cloud
  API key, microphone or cloud speech service was exercised. The manual
  real-model and real-voice procedures are documented and explicitly state
  they were **not** run.
- Runtime verification uses Chromium's **fake audio device** and a mock voice
  engine; no real audio was captured.
- `pnpm audit --audit-level high` exits 0, but two **moderate, build-time**
  `glob`/`minimatch` findings remain (development tooling, not shipped
  runtime). They are documented in the 10A progress entry, not fixed.
- Measured performance numbers come from the one specified dev machine
  ([development/PERFORMANCE.md](./development/PERFORMANCE.md)); they are not a
  cross-device benchmark.

## Product limits users will notice

- **Local models need Ollama.** The app does not start Ollama or download a
  model by itself. You supply the service, the engine executable and the
  models. Model details stay *unknown* when Ollama does not report them.
- **Voice input needs an external whisper.cpp-compatible executable** you pick
  in settings. Read-aloud uses OS offline voices. Piper, cloud STT transport,
  in-process Whisper and automatic read-aloud are deliberately not
  implemented; see [development/VOICE_DECISION.md](./development/VOICE_DECISION.md).
- **Local-only mode is not a firewall.** It blocks cloud providers and cloud
  voice in main, but not browser links, your own Ollama downloads, or commands
  you run in the terminal.
- **Bounded contexts and caps:** ~40,000 characters per attached file and
  120,000 total per request; 2,000 entries per directory listing; 500 search
  results; 50 conversations × 200 messages; 500 audit entries. These limits
  are intentional and mostly surfaced in the UI.
- **A single agent run** at a time; only `read` is permitted without approval;
  edits and commands need confirmation; forbidden operations (delete/rename,
  Git write operations, package install, shell, out-of-workspace paths) have no
  permission category.

## Documented spec-vs-V1 conflicts

The M10 section of `NOVA_IDE_SPEC.md` lists extension architecture, plugin
management, update strategy and cross-platform packaging. The V1 definition of
done and the owner's decisions exclude these; they are recorded as **planned**,
and the automated release checklist explicitly reports them as out of scope.
This document and [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md) are the
authoritative record of that decision.
