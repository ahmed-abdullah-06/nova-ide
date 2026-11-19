# Packaging, licensing and signing (Milestone 10C, updated 10G)

This document records what was actually built and verified for the V1 release
candidate, and what still needs an owner decision or a manual step. Nothing
here claims a platform or a signing result that was not exercised. The product
was renamed from **NOVA IDE** to **A6** in 10G; all metadata and artifact names
below are the current A6 ones, verified after that rename.

## 1. License and third-party notices

The repository and specification contained **no license** before this work.
A conservative default was chosen so the release is not accidentally
open-source licensed:

- `LICENSE` — all rights reserved / proprietary evaluation license. **The
  owner must replace this with the intended license (for example MIT or
  Apache-2.0) before any public open-source release.** This is an explicit,
  unresolved owner decision, not an oversight.
- `THIRD_PARTY_NOTICES.md` — generated from the **real installed dependency
  tree** (215 packages, 9 license identifiers: MIT, ISC, Apache-2.0, BSD-2,
  BSD-3, MPL-2.0, BlueOak-1.0.0 and dual-license combinations). It lists each
  package, its version and declared license, plus the representative license
  text copied from `node_modules`. Regenerate with
  `pnpm generate:notices` after any dependency change. No dependency was added
  to produce these notices.

The `license: "UNLICENSED"` value in both `package.json` files prevents npm
from publishing the app by accident; it is intentional and distinct from the
license decision above.

## 2. Product metadata (single source of truth)

`apps/desktop/forge.config.mts` and `apps/desktop/package.json` carry the
release metadata. A subtle toolchain detail was found and fixed during this
work:

- Electron Packager sets the exe's `LegalCopyright` from the **top-level
  `packagerConfig.appCopyright`** option (via `legalCopyright` → `resedit`).
  Setting only `win32metadata.LegalCopyright` does **not** change the exe; it
  silently kept the Electron template value
  `Copyright (C) 2015 GitHub, Inc. All rights reserved.`. Both keys are now
  fed from one `PRODUCT_COPYRIGHT` constant so they cannot drift.

Verified metadata of the rebuilt artifacts (2026-11-17):

| Artifact | Field | Value |
|---|---|---|
| `A6IDE.exe` | ProductName | `A6` |
| `A6IDE.exe` | FileDescription | `A6 desktop application` |
| `A6IDE.exe` | LegalCopyright | `Copyright (c) 2026 A6 Project. All rights reserved.` |
| `A6IDE.exe` | ProductVersion | `0.1.0` |
| `A6IDE-0.1.0-full.nupkg` (nuspec) | title / authors | `A6` / `A6 Project` |
| `A6IDE-0.1.0-full.nupkg` | description / copyright | as above |
| `A6-0.1.0 Setup.exe` | ProductVersion | `0.1.0` |

The application icon is generated from the committed root SVG sources by
`pnpm generate:icons` (`tools/release/generate-icons.cjs`): the small SVG feeds
16/24/32/48 px, the full SVG feeds 64/128/256 px, and `apps/desktop/icons/a6.ico`
wraps all seven PNG-compressed entries. The generator is committed, uses the
bundled Electron/Chromium as the rasterizer (no new image dependency), and the
SVG sources are left unchanged.

The ICO is wired through `packagerConfig.icon` and copied as an Electron Forge
extra resource (`extraResource: ['icons/a6.ico']`) to `resources/a6.ico` outside
the ASAR. The main process resolves that file in both layouts and passes it as
the `BrowserWindow` `icon` so the window, Alt+Tab and taskbar button show the A6
mark in development and packaged builds (`apps/desktop/src/main/window.ts`).
Because development runs inside Electron’s own executable, the main process sets
a dev-only App User Model ID (`A6.IDE.Dev`) before `ready`
(`apps/desktop/src/main/index.ts`); the packaged/Squirrel AppUserModelID is not
overridden. The renderer title row displays the generated A6 mark from
`apps/desktop/icons/a6-32.png`.

**Profile survival across the rename.** Electron derives `userData` from the
product name, so renaming to A6 would otherwise strand every existing setting,
encrypted API key and conversation in the old `NOVA IDE` directory. The app now
pins `userData` back to that legacy directory at startup
(`apps/desktop/src/main/config/profilePath.ts`); an explicit `--user-data-dir`
(the verification harness) is always respected. This is verified by unit tests
and, in the packaged app, by a throwaway profile seeded with the legacy path
(see section 4). The directory name is an internal storage detail, not branding.

