# V1 release checklist (Milestone 10D)

This is the human-facing release procedure for the V1 release candidate. It is
**local-only**: nothing here pushes commits, creates tags, publishes GitHub
releases, or needs a secret checked into the repository. Signing and
publishing are owner manual steps on a secured machine.

## 1. Automated gates (run locally, then in CI)

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm typecheck          # TypeScript, all workspaces + tests
pnpm test               # unit suite
pnpm package            # portable packaged app
pnpm make               # Windows Squirrel + zip installers
pnpm verify             # 133 packaged-runtime checks
pnpm verify:fuses       # all 6 hardening fuses
pnpm verify:quitcleanup # no child process survives a crash
pnpm verify:packaging   # 20 packaged metadata/first-run checks
pnpm generate:notices   # refresh THIRD_PARTY_NOTICES.md after dep changes
node tools/release/checklist.mjs  # hygiene + manual-step reminder
```

All commands above must pass on the release commit. The equivalent sequence
runs automatically in `.github/workflows/verify.yml` on push/PR. That workflow
has `contents: read` only and uploads build artifacts — it does **not** create
releases, tags, or publish, and it references no secrets.

`node tools/release/checklist.mjs` checks that the tree is clean, no secrets or
personal paths are committed, the license/notices/docs exist, the build
artifacts exist, and product metadata is consistent. It then prints the manual
steps below. It changes no files and makes no network calls.

## 2. Owner decisions (blocking, not done)

- [ ] **License.** The current `LICENSE` is a conservative all-rights-reserved
      default because no license was specified. Replace it with the intended
      license before a public open-source release.
- [ ] **Icon URL.** The Squirrel nuspec carries a default Electron `iconUrl`.
      Replace it with an HTTPS URL you control.
- [ ] **Product/brand name.** 10G applies the final A6 rename; confirm the
      rename results before producing release artifacts.

## 3. Signing and notarization (blocking for a public release, not done)

The produced binaries are **unsigned**. On Windows SmartScreen and on macOS
Gatekeeper will warn until this is completed.

- [ ] Obtain a code-signing certificate; store it in the OS certificate store
      or pass it via environment variables. **Never commit the certificate or
      its password.**
- [ ] Configure `windowsSign` in `apps/desktop/forge.config.mts` through env
      vars, rebuild with `pnpm make`, and verify with `signtool verify /pa`.
- [ ] macOS (only if a signed Mac build is planned): configure signing and
      notarization, then verify with `spctl -a -vv` and `stapler validate`.
- [ ] Record the signer identity and signing date in the release notes.

No fake verification is recorded: until the steps above are run, the release
is documented as **unsigned**.

## 4. Manual smoke tests (owner, on a clean Windows machine)

- [ ] Install with the generated `NOVA IDE-0.1.0 Setup.exe`.
- [ ] Confirm the app starts from the installed location (path with spaces).
- [ ] First run with **no Ollama running, no local models and no API keys**:
      the app must start, show the local provider as keyless, the cloud
      provider as disabled, and never crash on offline lookups.
- [ ] Confirm the data files are created under the userData directory.
- [ ] Uninstall and confirm **no NOVAIDE process remains running**.
- [ ] Confirm no user settings/keys/conversations outside the app's own
      userData directory were touched.

The automated equivalents of most of these are in `pnpm verify:packaging`
(20 checks), but a real install/uninstall is intentionally left to the owner
because it modifies the machine.

## 5. Publishing (owner, outside this repository's tooling)

- [ ] Review `docs/RELEASE_READINESS.md` (produced in 10F) and this checklist.
- [ ] Attach the verified, signed artifacts and third-party notices to a
      release using your own account.
- [ ] Create the version tag only when you intend to publish.
- [ ] Archive the installer, `RELEASES`, nuspec and checksum in your release
      storage.

## 6. Explicitly out of V1 scope

Per the V1 definition of done and the owner's decisions, the following are
**not** part of this release and are not claimed anywhere: extension system /
marketplace, auto-update server, computer control (Milestone 9, deferred),
multi-agent, Linux/macOS native installers, and V2 features. The spec's M10
task list names extension architecture, plugin management, update strategy and
cross-platform packaging; those are recorded as a spec-vs-V1 conflict and
marked **planned**, not implemented.
