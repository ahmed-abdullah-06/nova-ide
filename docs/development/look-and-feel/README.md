# A6 look-and-feel milestone (LF0–LF5)

This record tracks the appearance-and-shell milestone on top of `27de244`
(`dev`). It is separate from product versions V1/V2. The target is roughly
50% closer to contemporary IDE shells (VS Code / Kiro / Cursor) in layout,
density and feel. **This document currently contains LF0 only: inspection,
BEFORE scorecard and plan. No source files were changed in LF0.**

## LF0 method and evidence

- The packaged app was rebuilt from the current source with `pnpm package`
  (build artefact only), then launched with
  `--remote-debugging-port=9339 --user-data-dir=<temporary profile>` plus the
  fake-media flags used by `tools/verify/runtime.mjs`. No user profile was
  touched; the fixture workspace and profile were removed after capture.
- States were driven through the existing CDP harness (`tools/verify/cdp.mjs`)
  and the real preload bridge: `workspace.close()`, `workspace.open(fixture)`,
  a DOM click on an explorer tree node, `terminal.create()`, the title-bar AI
  toggle and the activity-bar Settings item.
- Viewports were set with `Emulation.setDeviceMetricsOverride` at
  `deviceScaleFactor: 1`. All ten PNGs were checked by reading their IHDR
  dimensions: every 1280 file is exactly 1280×720 and every 1920 file is
  exactly 1920×1080. File sizes are distinct; no two states are byte-identical.
- DOM/computed-style facts were collected in the folder-open state at
  1280×720. Code inspection of the components and CSS supplied the rest of the
  evidence. **The capturing model cannot view images**; no human visual
  judgement is claimed here. Visual review of the PNGs is explicitly left to
  the owner.

### BEFORE screenshots

`docs/development/look-and-feel/before/`:

| State | 1280×720 | 1920×1080 |
| --- | --- | --- |
| No folder open | `1280x720-no-folder.png` | `1920x1080-no-folder.png` |
| Folder open with files | `1280x720-folder-open.png` | `1920x1080-folder-open.png` |
| Terminal open | `1280x720-terminal.png` | `1920x1080-terminal.png` |
| AI panel open | `1280x720-ai-panel.png` | `1920x1080-ai-panel.png` |
| Settings tab | `1280x720-settings.png` | `1920x1080-settings.png` |

Supplemental limitation: CDP captures the renderer surface only. The native
Windows caption buttons (`titleBarOverlay`) are drawn by the OS and therefore
do not appear in these PNGs; their presence is enforced by DOM geometry checks
in `tools/verify/runtime.mjs`. Console errors during capture: **0**.

## BEFORE scorecard

Legend: **present** = fully implemented; **partial** = some real backing
feature exists but the scorecard item is not met; **missing** = no backing
feature. Baseline: **0 present / 14 partial / 6 missing**.