The nuspec still contains a default `iconUrl` that points at Electron's icon
on GitHub. There is no project icon host in this repository, so the owner
must supply a real, HTTPS-hosted icon URL before a public release; this is
documented here rather than faked.

## 3. Artifacts produced

`pnpm make` (Windows, x64) produces, under `apps/desktop/out/make/`:

- `A6-win32-x64/` — the portable packaged application.
- `squirrel.windows/x64/A6IDE-0.1.0-full.nupkg` — the Squirrel full package.
- `squirrel.windows/x64/RELEASES` — the Squirrel release manifest (local only).
- `squirrel.windows/x64/A6-0.1.0 Setup.exe` — the Squirrel installer.
- `zip/` — a portable zip archive.

These files are build output and are **not committed**.

## 4. What was actually verified

`pnpm verify:packaging` (script: `tools/verify/packaging.mjs`) drives the real
packaged build and includes checks for:

- exe and nuspec metadata match the product (above);
- the generated A6 icon is shipped as the packaged extra resource
  `resources/a6.ico`, matching the committed source icon;
- when installed Start Menu/Desktop shortcuts are present on the machine, their
  extracted icon is compared to the generated A6 mark rather than Electron’s icon
  (raw icon bytes are not compared because Windows uses resampled icon sizes);
  this check is skipped when no installed A6 shortcut is found;
- the app launches from a **fresh path whose name contains spaces** (like a
  real per-user install) — no hard-coded install location;
- a **completely fresh profile** (no Ollama running, no local models, no API
  keys) reaches a ready renderer, and reports its name as `A6`;
- the local provider is present and keyless, the cloud provider is disabled
  and keyless on first run;
- offline provider-status and model-catalog lookups return a result and do
  **not** crash the app;
- the app creates its settings file in the `userData` directory and persists
  valid JSON on first write;
- **no application process survives a forced kill** (the same guarantee the
  Squirrel uninstaller needs to stop running processes before removal);
- (10G) with a fake `APPDATA` root containing a seeded legacy `NOVA IDE`
  profile, the packaged app launched **without** `--user-data-dir` reads that
  profile (`localOnly: true`), creates **no** fresh `A6` profile, leaves the
  seeded file unchanged, and never touches the real user profile (which is
  fingerprinted before and after every phase).

`pnpm verify`, `pnpm verify:fuses` and `pnpm verify:quitcleanup` remain the
broader runtime, fuse and child-process-cleanup gates and were re-run for this
milestone. The full local Squirrel install → uninstall cycle was **not** run,
because that modifies the developer machine; the process-cleanup and
clean-location checks above are the automated proxies, and the actual install
is listed as an owner manual step in the release readiness report.

## 5. Platforms

- **Windows x64 — verified** on the specified development machine
  (16 GB RAM, Intel Core i5-1145G7, integrated Intel graphics). This is the
  initial development platform per the spec.
- **macOS — not verified.** No native maker package (`@electron-forge/maker-dmg`
  / `maker-zip` target for darwin is configured for the zip only) and no macOS
  machine was available. Apple notarization is **not** implemented.
- **Linux — not verified.** No native maker package is installed, so no `.deb`
  / `.rpm` / AppImage is produced. The portable zip maker is configured for
  win32 and darwin only.

Adding native makers/signing would require new build dependencies and a build
machine per platform; that was deliberately out of scope for this milestone.

## 6. Code signing and notarization (owner manual steps — NOT done)

No certificate, secret, token or password is present in the repository, and
no signing or notarization was performed. Do **not** claim a signed build
until the following are done by the owner on a secured machine:

1. Obtain an EV/OV code-signing certificate (Windows) and, for macOS, an
   Apple Developer ID plus app-specific notarization credentials.
2. Configure `windowsSign` and (if added) macOS signing in
   `apps/desktop/forge.config.mts` **through environment variables or the
   OS certificate store**, never by committing the certificate or password.
3. Run `pnpm make` on the matching host platform and verify the signer
   (`signtool verify /pa` on Windows; `spctl -a -vv` / `stapler validate` on
   macOS).
4. Publish through an owner-controlled channel. This repository's workflows
   only build artifacts locally; they do not publish, push tags, or create
   GitHub releases.

Untouched, the produced binaries are **unsigned**. Windows SmartScreen and
macOS Gatekeeper will warn until signing/notarization is completed. This is a
known, documented limitation of the V1 release candidate, not a silent gap.
