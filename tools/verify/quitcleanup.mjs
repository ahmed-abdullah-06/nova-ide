// Checks that no child process survives the application.
//
// The harness starts a long running task, kills the application (a crash
// skips every cleanup handler) and then verifies that the process of the
// task is really gone. The task writes its own process id into a file, so
// the check does not depend on how the process list is queried.
//
// Usage:
//   node tools/verify/quitcleanup.mjs
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  createIsolatedProfile,
  profileFingerprint,
  realUserDataPath,
  userDataArgument,
} from './isolation.mjs';

/** The port of the DevTools endpoint (a free one, to avoid collisions). */
const PORT = 9400 + Math.floor(Math.random() * 200);

/** The workspace the check runs against. */
const root = mkdtempSync(path.join(tmpdir(), 'nova-quit-'));

/** The file the task writes its process id into. */
const pidFile = path.join(root, 'pid.txt');

writeFileSync(
  path.join(root, 'package.json'),
  JSON.stringify({
    name: 'quit-fixture',
    private: true,
    scripts: { slow: 'node slow.js' },
  }),
  'utf8',
);
writeFileSync(
  path.join(root, 'slow.js'),
  [
    "const fs = require('node:fs');",
    `fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid) + ' ' + String(process.ppid));`,
    "console.log('NOVA_SLOW_STARTED');",
    'setTimeout(() => {}, 60000);',
  ].join('\n'),
  'utf8',
);

// The application runs with an isolated profile, so the check never
// touches the settings, the keys or the conversations of the user.
const profile = createIsolatedProfile();
const userProfile = realUserDataPath();
const fingerprintBefore = profileFingerprint(userProfile);

const app = spawn(
  path.join(
    process.cwd(),
    'apps',
    'desktop',
    'out',
    'NOVA IDE-win32-x64',
    'NOVAIDE.exe',
  ),
  [`--remote-debugging-port=${PORT}`, userDataArgument(profile.dir)],
  { stdio: 'ignore' },
);

/** Waits until the DevTools endpoint answers. */
async function waitForDevTools(timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      if (response.ok) return true;
    } catch {
      // The application is not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

const ready = await waitForDevTools();
if (!ready) {
  console.error('FAIL the application did not start');
  app.kill();
  rmSync(root, { recursive: true, force: true });
  process.exit(1);
}

const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const page = targets.find((target) => target.type === 'page');
if (page === undefined) {
  console.error('FAIL the renderer window is missing');
  app.kill();
  rmSync(root, { recursive: true, force: true });
  process.exit(1);
}

const socket = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let nextId = 1;
const pending = new Map();
socket.addEventListener('message', (event) => {
  const message = JSON.parse(String(event.data));
  if (typeof message.id === 'number') {
    const entry = pending.get(message.id);
    if (entry !== undefined) {
      pending.delete(message.id);
      entry(message.result);
    }
  }
});

/**
 * Evaluates an expression in the renderer.
 *
 * @param {string} expression The expression to evaluate.
 * @returns {Promise<unknown>} The value of the expression.
 */
function evaluate(expression) {
  const id = nextId;
  nextId += 1;
  return new Promise((resolve) => {
    pending.set(id, resolve);
    socket.send(
      JSON.stringify({
        id,
        method: 'Runtime.evaluate',
        params: { expression, awaitPromise: true, returnByValue: true },
      }),
    );
  });
}

await evaluate(
  `window.nova.workspace.open(${JSON.stringify(root)}).then((r) => r.ok)`,
);
await new Promise((resolve) => setTimeout(resolve, 2000));

// Start the long running task.
await evaluate(
  `window.nova.task.run('slow').then((r) => (r.ok ? r.value.taskId : 'ERR'))`,
);

/** True while the process is still alive. */
function isAlive(processId) {
  try {
    // Signal 0 only checks whether the process exists.
    process.kill(processId, 0);
    return true;
  } catch {
    return false;
  }
}

// Wait for the task to write its process id.
let pid = null;
let wrapperPid = null;
for (let attempt = 0; attempt < 40 && pid === null; attempt += 1) {
  if (existsSync(pidFile)) {
    const raw = readFileSync(pidFile, 'utf8').trim();
    if (raw.length > 0) {
      const parts = raw.split(/\s+/);
      pid = Number.parseInt(parts[0], 10);
      wrapperPid = Number.parseInt(parts[1] ?? '', 10);
    }
  }
  if (pid === null) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

if (pid === null || Number.isNaN(pid)) {
  console.error('FAIL the task never started');
  socket.close();
  app.kill();
  rmSync(root, { recursive: true, force: true });
  process.exit(1);
}

const aliveWhileRunning = isAlive(pid);

// Kill the application without a clean shutdown — a crash skips every
// cleanup handler of the main process.
socket.close();
app.kill();

// Wait for the watchdog to terminate the orphaned task.
let alive = isAlive(pid);
for (let attempt = 0; attempt < 40 && alive; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  alive = isAlive(pid);
}

console.log(
  `the task (process ${pid}, wrapper ${wrapperPid}) was running: ` +
    `${aliveWhileRunning}, still alive after the crash: ${alive}, ` +
    `the wrapper is alive: ${isAlive(wrapperPid)}`,
);

rmSync(root, { recursive: true, force: true });

// The profile of the user must not have changed.
const fingerprintAfter = profileFingerprint(userProfile);
if (fingerprintAfter !== fingerprintBefore) {
  console.error(
    `FAIL the profile of the user was changed (${userProfile ?? 'unknown'})`,
  );
  profile.cleanup();
  process.exit(1);
}
console.log('the profile of the user was not touched');

profile.cleanup();
process.exit(alive ? 1 : 0);
