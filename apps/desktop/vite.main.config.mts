import { defineConfig } from 'vite';

// Main-process bundle configuration (Forge Vite plugin handles externals).
// https://www.electronforge.io/config/plugins/vite
export default defineConfig({
  build: {
    rollupOptions: {
      // `node-pty` is a native module: its `.node` binary must stay a real
      // file on disk and must not be inlined into the bundle. It is shipped
      // as an unpacked ASAR entry (see `forge.config.mts`).
      external: ['node-pty'],
    },
  },
});