| # | Item | Status | Evidence (DOM / computed style / code) |
| --- | --- | --- | --- |
| 1 | Title row: icon, inline menu, centered command center, layout toggles, window controls | partial | `.title-bar` exists (height 32px) with a 32×32 A6 `<img>` rendered at 18×18, 5 `.menu-bar__top` items, and `.title-bar__actions` buttons `Toggle AI Panel`, `Settings`. Probe `hasCommandCenter:false`; `.title-bar__title` is plain non-interactive text. No sidebar/bottom-panel toggle in the row. Caption buttons are native overlay, not DOM. |
| 2 | Activity bar: tooltips with shortcuts, active accent, SCM badge, bottom gear | partial | 4 `.activity-bar__item` with matching `title`/`aria-label` (Explorer, Search, Source Control, Settings) but no shortcut in the tooltip. `layout.css:125` draws a 2px `var(--accent)` active `::before`. Probe `badge:false`; `useGit` already exposes real status but no badge is rendered. Settings gear is the 4th top item, followed by the spacer — not pinned to the bottom. |
| 3 | Side bar section headers: chevron, uppercase, hover actions; OPEN EDITORS | partial | `.explorer__title` text `EXPLORER` with `text-transform:uppercase` and `.explorer__actions` icon buttons (`explorer.css:12-30`). Probe `openEditorsSection:false`; sections are not collapsible and headers have no chevron. |
| 4 | Explorer tree: file icons, chevrons, indent guides, hover/selection, git colours | partial | Probe `treeNodes:7`, `fileIcons:7`; `fileIcons.tsx` has ~28 extension styles plus open/closed folder SVGs. `FileTreeNode.tsx:87-105` renders chevrons and depth-based padding (`indent = 6 + depth*14`) but no vertical indent guides. No git status in the tree. |
| 5 | Tabs: icon, name, dirty dot → X on hover, accent line, overflow, context menu, drag | partial | Probe: 2 tabs, 2 close buttons, `overflow-x:auto`, 0 dirty dots in this state. `EditorTabs.tsx:64-70` renders an icon only for Settings. `editor.css:39` gives the active tab a 1px accent `::before`; `editor.css:82-89` swaps dot/X on hover. No `onContextMenu` on tabs; no drag-to-reorder. |
| 6 | Breadcrumb bar under tabs | missing | Probe `breadcrumbs.exists:false`; no component or selector exists in `src/renderer`. |
| 7 | Monaco options: minimap, bracket colour, indent guides, sticky scroll, current line, smooth caret, font, scrollbars | partial | `MonacoEditor.tsx:58-67` sets `minimap.enabled:true`, `renderLineHighlight:'all'`, `fontSize:13`, `tabSize:2`; probe confirms `.minimap` and a current-line node. Bracket pair colourization, sticky scroll, indent guides, smooth caret, line height and editor scrollbar styling are not configured. Computed editor font is Monaco's default `"Segoe WPC" …`, not Cascadia Code/Consolas. |
| 8 | Monaco theme matching workbench (dark + light) | missing | `MonacoEditor.tsx:165` calls `monaco.editor.setTheme('vs-dark' \| 'vs')`. No `a6-dark` / `a6-light` definitions and no shared token-to-Monaco mapping. |
| 9 | Bottom panel: tab strip + count badge, right actions, resizable sash | partial | `BottomPanel.tsx:16-20,54-72` renders TERMINAL/PROBLEMS/OUTPUT with a conditional `.bottom-panel__badge` (`problemCount = problems.errorCount`). Probe (panel hidden at capture): `badge:false`, `actions:0`, `sashCount:0`. Tab labels are uppercased by CSS. No new-terminal/maximize/close actions, no sash. |
| 10 | Status bar: branch, error/warning counts, Ln/Col, indentation, encoding, EOL, language, local-only, bell | partial | Probe items: workspace name, `Local-only: off`, language `<select>`, `Ln 1, Col 1`, `UTF-8`, theme toggle, version. Missing branch, counts, `Spaces: n`, LF/CRLF and bell. |
| 11 | Command Palette (Ctrl+Shift+P) | missing | `catalog.ts:322-329` registers `a6.view.commandPalette` with `enabled: () => false` and `plannedHint`; `CommandProvider.tsx:161` supplies `commandPalette: () => undefined`. No overlay component. |
| 12 | Quick Open (Ctrl+P) | missing | No command id, no overlay. `IpcChannels.searchQuery` and `NovaSearchApi` exist but are not wired to a file quick-open. |
| 13 | Welcome tab with no folder | missing | Explorer empty state exists (`.explorer__empty-title`, `.explorer__empty-hint`), but no Welcome editor tab; tabs are only file buffers, untitled buffers and Settings. |
| 14 | Non-blocking toasts + bell history; no alert-style messages | partial | `NotificationHost.tsx` renders auto-dismissing toasts; `explorer.css:260` fixes them bottom-right (`right:16px; bottom:40px`). No bell/history. `EditorTabs.tsx:29` and `Explorer.tsx:212` still use `window.confirm`. |
| 15 | Consistent context menus via one component | partial | `ExplorerContextMenu.tsx` is a real `role="menu"` component used by the tree; editor tabs have none; no shared menu primitive. |
| 16 | Visual system: Dark Modern-style palette, light variant, 13px Segoe UI, 1px borders, 22–28px rows | partial | `tokens.css` defines a complete dark/light token set: `--surface-app:#111318`, `--surface-sidebar:#171a21`, `--border:#2b303b`, `--text:#e5e7eb`, `--accent:#2f9bf0`, `--font-size-base:13px`, Segoe UI stack, 24/28px row tokens. This is a blue-tinted custom scheme, not the requested Dark Modern neutral values; `--tab-height:36px` exceeds the density target. |
| 17 | Focus/hover: 1px accent outlines, sash hover, delayed tooltips, no layout shift | partial | `global.css:41` and `explorer.css:48` define 1px accent `:focus-visible` outlines. No sash exists; tooltips are native `title` attributes (no delay control). Hover rules change colour/background only. |
| 18 | Sashes between side bar, editor, bottom panel and AI panel with remembered sizes | missing | Probe `sashCount:0`; `UiProvider` stores visibility and layout signals only, no sizes and no persistence. |
| 19 | Keyboard: Ctrl+B, Ctrl+J, Ctrl+L, Ctrl+Tab/PageUp/PageDown, F1 | partial | `catalog.ts:354` binds Ctrl+L to AI panel. Explorer is Ctrl+Shift+E; no Ctrl+B, Ctrl+J, Ctrl+Tab, Ctrl+PageUp/Down or F1 bindings. |
| 20 | Designed empty and loading states for every panel | partial | Explorer has empty title/hint, loading spinner and retry (`FileTreeNode.tsx:118-120,141-167`); Monaco has `.editor-loading`. Other panels lack a consistent designed empty/loading treatment. |

