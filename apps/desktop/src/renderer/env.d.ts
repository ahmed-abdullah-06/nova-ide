import type { NovaApi } from '../shared/ipc-types';

declare global {
  interface Window {
    /** Typed preload bridge exposed via contextBridge (see src/preload/index.ts). */
    nova: NovaApi;
  }
}

export {};
