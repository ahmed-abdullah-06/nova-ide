'use strict';

/**
 * Dev-only Windows console guard.
 *
 * Electron Forge starts Vite watchers and pnpm config helpers through
 * `child_process`; on Windows those helper processes can flash a console
 * window before the IDE appears. This preload is injected only into the
 * development launcher, never into the packaged app or the Electron main
 * process, and forces `windowsHide` on every child process call, including
 * `fork`.
 *
 * Set A6_DEV_HIDE_CONSOLE_DEBUG=1 to log each guarded call during a dev run.
 */
if (process.platform !== 'win32' || process.versions.electron !== undefined) {
  return;
}

const childProcess = require('node:child_process');
const debug = process.env.A6_DEV_HIDE_CONSOLE_DEBUG === '1';
const promisifyCustom = Symbol.for('nodejs.util.promisify.custom');
const shellMeta = /[&|<>^()\r\n]/;

/** @param {unknown[]} args The call arguments. */
function optionsIndex(args) {
  return Array.isArray(args[1]) ? 2 : 1;
}

/**
 * Adds the hidden-window option to a child_process call without changing its
 * command or arguments. A call that already supplied an options object keeps
 * all of its settings; `windowsHide` is forced to true.
 *
 * @param {unknown[]} args The original call arguments.
 * @param {number} index The position of the options argument.
 * @param {string} name The name of the wrapped function.
 * @returns {unknown[]} The guarded call arguments.
 */
function guard(args, index, name) {
  const next = args.slice();
  const current = next[index];
  const options =
    current !== null && typeof current === 'object' && !Array.isArray(current)
      ? { ...current }
      : {};

  // A direct executable needs no command shell. Shell strings (the form used
  // by `exec`) keep their shell because parsing them here would change the
  // command's meaning.
  if (options.shell === true) {
    const command = next[0];
    const commandArgs = Array.isArray(next[1]) ? next[1] : [];
    const directExe =
      typeof command === 'string' && /\.(exe|com)$/i.test(command);
    const plainArgs = commandArgs.every(
      (value) => typeof value === 'string' && !shellMeta.test(value),
    );
    if (directExe && !shellMeta.test(command) && plainArgs) {
      options.shell = false;
    }
  }

  options.windowsHide = true;
  if (current !== null && typeof current === 'object' && !Array.isArray(current)) {
    next[index] = options;
  } else {
    next.splice(index, 0, options);
  }

  if (debug) {
    const command = typeof next[0] === 'string' ? next[0] : String(next[0]);
    console.error(`[dev-console] ${name}: windowsHide=true ${command}`);
  }
  return next;
}

/**
 * Wraps one child_process function.
 *
 * @param {Function} original The real Node function.
 * @param {string} name The function name for the optional debug log.
 * @param {(args: unknown[]) => number} indexOfOptions Finds the options slot.
 * @returns {Function} The guarded function.
 */
function wrap(original, name, indexOfOptions) {
  const wrapped = function (...args) {
    return original.apply(this, guard(args, indexOfOptions(args), name));
  };
  const originalPromisified = original[promisifyCustom];
  if (typeof originalPromisified === 'function') {
    wrapped[promisifyCustom] = function (...args) {
      return originalPromisified.apply(
        this,
        guard(args, indexOfOptions(args), `${name}[promise]`),
      );
    };
  }
  return wrapped;
}

const atOptions = (args) => optionsIndex(args);
const atOne = () => 1;

childProcess.spawn = wrap(childProcess.spawn, 'spawn', atOptions);
childProcess.spawnSync = wrap(childProcess.spawnSync, 'spawnSync', atOptions);
childProcess.fork = wrap(childProcess.fork, 'fork', atOptions);
childProcess.exec = wrap(childProcess.exec, 'exec', atOne);
childProcess.execSync = wrap(childProcess.execSync, 'execSync', atOne);
childProcess.execFile = wrap(childProcess.execFile, 'execFile', atOptions);
childProcess.execFileSync = wrap(
  childProcess.execFileSync,
  'execFileSync',
  atOptions,
);
