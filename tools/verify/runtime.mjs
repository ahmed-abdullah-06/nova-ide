/**
 * Runtime verification harness for A6 (spec §24).
 *
 * Launches the real application (packaged or development build), drives it
 * through the Chrome DevTools protocol and checks the behaviour that can
 * only be verified in a running application:
 *
 *  - the window and the six layout regions render,
 *  - a workspace can be opened and the explorer lists it,
 *  - a terminal session starts in the workspace root and answers commands,
 *  - the search finds files and content,
 *  - the source control panel reports the repository state,
 *  - the problems panel shows the diagnostics of the editor,
 *  - a task can be started and stopped again,
 *  - the agent plans, proposes, reverts with a conflict confirmation and
 *    applies a narrowed permission,
 *  - the renderer produces no console errors.
 *
 * Usage:
 *   node tools/verify/runtime.mjs                # packaged build
 *   node tools/verify/runtime.mjs --dev          # development build
 *   node tools/verify/runtime.mjs --keep-open    # leave the app running
 */
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DevToolsSession,
  findPageTarget,
  waitForDevTools,
} from './cdp.mjs';
import {
  createIsolatedProfile,
  profileFingerprint,
  realUserDataPath,
  seedProviderAddress,
  userDataArgument,
} from './isolation.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const DESKTOP = path.join(REPO, 'apps', 'desktop');
const DEVTOOLS_PORT = 9333;

const options = {
  dev: process.argv.includes('--dev'),
  keepOpen: process.argv.includes('--keep-open'),
};

/**
 * Starts a mock of the local Ollama service.
 *
 * The harness talks to it through the real provider of the application,
 * so the chat flow is verified end to end without a model.
 *
 * The mock also answers the management endpoints of Milestone 7:
 * /api/tags (the installed models), /api/ps (the loaded models),
 * /api/show (the details), /api/pull (the progress of a download),
 * /api/delete and /api/generate (the unload).
 *
 * @returns {Promise<{url: string, stop: () => void}>} The mock.
 */
async function startMockOllama() {
  /** The models the mock knows. */
  const installed = new Map([
    [
      'nova-verify-model',
      {
        name: 'nova-verify-model',
        model: 'nova-verify-model',
        modified_at: '2025-10-03T23:34:03.409490317-07:00',
        size: 1024,
        digest: 'verifydigest',
        details: {
          format: 'gguf',
          family: 'nova',
          families: ['nova'],
          parameter_size: '1.0B',
          quantization_level: 'Q4_K_M',
        },
      },
    ],
  ]);
  /** The models that were pulled during the run. */
  const pulled = new Set();
  /** The requests the mock received (for the checks). */
  const seen = [];

  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => {
      chunks.push(chunk.toString('utf8'));
    });
    request.on('end', () => {
      const body = chunks.join('');
      const url = request.url ?? '';
      seen.push({ method: request.method ?? '', url, body });
      if ((request.method ?? '') === 'DELETE' && url.startsWith('/api/delete')) {
        const model = JSON.parse(body || '{}').model;
        installed.delete(model);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
        return;
      }
      if (url.startsWith('/api/generate')) {
        // The unload of a model.
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"done":true}');
        return;
      }
      if (url.startsWith('/api/pull')) {
        const model = JSON.parse(body || '{}').model;
        const slow = String(model).includes('slow');
        response.writeHead(200, { 'content-type': 'application/x-ndjson' });
        let step = 0;
        const writeNext = () => {
          step += 1;
          if (step === 1) {
            response.write('{"status":"pulling manifest"}\n');
          } else if (step === 2) {
            response.write(
              '{"status":"pulling verifydigest","total":2048,"completed":1024}\n',
            );
          } else if (step === 3) {
            response.write(
              '{"status":"pulling verifydigest","total":2048,"completed":2048}\n',
            );
          } else if (step === 4 && !slow) {
            installed.set(model, {
              name: model,
              model,
              modified_at: '2025-10-03T23:34:03.409490317-07:00',
              size: 2048,
              digest: 'verifydigest',
              details: {
                format: 'gguf',
                family: 'nova',
                parameter_size: '1.0B',
                quantization_level: 'Q4_K_M',
              },
            });
            pulled.add(model);
            response.write('{"status":"success"}\n');
            response.end();
            return;
          } else {
            // A slow download stays open, so the check can stop it.
            response.write(
              '{"status":"pulling verifydigest","total":4096,"completed":2048}\n',
            );
          }
          setTimeout(writeNext, 300);
        };
        writeNext();
        return;
      }
      if (url.startsWith('/api/show')) {
        const model = JSON.parse(body || '{}').model;
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(
          JSON.stringify({
            license: 'MIT',
            parameters: 'temperature 0.7',
            modified_at: '2025-10-03T23:34:03.409490317-07:00',
            details: {
              format: 'gguf',
              family: 'nova',
              parameter_size: '1.0B',
              quantization_level: 'Q4_K_M',
            },
            capabilities: ['completion', 'tools'],
            model_info: { 'nova.context_length': 4096 },
          }),
        );
        return;
      }
      if (url.startsWith('/api/ps')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ models: [] }));
        return;
      }
      if (url.startsWith('/api/tags')) {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ models: [...installed.values()] }));
        return;
      }
      if (url.startsWith('/api/chat')) {
        // The planner and the agent use different system prompts, so the
        // mock can tell the three flows apart.
        const isPlanner = body.includes('You are planning a coding task');
        const isAgent = body.includes('You are a coding agent');
        response.writeHead(200, { 'content-type': 'application/x-ndjson' });
        if (isPlanner) {
          const answer = planAnswers.shift() ?? DEFAULT_PLAN_ANSWER;
          // The plan is fast: the run only waits for the user after it.
          setTimeout(() => {
            response.write(
              '{"message":{"role":"assistant","content":' +
                JSON.stringify(answer) +
                '},"done":false}\n',
            );
            response.write('{"done":true,"eval_count":7}\n');
            response.end();
          }, 50);
          return;
        }
        if (isAgent) {
          const answer = agentAnswers.shift() ?? agentAnswers[0] ??
            '{"thought":"done","final":"The agent is finished."}';
          // The answer takes a moment, so the run can be stopped while
          // the model is still thinking.
          setTimeout(() => {
            response.write(
              '{"message":{"role":"assistant","content":' +
                JSON.stringify(answer) +
                '},"done":false}\n',
            );
            response.write('{"done":true,"eval_count":7}\n');
            response.end();
          }, 1200);
          return;
        }
        response.write(
          '{"message":{"role":"assistant","content":"NOVA_VERIFY_ANSWER"},"done":false}\n',
        );
        response.write('{"done":true,"eval_count":7}\n');
        response.end();
      }
      return;
    });
  });
  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    installed,
    pulled,
    seen,
    stop: () => {
      server.close();
    },
  };
}

/**
 * The scripted plan of the planner.
 *
 * The mock service returns them one after the other; the default plan is
 * used once the queue is empty, so every run gets a usable plan.
 */
const planAnswers = [];

/** The plan that is used when no scripted plan is queued. */
const DEFAULT_PLAN_ANSWER = JSON.stringify({
  steps: [
    {
      description: 'Read the notes of the project',
      files: ['notes.txt'],
      command: null,
    },
    {
      description: 'Update the notes of the project',
      files: ['notes.txt'],
      command: null,
    },
  ],
});

/**
 * The scripted answers of the agent.
 *
 * The mock service returns them one after the other, so the agent walks
 * through its steps deterministically.
 */
const agentAnswers = [
  JSON.stringify({
    thought: 'read the notes',
    tool: { name: 'read_file', arguments: { path: 'notes.txt' } },
  }),
  JSON.stringify({
    thought: 'write the notes',
    tool: {
      name: 'write_file',
      arguments: { path: 'notes.txt', content: 'written by the agent\n' },
    },
  }),
  JSON.stringify({ thought: 'done', final: 'The notes were updated.' }),
];

/** The checks that were executed. */
const results = [];
/** Console errors reported by the renderer. */
const consoleErrors = [];
/** The moment the run started (for the timing of the checks). */
const startedAt = Date.now();

