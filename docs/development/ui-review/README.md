# A6 UI review — BEFORE / AFTER

This record covers the appearance-only cleanup pass U0–U6. Each step is one
commit on top of `f2237cf`:

| Step | Commit | Summary |
| --- | --- | --- |
| U0 | `72e4f82` | BEFORE screenshots |
| U1 | `dcaf2b7` | Design tokens, inline SVG icons, UI primitives, CSS cleanup |
| U2 | `9277152` | Custom title row, native menu removal, activity-bar cleanup |
| U3 | `2a75973` | One shared Chat/Agent composer, decluttered AI header |
| U4 | `3b3e347` | Full editor-area Settings tab |
| U5 | `b733026` | Shell polish and real status-bar privacy indicator |
| U6 | this commit | AFTER screenshots, report, final verification |

No new dependencies were added. All icons are inline SVG in
`components/ui/icons.tsx`. Fuses, CSP, security flags, permissions, IPC
channels, provider/agent behaviour, and privacy enforcement were not changed.

## Control map

| Area | BEFORE | AFTER | Notes |
| --- | --- | --- | --- |
| Window chrome | Native title bar and native application menu | Custom `TitleBar` + in-app `MenuBar`; native window buttons drawn by `titleBarOverlay` | Same menu commands; only presentation moved; overlay colours follow the active theme and title-row actions reserve overlay space |
| Activity bar | Explorer, Search, Source Control, duplicate AI Agent, dead Extensions, Settings | Explorer, Search, Source Control, Settings | Duplicate agent entry and dead Extensions entry removed; the real agent lives in the AI panel |
| Sidebar Settings | Appearance theme button plus a note about settings arriving later | Same theme button; note points to the Settings editor tab | No theme behaviour change |
| AI panel header | Mode tabs plus provider/model controls and badges competing for space | Mode tabs and gear only; provider/model selects and LOCAL/CLOUD/LOCAL ONLY chips in a compact controls row | Every real control kept |
| Composer | Chat composer in the AI panel; separate task composer in Agent mode | One `.ai-panel__input` composer; Start/Send/Stop change with the mode | Agent tab is a run view; no second task box |
| Settings | AI gear expanded inline provider and voice panels | Closable editor tab with Providers, Models, Agent, Voice, Privacy | Activity gear, title-bar gear, AI gear and `Ctrl+,` all open the same tab |
| Local-only switch | Inside provider settings | Privacy section of the Settings tab | Same shared state and main-process enforcement |
| API key fields | Shown with the provider controls | Only for providers that use a key | No storage or credential changes |
| Editor tabs | File buffers and New untitled buffer | Same plus a gear-marked Settings tab | Settings is excluded from save/save-as and editor context |
| Status bar | Workspace, static `Git: —`, language, cursor, UTF-8, theme, version | Workspace, real `Local-only: on/off` indicator, language, cursor, UTF-8, theme, version | Static Git placeholder was not a control and was removed |
| Commands | No Settings command in the registry | `a6.view.openSettings`, default `Ctrl+,` | Deliberately absent from `MENU_LAYOUT`; reviewed menu labels unchanged |

## Main-process changes

Only the two presentation changes approved for U2 were made:

- `titleBarStyle: 'hidden'` with a 32 px `titleBarOverlay`. The main process
  seeds dark colours; the renderer updates overlay colours on theme changes so
  the native caption buttons match the title row in both themes.
- `Menu.setApplicationMenu(null)` and `mainWindow.setMenu(null)` to remove the
  native menu.

No other main-process file was changed in this pass.

## Verification

U0–U6 were verified on a clean tree at `0134cee` (Windows x64):

| Command | Result |
| --- | --- |
| `pnpm typecheck` | exit 0 |
| `pnpm build` | exit 0 |
| `pnpm test` | 57 files, 752 tests passed |
| `pnpm verify` | 159/159 checks passed |
| `pnpm verify:fuses` | 6/6 fuses as expected |
| `pnpm verify:quitcleanup` | exit 0 |
| `pnpm verify:packaging` | 26/26 checks passed |
| `pnpm verify:release` | 17/17 checks passed |

`pnpm verify` covers the packaged app through CDP with an isolated profile and
a mock local provider. It includes the new Settings tab, its entry points, the
shared composer, and the status-bar local-only indicator. An initial final run
exposed two CDP focus/key timing flakes; after the harness steps were made
deterministic, three consecutive runs passed 159/159.

### Icon branding follow-up (post-U6)

Committed A6 branding work added the generated icon to the window, taskbar and
custom title row without changing behaviour or packaged identity:

- `apps/desktop/forge.config.mts` copies `icons/a6.ico` as an extra resource so
  the packaged app has `resources/a6.ico` outside the ASAR.
- `apps/desktop/src/main/window.ts` resolves that icon in packaged and dev
  layouts and passes it to `BrowserWindow`.
- `apps/desktop/src/main/index.ts` sets a dev-only App User Model ID
  (`A6.IDE.Dev`) before `ready` so Windows can group the development process
  (running inside Electron’s executable) separately from Electron’s own taskbar
  icon; the packaged/Squirrel AppUserModelID is not overridden.
- `apps/desktop/src/renderer/components/layout/TitleBar.tsx` renders the
  generated `icons/a6-32.png` mark (inlined by Vite) in the custom title row.

Runtime verification now asserts the title-row image loads as the 32×32 A6 mark.
Packaging verification now asserts the packaged extra resource matches the
committed `a6.ico` and, when installed Start Menu/Desktop shortcuts are present,
compares their extracted icon to the A6 mark rather than Electron’s icon (raw
icon bytes differ across Windows icon sizes/resampling). On this machine the
installed Start Menu and Desktop shortcuts resolved to the per-user installed
`A6IDE.exe` and compared as closer to A6 than Electron. The packaged taskbar
button was also compared programmatically against the A6 mark/Electron icon and
showed the A6 mark.

Dev taskbar grouping can be affected by Windows/Explorer icon caching when the
same `electron.exe` path is used by multiple apps; after Explorer refresh during
this session the dev window grouped under A6. End-to-end packaged/native-chrome
verification remains Windows x64 only.

### Evidence method

The screenshots were captured from the packaged app at both target sizes. They
were checked programmatically for pixel dimensions, SHA-256 uniqueness, and no
BEFORE/AFTER hash overlap. Computed styles and DOM geometry were also checked
for the shell regions and privacy state. The reviewer should still inspect the
images visually; this record does not claim a human visual judgement.

## Windows-only limitation

End-to-end, packaged, native-title-bar and window-chrome verification was run
on Windows x64 only. macOS and Linux layout and overlay behaviour were not
executed in this environment.

## Screenshots

`before/` and `after/` use the same names and viewport sizes:

- `1280x720-chat.png`
- `1280x720-agent-idle.png`
- `1280x720-agent-run-proposals.png`
- `1280x720-settings.png`
- `1280x720-chat-window.png`
- `1920x1080-chat.png`
- `1920x1080-agent-idle.png`
- `1920x1080-agent-run-proposals.png`
- `1920x1080-settings.png`
- `1920x1080-chat-window.png`

The `-chat-window.png` files are supplemental native-chrome captures; all
other files are renderer viewport captures.
