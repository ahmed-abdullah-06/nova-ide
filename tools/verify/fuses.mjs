/**
 * Reads the Electron fuses of the packaged executable and prints them.
 *
 * The fuses are part of the security model of Milestone 1 (spec §19.1);
 * this script proves that the packaged build really carries them.
 *
 * Usage: node tools/verify/fuses.mjs
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  FuseState,
  FuseV1Options,
  getCurrentFuseWire,
} from '@electron/fuses';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const exe = path.join(
  root,
  'apps',
  'desktop',
  'out',
  'NOVA IDE-win32-x64',
  'NOVAIDE.exe',
);

if (!existsSync(exe)) {
  console.error(`the packaged executable was not found: ${exe}`);
  console.error('run "pnpm package" first');
  process.exit(1);
}

const wire = await getCurrentFuseWire(exe);

/** The fuses that must be set, and the value they must have. */
const expected = [
  [FuseV1Options.RunAsNode, false],
  [FuseV1Options.EnableCookieEncryption, true],
  [FuseV1Options.EnableNodeOptionsEnvironmentVariable, false],
  [FuseV1Options.EnableNodeCliInspectArguments, false],
  [FuseV1Options.EnableEmbeddedAsarIntegrityValidation, true],
  [FuseV1Options.OnlyLoadAppFromAsar, true],
];

/** The name of a fuse. */
const names = Object.fromEntries(
  Object.entries(FuseV1Options)
    .filter(([, value]) => typeof value === 'number')
    .map(([name, value]) => [value, name]),
);

/** Turns the state of the wire into a boolean. */
function isEnabled(state) {
  return state === FuseState.ENABLE;
}

let failed = 0;
for (const [option, want] of expected) {
  const name = names[option] ?? String(option);
  const got = isEnabled(wire[option]);
  const ok = got === want;
  if (!ok) {
    failed += 1;
  }
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}: ${got ? 'ON' : 'OFF'} ` +
      `(expected ${want ? 'ON' : 'OFF'})`,
  );
}

// The remaining fuses are printed as well, so a change of the Electron
// version is visible.
for (const [option, state] of Object.entries(wire)) {
  const name = names[Number(option)] ?? option;
  if (!expected.some(([key]) => key === Number(option))) {
    console.log(`INFO  ${name}: ${FuseState[state] ?? state}`);
  }
}

console.log(
  failed === 0
    ? `all ${expected.length} fuses are set as expected`
    : `${failed} fuse(s) differ from the expected configuration`,
);
process.exit(failed === 0 ? 0 : 1);