/**
 * Records the outcome of one check.
 *
 * @param {string} name The name of the check.
 * @param {boolean} ok Whether the check passed.
 * @param {string} [detail] Additional information.
 */
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  const mark = ok ? 'PASS' : 'FAIL';
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ''} [${seconds}s]`);
}

/**
 * Waits until an expression evaluates to a truthy value.
 *
 * @param {import('./cdp.mjs').DevToolsSession} session The session.
 * @param {string} expression The expression to evaluate.
 * @param {number} [timeoutMs] The maximum time to wait.
 * @returns {Promise<unknown>} The value of the expression, or false.
 */
async function waitFor(session, expression, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let last = false;
  while (Date.now() < deadline) {
    const value = await session.evaluate(expression);
    if (value) {
      return value;
    }
    last = value;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return last;
}

/**
 * Clicks an element with a real mouse event.
 *
 * A DOM `click()` is not a trusted user gesture, so it cannot open the
 * microphone or start an `AudioContext`. The voice checks need a trusted
 * input event from the fake audio device.
 *
 * @param {import('./cdp.mjs').DevToolsSession} session The session.
 * @param {string} selector The selector of the element.
 * @returns {Promise<boolean>} True when the element was clicked.
 */
async function clickWithMouse(session, selector) {
  const point = await session.evaluate(
    `(() => {
      const element = document.querySelector(${JSON.stringify(selector)});
      if (element === null) return null;
      element.scrollIntoView({ block: 'center' });
      const rect = element.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`,
  );
  if (point === null || typeof point !== 'object') {
    return false;
  }
  const { x, y } = point;
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x,
    y,
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x,
    y,
    button: 'left',
    clickCount: 1,
  });
  return true;
}

/**
 * Finds the centre of an element identified by its visible text.
 *
 * @param {import('./cdp.mjs').DevToolsSession} session The session.
 * @param {string} selector The candidate selector.
 * @param {string} text The visible label (or a fragment of it).
 * @param {boolean} [exact] Require the whole label to match.
 * @returns {Promise<{x: number, y: number} | null>} The centre point.
 */
async function pointForText(session, selector, text, exact = true) {
  const matcher = exact
    ? `candidate.textContent.trim() === ${JSON.stringify(text)}`
    : `candidate.textContent.includes(${JSON.stringify(text)})`;
  return session.evaluate(
    `(() => {
      const node = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((candidate) => ${matcher});
      if (node === undefined) return null;
      const rect = node.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    })()`,
  );
}

/** @param {import('./cdp.mjs').DevToolsSession} session @param {{x: number, y: number} | null} point */
async function moveMouseTo(session, point) {
  if (point === null) return;
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseMoved',
    x: point.x,
    y: point.y,
  });
}

/** @param {import('./cdp.mjs').DevToolsSession} session @param {{x: number, y: number} | null} point */
async function clickAt(session, point) {
  if (point === null) return;
  await moveMouseTo(session, point);
  await session.send('Input.dispatchMouseEvent', {
    type: 'mousePressed',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
  await session.send('Input.dispatchMouseEvent', {
    type: 'mouseReleased',
    x: point.x,
    y: point.y,
    button: 'left',
    clickCount: 1,
  });
}

/**
 * Clicks an element identified by its visible text. This exercises the same
 * React handler as a pointer click without depending on window coordinates.
 *
 * @param {import('./cdp.mjs').DevToolsSession} session The session.
 * @param {string} selector The candidate selector.
 * @param {string} text The visible label (or a fragment of it).
 * @param {boolean} [exact] Require the whole label to match.
 * @returns {Promise<boolean>} True when an element was clicked.
 */
async function clickText(session, selector, text, exact = true) {
  const matcher = exact
    ? `candidate.textContent.trim() === ${JSON.stringify(text)}`
    : `candidate.textContent.includes(${JSON.stringify(text)})`;
  return session.evaluate(
    `(() => {
      const node = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((candidate) => ${matcher});
      if (node === undefined) return false;
      node.click();
      return true;
    })()`,
  );
}

/** @param {import('./cdp.mjs').DevToolsSession} session @param {string} selector @param {string} text */
async function hoverText(session, selector, text) {
  return session.evaluate(
    `(() => {
      const node = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((candidate) => candidate.textContent.trim() === ${JSON.stringify(text)});
      if (node === undefined) return false;
      node.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      node.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
      return true;
    })()`,
  );
}

/** @param {import('./cdp.mjs').DevToolsSession} session @param {string} selector @param {string} text */
async function focusText(session, selector, text) {
  return session.evaluate(
    `(() => {
      const node = [...document.querySelectorAll(${JSON.stringify(selector)})]
        .find((candidate) => candidate.textContent.includes(${JSON.stringify(text)}));
      if (node === undefined) return false;
      node.focus();
      return document.activeElement === node;
    })()`,
  );
}

/** @param {import('./cdp.mjs').DevToolsSession} session */
async function traceSnapshot(session) {
  return session.evaluate(
    `typeof window.__a6CommandTrace === 'function'
      ? window.__a6CommandTrace()
      : null`,
  );
}

/** @param {import('./cdp.mjs').DevToolsSession} session */
async function traceSequence(session) {
  const snapshot = await traceSnapshot(session);
  return Array.isArray(snapshot) && snapshot.length > 0
    ? snapshot[snapshot.length - 1].sequence
    : 0;
}

/**
 * Waits for the plan of the active run and approves it unchanged.
 *
 * @param {import('./cdp.mjs').DevToolsSession} session The session.
 * @returns {Promise<boolean>} True when the plan was approved.
 */
async function approvePlan(session) {
  const clicked = await waitFor(
    session,
    `(() => {
      const plan = document.querySelector('.agent-panel__plan');
      if (plan === null) return false;
      const buttons = [...plan.querySelectorAll('.agent-panel__action')];
      const approve = buttons.find(
        (button) => button.textContent.trim() === 'Approve plan',
      );
      if (approve === undefined || approve.disabled) return false;
      approve.click();
      return true;
    })()`,
    30000,
  );
  return clicked === true;
}

/**
 * Creates the workspace the checks run against.
 *
 * @returns {string} The path of the workspace.
 */
function createFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'nova-verify-'));
  writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify(
      {
        name: 'nova-verify-fixture',
        private: true,
        version: '1.0.0',
        scripts: {
          hello: 'node hello.js',
          slow: 'node slow.js',
        },
      },
      null,
      2,
    ),
    'utf8',
  );
  writeFileSync(path.join(root, 'hello.js'), "console.log('NOVA_TASK_OK');\n", 'utf8');
  writeFileSync(path.join(root, 'slow.js'), 'setTimeout(() => {}, 30000);\n', 'utf8');
  writeFileSync(
    path.join(root, 'index.js'),
    'const needle = 1;\nconsole.log(needle);\n',
    'utf8',
  );
  // The fixture is a real git repository with one commit and one untracked
  // file, so the source control panel is verified against real git output.
  const git = (...args) =>
    spawnSync('git', args, { cwd: root, stdio: 'ignore', shell: false });
  git('init', '--initial-branch=main');
  git('config', 'user.email', 'verify@example.com');
  git('config', 'user.name', 'NOVA Verify');
  git('config', 'commit.gpgsign', 'false');
  git('add', 'index.js', 'hello.js');
  git('commit', '-m', 'initial commit');
  git('branch', 'feature/verify');
  writeFileSync(path.join(root, 'untracked.txt'), 'untracked\n', 'utf8');
  // A file with a type error, so the problems panel has something to show.
  writeFileSync(
    path.join(root, 'broken.ts'),
    'const value: number = "not a number";\n',
    'utf8',
  );
  return root;
}

/**
 * Starts the application under test.
 *
 * The application gets an isolated profile directory, so a test run never
 * reads or writes the settings, the keys or the conversations of the
 * user.
 *
 * @param {string} profileDir The isolated profile directory.
 * @returns {import('node:child_process').ChildProcess} The child process.
 */
function startApp(profileDir) {
  const profileArgument = userDataArgument(profileDir);
  if (options.dev) {
    return spawn(
      'pnpm',
      [
        'exec',
        'electron-forge',
        'start',
        '--inspect-port=9334',
        profileArgument,
      ],
      {
        cwd: DESKTOP,
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, NOVA_VERIFY: '1' },
      },
    );
  }
  const executable = path.join(
    DESKTOP,
    'out',
    'A6-win32-x64',
    'A6IDE.exe',
  );
  if (!existsSync(executable)) {
    throw new Error(
      `The packaged application is missing. Run "pnpm package" first (${executable}).`,
    );
  }
  // The voice checks need a deterministic microphone. Chromium's fake
  // device produces a synthetic tone and the fake UI grants the media
  // permission, so verification never touches the microphone of the user
  // and never depends on a sound card.
  return spawn(
    executable,
    [
      `--remote-debugging-port=${DEVTOOLS_PORT}`,
      '--use-fake-device-for-media-stream',
      '--use-fake-ui-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      profileArgument,
    ],
    { stdio: 'inherit' },
  );
}

/** Runs the verification. */
async function main() {
  const fixture = createFixture();
  console.log(`Fixture workspace: ${fixture}\n`);

  // The application runs with an isolated profile: a test run must never
  // touch the settings, the keys or the conversations of the user.
  const profile = createIsolatedProfile();

  // The mock of the local service starts BEFORE the application, and its
  // address is written into the isolated profile. The application
  // therefore never knows the default address of Ollama and can never
  // contact the real service of the user — not even with its first
  // request.
  const mockOllama = await startMockOllama();
  seedProviderAddress(profile.dir, mockOllama.url);
  console.log(`Profile of the application: ${profile.dir}\n`);
  console.log(`Mock service: ${mockOllama.url}\n`);

  const userProfile = realUserDataPath();
  const fingerprintBefore = profileFingerprint(userProfile);

  const app = startApp(profile.dir);
  let session = null;
  let exitCode = 0;

  try {
    const ready = await waitForDevTools('127.0.0.1', DEVTOOLS_PORT, 90000);
    if (!ready) {
      check('application starts', false, 'the DevTools endpoint never answered');
      return;
    }
    check('application starts', true);

    const target = await findPageTarget('127.0.0.1', DEVTOOLS_PORT);
    if (target === null) {
      check('renderer window exists', false);
      return;
    }
    session = new DevToolsSession(target.webSocketDebuggerUrl);
    await session.open();
    await session.send('Runtime.enable');
    await session.send('Log.enable');

    session.on((method, params) => {
      if (method === 'Runtime.consoleAPICalled' && params.type === 'error') {
        consoleErrors.push(
          (params.args ?? []).map((arg) => arg.value ?? arg.description).join(' '),
        );
      }
      if (method === 'Log.entryAdded' && params.entry?.level === 'error') {
        consoleErrors.push(params.entry.text);
      }
    });

    // The layout must render completely.
    const rendered = await waitFor(
      session,
      `(() => {
        const shell = document.querySelector('.app-shell');
        if (!shell) return false;
        const regions = [
          '.activity-bar', '.sidebar', '.editor-area', '.bottom-panel',
          '.ai-panel', '.status-bar',
        ];
        return regions.every((selector) => shell.querySelector(selector) !== null);
      })()`,
    );
    check('layout renders all regions', rendered);

    // The title row must use the generated A6 mark, not a generic placeholder.
    const brandMark = await waitFor(
      session,
      `(() => {
        const img = document.querySelector('.title-bar__brand img');
        return img !== null && img.complete === true &&
          img.naturalWidth === 32 && img.naturalHeight === 32 &&
          img.getBoundingClientRect().width > 0;
      })()`,
      10000,
    );
    check('title row shows the generated A6 mark', brandMark);

    const titleBarBounds = await session.evaluate(
      `(() => {
        const bar = document.querySelector('.title-bar');
        const actions = document.querySelector('.title-bar__actions');
        if (bar === null || actions === null) return null;
        const barRect = bar.getBoundingClientRect();
        const actionRects = [...actions.querySelectorAll('button')].map((node) => {
          const r = node.getBoundingClientRect();
          return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
        });
        const overlay = navigator.windowControlsOverlay;
        const overlayRect = overlay?.visible && overlay.getTitlebarAreaRect
          ? (() => { const r = overlay.getTitlebarAreaRect(); return { x: r.x, width: r.width }; })()
          : null;
        return {
          innerWidth: window.innerWidth,
          barRight: barRect.right,
          actionsRight: Math.max(...actionRects.map((r) => r.right), 0),
          actionRects,
          overlayRect,
        };
      })()`,
    );
    check(
      'title-row action buttons stay inside the visible title bar area',
      titleBarBounds !== null &&
        Array.isArray(titleBarBounds.actionRects) &&
        titleBarBounds.actionRects.length >= 2 &&
        titleBarBounds.actionRects.every(
          (r) =>
            r.width > 0 &&
            r.height > 0 &&
            r.left >= 0 &&
            r.right <= titleBarBounds.innerWidth - 1 &&
            // getTitlebarAreaRect() describes the draggable title-bar area,
            // which starts at x:0. Native caption buttons occupy the space to
            // its right, so that is the boundary DOM controls must not cross.
            (titleBarBounds.overlayRect === null ||
              r.right <=
                titleBarBounds.overlayRect.x +
                  titleBarBounds.overlayRect.width -
                  1),
        ),
      JSON.stringify(titleBarBounds),
    );

    const bridge = await session.evaluate(
      `typeof window.nova === 'object' && window.nova !== null`,
    );
    check('preload bridge is exposed', bridge === true);

    // Open the fixture workspace through the typed bridge and let the
    // renderer pick the change up (it re-reads the active workspace when
    // the window gains focus).
    const opened = await session.evaluate(
      `window.nova.workspace.open(${JSON.stringify(fixture)}).then((r) => r.ok)`,
    );
    check('workspace opens through the bridge', opened === true);
    await session.evaluate(`window.dispatchEvent(new Event('focus'))`);
    const explorerReady = await waitFor(
      session,
      `(() => {
        const name = document.querySelector('.explorer__title');
        return name !== null;
      })()`,
      15000,
    );
    check('explorer shows the opened workspace', explorerReady);

    // The terminal must start in the workspace root and answer commands.
    const terminal = await session.evaluate(
      `(() => {
        const result = window.nova.terminal.create();
        return result.then((r) => (r.ok ? r.value.cwd : 'ERROR:' + r.message));
      })()`,
    );
    check(
      'terminal starts in the workspace root',
      typeof terminal === 'string' &&
        terminal.replace(/\\\\/g, '/') === fixture.replace(/\\\\/g, '/'),
      typeof terminal === 'string' ? terminal : '',
    );

    // The terminal view of the panel must show the shell prompt.
    const terminalVisible = await waitFor(
      session,
      `document.querySelectorAll('.terminal-view .xterm-rows > div').length > 0`,
      20000,
    );
    check('terminal view renders in the panel', terminalVisible);

    // The bottom panel may be hidden by default; selecting its Terminal tab
    // shows it without recreating the live session.
    await session.evaluate(
      `(() => {
        const tab = [...document.querySelectorAll('.bottom-panel__tab')]
          .find((node) => node.textContent.includes('Terminal'));
        if (tab === undefined) return false;
        tab.click();
        return true;
      })()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 200));

    // Typing into the terminal must produce output in the renderer. A real
    // click on the xterm screen activates its key handling before text is
    // sent; programmatic focus alone is not enough on every Windows shell.
    await clickWithMouse(
      session,
      '.terminal-panel__view:not([hidden]) .terminal-view .xterm-screen',
    );
    const focused = await session.evaluate(
      `(() => {
        const area = document.querySelector('.terminal-panel__view:not([hidden]) .terminal-view textarea');
        if (area === null) return false;
        area.focus();
        return document.activeElement === area;
      })()`,
    );
    check('terminal accepts keyboard focus', focused === true);

    await session.insertText('echo NOVA_VERIFY_TERMINAL');
    await session.pressKey('Enter', 13);

    const terminalOutput = await waitFor(
      session,
      `(() => {
        const rows = document.querySelectorAll('.terminal-view .xterm-rows > div');
        if (rows.length === 0) return false;
        const text = [...rows].map((row) => row.textContent).join('\\n');
        return text.includes('NOVA_VERIFY_TERMINAL');
      })()`,
      40000,
    );
    check('terminal renders the output of a command', terminalOutput);

    // Explorer empty state must derive its Open Folder hint from the command
    // registry. Run this AFTER the first terminal echo check: closing and
    // reopening the workspace leaves the auto-created terminal session in an
    // exited state, so it must not happen before terminal output is verified.
    // The renderer observes a bridge-driven workspace change on focus, just as
    // it does after workspace.open() above.
    await session.evaluate(`window.nova.workspace.close()`);
    await session.evaluate(`window.dispatchEvent(new Event('focus'))`);
    const explorerEmpty = await waitFor(
      session,
      `(() => {
        const hint = document.querySelector('.explorer__empty-hint');
        const title = document.querySelector('.explorer__empty-title');
        return hint !== null && title !== null ? hint.textContent.trim() : false;
      })()`,
      10000,
    );
    const expectedOpenHint = await session.evaluate(
      `(() => {
        // Mirror CommandRegistry display: openWorkspace chord is Ctrl+K Ctrl+O on win32/linux, Cmd+K Cmd+O on darwin.
        const mac = navigator.userAgent.toLowerCase().includes('mac');
        return mac ? 'Cmd+K Cmd+O' : 'Ctrl+K Ctrl+O';
      })()`,
    );
    check(
      'Explorer Open Folder hint matches the command registry shortcut',
      explorerEmpty === expectedOpenHint,
      JSON.stringify({ explorerEmpty, expectedOpenHint }),
    );
    const reopenedWorkspace = await session.evaluate(
      `window.nova.workspace.open(${JSON.stringify(fixture)}).then((r) => r.ok)`,
    );
    check('workspace reopens after empty-state hint check', reopenedWorkspace === true);
    await session.evaluate(`window.dispatchEvent(new Event('focus'))`);
    const explorerReadyAgain = await waitFor(
      session,
      `document.querySelector('.explorer__title') !== null`,
      15000,
    );
    check('explorer restored after empty-state hint check', explorerReadyAgain === true);

    // The search view must be reachable through the activity bar.
    const searchOpened = await session.evaluate(
      `(() => {
        const buttons = [...document.querySelectorAll('.activity-bar__item')];
        const search = buttons.find((b) => b.getAttribute('aria-label') === 'Search');
        if (search === undefined) return false;
        search.click();
        return true;
      })()`,
    );
    check('search view is reachable', searchOpened === true);

    const searchTyped = await waitFor(
      session,
      `(() => {
        const input = document.querySelector('.search-view__input');
        if (input === null) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'index.js');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`,
      15000,
    );
    check('search accepts a pattern', searchTyped);

    const searchResults = await waitFor(
      session,
      `(() => {
        const items = [...document.querySelectorAll('.search-view__result-name')];
        return items.length > 0 ? items.map((i) => i.textContent).join(',') : false;
      })()`,
      20000,
    );
    check(
      'search finds files by name',
      searchTyped !== false && searchResults !== false,
      String(searchResults),
    );

    // The content search must find the occurrence in the file.
    const contentTyped = await session.evaluate(
      `(() => {
        const input = document.querySelector('.search-view__input');
        if (input === null) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'needle');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const content = [...document.querySelectorAll('.search-view__mode')]
          .find((mode) => mode.textContent.trim() === 'Content');
        if (content === undefined) return false;
        content.click();
        return true;
      })()`,
    );
    check('search switches to the content mode', contentTyped === true);

    const contentResults = await waitFor(
      session,
      `(() => {
        const items = [...document.querySelectorAll('.search-view__result-name')];
        return items.length > 0 ? items.map((i) => i.textContent).join(',') : false;
      })()`,
      20000,
    );
    check(
      'search finds content matches',
      contentTyped === true && contentResults !== false,
      String(contentResults),
    );



    // The problems panel must show the diagnostics of the editor.
    const problemsOpened = await session.evaluate(
      `(() => {
        // The sidebar shows the search view at this point, so the explorer
        // is activated again first.
        const buttons = [...document.querySelectorAll('.activity-bar__item')];
        const explorer = buttons.find(
          (b) => b.getAttribute('aria-label') === 'Explorer');
        if (explorer === undefined) return false;
        explorer.click();
        return true;
      })()`,
    );
    check('the explorer view is reachable', problemsOpened === true);

    const treeExpanded = await waitFor(
      session,
      `(() => {
        const root = document.querySelector('.tree-node');
        if (root === null) return false;
        if (root.getAttribute('aria-expanded') === 'false') root.click();
        return true;
      })()`,
      15000,
    );
    check('the explorer tree is reachable', treeExpanded === true);

    const fileOpened = await waitFor(
      session,
      `(() => {
        const labels = [...document.querySelectorAll('.tree-node__label')];
        const file = labels.find((l) => l.textContent === 'broken.ts');
        if (file === undefined) return false;
        file.click();
        return true;
      })()`,
      15000,
    );
    check('the file with the error can be opened', fileOpened === true);

    const problemsTab = await session.evaluate(
      `(() => {
        const tabs = [...document.querySelectorAll('.bottom-panel__tab')];
        const problems = tabs.find((tab) => tab.textContent.includes('Problems'));
        if (problems === undefined) return false;
        problems.click();
        return true;
      })()`,
    );
    check('problems panel is reachable', problemsTab === true);

    const diagnostics = await waitFor(
      session,
      `(() => {
        const items = [...document.querySelectorAll('.problems-panel__item')];
        return items.length > 0
          ? items.map((i) => i.textContent).join(' | ')
          : false;
      })()`,
      30000,
    );
    check(
      'problems panel lists the diagnostics of the editor',
      typeof diagnostics === 'string' && diagnostics.includes('Error'),
      String(diagnostics).slice(0, 160),
    );

    // The task runner must list the scripts of the workspace.
    const outputTab = await session.evaluate(
      `(() => {
        const tabs = [...document.querySelectorAll('.bottom-panel__tab')];
        const output = tabs.find((tab) => tab.textContent.includes('Output'));
        if (output === undefined) return false;
        output.click();
        return true;
      })()`,
    );
    check('task panel is reachable', outputTab === true);

    const taskNames = await waitFor(
      session,
      `(() => {
        const names = [...document.querySelectorAll('.task-panel__name')]
          .map((n) => n.textContent);
        return names.length > 0 ? names.join(',') : false;
      })()`,
      15000,
    );
    check(
      'task runner lists the workspace scripts',
      typeof taskNames === 'string' && taskNames.includes('hello'),
      String(taskNames),
    );

    // A task must run and report its output.
    const taskStarted = await session.evaluate(
      `(() => {
        const items = [...document.querySelectorAll('.task-panel__item')];
        const item = items.find((i) => i.textContent.includes('hello'));
        if (item === undefined) return false;
        const button = item.querySelector('.task-panel__run');
        if (button === null) return false;
        button.click();
        return true;
      })()`,
    );
    check('task runner starts a script', taskStarted === true);

    const taskOutput = await waitFor(
      session,
      `(() => {
        const output = document.querySelector('.task-panel__output');
        return output !== null && output.textContent.includes('NOVA_TASK_OK')
          ? output.textContent
          : false;
      })()`,
      30000,
    );
    check(
      'task runner shows the task output',
      typeof taskOutput === 'string' && taskOutput.includes('NOVA_TASK_OK'),
      String(taskOutput).slice(0, 120),
    );

    // The task must end with a success status.
    const taskStatus = await waitFor(
      session,
      `(() => {
        const status = document.querySelector('.task-panel__status');
        if (status === null) return false;
        const text = status.textContent.trim();
        // The panel shows "running" while the task is still going.
        return text.startsWith('success') ? text : false;
      })()`,
      30000,
    );
    check(
      'task runner reports the final status',
      typeof taskStatus === 'string' && taskStatus.startsWith('success'),
      String(taskStatus),
    );

    // A long running task must be stoppable.
    const slowStarted = await session.evaluate(
      `(() => {
        const items = [...document.querySelectorAll('.task-panel__item')];
        const item = items.find((i) => i.textContent.includes('slow'));
        if (item === undefined) return false;
        const button = item.querySelector('.task-panel__run');
        if (button === null) return false;
        button.click();
        return true;
      })()`,
    );
    check('task runner starts a long running script', slowStarted === true);

    const stopClicked = await waitFor(
      session,
      `(() => {
        const stop = document.querySelector('.task-panel__action--stop');
        if (stop === null) return false;
        stop.click();
        return true;
      })()`,
      15000,
    );
    check('the running task can be stopped', stopClicked === true);

    const cancelledStatus = await waitFor(
      session,
      `(() => {
        const status = document.querySelector('.task-panel__status');
        if (status === null) return false;
        const text = status.textContent.trim();
        return text.startsWith('cancelled') ? text : false;
      })()`,
      30000,
    );
    check(
      'the stopped task is reported as cancelled',
      typeof cancelledStatus === 'string' &&
        cancelledStatus.startsWith('cancelled'),
      String(cancelledStatus),
    );


    // The source control panel must report the repository state.
    const scmReachable = await session.evaluate(
      `(() => {
        const buttons = [...document.querySelectorAll('.activity-bar__item')];
        const scm = buttons.find((b) => b.getAttribute('aria-label') === 'Source Control');
        if (scm === undefined) return false;
        scm.click();
        return true;
      })()`,
    );
    check('source control view is reachable', scmReachable === true);

    const scmState = await waitFor(
      session,
      `(() => {
        const empty = document.querySelector('.source-control__empty');
        if (empty !== null) return empty.textContent.trim();
        const branch = document.querySelector('.source-control__branch');
        if (branch === null) return false;
        const text = branch.textContent.trim();
        // The panel shows a placeholder while the status is loading.
        return text === '…' ? false : text;
      })()`,
      15000,
    );
    check(
      'source control reports the repository state',
      typeof scmState === 'string' && scmState.length > 0,
      String(scmState),
    );

    // The source control panel must show the branch of the repository.
    const branch = await waitFor(
      session,
      `(() => {
        const element = document.querySelector('.source-control__branch');
        if (element === null) return false;
        const text = element.textContent.trim();
        // The panel shows a placeholder while the status is loading.
        return text === '…' ? false : text;
      })()`,
      15000,
    );
    check(
      'source control shows the current branch',
      branch === 'main',
      String(branch),
    );

    // The branch selector must offer the other branch of the fixture.
    const branchSelect = await waitFor(
      session,
      `(() => {
        const select = document.querySelector('.source-control__branch-select');
        if (select === null) return false;
        const options = [...select.options].map((o) => o.value);
        return options.includes('feature/verify') ? options.join(',') : false;
      })()`,
      15000,
    );
    check(
      'source control offers the other branches',
      typeof branchSelect === 'string',
      String(branchSelect),
    );

    // Switching the branch must be visible in the panel.
    const beforeSwitch = await session.evaluate(
      `(() => {
        const select = document.querySelector('.source-control__branch-select');
        return select === null ? 'NO SELECT' : select.disabled;
      })()`,
    );
    const switched = await session.evaluate(
      `(() => {
        const select = document.querySelector('.source-control__branch-select');
        if (select === null) return false;
        select.value = 'feature/verify';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`,
    );
    check(
      'the branch can be switched',
      switched === true,
      `state: ${JSON.stringify(beforeSwitch)}`,
    );

    const newBranch = await waitFor(
      session,
      `(() => {
        const element = document.querySelector('.source-control__branch');
        if (element === null) return false;
        const text = element.textContent.trim();
        // The check waits for the new branch, not for any branch.
        return text === 'feature/verify' ? text : false;
      })()`,
      30000,
    );
    const branchError = await session.evaluate(
      `(() => {
        const error = document.querySelector('.source-control__error');
        return error === null ? '' : error.textContent.trim();
      })()`,
    );
    const branchDiag = await session.evaluate(
      `(() => {
        const select = document.querySelector('.source-control__branch-select');
        return {
          selectValue: select === null ? 'NO SELECT' : select.value,
          disabled: select === null ? null : select.disabled,
          diag: window.__novaSwitchDiag ?? 'NO DIAG',
        };
      })()`,
    );
    check(
      'the switched branch is shown',
      newBranch === 'feature/verify',
      `${String(newBranch)} ${String(branchError)} ${JSON.stringify(branchDiag)}`,
    );

    // The untracked file of the fixture must be listed.
    const untracked = await waitFor(
      session,
      `(() => {
        const names = [...document.querySelectorAll('.source-control__name')]
          .map((n) => n.textContent);
        return names.length > 0 ? names.join(',') : false;
      })()`,
      15000,
    );
    check(
      'source control lists the untracked files',
      typeof untracked === 'string' && untracked.includes('untracked.txt'),
      String(untracked),
    );

    // Staging the file must move it into the staged group.
    const staged = await session.evaluate(
      `(() => {
        const items = [...document.querySelectorAll('.source-control__item')];
        const item = items.find((i) => i.textContent.includes('untracked.txt'));
        if (item === undefined) return false;
        const button = [...item.querySelectorAll('button')]
          .find((b) => b.textContent.trim() === 'Stage');
        if (button === undefined) return false;
        button.click();
        return true;
      })()`,
    );
    check('source control can stage a file', staged === true);

    const stagedGroup = await waitFor(
      session,
      `(() => {
        const titles = [...document.querySelectorAll('.source-control__group-title')]
          .map((t) => t.textContent);
        const names = [...document.querySelectorAll('.source-control__name')]
          .map((n) => n.textContent);
        return titles.some((t) => t.includes('Staged')) &&
          names.includes('untracked.txt')
          ? 'staged'
          : false;
      })()`,
      15000,
    );
    check('the staged file appears in the staged group', stagedGroup === 'staged');

    // The commit must succeed and empty the staged group.
    const committed = await session.evaluate(
      `(() => {
        const input = document.querySelector('.source-control__message');
        if (input === null) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'NOVA verify commit');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const button = document.querySelector('.source-control__commit-button');
        if (button === null) return false;
        button.click();
        return true;
      })()`,
    );
    check('the commit can be started', committed === true);

    const committedState = await waitFor(
      session,
      `(() => {
        const titles = [...document.querySelectorAll('.source-control__group-title')]
          .map((t) => t.textContent);
        return titles.some((t) => t.includes('Staged')) ? false : 'clean';
      })()`,
      20000,
    );
    check('the commit empties the staged group', committedState === 'clean');


    // The terminal must be able to stop a running command without closing
    // the session.
    const terminalTab = await session.evaluate(
      `(() => {
        const tabs = [...document.querySelectorAll('.bottom-panel__tab')];
        const terminal = tabs.find((tab) => tab.textContent.includes('Terminal'));
        if (terminal === undefined) return false;
        terminal.click();
        return true;
      })()`,
    );
    check('the terminal tab is reachable', terminalTab === true);

    // Earlier checks may have closed the original shell. Create a fresh
    // session through the UI so the Stop button, the typed command and the
    // rendered view all belong to one live session.
    const sessionsBefore = await session.evaluate(
      `document.querySelectorAll('.terminal-panel__tab').length`,
    );
    const newSessionClicked = await session.evaluate(
      `(() => {
        const buttons = [...document.querySelectorAll('.terminal-panel__action')];
        const button = buttons.find((candidate) =>
          candidate.textContent.trim() === '+' ||
          candidate.getAttribute('title')?.includes('New terminal session') === true,
        );
        if (button === undefined) return false;
        button.click();
        return true;
      })()`,
    );
    const freshSession = await waitFor(
      session,
      `document.querySelectorAll('.terminal-panel__tab').length > ${sessionsBefore}`,
      15000,
    );
    if (newSessionClicked !== true || freshSession !== true) {
      throw new Error('could not create a fresh terminal session');
    }

    // The visible view is the one whose Stop button is exercised below.
    const terminalTextExpr = `(() => [...document.querySelectorAll('.terminal-panel__view:not([hidden]) .terminal-view .xterm-rows > div')]
      .map((row) => row.textContent ?? '')
      .join(' ')
      .replace(/\\s+/g, ' '))()`;
    // A real click activates xterm's key handling before the text is sent.
    await clickWithMouse(session, '.terminal-panel__view:not([hidden]) .terminal-view .xterm-screen');
    const terminalFocused = await session.evaluate(
      `(() => {
        const area = document.querySelector('.terminal-panel__view:not([hidden]) .terminal-view textarea');
        if (area === null) return false;
        area.focus();
        return document.activeElement === area;
      })()`,
    );
    if (terminalFocused !== true) {
      throw new Error('the terminal view did not accept focus');
    }

    // Echo a unique marker before the long-running command: the marker is
    // shell output, so it cannot be confused with a prompt, a wrapped line or
    // a PSReadLine suggestion.
    await session.insertText('echo NOVA_START; Start-Sleep 30');
    await session.pressKey('Enter', 13);

    // The command must really be running before it is interrupted.
    const commandStarted = await waitFor(
      session,
      `${terminalTextExpr}.includes('NOVA_START')`,
      30000,
    );
    check('the command in the terminal is running', commandStarted !== false);

    const stopButtonClicked = await session.evaluate(
      `(() => {
        const buttons = [...document.querySelectorAll('.terminal-panel__action')];
        const stop = buttons.find((b) => b.textContent.trim() === 'Stop');
        if (stop === undefined) return false;
        stop.click();
        return true;
      })()`,
    );
    check(
      'the terminal can stop a running command',
      stopButtonClicked === true,
    );

    // The session must still be usable after the interrupt.
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const terminalText = await session.evaluate(terminalTextExpr);
    // The shell needs a moment to return to the prompt; the command is
    // sent a few times, so a lost keystroke cannot fail the check.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await clickWithMouse(session, '.terminal-panel__view:not([hidden]) .terminal-view .xterm-screen');
      await session.evaluate(
        `(() => {
          const area = document.querySelector('.terminal-panel__view:not([hidden]) .terminal-view textarea');
          if (area === null) return false;
          area.focus();
          return document.activeElement === area;
        })()`,
      );
      await session.insertText('echo NOVA_AFTER_STOP');
      await session.pressKey('Enter', 13);
      await new Promise((resolve) => setTimeout(resolve, 700));
      const done = await session.evaluate(
        `${terminalTextExpr}.includes('NOVA_AFTER_STOP')`,
      );
      if (done === true) {
        break;
      }
    }
    const afterStop = await waitFor(
      session,
      `${terminalTextExpr}.includes('NOVA_AFTER_STOP')`,
      30000,
    );
    check(
      'the terminal session survives the interrupt',
      afterStop !== false,
      `${String(afterStop).slice(0, 60)} | ${String(terminalText).slice(-300)}`,
    );

    // The number of open tabs before the chat (the answer must not
    // change it).
    const tabsBeforeChat = await session.evaluate(
      `document.querySelectorAll('.editor-tab:not(.editor-tab--settings)').length`,
    );

    // The application only knows the mock service: the address was
    // written into the isolated profile before the application started,
    // so the real service of the user is never contacted — not even
    // with the first request.
    const knownProviders = await session.evaluate(
      `window.nova.ai.providers().then((r) =>
         r.ok
           ? r.value.map((p) => p.id + '=' + p.baseUrl).join(',')
           : 'ERROR')`,
    );
    check(
      'the application only knows the mock service',
      typeof knownProviders === 'string' &&
        knownProviders.includes(`ollama=${mockOllama.url}`) &&
        !knownProviders.includes('127.0.0.1:11434'),
      String(knownProviders),
    );

    // The mock must have received the requests of the application.
    check(
      'the mock service received the requests of the application',
      mockOllama.seen.length > 0,
      `${mockOllama.seen.length} requests`,
    );

    // The chat panel must be able to talk to a provider. The harness
    // hosts a mock of the local Ollama service.

    // The AI panel gear opens the Settings editor tab, where the address
    // is changed the way a user would do it.
    const settingsOpened = await session.evaluate(
      `(() => {
        const button = document.querySelector('.ai-panel__settings-button');
        if (button === null) return false;
        button.click();
        return true;
      })()`,
    );
    check('the provider settings can be opened', settingsOpened === true);

    const settingsTabOpened = await waitFor(
      session,
      `document.querySelector('.editor-tab--settings.editor-tab--active') !== null &&
       document.querySelector('.settings-view') !== null`,
      10000,
    );
    check('the Settings editor tab is opened', settingsTabOpened === true);

    const settingsRendered = await waitFor(
      session,
      `document.querySelector('.ai-settings__address-input') !== null`,
      10000,
    );
    check('the provider settings are rendered', settingsRendered === true);

    const providerConfigured = await session.evaluate(
      `(() => {
        const input = document.querySelector('.ai-settings__address-input');
        if (input === null) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, ${JSON.stringify(mockOllama.url)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const buttons = [...document.querySelectorAll('.ai-settings__action')];
        const save = buttons.find((b) => b.textContent.trim() === 'Save address');
        if (save === undefined) return false;
        save.click();
        return true;
      })()`,
    );
    check(
      'the provider can be pointed at a local service',
      providerConfigured === true,
    );

    const modelListed = await waitFor(
      session,
      `(() => {
        const select = document.querySelector('select[aria-label="Model"]');
        if (select === null) return false;
        const options = [...select.options].map((o) => o.value);
        return options.includes('nova-verify-model');
      })()`,
      20000,
    );
    check('the model of the provider is listed', modelListed === true);

    // --- The management of the local models (Milestone 7) --------------

    const modelsSection = await waitFor(
      session,
      `document.querySelector('.ai-models__list') !== null`,
      20000,
    );
    check('the models section of the settings is rendered', modelsSection === true);

    const installedListed = await waitFor(
      session,
      `(() => {
        const items = [...document.querySelectorAll('.ai-models__item')];
        const names = items.map((i) => i.getAttribute('data-model'));
        return names.includes('nova-verify-model') ? names.join(',') : false;
      })()`,
      20000,
    );
    check(
      'the installed models are listed',
      typeof installedListed === 'string' &&
        installedListed.includes('nova-verify-model'),
      String(installedListed),
    );

    const fitShown = await waitFor(
      session,
      `(() => {
        const fit = document.querySelector('.ai-models__fit');
        if (fit === null) return false;
        const text = fit.textContent;
        return text.includes('estimate') ? text : false;
      })()`,
      10000,
    );
    check(
      'the fit of a model is shown as an estimate',
      typeof fitShown === 'string' && fitShown.includes('estimate'),
      String(fitShown).slice(0, 120),
    );

    const hardwareShown = await session.evaluate(
      `(() => {
        const text = document.querySelector('.ai-models__hardware');
        return text === null ? '' : text.textContent.trim();
      })()`,
    );
    check(
      'the facts of the machine are shown',
      typeof hardwareShown === 'string' &&
        hardwareShown.includes('memory') &&
        hardwareShown.includes('processors'),
      String(hardwareShown).slice(0, 160),
    );

    const detailsOpened = await session.evaluate(
      `(() => {
        const item = [...document.querySelectorAll('.ai-models__item')].find(
          (i) => i.getAttribute('data-model') === 'nova-verify-model');
        if (item === undefined) return false;
        const button = [...item.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === 'Details');
        if (button === undefined) return false;
        button.click();
        return true;
      })()`,
    );
    check('the details of a model can be opened', detailsOpened === true);

    const detailsShown = await waitFor(
      session,
      `(() => {
        const details = document.querySelector('.ai-models__details');
        if (details === null) return false;
        const text = details.textContent;
        return text.includes('Tool calls') ? text : false;
      })()`,
      10000,
    );
    check(
      'the details show what Ollama reports about the capabilities',
      typeof detailsShown === 'string' && detailsShown.includes('reported by Ollama'),
      String(detailsShown).slice(0, 200),
    );

    // A download needs the confirmation of the user.
    const downloadBlocked = await session.evaluate(
      `(() => {
        const input = document.querySelector(
          'input[aria-label="Name of the model"]');
        if (input === null) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'nova-slow-model');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const buttons = [...document.querySelectorAll('.ai-models__action')];
        const download = buttons.find(
          (b) => b.textContent.trim() === 'Download');
        if (download === undefined) return false;
        // The button stays disabled until the user confirms.
        return download.disabled === true;
      })()`,
    );
    check(
      'a download needs the confirmation of the user',
      downloadBlocked === true,
    );

    const downloadStarted = await session.evaluate(
      `(() => {
        const confirm = document.querySelector('.ai-models__confirm input');
        if (confirm === null) return false;
        confirm.click();
        const buttons = [...document.querySelectorAll('.ai-models__action')];
        const download = buttons.find(
          (b) => b.textContent.trim() === 'Download');
        if (download === undefined || download.disabled) return false;
        download.click();
        return true;
      })()`,
    );
    check('the download can be started', downloadStarted === true);

    const progressShown = await waitFor(
      session,
      `(() => {
        const text = document.querySelector('.ai-models__progress-text');
        if (text === null) return false;
        const value = text.textContent;
        return value.includes('nova-slow-model') ? value : false;
      })()`,
      20000,
    );
    check(
      'the progress of the download is shown',
      typeof progressShown === 'string' &&
        progressShown.includes('nova-slow-model'),
      String(progressShown).slice(0, 160),
    );

    const downloadStopped = await session.evaluate(
      `(() => {
        const buttons = [...document.querySelectorAll('.ai-models__action')];
        const stop = buttons.find(
          (b) => b.textContent.trim() === 'Stop the download');
        if (stop === undefined) return false;
        stop.click();
        return true;
      })()`,
    );
    check('the download can be stopped', downloadStopped === true);

    const downloadCancelled = await waitFor(
      session,
      `(() => {
        const text = document.querySelector('.ai-models__progress-text');
        if (text === null) return false;
        const value = text.textContent;
        return value.toLowerCase().includes('cancel') ? value : false;
      })()`,
      20000,
    );
    check(
      'the stopped download is reported as cancelled',
      typeof downloadCancelled === 'string',
      String(downloadCancelled).slice(0, 160),
    );

    // A second download brings a new model into the list.
    const secondDownload = await session.evaluate(
      `(() => {
        const input = document.querySelector(
          'input[aria-label="Name of the model"]');
        if (input === null) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, 'nova-new-model');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const buttons = [...document.querySelectorAll('.ai-models__action')];
        const download = buttons.find(
          (b) => b.textContent.trim() === 'Download');
        if (download === undefined || download.disabled) return false;
        download.click();
        return true;
      })()`,
    );
    check('a second download can be started', secondDownload === true);

    const downloadFinished = await waitFor(
      session,
      `(() => {
        const text = document.querySelector('.ai-models__progress-text');
        if (text === null) return false;
        const value = text.textContent;
        return value.includes('nova-new-model') && value.includes('downloaded')
          ? value
          : false;
      })()`,
      30000,
    );
    check(
      'the finished download is reported',
      typeof downloadFinished === 'string',
      String(downloadFinished).slice(0, 160),
    );

    const newModelListed = await waitFor(
      session,
      `(() => {
        const items = [...document.querySelectorAll('.ai-models__item')];
        const names = items.map((i) => i.getAttribute('data-model'));
        return names.includes('nova-new-model') ? names.join(',') : false;
      })()`,
      20000,
    );
    check(
      'the downloaded model is listed',
      typeof newModelListed === 'string' &&
        newModelListed.includes('nova-new-model'),
      String(newModelListed),
    );

    const newModelInDropdown = await waitFor(
      session,
      `(() => {
        const select = document.querySelector('select[aria-label="Model"]');
        if (select === null) return false;
        const options = [...select.options].map((o) => o.value);
        return options.includes('nova-new-model') ? options.join(',') : false;
      })()`,
      20000,
    );
    check(
      'the downloaded model appears in the model list of the chat',
      typeof newModelInDropdown === 'string',
      String(newModelInDropdown).slice(0, 160),
    );

    // The deletion asks for a confirmation and can be declined.
    const deleteAsked = await session.evaluate(
      `(() => {
        const item = [...document.querySelectorAll('.ai-models__item')].find(
          (i) => i.getAttribute('data-model') === 'nova-new-model');
        if (item === undefined) return false;
        const button = [...item.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === 'Delete');
        if (button === undefined) return false;
        button.click();
        return true;
      })()`,
    );
    check('the deletion of a model asks for a confirmation', deleteAsked === true);

    const confirmationShown = await waitFor(
      session,
      `(() => {
        const confirm = document.querySelector('.ai-models__confirm-delete');
        if (confirm === null) return false;
        const text = confirm.textContent;
        return text.includes('nova-new-model') ? text : false;
      })()`,
      10000,
    );
    check(
      'the confirmation shows the name of the model',
      typeof confirmationShown === 'string' &&
        confirmationShown.includes('nova-new-model'),
      String(confirmationShown).slice(0, 160),
    );

    const deleteCancelled = await session.evaluate(
      `(() => {
        const confirm = document.querySelector('.ai-models__confirm-delete');
        if (confirm === null) return false;
        const button = [...confirm.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === 'Keep the model');
        if (button === undefined) return false;
        button.click();
        return true;
      })()`,
    );
    check('the deletion can be declined', deleteCancelled === true);

    const stillListed = await waitFor(
      session,
      `(() => {
        const items = [...document.querySelectorAll('.ai-models__item')];
        const names = items.map((i) => i.getAttribute('data-model'));
        return names.includes('nova-new-model') ? names.join(',') : false;
      })()`,
      10000,
    );
    check(
      'the declined model is still installed',
      typeof stillListed === 'string',
      String(stillListed),
    );

    const deleteAskedAgain = await session.evaluate(
      `(() => {
        const item = [...document.querySelectorAll('.ai-models__item')].find(
          (i) => i.getAttribute('data-model') === 'nova-new-model');
        if (item === undefined) return false;
        const button = [...item.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === 'Delete');
        if (button === undefined) return false;
        button.click();
        return true;
      })()`,
    );
    check('the deletion of a model asks again', deleteAskedAgain === true);

    const confirmationShownAgain = await waitFor(
      session,
      `(() => {
        const confirm = document.querySelector('.ai-models__confirm-delete');
        if (confirm === null) return false;
        return confirm.textContent.includes('nova-new-model')
          ? confirm.textContent
          : false;
      })()`,
      10000,
    );
    check(
      'the confirmation is shown again',
      typeof confirmationShownAgain === 'string',
      String(confirmationShownAgain).slice(0, 160),
    );

    const deleteConfirmed = await session.evaluate(
      `(() => {
        const confirm = document.querySelector('.ai-models__confirm-delete');
        if (confirm === null) return false;
        const del = [...confirm.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === 'Delete the model');
        if (del === undefined) return false;
        del.click();
        return true;
      })()`,
    );
    check('the deletion can be confirmed', deleteConfirmed === true);

    const modelRemoved = await waitFor(
      session,
      `(() => {
        const items = [...document.querySelectorAll('.ai-models__item')];
        const names = items.map((i) => i.getAttribute('data-model'));
        return names.includes('nova-new-model') ? false : names.join(',');
      })()`,
      20000,
    );
    check(
      'the deleted model is gone',
      typeof modelRemoved === 'string' &&
        !modelRemoved.includes('nova-new-model'),
      String(modelRemoved),
    );

    const localBadge = await waitFor(
      session,
      `(() => {
        // The compact provider chip next to the model picker shows which
        // kind of provider the shared composer uses.
        const controls = document.querySelector('.ai-panel__controls');
        if (controls === null) return false;
        const badge = controls.querySelector('.ai-panel__provider-chip');
        if (badge === null) return false;
        const text = badge.textContent.trim();
        return text === 'LOCAL' ? text : false;
      })()`,
      10000,
    );
    check(
      'the panel shows that the provider is local',
      localBadge === 'LOCAL',
      String(localBadge),
    );

    // The Settings tab is a real editor tab. Close it so a file buffer is
    // active for the context and editor checks below.
    const settingsCloseClicked = await session.evaluate(
      `(() => {
        const tab = document.querySelector('.editor-tab--settings');
        const close = tab?.querySelector('.editor-tab__close');
        if (close === null || close === undefined) return false;
        close.click();
        return true;
      })()`,
    );
    const settingsClosedForEditor = await waitFor(
      session,
      `document.querySelector('.editor-tab--settings') === null`,
      5000,
    );
    check(
      'the Settings tab closes back to the editor',
      settingsCloseClicked === true && settingsClosedForEditor === true,
    );

    // The current file can be attached as context, and the panel shows
    // what will be sent.
    const attached = await session.evaluate(
      `(() => {
        const buttons = [...document.querySelectorAll('.ai-panel__action')];
        const attach = buttons.find(
          (b) => b.textContent.trim() === 'Attach file');
        if (attach === undefined || attach.disabled) return false;
        const chip = document.querySelector('.ai-panel__attachment');
        attach.click();
        return true;
      })()`,
    );
    check('the current file can be attached', attached === true);

    const contextShown = await waitFor(
      session,
      `(() => {
        const title = document.querySelector('.ai-panel__context-title');
        if (title === null) return false;
        const items = [...document.querySelectorAll('.ai-panel__attachment')];
        const text = items.map((i) => i.textContent).join('|');
        // The check waits for the size of the context, not for the chip.
        return text.includes('tokens') ? text : false;
      })()`,
      15000,
    );
    check(
      'the panel shows what will be sent',
      typeof contextShown === 'string' && contextShown.includes('tokens'),
      `${String(contextShown)}`,
    );

    // The attached file can be removed again.
    const removed = await session.evaluate(
      `(() => {
        const buttons = [...document.querySelectorAll(
          '.ai-panel__attachment-remove')];
        if (buttons.length === 0) return false;
        buttons[0].click();
        return true;
      })()`,
    );
    check('the attached file can be removed', removed === true);

    // The answer of the model must arrive in the panel.
    const sent = await session.evaluate(
      `(() => {
        const input = document.querySelector('.ai-panel__input');
        if (input === null) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(input, 'What does the project do?');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`,
    );
    check('the chat input accepts a question', sent === true);

    await session.evaluate(
      `(() => {
        const buttons = [...document.querySelectorAll('.ai-panel__action')];
        const send = buttons.find((b) => b.textContent.trim() === 'Send');
        if (send === undefined) return false;
        send.click();
        return true;
      })()`,
    );

    const answer = await waitFor(
      session,
      `(() => {
        const messages = document.querySelectorAll('.ai-message__content');
        for (const message of messages) {
          if (message.textContent.includes('NOVA_VERIFY_ANSWER')) {
            return message.textContent;
          }
        }
        return false;
      })()`,
      30000,
    );
    check(
      'the answer of the model arrives in the panel',
      typeof answer === 'string' && answer.includes('NOVA_VERIFY_ANSWER'),
      String(answer).slice(0, 80),
    );

    // The answer must not be written into a file (that is Milestone 5):
    // the number of open tabs must not change.
    const noFileWrite = await session.evaluate(
      `(() => document.querySelectorAll('.editor-tab:not(.editor-tab--settings)').length === ${tabsBeforeChat})()`,
    );
    check('the answer did not open a file', noFileWrite === true);

    // Ctrl+, is the keyboard entry point for the same Settings tab. Send the
    // punctuation key with an explicit `text`, as a real Windows keyboard
    // event does; CDP's modifier-only form is intermittently swallowed here.
    const commaKey = {
      key: ',',
      code: 'Comma',
      windowsVirtualKeyCode: 188,
      nativeVirtualKeyCode: 188,
      modifiers: 2, // ctrl
    };
    await session.send('Input.dispatchKeyEvent', {
      ...commaKey,
      type: 'keyDown',
      text: ',',
    });
    await session.send('Input.dispatchKeyEvent', { ...commaKey, type: 'keyUp' });
    const settingsReopened = await waitFor(
      session,
      `document.querySelector('.editor-tab--settings.editor-tab--active') !== null &&
       document.querySelector('.voice-settings') !== null`,
      10000,
    );
    check('the Settings tab opens with Ctrl+,', settingsReopened === true);

    // --- Voice assistant (Milestone 8) --------------------------------
    //
    // The microphone is Chromium's fake device (the flags are set when the
    // packaged application starts) and the speech engine is a mock: the
    // configured "engine" is the command interpreter, which only echoes a
    // marker. No real model is downloaded, no cloud service is contacted
    // and no audio of the user is involved. The settings and the fake
    // model live in the isolated profile of this run.

    // The AI panel is hidden by default now that visibility is a real command;
    // show it before driving its microphone button.
    const aiPanelHidden = await session.evaluate(
      `(() => {
        const panel = document.querySelector('.ai-panel');
        return panel === null || panel.classList.contains('ai-panel--hidden');
      })()`,
    );
    if (aiPanelHidden === true) {
      await clickText(session, '.menu-bar__top', 'View');
      await clickText(session, '.menu-bar__item', 'Toggle AI Panel', false);
    }
    await waitFor(
      session,
      `(() => {
        const panel = document.querySelector('.ai-panel');
        return panel !== null && !panel.classList.contains('ai-panel--hidden');
      })()`,
      5000,
    );

    const voiceBridge = await session.evaluate(
      `(() => {
        const voice = window.nova?.voice;
        if (voice === undefined) return false;
        return ['openSession', 'closeSession', 'settings', 'saveSettings',
          'pickFile', 'transcribe', 'cancelTranscription']
          .every((name) => typeof voice[name] === 'function');
      })()`,
    );
    check('the voice channels are exposed by the bridge', voiceBridge === true);

    const voiceDefaults = await session.evaluate(
      `window.nova.voice.settings().then((s) => JSON.stringify({
        enabled: s.enabled, engine: s.engine, key: s.pushToTalkKey
      }))`,
    );
    const defaultVoice = JSON.parse(String(voiceDefaults));
    check(
      'the voice assistant starts switched off without an engine',
      defaultVoice.enabled === false &&
        defaultVoice.engine === 'none' &&
        typeof defaultVoice.key === 'string' &&
        defaultVoice.key.length > 0,
      String(voiceDefaults),
    );

    const voicePanel = await waitFor(
      session,
      `document.querySelector('.voice-settings') !== null`,
      10000,
    );
    check('the voice settings are rendered', voicePanel === true);

    const micWhileOff = await clickWithMouse(
      session,
      '.ai-panel__action--mic',
    );
    const offNotice = await waitFor(
      session,
      `(() => {
        const status = document.querySelector('.ai-panel__voice-status');
        return status !== null && status.textContent.includes('switched off')
          ? status.textContent
          : false;
      })()`,
      10000,
    );
    check(
      'the microphone does not start while the assistant is off',
      micWhileOff === true && typeof offNotice === 'string',
      String(offNotice).slice(0, 100),
    );

    const localOnlyOn = await session.evaluate(
      `(() => {
        const box = document.querySelector('input[aria-label="Local-only mode"]');
        if (box === null) return false;
        box.click();
        return true;
      })()`,
    );
    const voiceLocalBadge = await waitFor(
      session,
      `document.querySelector('.ai-badge--local-only') !== null`,
      10000,
    );
    const cloudBlocked = await session.evaluate(
      `(() => {
        const select = document.querySelector('#voice-engine');
        if (select === null) return false;
        const cloud = [...select.options].find((option) => option.value === 'cloud');
        return cloud !== undefined && cloud.disabled === true &&
          cloud.textContent.includes('local-only');
      })()`,
    );
    check(
      'the local-only mode is shown and removes cloud voice',
      localOnlyOn === true && voiceLocalBadge === true && cloudBlocked === true,
      `badge=${String(voiceLocalBadge)} cloud=${String(cloudBlocked)}`,
    );
    const statusLocalOn = await waitFor(
      session,
      `document.querySelector('.status-bar__privacy--on') !== null`,
      10000,
    );
    check('the status bar shows local-only mode', statusLocalOn === true);

    const noSession = await session.evaluate(
      `(async () => {
        const audio = new Int16Array(16000).buffer;
        const result = await window.nova.voice.transcribe(
          'nova-verify-no-session', audio, false);
        return JSON.stringify(result);
      })()`,
    );
    const noSessionOutcome = JSON.parse(String(noSession));
    check(
      'audio without a recording session is refused',
      noSessionOutcome.ok === false && noSessionOutcome.code === 'no-session',
      String(noSession).slice(0, 120),
    );

    // Even a hand-edited setting that selects a cloud engine must not send
    // the audio while the local-only mode is on (approval is irrelevant).
    const cloudInLocalOnly = await session.evaluate(
      `(async () => {
        const current = await window.nova.voice.settings();
        await window.nova.voice.saveSettings({
          ...current, enabled: true, engine: 'cloud'
        });
        const opened = await window.nova.voice.openSession();
        const result = await window.nova.voice.transcribe(
          opened.sessionId, new Int16Array(16000).buffer, true);
        await window.nova.voice.closeSession(opened.sessionId);
        await window.nova.voice.saveSettings(current);
        return JSON.stringify(result);
      })()`,
    );
    const cloudOutcome = JSON.parse(String(cloudInLocalOnly));
    check(
      'the local-only mode refuses cloud voice even when approved',
      cloudOutcome.ok === false && cloudOutcome.code === 'local-only',
      String(cloudInLocalOnly).slice(0, 120),
    );

    const localOnlyOff = await session.evaluate(
      `(() => {
        const box = document.querySelector('input[aria-label="Local-only mode"]');
        if (box === null || !box.checked) return false;
        box.click();
        return true;
      })()`,
    );
    const voiceLocalBadgeGone = await waitFor(
      session,
      `document.querySelector('.ai-badge--local-only') === null`,
      10000,
    );
    check(
      'the local-only mode can be switched off again',
      localOnlyOff === true && voiceLocalBadgeGone === true,
    );
    const statusLocalOff = await waitFor(
      session,
      `document.querySelector('.status-bar__privacy--on') === null`,
      10000,
    );
    check('the status bar clears local-only mode', statusLocalOff === true);

    // The mock is an executable on the disk: the command interpreter with
    // an echo argument. The model is an inert file in the isolated profile.
    const mockModel = path.join(profile.dir, 'voice-mock-model.bin');
    writeFileSync(mockModel, 'not a real speech model\n', 'utf8');
    const mockEngine = path.join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'cmd.exe',
    );
    const engineConfigured = await session.evaluate(
      `(async () => {
        const current = await window.nova.voice.settings();
        const next = {
          ...current,
          enabled: true,
          engine: 'local',
          enginePath: ${JSON.stringify(mockEngine)},
          engineArgs: ['/c', 'echo NOVA_VERIFY_TRANSCRIPT'],
          modelPath: ${JSON.stringify(mockModel)},
          modelId: 'verify',
          maxRecordingSeconds: 5,
        };
        const saved = await window.nova.voice.saveSettings(next);
        return saved.enabled === true && saved.engine === 'local' &&
          saved.enginePath === ${JSON.stringify(mockEngine)};
      })()`,
    );
    check(
      'the voice settings are saved through the validated channel',
      engineConfigured === true,
    );

    const recognition = await session.evaluate(
      `(async () => {
        const opened = await window.nova.voice.openSession();
        const audio = new Int16Array(16000).buffer;
        const result = await window.nova.voice.transcribe(
          opened.sessionId, audio, false);
        await window.nova.voice.closeSession(opened.sessionId);
        return JSON.stringify(result);
      })()`,
    );
    const recognitionOutcome = JSON.parse(String(recognition));
    check(
      'the mock local engine recognises fake audio',
      recognitionOutcome.ok === true &&
        typeof recognitionOutcome.value?.text === 'string' &&
        recognitionOutcome.value.text.includes('NOVA_VERIFY_TRANSCRIPT'),
      String(recognition).slice(0, 160),
    );

    // The whole path of the composer: a real recording of the fake device,
    // a recognition by the mock and a transcript that only lands in the
    // input field. The number of chat messages must not change.
    const messagesBeforeVoice = await session.evaluate(
      `document.querySelectorAll('.ai-message').length`,
    );
    const micFocused = await clickWithMouse(
      session,
      '.ai-panel__action--mic',
    );
    const recording = await waitFor(
      session,
      `document.querySelector('.ai-panel__action--mic')?.getAttribute('aria-pressed') === 'true'`,
      15000,
    );
    check(
      'the microphone opens for a recording',
      micFocused === true && recording === true,
    );
    // The fake device needs a moment to produce 0.3 seconds of samples.
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const stoppedRecording = await clickWithMouse(
      session,
      '.ai-panel__action--mic',
    );
    await waitFor(
      session,
      `document.querySelector('.ai-panel__action--mic')?.getAttribute('aria-pressed') !== 'true'`,
      15000,
    );
    const transcript = await waitFor(
      session,
      `(() => {
        const input = document.querySelector('.ai-panel__input');
        return input !== null && input.value.includes('NOVA_VERIFY_TRANSCRIPT')
          ? input.value
          : false;
      })()`,
      20000,
    );
    const messagesAfterVoice = await session.evaluate(
      `document.querySelectorAll('.ai-message').length`,
    );
    check(
      'recognised speech lands in the composer without being sent',
      stoppedRecording === true &&
        typeof transcript === 'string' &&
        messagesAfterVoice === messagesBeforeVoice,
      `messages ${String(messagesBeforeVoice)} -> ${String(messagesAfterVoice)}`,
    );

    // The read-aloud uses a fake synthesis: no sound is produced and no
    // voice of the machine is touched. The button must start and stop it.
    const speechFake = await session.evaluate(
      `(() => {
        window.__novaVerifySpoken = [];
        window.__novaVerifyCancelled = 0;
        class FakeUtterance {
          constructor(text) { this.text = text; this.rate = 1; this.voice = null; }
        }
        Object.defineProperty(window, 'SpeechSynthesisUtterance', {
          value: FakeUtterance, configurable: true,
        });
        Object.defineProperty(window, 'speechSynthesis', {
          value: {
            speak: (utterance) => window.__novaVerifySpoken.push(utterance.text),
            cancel: () => { window.__novaVerifyCancelled += 1; },
            getVoices: () => [],
          },
          configurable: true,
        });
        const read = document.querySelector('.ai-message__read');
        if (read === null) return false;
        read.click();
        return true;
      })()`,
    );
    const speaking = await waitFor(
      session,
      `(() => {
        const button = document.querySelector('.ai-message__read');
        return button !== null && button.textContent.includes('Stop reading');
      })()`,
      10000,
    );
    check(
      'the read-aloud starts from the answer',
      speechFake === true && speaking === true,
    );
    const speechStopped = await session.evaluate(
      `(() => {
        const button = document.querySelector('.ai-message__read');
        if (button === null || !button.textContent.includes('Stop reading')) {
          return false;
        }
        button.click();
        return window.__novaVerifyCancelled > 0 &&
          window.__novaVerifySpoken.length > 0;
      })()`,
    );
    const stoppedLabel = await waitFor(
      session,
      `(() => {
        const button = document.querySelector('.ai-message__read');
        return button !== null && button.textContent.includes('Read aloud');
      })()`,
      10000,
    );
    check(
      'the read-aloud can be stopped',
      speechStopped === true && stoppedLabel === true,
    );

    // Leave the isolated profile without an enabled microphone.
    const voiceRestored = await session.evaluate(
      `window.nova.voice.settings()
        .then((s) => window.nova.voice.saveSettings({
          ...s, enabled: false, engine: 'none', enginePath: '', modelPath: ''
        }))
        .then((s) => s.enabled === false && s.engine === 'none')`,
    );
    check('the voice settings are restored after verification', voiceRestored === true);

    // Return to a file editor before the agent and editor-keyboard checks.
    const settingsCloseAgainClicked = await session.evaluate(
      `(() => {
        const tab = document.querySelector('.editor-tab--settings');
        const close = tab?.querySelector('.editor-tab__close');
        if (close === null || close === undefined) return false;
        close.click();
        return true;
      })()`,
    );
    const settingsClosedAgain = await waitFor(
      session,
      `document.querySelector('.editor-tab--settings') === null`,
      5000,
    );
    check(
      'the Settings tab closes after the voice checks',
      settingsCloseAgainClicked === true && settingsClosedAgain === true,
    );

    // The agent mode of the AI panel.
    const agentTab = await session.evaluate(
      `(() => {
        const tabs = [...document.querySelectorAll('.ai-panel__mode')];
        const agent = tabs.find((tab) => tab.textContent.trim() === 'Agent');
        if (agent === undefined) return false;
        agent.click();
        return true;
      })()`,
    );
    check('the agent mode of the panel is reachable', agentTab === true);

    // The task of the agent.
    const taskTyped = await session.evaluate(
      `(() => {
        const input = document.querySelector('.ai-panel__input');
        if (input === null) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(input, 'Update the notes of the project');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`,
    );
    check('the agent accepts a task', taskTyped === true);

    const started = await session.evaluate(
      `(() => {
        const buttons = [...document.querySelectorAll('.ai-panel__action')];
        const start = buttons.find((b) => b.textContent.trim() === 'Start');
        if (start === undefined || start.disabled) return false;
        start.click();
        return true;
      })()`,
    );
    check('the agent run starts', started === true);

    // The plan is shown before the first tool call and can be edited.
    const planShown = await waitFor(
      session,
      `(() => {
        const plan = document.querySelector('.agent-panel__plan');
        if (plan === null) return false;
        return plan.querySelectorAll('.agent-panel__plan-step').length;
      })()`,
      30000,
    );
    check(
      'the run shows a plan before it acts',
      typeof planShown === 'number' && planShown > 0,
      String(planShown),
    );

    const planEdited = await session.evaluate(
      `(() => {
        const plan = document.querySelector('.agent-panel__plan');
        if (plan === null) return false;
        const textarea = plan.querySelector('.agent-panel__plan-description');
        if (textarea === null) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(textarea, 'Read the notes of the project carefully');
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`,
    );
    check('a plan step can be edited', planEdited === true);

    const planApproved = await waitFor(
      session,
      `(() => {
        const plan = document.querySelector('.agent-panel__plan');
        if (plan === null) return false;
        const buttons = [...plan.querySelectorAll('.agent-panel__action')];
        const approve = buttons.find(
          (button) => button.textContent.trim() === 'Approve edited plan',
        );
        if (approve === undefined || approve.disabled) return false;
        approve.click();
        return true;
      })()`,
      10000,
    );
    check('the edited plan can be approved', planApproved === true);

    const editedEvent = await waitFor(
      session,
      `(() => {
        const events = [...document.querySelectorAll('.agent-panel__event')];
        const text = events.map((event) => event.textContent).join(' | ');
        return text.includes('approved the edited plan') ? text : false;
      })()`,
      30000,
    );
    check(
      'the approval of the edited plan is reported',
      typeof editedEvent === 'string',
      String(editedEvent).slice(0, 120),
    );

    // The progress of the run must be visible.
    const timeline = await waitFor(
      session,
      `(() => {
        const events = document.querySelectorAll('.agent-panel__event');
        if (events.length === 0) return false;
        const text = [...events].map((e) => e.textContent).join(' | ');
        // The check waits for the tool call, not for the first event.
        return text.includes('read_file') ? text : false;
      })()`,
      30000,
    );
    check(
      'the progress of the run is shown',
      typeof timeline === 'string' && timeline.includes('read_file'),
      String(timeline).slice(0, 120),
    );

    // The change must be a proposal; the file must not be written yet.
    const proposal = await waitFor(
      session,
      `(() => {
        const items = [...document.querySelectorAll('.agent-panel__proposal-path')];
        return items.length > 0 ? items.map((i) => i.textContent).join(',') : false;
      })()`,
      30000,
    );
    check(
      'the agent proposes a change',
      typeof proposal === 'string' && proposal.includes('notes.txt'),
      String(proposal),
    );

    const notWrittenYet = !existsSync(
      path.join(fixture, 'notes.txt'),
    );
    check('the file is not written before the user accepts', notWrittenYet);

    // Accept the proposal: the file is written.
    const accepted = await session.evaluate(
      `(() => {
        const button = document.querySelector('.agent-proposal__accept');
        if (button === null || button.disabled) return false;
        button.click();
        return true;
      })()`,
    );
    check('the change can be accepted', accepted === true);

    const written = await waitFor(
      session,
      `(() => {
        const items = [...document.querySelectorAll('.agent-panel__proposal-path')];
        return items.length === 0 ? 'accepted' : false;
      })()`,
      20000,
    );
    check('the accepted change leaves the list', written === 'accepted');

    const fileOnDisk = existsSync(path.join(fixture, 'notes.txt'))
      ? readFileSync(path.join(fixture, 'notes.txt'), 'utf8')
      : '';
    check(
      'the accepted change is written to the disk',
      fileOnDisk.includes('written by the agent'),
      JSON.stringify(fileOnDisk),
    );

    // The next run may only start when the previous one has finished.
    const firstRunFinished = await waitFor(
      session,
      `(() => {
        const state = document.querySelector('.agent-panel__state');
        if (state === null) return false;
        const text = state.textContent.trim();
        return text === 'completed' || text === 'failed' ? text : false;
      })()`,
      30000,
    );
    check('the first run finishes', firstRunFinished !== false);

    // A rejected proposal must leave the disk untouched.
    agentAnswers.length = 0;
    agentAnswers.push(
      JSON.stringify({
        thought: 'write the notes again',
        tool: {
          name: 'write_file',
          arguments: { path: 'notes.txt', content: 'rejected content\n' },
        },
      }),
      JSON.stringify({ thought: 'done', final: 'done' }),
    );
    const secondRun = await session.evaluate(
      `(() => {
        const input = document.querySelector('.ai-panel__input');
        if (input === null) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(input, 'Change the notes again');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      })()`,
    );
    check('a second task can be entered', secondRun === true);

    const secondStarted = await session.evaluate(
      `(() => {
        const buttons = [...document.querySelectorAll('.ai-panel__action')];
        const start = buttons.find((b) => b.textContent.trim() === 'Start');
        if (start === undefined || start.disabled) return false;
        start.click();
        return true;
      })()`,
    );
    check('the second run starts', secondStarted === true);
    check('the second plan can be approved', await approvePlan(session));

    const secondProposal = await waitFor(
      session,
      `(() => {
        const items = [...document.querySelectorAll('.agent-panel__proposal-path')];
        return items.length > 0 ? items.map((i) => i.textContent).join(',') : false;
      })()`,
      30000,
    );
    check(
      'the second run proposes a change',
      typeof secondProposal === 'string',
      String(secondProposal),
    );

    const rejected = await session.evaluate(
      `(() => {
        const button = document.querySelector('.agent-proposal__reject');
        if (button === null || button.disabled) return false;
        button.click();
        return true;
      })()`,
    );
    check('the change can be rejected', rejected === true);

    await new Promise((resolve) => setTimeout(resolve, 1500));
    const unchanged = readFileSync(
      path.join(fixture, 'notes.txt'),
      'utf8',
    );
    check(
      'a rejected change does not touch the file',
      !unchanged.includes('rejected content'),
      JSON.stringify(unchanged),
    );

    // The checkpoint of the run: a file that changed after the run must be
    // confirmed before the revert overwrites it (carry-over C1).
    writeFileSync(path.join(fixture, 'notes.txt'), 'a newer edit\n');
    const previewed = await session.evaluate(
      `(() => {
        const buttons = [...document.querySelectorAll('.agent-panel__action')];
        const revert = buttons.find(
          (b) => b.textContent.includes('Revert the changes'),
        );
        if (revert === undefined || revert.disabled) return false;
        revert.click();
        return true;
      })()`,
    );
    check('the revert preview opens', previewed === true);

    const conflict = await waitFor(
      session,
      `(() => {
        const input = document.querySelector(
          '.agent-panel__revert-confirm input[type="checkbox"]',
        );
        const primary = document.querySelector(
          '.agent-panel__revert-actions .agent-panel__action--primary',
        );
        if (input === null || primary === null) return false;
        return { disabled: primary.disabled, text: primary.textContent.trim() };
      })()`,
      20000,
    );
    check(
      'a newer edit is reported as a conflict',
      typeof conflict === 'object' &&
        conflict !== null &&
        conflict.disabled === true,
      JSON.stringify(conflict),
    );

    const confirmed = await session.evaluate(
      `(() => {
        const input = document.querySelector(
          '.agent-panel__revert-confirm input[type="checkbox"]',
        );
        if (input === null) return false;
        input.click();
        return true;
      })()`,
    );
    check('the conflict can be confirmed', confirmed === true);

    const revertClicked = await waitFor(
      session,
      `(() => {
        const primary = document.querySelector(
          '.agent-panel__revert-actions .agent-panel__action--primary',
        );
        if (primary === null || primary.disabled) return false;
        primary.click();
        return true;
      })()`,
      10000,
    );
    check('the confirmed revert runs', revertClicked === true);

    const dialogClosed = await waitFor(
      session,
      `(() => document.querySelector('.agent-panel__revert') === null)()`,
      20000,
    );
    check('the revert dialog closes after the revert', dialogClosed === true);

    await new Promise((resolve) => setTimeout(resolve, 1500));
    check(
      'the reverted file is gone again',
      !existsSync(path.join(fixture, 'notes.txt')),
      'the file was not removed',
    );

    // A rejected plan stops the run before the first tool call.
    const thirdStarted = await session.evaluate(
      `(() => {
        const input = document.querySelector('.ai-panel__input');
        if (input === null) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(input, 'Do something that must not run');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const buttons = [...document.querySelectorAll('.ai-panel__action')];
        const start = buttons.find((b) => b.textContent.trim() === 'Start');
        if (start === undefined || start.disabled) return false;
        start.click();
        return true;
      })()`,
    );
    check('a third run starts', thirdStarted === true);

    const planRejected = await waitFor(
      session,
      `(() => {
        const plan = document.querySelector('.agent-panel__plan');
        if (plan === null) return false;
        const buttons = [...plan.querySelectorAll('.agent-panel__action')];
        const reject = buttons.find(
          (button) => button.textContent.trim() === 'Reject',
        );
        if (reject === undefined || reject.disabled) return false;
        reject.click();
        return true;
      })()`,
      30000,
    );
    check('the plan can be rejected', planRejected === true);

    const planRejectedEvent = await waitFor(
      session,
      `(() => {
        const events = [...document.querySelectorAll('.agent-panel__event')];
        const text = events.map((event) => event.textContent).join(' | ');
        return text.includes('rejected the plan') ? text : false;
      })()`,
      30000,
    );
    check(
      'the rejected plan is reported',
      typeof planRejectedEvent === 'string',
      String(planRejectedEvent).slice(0, 120),
    );

    const noToolAfterReject = await session.evaluate(
      `(() => document.querySelectorAll('.agent-panel__event--tool-called').length === 0)()`,
    );
    check(
      'a rejected plan runs no tool',
      noToolAfterReject === true,
      'a tool ran after the plan was rejected',
    );

    const rejectedState = await waitFor(
      session,
      `(() => {
        const state = document.querySelector('.agent-panel__state');
        if (state === null) return false;
        const text = state.textContent.trim();
        return text === 'cancelled' ? text : false;
      })()`,
      30000,
    );
    check('a rejected plan cancels the run', rejectedState === 'cancelled');

    // The stop button must work while a run is in progress.
    agentAnswers.length = 0;
    agentAnswers.push(
      JSON.stringify({
        thought: 'read the notes',
        tool: { name: 'read_file', arguments: { path: 'notes.txt' } },
      }),
    );
    await session.evaluate(
      `(() => {
        const input = document.querySelector('.ai-panel__input');
        if (input === null) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(input, 'Stop me');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const buttons = [...document.querySelectorAll('.ai-panel__action')];
        const start = buttons.find((b) => b.textContent.trim() === 'Start');
        if (start === undefined) return false;
        start.click();
        return true;
      })()`,
    );
    check('the plan of the last run can be approved', await approvePlan(session));
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const stopped = await session.evaluate(
      `(() => {
        const buttons = [...document.querySelectorAll('.ai-panel__action')];
        const stop = buttons.find((b) => b.textContent.trim() === 'Stop');
        if (stop === undefined || stop.disabled) return false;
        stop.click();
        return true;
      })()`,
    );
    check('the run can be stopped', stopped === true);

    const cancelled = await waitFor(
      session,
      `(() => {
        const state = document.querySelector('.agent-panel__state');
        if (state === null) return false;
        const text = state.textContent.trim();
        return text === 'cancelled' ? text : false;
      })()`,
      30000,
    );
    check('the stopped run reports that it was cancelled', cancelled === 'cancelled');

    // A permission can be narrowed at once; the main process applies it.
    const narrowed = await session.evaluate(
      `(() => {
        const box = document.querySelector(
          '.agent-panel__permission input[type="checkbox"]',
        );
        if (box === null || !box.checked) return false;
        box.click();
        return true;
      })()`,
    );
    check('the read permission can be narrowed', narrowed === true);

    const persisted = await waitFor(
      session,
      `(async () => {
        const view = await window.nova.agent.permissionSettings();
        return view.current.read === false ? view.current : false;
      })()`,
      10000,
    );
    check(
      'the narrowed permission is applied in the main process',
      typeof persisted === 'object' &&
        persisted !== null &&
        persisted.read === false,
      JSON.stringify(persisted),
    );

    // -----------------------------------------------------------------------
    // A6 commands, menus and keybindings (packaged build).
    // -----------------------------------------------------------------------
    const traceAvailable = await waitFor(
      session,
      `typeof window.__a6CommandTrace === 'function'`,
      10000,
    );
    check('command trace accessor is exposed', traceAvailable === true);

    const menuCategories = await session.evaluate(
      `[...document.querySelectorAll('.menu-bar__top')].map((node) => node.textContent.trim())`,
    );
    check(
      'renderer menu bar exposes every category',
      JSON.stringify(menuCategories) ===
        JSON.stringify(['File', 'Edit', 'View', 'Window', 'Help']),
      JSON.stringify(menuCategories),
    );

    // Click opens, hover switches while open, Escape closes. The File menu is
    // also where the Alt+F4-only label is checked (it is never pressed).
    await clickText(session, '.menu-bar__top', 'File');
    const fileMenu = await session.evaluate(
      `(() => {
        const menu = document.querySelector('.menu-bar__dropdown');
        const top = [...document.querySelectorAll('.menu-bar__top')]
          .find((node) => node.textContent.trim() === 'File');
        const exit = menu === null ? null : [...menu.querySelectorAll('.menu-bar__item')]
          .find((node) => node.textContent.includes('Exit'));
        const label = exit === null ? null : exit.querySelector('.menu-bar__label');
        const shortcut = exit === null ? null : exit.querySelector('.menu-bar__shortcut');
        return {
          label: menu === null ? null : menu.getAttribute('aria-label'),
          expanded: top === undefined ? null : top.getAttribute('aria-expanded'),
          role: document.querySelector('.menu-bar')?.getAttribute('role') ?? null,
          itemRoles: menu === null ? [] : [...menu.querySelectorAll('.menu-bar__item')]
            .map((node) => node.getAttribute('role')),
          exitShortcut: shortcut === null ? null : shortcut.textContent.trim(),
          aligned: label !== null && shortcut !== null
            ? getComputedStyle(label).flexGrow === '1' &&
              getComputedStyle(shortcut).marginLeft === '24px'
            : false,
        };
      })()`,
    );
    const hoveredLabel = await (async () => {
      await hoverText(session, '.menu-bar__top', 'Edit');
      return session.evaluate(
        `document.querySelector('.menu-bar__dropdown')?.getAttribute('aria-label') ?? null`,
      );
    })();
    await session.pressKey('Escape', 27);
    const closedByEscape = await session.evaluate(
      `(() => {
        const menu = document.querySelector('.menu-bar__dropdown');
        const top = [...document.querySelectorAll('.menu-bar__top')]
          .find((node) => node.textContent.trim() === 'File');
        return menu === null && top?.getAttribute('aria-expanded') === 'false';
      })()`,
    );
    check(
      'menu opens on click, switches on hover and closes on Escape',
      fileMenu.role === 'menubar' &&
        fileMenu.label === 'File menu' &&
        fileMenu.expanded === 'true' &&
        fileMenu.itemRoles.length > 0 &&
        fileMenu.itemRoles.every((role) => role === 'menuitem' || role === 'menuitemcheckbox') &&
        fileMenu.exitShortcut === 'Alt+F4' &&
        fileMenu.aligned === true &&
        hoveredLabel === 'Edit menu' &&
        closedByEscape === true,
      JSON.stringify({ fileMenu, hoveredLabel, closedByEscape }),
    );

    // Arrow keys move between items and categories; an outside pointer closes.
    await clickText(session, '.menu-bar__top', 'View');
    await waitFor(
      session,
      `document.activeElement?.classList.contains('menu-bar__item') === true`,
      5000,
    );
    const firstItem = await session.evaluate(`document.activeElement?.textContent.trim() ?? null`);
    await session.pressKey('ArrowDown', 40);
    const secondItem = await session.evaluate(`document.activeElement?.textContent.trim() ?? null`);
    await session.pressKey('ArrowRight', 39);
    const keyboardCategory = await session.evaluate(
      `document.querySelector('.menu-bar__dropdown')?.getAttribute('aria-label') ?? null`,
    );
    await session.evaluate(
      `document.documentElement.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`,
    );
    const closedByOutside = await session.evaluate(
      `document.querySelector('.menu-bar__dropdown') === null`,
    );
    check(
      'menu supports keyboard navigation and outside-pointer close',
      typeof firstItem === 'string' &&
        typeof secondItem === 'string' &&
        firstItem !== secondItem &&
        keyboardCategory === 'Window menu' &&
        closedByOutside === true,
      JSON.stringify({ firstItem, secondItem, keyboardCategory, closedByOutside }),
    );

    // A click must execute the same command id through the trusted menu source.
    const beforeMenuCommand = await traceSequence(session);
    const beforePanelVisible = await session.evaluate(
      `(() => {
        const panel = document.querySelector('.ai-panel');
        return panel !== null && !panel.classList.contains('ai-panel--hidden');
      })()`,
    );
    await clickText(session, '.menu-bar__top', 'View');
    await clickText(session, '.menu-bar__item', 'Toggle AI Panel', false);
    const menuCommand = await session.evaluate(
      `(() => {
        const trace = window.__a6CommandTrace();
        const last = trace[trace.length - 1] ?? null;
        const panel = document.querySelector('.ai-panel');
        return {
          last,
          closed: document.querySelector('.menu-bar__dropdown') === null,
          panelVisible: panel !== null && !panel.classList.contains('ai-panel--hidden'),
        };
      })()`,
    );
    check(
      'menu click executes the command with the user-menu source',
      menuCommand.last !== null &&
        menuCommand.last.sequence > beforeMenuCommand &&
        menuCommand.last.id === 'a6.view.toggleAiPanel' &&
        menuCommand.last.source === 'user-menu' &&
        menuCommand.last.outcome === 'ran' &&
        menuCommand.closed === true &&
        menuCommand.panelVisible !== beforePanelVisible,
      JSON.stringify(menuCommand),
    );

    // Toggles, disabled items, hints and right-aligned shortcuts must be honest.
    await clickText(session, '.menu-bar__top', 'View');
    const viewMenu = await session.evaluate(
      `(() => {
        const menu = document.querySelector('.menu-bar__dropdown');
        const items = menu === null ? [] : [...menu.querySelectorAll('.menu-bar__item')];
        const palette = items.find((node) => node.textContent.includes('Command Palette'));
        const ai = items.find((node) => node.textContent.includes('Toggle AI Panel'));
        const shortcut = ai === undefined ? null : ai.querySelector('.menu-bar__shortcut');
        const label = ai === undefined ? null : ai.querySelector('.menu-bar__label');
        return {
          paletteDisabled: palette !== undefined && palette.disabled === true &&
            palette.classList.contains('menu-bar__item--disabled') &&
            (palette.getAttribute('title') ?? '').includes('planned'),
          panelVisible: (() => {
            const panel = document.querySelector('.ai-panel');
            return panel !== null && !panel.classList.contains('ai-panel--hidden');
          })(),
          aiCheckbox: ai !== undefined &&
            ai.getAttribute('role') === 'menuitemcheckbox' &&
            ai.getAttribute('aria-checked') ===
              String((() => {
                const panel = document.querySelector('.ai-panel');
                return panel !== null && !panel.classList.contains('ai-panel--hidden');
              })()),
          shortcut: shortcut === null ? null : shortcut.textContent.trim(),
          aligned: label !== null && shortcut !== null
            ? getComputedStyle(label).flexGrow === '1' &&
              getComputedStyle(shortcut).marginLeft === '24px'
            : false,
        };
      })()`,
    );
    await session.pressKey('Escape', 27);
    check(
      'view menu marks toggles, disabled items and shortcuts honestly',
      viewMenu.paletteDisabled === true &&
        viewMenu.aiCheckbox === true &&
        typeof viewMenu.panelVisible === 'boolean' &&
        viewMenu.shortcut === 'Ctrl+L' &&
        viewMenu.aligned === true,
      JSON.stringify(viewMenu),
    );

    // Hiding a panel must keep the live terminal mounted.
    await clickText(session, '.menu-bar__top', 'View');
    await clickText(session, '.menu-bar__item', 'Toggle Terminal', false);
    const hiddenPanel = await session.evaluate(
      `(() => {
        const panel = document.querySelector('.bottom-panel');
        return {
          hidden: panel !== null && panel.classList.contains('bottom-panel--hidden'),
          mounted: document.querySelector('.terminal-view') !== null,
        };
      })()`,
    );
    await clickText(session, '.menu-bar__top', 'View');
    await clickText(session, '.menu-bar__item', 'Toggle Terminal', false);
    const shownPanel = await session.evaluate(
      `(() => {
        const panel = document.querySelector('.bottom-panel');
        return panel !== null && !panel.classList.contains('bottom-panel--hidden');
      })()`,
    );
    check(
      'hidden terminal panel stays mounted and can be restored',
      hiddenPanel.hidden === true && hiddenPanel.mounted === true && shownPanel === true,
      JSON.stringify({ hiddenPanel, shownPanel }),
    );

    // Ctrl+N reuses the explorer inline creation instead of an untitled buffer.
    await session.pressShortcut('n', 'KeyN', 78, ['ctrl']);
    const inlineCreate = await waitFor(
      session,
      `document.querySelector('.tree-node__input') !== null`,
      5000,
    );
    await session.pressKey('Escape', 27);
    check('Ctrl+N starts inline creation in the explorer', inlineCreate === true);

    // The Edit menu must use the focus target captured before the menu opened.
    // Close any dropdown left by the previous checks and let React settle
    // before the terminal takes focus.
    await session.pressKey('Escape', 27);
    await new Promise((resolve) => setTimeout(resolve, 150));
    await session.evaluate(
      `document.documentElement.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`,
    );
    const terminalFocusedForMenu = await session.evaluate(
      `(() => {
        const tab = [...document.querySelectorAll('.bottom-panel__tab')]
          .find((node) => node.textContent.includes('Terminal'));
        if (tab !== undefined) tab.click();
        const area = document.querySelector('.terminal-panel__view:not([hidden]) .terminal-view textarea');
        if (area === null) return false;
        area.focus();
        return document.activeElement === area;
      })()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    const terminalStillFocused = await session.evaluate(
      `document.activeElement?.closest('.xterm') !== null`,
    );
    await clickText(session, '.menu-bar__top', 'Edit');
    await waitFor(
      session,
      `document.querySelector('.menu-bar__dropdown') !== null`,
      2000,
    );
    const editWithTerminal = await session.evaluate(
      `(() => {
        const menu = document.querySelector('.menu-bar__dropdown');
        const items = menu === null ? [] : [...menu.querySelectorAll('.menu-bar__item')];
        const undo = items.find((node) => node.textContent.includes('Undo'));
        const copy = items.find((node) => node.textContent.includes('Copy'));
        return {
          undoDisabled: undo !== undefined && undo.disabled === true,
          hint: undo === null ? null : undo.getAttribute('title'),
          copyDisabled: copy !== undefined && copy.disabled === true,
        };
      })()`,
    );
    await session.pressKey('Escape', 27);
    const aiHiddenForMenu = await session.evaluate(
      `(() => {
        const panel = document.querySelector('.ai-panel');
        return panel === null || panel.classList.contains('ai-panel--hidden');
      })()`,
    );
    if (aiHiddenForMenu === true) {
      await clickText(session, '.menu-bar__top', 'View');
      await clickText(session, '.menu-bar__item', 'Toggle AI Panel', false);
    }
    const fieldFocusedForMenu = await session.evaluate(
      `(() => {
        const area = document.querySelector('.ai-panel__input');
        if (area === null) return false;
        area.focus();
        return document.activeElement === area;
      })()`,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    await clickText(session, '.menu-bar__top', 'Edit');
    await waitFor(
      session,
      `document.querySelector('.menu-bar__dropdown') !== null`,
      2000,
    );
    const editWithField = await session.evaluate(
      `(() => {
        const menu = document.querySelector('.menu-bar__dropdown');
        const items = menu === null ? [] : [...menu.querySelectorAll('.menu-bar__item')];
        const cut = items.find((node) => node.textContent.includes('Cut'));
        const copy = items.find((node) => node.textContent.includes('Copy'));
        return {
          cutEnabled: cut !== undefined && !cut.disabled,
          copyEnabled: copy !== undefined && !copy.disabled,
        };
      })()`,
    );
    await session.pressKey('Escape', 27);
    check(
      'Edit menu uses the focus captured before it opened',
      terminalFocusedForMenu === true &&
        terminalStillFocused === true &&
        editWithTerminal.undoDisabled === true &&
        (editWithTerminal.hint ?? '').includes('Focus a text field') &&
        editWithTerminal.copyDisabled === true &&
        fieldFocusedForMenu === true &&
        editWithField.cutEnabled === true &&
        editWithField.copyEnabled === true,
      JSON.stringify({
        terminalFocusedForMenu,
        terminalStillFocused,
        editWithTerminal,
        fieldFocusedForMenu,
        editWithField,
      }),
    );

    // Make sure no dropdown is left open; the registry suppresses shortcuts
    // while a menu owns the keyboard.
    await session.evaluate(
      `document.documentElement.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`,
    );

    // Terminal key pass-through: no registry entries, no chord hint, no panel toggle.
    const terminalRefocused = await session.evaluate(
      `(() => {
        const area = document.querySelector('.terminal-panel__view:not([hidden]) .terminal-view textarea');
        if (area === null) return false;
        area.focus();
        return document.activeElement === area;
      })()`,
    );
    const beforeTerminalKeys = await traceSequence(session);
    const panelBeforeTerminalKeys = await session.evaluate(
      `(() => {
        const panel = document.querySelector('.ai-panel');
        return panel !== null && panel.classList.contains('ai-panel--hidden');
      })()`,
    );
    for (const [key, code, keyCode] of [
      ['l', 'KeyL', 76], ['w', 'KeyW', 87], ['k', 'KeyK', 75],
      ['z', 'KeyZ', 90], ['c', 'KeyC', 67], ['v', 'KeyV', 86],
    ]) {
      await session.pressShortcut(key, code, keyCode, ['ctrl']);
    }
    const afterTerminalKeys = await traceSequence(session);
    const terminalKeyState = await session.evaluate(
      `(() => {
        const panel = document.querySelector('.ai-panel');
        return {
          panelHidden: panel !== null && panel.classList.contains('ai-panel--hidden'),
          hint: document.querySelector('.menu-bar__hint')?.textContent ?? null,
        };
      })()`,
    );
    check(
      'terminal passes Ctrl+L/W/K/Z/C/V through without commands',
      terminalRefocused === true &&
        beforeTerminalKeys === afterTerminalKeys &&
        panelBeforeTerminalKeys === terminalKeyState.panelHidden &&
        terminalKeyState.hint === null,
      JSON.stringify({ beforeTerminalKeys, afterTerminalKeys, terminalKeyState }),
    );

    // Monaco owns Find/Replace/Undo/Redo; Ctrl+L is unbound there so the
    // registry can still toggle the AI panel outside the terminal.
    await clickWithMouse(session, '.editor-content .view-lines');
    const monacoFocused = await waitFor(
      session,
      `document.activeElement?.closest('.monaco-editor') !== null`,
      5000,
    );
    const beforeEditorKeys = await traceSequence(session);
    await session.pressShortcut('f', 'KeyF', 70, ['ctrl']);
    await session.pressShortcut('h', 'KeyH', 72, ['ctrl']);
    await session.pressShortcut('z', 'KeyZ', 90, ['ctrl']);
    await session.pressShortcut('y', 'KeyY', 89, ['ctrl']);
    const afterEditorKeys = await traceSequence(session);
    check(
      'Monaco keeps Ctrl+F/H/Z/Y without registry commands',
      monacoFocused === true && beforeEditorKeys === afterEditorKeys,
      JSON.stringify({ beforeEditorKeys, afterEditorKeys }),
    );
    // Ctrl+F/H opened Monaco's find/replace widget; close it so its inputs do
    // not masquerade as the editor for the later typing checks.
    await session.pressKey('Escape', 27);

    // Focus a non-terminal, non-editor element for the registry shortcut.
    const plainFocused = await focusText(session, '.menu-bar__top', 'File');
    const panelBeforeCtrlL = await session.evaluate(
      `(() => {
        const panel = document.querySelector('.ai-panel');
        return panel !== null && panel.classList.contains('ai-panel--hidden');
      })()`,
    );
    await session.pressShortcut('l', 'KeyL', 76, ['ctrl']);
    const ctrlLEntry = await session.evaluate(
      `(() => {
        const trace = window.__a6CommandTrace();
        const panel = document.querySelector('.ai-panel');
        return {
          last: trace[trace.length - 1] ?? null,
          panelHidden: panel !== null && panel.classList.contains('ai-panel--hidden'),
        };
      })()`,
    );
    check(
      'Ctrl+L toggles the AI panel outside the terminal',
      plainFocused === true &&
        ctrlLEntry.last !== null &&
        ctrlLEntry.last.id === 'a6.view.toggleAiPanel' &&
        ctrlLEntry.last.source === 'user-keyboard' &&
        ctrlLEntry.last.outcome === 'ran' &&
        ctrlLEntry.panelHidden !== panelBeforeCtrlL,
      JSON.stringify(ctrlLEntry),
    );

    const measureAiPanelLayout = async () =>
      session.evaluate(
        `(() => {
          const shell = document.querySelector('.app-shell');
          const panel = document.querySelector('.ai-panel');
          const editor = document.querySelector('.editor-area');
          if (shell === null || panel === null || editor === null) return null;
          const shellRect = shell.getBoundingClientRect();
          const panelRect = panel.getBoundingClientRect();
          const editorRect = editor.getBoundingClientRect();
          const hidden = panel.classList.contains('ai-panel--hidden');
          const style = getComputedStyle(panel);
          return {
            hidden,
            shellRight: shellRect.right,
            panelWidth: panelRect.width,
            panelRight: panelRect.right,
            editorRight: editorRect.right,
            display: style.display,
            visibility: style.visibility,
            gap: shellRect.right - Math.max(editorRect.right, hidden ? 0 : panelRect.right),
            contentChildren: panel.querySelector('.ai-panel__content, .ai-panel__messages, .ai-panel__composer, .agent-panel') !== null,
          };
        })()`,
      );

    const aiPanelLayoutAfterCtrlL = await measureAiPanelLayout();
    // Toggle back to cover both states (shown and hidden).
    await session.pressShortcut('l', 'KeyL', 76, ['ctrl']);
    await waitFor(
      session,
      `(() => {
        const panel = document.querySelector('.ai-panel');
        return panel !== null && panel.classList.contains('ai-panel--hidden') === ${String(
          !ctrlLEntry.panelHidden,
        )};
      })()`,
      5000,
    );
    const aiPanelLayoutAfterSecondCtrlL = await measureAiPanelLayout();
    const layouts = [aiPanelLayoutAfterCtrlL, aiPanelLayoutAfterSecondCtrlL].filter(Boolean);
    check(
      'AI panel shown/hidden states leave no empty right strip',
      layouts.length === 2 &&
        layouts.some((l) => l.hidden === true) &&
        layouts.some((l) => l.hidden === false) &&
        layouts.every(
          (l) =>
            (l.hidden === true && l.panelWidth <= 1 && l.gap <= 2) ||
            (l.hidden === false && l.panelWidth > 100 && l.gap <= 2 && l.contentChildren === true),
        ),
      JSON.stringify({ aiPanelLayoutAfterCtrlL, aiPanelLayoutAfterSecondCtrlL }),
    );

    // A chord prefix shows a visible hint; Escape cancels it before it can
    // open the native folder dialog.
    await session.pressShortcut('k', 'KeyK', 75, ['ctrl']);
    const chordHint = await session.evaluate(
      `document.querySelector('.menu-bar__hint')?.textContent ?? null`,
    );
    await session.pressKey('Escape', 27);
    const chordCancelled = await session.evaluate(
      `document.querySelector('.menu-bar__hint') === null`,
    );
    check(
      'chords show a status hint and Escape cancels them',
      typeof chordHint === 'string' &&
        chordHint.includes('Ctrl+K') &&
        chordCancelled === true,
      String(chordHint),
    );

    // Dirty buffers: closing a tab can be declined, and declining a window
    // close or Exit leaves the application alive.
    await session.evaluate(
      `(() => {
        const button = document.querySelector('.editor-tabs__new');
        if (button !== null) button.click();
        return document.querySelector('.editor-tabs__new') !== null;
      })()`,
    );
    await clickWithMouse(session, '.editor-content .view-lines');
    await session.evaluate(
      `(() => {
        const area = document.querySelector(
          '.monaco-editor textarea[aria-label*="Editor content"], .monaco-editor textarea.inputarea',
        );
        if (area !== null) area.focus();
        return area !== null;
      })()`,
    );
    const newEditorFocused = await waitFor(
      session,
      `document.activeElement?.closest('.editor-content') !== null`,
      5000,
    );
    await session.typeText('A6_VERIFY_DIRTY');
    const dirtyTabVisible = await waitFor(
      session,
      `document.querySelector('.editor-tab--active .editor-tab__dirty') !== null`,
      5000,
    );
    const dirtyState = await session.evaluate(
      `(() => ({
        name: document.querySelector('.editor-tab--active .editor-tab__name')?.textContent ?? null,
        lines: document.querySelector('.editor-content .view-lines')?.textContent ?? null,
      }))()`,
    );
    check(
      'editing a buffer marks its tab dirty',
      newEditorFocused === true && dirtyTabVisible === true,
      JSON.stringify(dirtyState),
    );
    const dirtyTabName = dirtyState.name;

    await session.evaluate(
      `window.__a6ConfirmMessages = [];
       window.__a6OriginalConfirm = window.confirm;
       window.confirm = (message) => {
         window.__a6ConfirmMessages.push(String(message));
         return false;
       };`,
    );
    await session.evaluate(
      `(() => {
        const button = document.querySelector('.editor-tab--active .editor-tab__close');
        if (button === null) return false;
        button.click();
        return true;
      })()`,
    );
    const tabCloseCancelled = await session.evaluate(
      `(() => ({
        messages: window.__a6ConfirmMessages.slice(),
        stillOpen: [...document.querySelectorAll('.editor-tab__name')]
          .some((node) => node.textContent.trim() === ${JSON.stringify(dirtyTabName ?? '')}),
      }))()`,
    );
    check(
      'closing a dirty tab can be declined',
      tabCloseCancelled.messages.some((message) => message.includes('Unsaved changes')) &&
        tabCloseCancelled.stillOpen === true,
      JSON.stringify(tabCloseCancelled),
    );

    await session.evaluate(
      `window.__a6ConfirmMessages = []; window.confirm = () => {
        window.__a6ConfirmMessages.push('accepted');
        return true;
      };`,
    );
    await session.evaluate(
      `(() => {
        const button = document.querySelector('.editor-tab--active .editor-tab__close');
        if (button === null) return false;
        button.click();
        return true;
      })()`,
    );
    const tabCloseAccepted = await waitFor(
      session,
      `(() => ![...document.querySelectorAll('.editor-tab__name')]
        .some((node) => node.textContent.trim() === ${JSON.stringify(dirtyTabName ?? '')}))()`,
      5000,
    );
    check('an accepted dirty-tab close removes the tab', tabCloseAccepted === true);

    // Recreate a dirty buffer for the window-level close checks.
    console.log('  step: recreate dirty buffer');
    await session.evaluate(`document.querySelector('.editor-tabs__new')?.click()`);
    await clickWithMouse(session, '.editor-content .view-lines');
    await session.evaluate(
      `(() => {
        const area = document.querySelector(
          '.monaco-editor textarea[aria-label*="Editor content"], .monaco-editor textarea.inputarea',
        );
        if (area !== null) area.focus();
        return area !== null;
      })()`,
    );
    await waitFor(
      session,
      `document.activeElement?.closest('.editor-content') !== null`,
      5000,
    );
    await session.typeText('A6_VERIFY_CLOSE');
    await waitFor(
      session,
      `document.querySelector('.editor-tab--active .editor-tab__dirty') !== null`,
      5000,
    );
    const closeReady = await session.evaluate(
      `document.querySelector('.editor-tab--active .editor-tab__dirty') !== null`,
    );
    if (closeReady !== true) {
      check('declining a dirty window close leaves the app alive', false, 'no dirty buffer');
      check('declining Exit with unsaved changes leaves the app alive', false, 'no dirty buffer');
    } else {
    await session.evaluate(
      `window.__a6ConfirmMessages = [];
       window.confirm = (message) => {
         window.__a6ConfirmMessages.push(String(message));
         return false;
       };`,
    );
    // `void` prevents Runtime.evaluate from awaiting the close handshake; the
    // renderer's mocked confirm answers it without ever closing the app.
    console.log('  step: request window close');
    await session.evaluate(`void window.nova.window.close()`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const closeWindowCancelled = await session.evaluate(
      `(() => ({
        messages: window.__a6ConfirmMessages.slice(),
        alive: document.readyState === 'complete',
      }))()`,
    );
    check(
      'declining a dirty window close leaves the app alive',
      closeWindowCancelled.messages.some((message) => message.includes('Unsaved changes')) &&
        closeWindowCancelled.alive === true,
      JSON.stringify(closeWindowCancelled),
    );

    await session.evaluate(
      `window.__a6ConfirmMessages = [];
       window.confirm = (message) => {
         window.__a6ConfirmMessages.push(String(message));
         return false;
       };`,
    );
    await clickText(session, '.menu-bar__top', 'File');
    await clickText(session, '.menu-bar__item', 'Exit', false);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const exitCancelled = await session.evaluate(
      `(() => ({
        messages: window.__a6ConfirmMessages.slice(),
        alive: document.readyState === 'complete',
      }))()`,
    );
    check(
      'declining Exit with unsaved changes leaves the app alive',
      exitCancelled.messages.some((message) => message.includes('Unsaved changes')) &&
        exitCancelled.alive === true,
      JSON.stringify(exitCancelled),
    );
    }
    await session.evaluate(
      `window.confirm = window.__a6OriginalConfirm ?? window.confirm;
       delete window.__a6OriginalConfirm;
       delete window.__a6ConfirmMessages;`,
    );

    // The trace must stay bounded, frozen and free of arguments or content.
    console.log('  step: verify trace integrity');
    const finalTrace = await traceSnapshot(session);
    const traceIntegrity = await session.evaluate(
      `(() => {
        const snapshot = typeof window.__a6CommandTrace === 'function'
          ? window.__a6CommandTrace()
          : null;
        if (snapshot === null) return { ok: false };
        return {
          ok: snapshot.length > 0 && snapshot.length <= 32 &&
            Object.isFrozen(snapshot) &&
            snapshot.every((entry) =>
              Object.isFrozen(entry) &&
              Object.keys(entry).sort().join(',') === 'id,outcome,sequence,source' &&
              (entry.source === 'user-menu' || entry.source === 'user-keyboard') &&
              (entry.outcome === 'ran' || entry.outcome === 'blocked')),
        };
      })()`,
    );
    check(
      'command trace is bounded, frozen and non-sensitive',
      traceIntegrity.ok === true,
      JSON.stringify(Array.isArray(finalTrace) ? finalTrace.slice(-1) : null),
    );
    const beforeAccessorCall = await traceSequence(session);
    await session.evaluate(`window.__a6CommandTrace()`);
    const afterAccessorCall = await traceSequence(session);
    check(
      'command trace accessor cannot execute commands',
      beforeAccessorCall === afterAccessorCall,
    );

    mockOllama.stop();

    // The renderer must not log any error.
    check(
      'renderer produced no console errors',
      consoleErrors.length === 0,
      consoleErrors.join(' | '),
    );
  } catch (error) {
    check('verification run', false, error instanceof Error ? error.message : String(error));
  } finally {
    session?.close();
    if (!options.keepOpen) {
      app.kill();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      try {
        rmSync(fixture, {
          recursive: true,
          force: true,
          maxRetries: 10,
          retryDelay: 200,
        });
      } catch {
        // The application may still hold the directory (the terminal
        // runs in it); the operating system removes it later.
      }
    }

    // The profile of the user must not have changed.
    const fingerprintAfter = profileFingerprint(userProfile);
    check(
      'the profile of the user was not touched',
      fingerprintAfter === fingerprintBefore,
      userProfile === null ? '' : userProfile,
    );

    // The application really used the isolated profile.
    check(
      'the application used the isolated profile',
      existsSync(path.join(profile.dir, 'providers.json')),
      profile.dir,
    );

    profile.cleanup();
    check(
      'the isolated profile was removed',
      !existsSync(profile.dir),
      profile.dir,
    );
  }

  const failed = results.filter((entry) => !entry.ok);
  console.log(
    `\n${results.length - failed.length}/${results.length} checks passed` +
      (failed.length > 0 ? `, ${failed.length} FAILED` : ''),
  );
  if (failed.length > 0) {
    exitCode = 1;
  }
  process.exit(exitCode);
}

main().catch((error) => {
  console.error('verification failed:', error);
  process.exit(1);
});
