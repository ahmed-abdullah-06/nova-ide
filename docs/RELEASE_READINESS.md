# V1 Release Readiness (Milestone 10, final)

This is the definition-of-done walkthrough for the V1 release candidate. It
records only what was actually run on the specified development machine
(Windows x64, 16 GB RAM, Intel Core i5-1145G7, integrated Intel graphics) and
lists the items that are **not** done as honest limitations or owner manual
steps. The final product name is **A6** (renamed from **NOVA IDE** in the
isolated 10G change set). The historical `NOVA_IDE_SPEC.md` keeps its original
file name for reference.

Final gate run: 2026-11-17, on the 10G release-candidate tree (`145eb3d` + the
10G change set). No push, tag, GitHub Release, certificate, secret or OS
install/uninstall was performed. All artifacts remain local under
`apps/desktop/out/` and are not committed.

## 1. Gate results (final regression)

| Gate | Command | Result |
|---|---|---|
| TypeScript | `pnpm typecheck` | exit **0** (tests + all workspaces) |
| Unit / integration tests | `pnpm test` | exit **0**, **701/701** tests in 51 files |
| Package | `pnpm package` | exit **0** (ASAR, `node-pty` unpacked, fuses) |
| Installer build | `pnpm make` | exit **0** (Squirrel + zip) |
| Packaged runtime | `pnpm verify` | exit **0**, **133/133** checks |
| Fuses | `pnpm verify:fuses` | exit **0**, **6/6** fuses as expected |
| Crash cleanup | `pnpm verify:quitcleanup` | exit **0**, no surviving child |
| Packaged metadata/first run | `pnpm verify:packaging` | exit **0**, **26/26** checks (incl. profile survival) |
| Release hygiene | `pnpm verify:release` | exit **0**, **17/17** automated checks |
| Dependency audit | `pnpm audit --audit-level high` | exit **0** |

Note on test flakiness: `node-pty`'s `conpty_console_list_agent.js` prints
`AttachConsole failed` in this shell environment (it also appeared in the
M10 baseline, 18×). In one 10E run a worker exited during startup, so only
691/691 tests ran and `pnpm test` exited 1; immediate re-runs and the final
10F/10G regressions all passed (696/696, then 701/701) with exit 0. This is an
environment quirk, not a product regression.

## 2. V1 definition-of-done walkthrough

The V1 DoD is that the product is a stable, tested, secure V1 desktop IDE with
a reproducible, verified release process, and that out-of-scope features are
not claimed. Each row is backed by an executed check or a code-level fact.

