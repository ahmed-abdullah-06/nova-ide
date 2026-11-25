/**
 * Development launcher for A6 (Windows console fix).
 *
 * The old `npm run dev` chain went through the pnpm shim and let Electron
 * Forge spawn Vite watchers and pnpm config helpers with visible consoles.
 * This launcher starts the same Forge `start` command directly, from the
 * desktop package, with no shell. A dev-only preload forces `windowsHide` on
 * every child process Forge creates. Standard output and error are inherited,
 * so the terminal that runs `npm run dev` still shows all logs.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..', '..');
const desktop = path.join(repo, 'apps', 'desktop');

const forgePackage = require.resolve('@electron-forge/cli/package.json');
const forgeCli = path.join(path.dirname(forgePackage), 'dist', 'electron-forge.js');
const guard = path.join(here, 'hide-console.cjs').replace(/\\/g, '/');

const nodeOptions = [
  process.env.NODE_OPTIONS ?? '',
  `--require="${guard}"`,
]
  .filter((value) => value.length > 0)
  .join(' ');

// The old chain went through pnpm, and Forge reports the package manager
// from npm_config_user_agent. Keep that value so the system check and its
// log output stay the same even though this launcher calls Forge directly.
const { packageManager } = require(path.join(repo, 'package.json'));
const [manager, version] = packageManager.split('@');
const userAgent = process.env.npm_config_user_agent ?? '';
const env = { ...process.env, NODE_OPTIONS: nodeOptions };
if (!new RegExp(`(^|\\s)${manager}\\/`).test(userAgent)) {
  env.npm_config_user_agent = `${manager}/${version} ${userAgent}`.trim();
}

const child = spawn(process.execPath, [forgeCli, 'start'], {
  cwd: desktop,
  env,
  stdio: 'inherit',
  windowsHide: true,
  shell: false,
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill(signal));
}

child.on('error', (error) => {
  console.error(`[dev] Electron Forge could not start: ${error.message}`);
  process.exitCode = 1;
});

child.on('close', (code, signal) => {
  process.exitCode = code ?? (signal !== null ? 1 : 0);
});