## Proposed file plan

The guiding constraint: **no new IPC channel, no main-process security change,
no new dependency.** New UI reads existing services (`git.status`,
`search.query`, `fs.readFile`, problems, tabs, commands). Every new action is a
registry command with a stable id, keybinding, `enabled`/`checked` state.

### LF1 — Tokens and theme (no layout changes)
- `styles/tokens.css`: Dark Modern-style neutral surfaces (`#1f1f1f` editor,
  `#181818` chrome, `#2b2b2b` borders, `#cccccc` fg, `#9d9d9d` muted,
  `#0078d4` accent — A6 blue kept as the accent if it reads better), plus a
  matching light variant; row heights 22–28px; `--tab-height:28px`.
- `features/editor/monacoSetup.ts`: define and register `a6-dark` / `a6-light`
  with token colours derived from the same CSS custom properties.
- `features/editor/MonacoEditor.tsx`: wire `setTheme('a6-dark' | 'a6-light')`.
- `styles/global.css`, `styles/editor.css`: font stack, line height, styled
  Monaco scrollbars; no structural changes.
- `components/ui/icons.tsx`: expanded inline-SVG icon set; `features/explorer/fileIcons.tsx`:
  ~20+ common file types plus open/closed folders.

### LF2 — Chrome
- `components/layout/TitleBar.tsx`: command-center pill (workspace name →
  palette), sidebar/bottom/AI layout toggles; keep native-overlay reservation.
- `components/layout/ActivityBar.tsx`: shortcut-bearing tooltips, SCM change
  badge (from shared Git state), gear pinned to the bottom.
- New shared `components/ui/ContextMenu.tsx`; `Sidebar.tsx` + Explorer:
  chevron/uppercase/hover-action section headers, OPEN EDITORS section.
- `features/editor/EditorTabs.tsx`: file icon, dirty dot ↔ X, accent line,
  context menu (Close / Close Others / Close All / Copy Path) as registry
  commands; `features/editor/EditorArea.tsx`: breadcrumb component.

### LF3 — Editor, bottom panel, status bar
- `MonacoEditor.tsx`: bracket pair colorization, indent guides, sticky scroll,
  current-line highlight, smooth caret, font/line-height, editor scrollbars.
- `BottomPanel.tsx`: PROBLEMS/OUTPUT/TERMINAL strip with count, right-aligned
  new-terminal/maximize/close actions (existing terminal + layout commands).
- `StatusBar.tsx`: branch and change counts from existing `useGit` data,
  Ln/Col, `Spaces: n`, UTF-8, LF/CRLF, language picker, local-only, bell.
  Non-clickable items get a non-interactive appearance.