| # | V1 DoD criterion | Evidence | Status |
|---|---|---|---|
| 1 | Desktop app launches; main UI renders; Monaco editing + tabs | `pnpm verify` 133/133; M1 DoD | **Met** |
| 2 | Workspace + file explorer; canonical path containment | M2 tests (`pathSecurity`, `fileOperations`); runtime verify | **Met** |
| 3 | Integrated terminal, search, Git, problems, tasks; no orphan processes | M3 runtime checks; `verify:quitcleanup` | **Met** |
| 4 | Provider-neutral chat (Ollama + OpenAI-compatible), encrypted keys, per-request privacy gate | M4 tests + mock-server runtime checks; `PRIVACY.md` | **Met** |
| 5 | Single bounded agent: plan, permissions, reviewable proposals, verification, audit | M5/M6 tests + runtime checks | **Met** |
| 6 | Local model management (catalog, details, fit, download/delete/unload) | M7 tests + mock-Ollama runtime checks | **Met** |
| 7 | Voice assistant: local STT into composer, OS read-aloud, local-only gate | M8 tests + fake-audio/mock-engine runtime checks; manual procedure documented (not run) | **Met (automated)** |
| 8 | `nodeIntegration:false`, `contextIsolation:true`, `sandbox:true`; typed whitelisted bridge | `apps/desktop/src/main/window.ts`, preload; unchanged in M10 | **Met** |
| 9 | Header CSP + hardened fuses | `verify:fuses` 6/6 (RunAsNode OFF, CookieEncryption ON, NodeOptions OFF, NodeCliInspect OFF, AsarIntegrity ON, OnlyLoadAppFromAsar ON); CSP unchanged | **Met** |
| 10 | No telemetry / background network; untrusted content treated as data | `PRIVACY.md`, `SECURITY.md`; code-level | **Met** |
| 11 | No secrets or personal paths committed | `verify:release` 17/17 (test fixtures excluded) | **Met** |
| 12 | Clean typecheck and passing unit suite | exit 0; 701/701 | **Met** |
| 13 | Reproducible package + installer build | `pnpm package`/`pnpm make` exit 0 | **Met** |
| 14 | Real packaged app verified end-to-end | `pnpm verify` 133/133 with isolated profile | **Met** |
| 15 | No child process survives a crash | `pnpm verify:quitcleanup` exit 0 | **Met** |
| 16 | Fresh-profile, clean-location first run; metadata correct | `pnpm verify:packaging` 26/26 | **Met** |
| 17 | High-severity dependency findings cleared; findings recorded honestly | `pnpm audit --audit-level high` exit 0; 2 moderate build-time findings documented | **Met** |
| 18 | Performance measured and documented | `tools/perf/last-results.json`, `docs/development/PERFORMANCE.md` | **Met** |
| 19 | License + third-party notices present | `LICENSE`, `THIRD_PARTY_NOTICES.md` (215 packages) | **Met** (license default needs owner decision) |
| 20 | Product metadata consistent and verified in artifacts | exe + nuspec checks in `verify:packaging` (A6) | **Met** |
| 21 | Local-only verification CI | `.github/workflows/verify.yml`: `contents: read`, no secrets/tags/publish/push | **Met** |
| 22 | Release documentation + hygiene checklist | `docs/RELEASE_CHECKLIST.md`, `tools/release/checklist.mjs` 17/17 | **Met** |
| 23 | User, security, architecture and limitations docs | `docs/USER_GUIDE.md`, `TROUBLESHOOTING.md`, `SECURITY.md`, `architecture/ARCHITECTURE.md`, `KNOWN_LIMITATIONS.md` | **Met** |
| 24 | Out-of-V1 scope features not claimed | Extension system, marketplace, auto-update, M9 computer control, multi-agent, V2 marked **planned** | **Met** |
| 25 | No publishing side effects from tooling | No push/tag/release/certificate/secret performed | **Met** |
| 26 | Existing profile survives the A6 rename | pinned legacy `userData` + unit tests + packaged seeded-profile check | **Met** |

### Not claimed (honest limitations)

| Item | Status |
|---|---|
| Code signing / notarization | **Not done** — binaries unsigned; owner manual step |
| macOS / Linux native installers | **Not implemented** — Windows x64 only verified |
| Real Squirrel install → uninstall cycle | **Not run** — modifies the dev machine; owner manual step |
| Real Ollama model / cloud key / microphone tests | **Not run** — automated tests use mocks; manual procedures documented |
| Real-profile A6 upgrade on an end-user machine | **Not run** — proven only in an isolated throwaway profile; owner manual step |
| Two moderate build-time `glob`/`minimatch` audit findings | **Not fixed** — dev tooling, not shipped runtime |
| `LICENSE` is a conservative default; nuspec `iconUrl` is Electron's | **Owner decision** before public release |

## 3. Files changed in M10 (per sub-milestone)

