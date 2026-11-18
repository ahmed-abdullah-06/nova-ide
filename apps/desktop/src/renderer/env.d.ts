import type { CommandTraceEntry } from './commands/registry';
import type { NovaApi } from '../shared/ipc-types';

declare global {
  interface Window {
    /** Typed preload bridge exposed via contextBridge (see src/preload/index.ts). */
    nova: NovaApi;
    /**
     * Read-only, harmless command trace used by packaged-app verification.
     * Entries contain only `{sequence, id, source, outcome}` — no arguments,
     * paths, file contents or secrets. It cannot execute commands.
     */
    __a6CommandTrace?: () => readonly CommandTraceEntry[];
  }
}

export {};