### LF4 — Palette, Quick Open, Welcome, notifications
- `commands/catalog.ts`: enable `a6.view.commandPalette`; add
  `a6.file.quickOpen` (Ctrl+P), `a6.view.toggleBottomPanel` (Ctrl+J),
  `a6.view.toggleSidebar` (Ctrl+B), `a6.view.nextTab` / `previousTab`,
  `a6.view.commandPaletteViaF1` or F1 alias — all with conflict checks.
- New `features/palette/` overlays: fuzzy ranking over `createCommandDefinitions()`
  and `window.nova.search` file results; recent-first, keyboard-only.
- New `features/welcome/WelcomeView.tsx` tab (Start / Recent / Help) using
  existing New File / Open Folder / Help commands.
- `NotificationHost.tsx` + `StatusBar.tsx`: toast history behind a bell;
  replace `window.confirm` alert-style calls with in-app confirmations.

### LF5 — Polish and verification
- Sash components with per-session (or existing settings) persistence; focus
  order, roles/aria, Escape/arrow handling; light-theme pass; 125% scaling;
  extend `tools/verify/runtime.mjs` with scorecard DOM/CSS assertions; AFTER
  screenshots and final scorecard in this file.

## Planned token mapping (LF1)

| Token | Dark | Light |
| --- | --- | --- |
| `--surface-app` (editor) | `#1f1f1f` | `#ffffff` |
| `--surface-sidebar` / chrome | `#181818` | `#f3f3f3` |
| `--border` | `#2b2b2b` | `#d4d4d4` |
| `--text` | `#cccccc` | `#1f1f1f` |
| `--text-muted` | `#9d9d9d` | `#616161` |
| `--accent` | `#0078d4` (or A6 `#2f9bf0`) | `#0078d4` |
| list hover / active | `#2a2d2e` / `#37373d` | `#e8e8e8` / `#e4e6f1` |
| UI font | 13px Segoe UI / system stack | same |
| row heights | 22–28px, 1px borders | same |

## Planned icon list (LF1, all inline SVG in `icons.tsx`)

New UI names: `commandCenter`, `layoutSidebar`, `layoutPanel`, `panelLeft`,
`panelBottom`, `panelRightOff`, `bell`, `error`, `warningCount`, `branch`,
`gitChange`, `indent`, `encoding`, `eol`, `newTerminal`, `maximizePanel`,
`closePanel`, `chevronUp`, `ellipsis`, `copyPath`, `history`, `arrowRight`,
`folderOpen`, `folderClosed`. File-type set: ts/tsx/js/jsx/json/html/css/scss/
md/py/java/c/cpp/h/go/rs/sh/sql/yaml/toml/vue/xml/svg/txt/lock/ignore + default
document. No icons, fonts or branding are copied from the target products, and
the words "VS Code"/"Visual Studio Code" will not appear in any user-facing UI
or documentation.

## Tests / verification plan

- Vitest (pure logic): fuzzy ranking for palette and quick open, breadcrumb
  segment building, status-bar models, tab context-menu actions, keybinding
  conflict detection (assert no new conflicts).
- `tools/verify/runtime.mjs`: add DOM/computed-style checks per scorecard item
  (one title row + command centre, breadcrumb for an open file, minimap enabled,
  bottom-panel tab strip with a Problems count after creating an error, palette
  opens with Ctrl+Shift+P and runs a command, quick open opens a file, Welcome
  tab with no folder, zero console errors). Update selectors where the shell
  markup changes so existing 159 checks stay green.
- Final gates: `pnpm typecheck`, `pnpm test`, `pnpm package`, `pnpm make`,
  `pnpm verify`, `verify:fuses`, `verify:quitcleanup`, `verify:packaging`,
  `verify:release`, with real counts reported.

## Limitations

- Windows x64 only for packaged/native-chrome verification; macOS and Linux
  were not executed.
- The capture model cannot view images; the BEFORE visual comparison is
  delegated to the owner. DOM/CSS evidence and code inspection are the basis
  of this scorecard.

**Status: LF0 complete — awaiting approval before LF1.**