| Commit | Sub-milestone | Files |
|---|---|---|
| `f29ff00` | 10A | `docs/PRIVACY.md`, `pnpm-workspace.yaml` (DOMPurify override), dependency regression test |
| `0e5a255` | 10B | `tools/perf/measure.mjs`, `tools/perf/last-results.json`, `docs/development/PERFORMANCE.md`, corruption-recovery + bounded-redacted-logging source/tests |
| `e15bdff` | 10C | `LICENSE`, `THIRD_PARTY_NOTICES.md`, `tools/release/generate-notices.mjs`, `docs/PACKAGING.md`, `tools/verify/packaging.mjs`, `apps/desktop/package.json`, `apps/desktop/forge.config.mts`, root `package.json` |
| `c59ec49` | 10D | `.github/workflows/verify.yml`, `docs/RELEASE_CHECKLIST.md`, `tools/release/checklist.mjs`, root `package.json` |
| `54d2eb4` | 10E | `docs/USER_GUIDE.md`, `docs/TROUBLESHOOTING.md`, `docs/SECURITY.md`, `docs/architecture/ARCHITECTURE.md`, `docs/KNOWN_LIMITATIONS.md`, `README.md`, `CHANGELOG.md`, `docs/development/PROGRESS.md` |
| `145eb3d` | 10F | `docs/RELEASE_READINESS.md`, progress/changelog updates |
| 10G (final) | 10G | `package.json`, `apps/desktop/package.json`, `apps/desktop/forge.config.mts`, `apps/desktop/index.html`, app UI/main strings & CSS headers, `LICENSE`, `.env.example`, `.npmrc`, `apps/desktop/src/main/config/profilePath.ts`, `apps/desktop/src/main/index.ts`, `tests/unit/profilePath.test.ts`, `tests/unit/verifyIsolation.test.ts`, `tools/release/generate-icons.cjs`, `apps/desktop/icons/*`, `tools/verify/{runtime,fuses,quitcleanup,packaging,isolation}.mjs`, `tools/perf/measure.mjs`, `tools/release/checklist.mjs`, `.github/workflows/verify.yml`, all docs, this report |

## 4. Dependencies

- **No new runtime or build dependency was added during V1 stabilization or
  the 10G rename.** The icon generator uses the already-installed Electron
  binary and Chromium canvas rather than an image-processing package.
- The only dependency change is a version **override** of the existing
  transitive `DOMPurify` to a patched `3.4.18`, pinned in `pnpm-workspace.yaml`
  because pnpm 12 ignores a `pnpm.overrides` field in `package.json`. A
  regression test guards the override.
- `LICENSE: "UNLICENSED"` in both `package.json` files is intentional: it
  blocks accidental npm publication and is separate from the license decision.
- `THIRD_PARTY_NOTICES.md` was generated from the installed tree; no package
  was installed to produce it.
- The workspace package names changed (`nova-ide` → `a6`, `@nova/desktop` →
  `@a6/desktop`). pnpm lockfile importers are keyed by path, not package name,
  so `pnpm install --frozen-lockfile` remains valid with no lockfile churn.

## 5. Audit findings and fixes

- `pnpm audit --audit-level high` exits **0** after the DOMPurify override.
- Two **moderate, build-time** findings in `glob`/`minimatch` remain. They are
  development-tooling dependencies, not part of the shipped runtime, and are
  recorded in the 10A entry of `docs/development/PROGRESS.md`. They were not
  "fixed" by an unrelated dependency bump.
- Electron Packager metadata bug found and fixed in 10C: setting only
  `win32metadata.LegalCopyright` left the exe with Electron's template
  copyright; the value actually comes from top-level
  `packagerConfig.appCopyright`. The invalid `win32metadata.LegalCopyright`
  key was removed (it also failed typecheck). The mechanism was preserved
  unchanged through the 10G rename; only the string values changed to A6.
- Release-hygiene scan initially flagged a deliberate fake key in a redaction
  test; test fixtures are now excluded from the secret scan.

## 6. Measured performance

Measured on the specified dev machine with the reproducible harness
(`tools/perf/measure.mjs`, raw results in `tools/perf/last-results.json`,
narrative in `docs/development/PERFORMANCE.md`):

