import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { copyNativeTerminalModule } from './forge/copyNativeModule';

// Single source of truth for the Windows copyright string. Electron Packager
// maps the top-level `packagerConfig.appCopyright` option to the exe's
// LegalCopyright version resource (via `legalCopyright` -> resedit). The
// `win32metadata` object has no LegalCopyright key in its type and is not
// where resedit reads the value from.
const PRODUCT_COPYRIGHT =
  'Copyright (c) 2026 NOVA IDE Project. All rights reserved.';

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      // The native `node-pty` module cannot be loaded from inside an ASAR
      // archive, so it is unpacked next to `app.asar` (Electron's standard
      // approach for native modules). Everything else stays packed, and the
      // ASAR integrity fuse keeps the archive tamper-evident.
      unpack: '**/node_modules/node-pty/**',
    },
    // Display name comes from package.json `productName` ("NOVA IDE");
    // the executable must be a filesystem-safe name without spaces.
    executableName: 'NOVAIDE',
    // Windows file/version resource metadata (spec 10C). These strings must
    // stay in sync with the description/author/copyright in package.json.
    appCopyright: PRODUCT_COPYRIGHT,
    win32metadata: {
      CompanyName: 'NOVA IDE Project',
      FileDescription: 'NOVA IDE desktop application',
      ProductName: 'NOVA IDE',
    },
    afterCopy: [copyNativeTerminalModule],
  },
  rebuildConfig: {
    // `node-pty` ships prebuilt N-API binaries. N-API is ABI-stable, so the
    // binaries work unchanged on every Node.js/Electron version and must
    // NOT be recompiled (that would require a full C++ toolchain on every
    // build machine).
    ignoreModules: ['node-pty'],
  },
  makers: [
    // Windows installers (initial development platform is Windows, spec §22)
    // `name` must be a valid NuGet package id — the scoped workspace name
    // "@nova/desktop" is rejected by nuget.exe (it also becomes a path).
    new MakerSquirrel({
      name: 'NOVAIDE',
      title: 'NOVA IDE',
      authors: 'NOVA IDE Project',
      description: 'NOVA IDE desktop application',
      copyright: PRODUCT_COPYRIGHT,
    }),
    // Portable zip archives
    new MakerZIP({}, ['win32', 'darwin']),
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          // Named entries map to the emitted bundle names (main.cjs,
          // preload.cjs) — Vite's [name] comes from the entry key.
          entry: { main: 'src/main/index.ts' },
          config: 'vite.main.config.mts',
          target: 'main',
        },
        {
          entry: { preload: 'src/preload/index.ts' },
          config: 'vite.preload.config.mts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.mts',
        },
      ],
    }),
    // Harden the packaged application before code signing (spec §19):
    // - RunAsNode disabled (prevents NODE_OPTIONS / external Node execution abuse)
    // - Cookie encryption enabled
    // - Node CLI inspect / NODE_OPTIONS environment variables disabled
    // - ASAR integrity validation + app loaded only from ASAR
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