| Metric | Value |
|---|---|
| Cold start → renderer ready | 975 ms |
| Idle working set (process tree) | 444.5 MB |
| Idle renderer JS heap | 14.7 MB |
| Large folder (6000 files) open → title | 34 ms |
| Tree expansion (>100 nodes) | 286 ms |
| Search (500 matches) | 64 ms |
| Long terminal output (~103k chars) | 995 ms |
| After close (working set / renderer heap) | 460.9 MB / 13.5 MB |
| 3,000-message history load | 181 ms |

These are single-machine measurements, not a cross-device benchmark. They were
captured before the 10G rename (the change is branding/packaging metadata and a
startup path pin, not a hot path), and the harness still targets the packaged
app, now `A6IDE.exe`.

## 7. Packaging

- Artifacts produced by `pnpm make`: portable `A6-win32-x64/`,
  `A6IDE-0.1.0-full.nupkg`, `RELEASES`, `A6-0.1.0 Setup.exe`, and a
  portable zip (all under `apps/desktop/out/`, not committed).
- Verified metadata: exe ProductName `A6`, FileDescription
  `A6 desktop application`, LegalCopyright
  `Copyright (c) 2026 A6 Project. All rights reserved.`, version
  `0.1.0`; nuspec title/authors/description/copyright match.
- `pnpm verify:packaging` passed **26/26** (clean location with spaces, fresh
  profile with no Ollama/models/keys, graceful offline lookups, data-file
  creation, no surviving process after forced kill, and the profile-survival
  checks in §11). Full details in `docs/PACKAGING.md`.
- The app icon set is generated from the committed A6 SVG sources (§11).
- Unsigned; SmartScreen warnings expected until the owner signs.

## 8. CI and release files (local only)

- `.github/workflows/verify.yml` — Windows runner, `contents: read`, builds and
  runs all gates, uploads artifacts as `a6-windows-x64`; no secrets, tags,
  publish or push.
- `tools/release/checklist.mjs` (`pnpm verify:release`) — hygiene + manual-step
  reminder, no file changes and no network calls.
- `tools/release/generate-notices.mjs` (`pnpm generate:notices`) and
  `tools/release/generate-icons.cjs` (`pnpm generate:icons`).
- `docs/RELEASE_CHECKLIST.md` — the human release procedure and owner steps.
- No tag, release, certificate, secret or credential was created or committed.

## 9. Documentation list

User: `USER_GUIDE.md`, `TROUBLESHOOTING.md`, `PRIVACY.md`, `SECURITY.md`,
`KNOWN_LIMITATIONS.md`.
Release/development: `RELEASE_READINESS.md`, `RELEASE_CHECKLIST.md`,
`PACKAGING.md`, `development/PERFORMANCE.md`, `development/PROGRESS.md`,
`architecture/ARCHITECTURE.md`, `development/REAL_MODEL_TESTING.md`,
`development/REAL_VOICE_TESTING.md`, `development/VOICE_DECISION.md`.
Root: `README.md`, `CHANGELOG.md`, `NOVA_IDE_SPEC.md` (historical), `LICENSE`,
`THIRD_PARTY_NOTICES.md`.

## 10. Owner manual steps (blocking for a public release)

1. Replace the conservative `LICENSE` with the intended license.
2. Supply a real HTTPS-hosted icon URL for the nuspec `iconUrl`.
3. Obtain a code-signing certificate; sign the Windows build and verify with
   `signtool verify /pa` (macOS: notarize and validate with `spctl`/`stapler`
   if a signed Mac build is planned). Never commit the certificate/password.
4. Perform a real Squirrel install → uninstall smoke test on Windows and
   confirm no `A6IDE` process remains.
5. Smoke-test a fresh first run with no Ollama/models/API keys.
6. Upgrade an existing **NOVA IDE** profile: confirm its settings, encrypted
   keys and conversations survive the rename to A6 (automated verification
   proves this only in a throwaway profile and never touches a real one).
7. Review `RELEASE_CHECKLIST.md`; create the tag, release and upload through
   your own account. This repository's tooling does not publish.

## 11. Final rename results (10G)

**Product identity.** The product is now **A6** everywhere it is user-facing or
part of the packaging identity: root package `a6`, desktop package
`@a6/desktop`, `productName: A6`, executable `A6IDE.exe`, Squirrel id `A6IDE`,
installer `A6-0.1.0 Setup.exe`, and `A6 desktop application` metadata. All
user/release docs, UI title/status bar strings, system prompt, error messages,
CSS headers, `LICENSE`, `.env.example`, `.npmrc`, the verification harnesses
and the CI artifact name were updated. Electron security flags, the CSP and all
six fuses were **not** changed.

**Intentional non-renames (to avoid a broad, risky refactor).** Internal
identifiers `window.nova`, `NovaApi`, the `nova:*` IPC channels, the
`nova-verify-profile-` temp prefix and the historical `NOVA_IDE_SPEC.md` file
name are unchanged. The legacy profile directory name `NOVA IDE` is also
retained on purpose as an internal storage key (see below). No A6 naming
conflict existed before the rename.

**Icon set.** The committed root sources `a6-logo.svg` (used at 64 px and above)
and `a6-logo-small.svg` (used at 16/24/32/48 px) were confirmed well-formed and
left byte-for-byte unchanged. `tools/release/generate-icons.cjs`
(`pnpm generate:icons`) rasterizes them with the bundled Electron/Chromium
canvas, writes the PNGs and hand-builds the ICO (no new dependency). Verified
output: `a6-{16,24,32,48,64,128,256}.png` with exact dimensions and `a6.ico`
with **7 entries / 88,793 bytes**; every ICO entry's declared size and PNG
dimensions matched. The generator and all generated assets are committed and
the ICO is wired through `packagerConfig.icon`.

**Profile survival (pinned path, no migration needed).** Renaming the product
would otherwise move Electron's default `userData` from `...\NOVA IDE` to
`...\A6`, stranding settings, encrypted API keys and conversations. Instead,
`apps/desktop/src/main/config/profilePath.ts` detects the product-name default
and pins `userData` back to the legacy `NOVA IDE` directory; an explicit
`--user-data-dir` and any other non-default override are always respected. This
runs at the top of `main/index.ts` before any store or log path is read.

Evidence:
- **Unit tests** — `tests/unit/profilePath.test.ts` (5 cases: default A6 →
  legacy path; explicit `--user-data-dir` respected; non-default override
  respected; idempotent; legacy name stable). `verifyIsolation.test.ts` now
  asserts the harness fingerprints the legacy path while the product name is
  A6.
- **Packaged isolated-profile check** — `tools/verify/packaging.mjs` seeds a
  throwaway `APPDATA` root with `<root>/NOVA IDE/app-settings.json` =
  `{ "version": 1, "settings": { "localOnly": true } }`, launches the packaged
  app **without** `--user-data-dir`, and confirmed: the seeded value was read
  (`window.nova.localOnly() === true`), no fresh `A6` profile was created, the
  seeded file was unchanged, and the real user profile was untouched. A
  regression that dropped the pin would read a fresh profile (`localOnly`
  false) and fail this check.
- `pnpm verify:packaging` finished **26/26**, and the full regression in §1 was
  green on the final A6 artifacts.

**Conflicts:** none. Before the rename the repository was checked for existing
A6 names; none were found. The only unresolved owner items remain those in §10
(signing, icon URL, license, real install/real-profile smoke tests).

## 12. Conclusion

The V1 release candidate meets the V1 definition of done for the implemented
scope: all automated gates are green on the final A6 artifacts, the packaged
app is verified from a clean location with a fresh profile, an existing legacy
profile is proven to survive the rename in an isolated check, the security
flags and fuses are intact, and no publishing side effects occurred. The
remaining items (signing, macOS/Linux installers, real-hardware and real-profile
smoke tests, license/icon decisions) are explicitly listed above and are
**not** claimed as complete. With 10G committed separately from 10A–10F, the
agent stops here for owner approval.
