/**
 * Runtime verification harness for NOVA IDE (spec §24).
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
    'NOVA IDE-win32-x64',
    'NOVAIDE.exe',
  );
  if (!existsSync(executable)) {
    throw new Error(
      `The packaged application is missing. Run "pnpm package" first (${executable}).`,
    );
  }
  return spawn(
    executable,
    [`--remote-debugging-port=${DEVTOOLS_PORT}`, profileArgument],
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
  const userProfile = realUserDataPath();
  const fingerprintBefore = profileFingerprint(userProfile);
  console.log(`Profile of the application: ${profile.dir}\n`);

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

    // Typing into the terminal must produce output in the renderer.
    const focused = await session.evaluate(
      `(() => {
        const area = document.querySelector('.terminal-view textarea');
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

    await session.evaluate(
      `(() => {
        const area = document.querySelector('.terminal-view textarea');
        if (area === null) return false;
        area.focus();
        return true;
      })()`,
    );
    await session.insertText('Start-Sleep 30');
    await session.pressKey('Enter', 13);

    // The command must really be running before it is interrupted.
    const commandStarted = await waitFor(
      session,
      `(() => {
        const rows = document.querySelectorAll('.terminal-view .xterm-rows > div');
        if (rows.length === 0) return false;
        const text = [...rows].map((row) => row.textContent).join('\\n');
        return text.includes('Start-Sleep 30');
      })()`,
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
    const terminalText = await session.evaluate(
      `(() => {
        const rows = document.querySelectorAll('.terminal-view .xterm-rows > div');
        return [...rows].map((row) => row.textContent).join('\\n');
      })()`,
    );
    // The shell needs a moment to return to the prompt; the command is
    // sent a few times, so a lost keystroke cannot fail the check.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await session.evaluate(
        `(() => {
          const area = document.querySelector('.terminal-view textarea');
          if (area === null) return false;
          area.focus();
          return true;
        })()`,
      );
      await session.insertText('echo NOVA_AFTER_STOP');
      await session.pressKey('Enter', 13);
      await new Promise((resolve) => setTimeout(resolve, 700));
      const done = await session.evaluate(
        `(() => {
          const rows = document.querySelectorAll('.terminal-view .xterm-rows > div');
          const text = [...rows].map((row) => row.textContent).join('\\n');
          return text.includes('NOVA_AFTER_STOP');
        })()`,
      );
      if (done === true) {
        break;
      }
    }
    const afterStop = await waitFor(
      session,
      `(() => {
        const rows = document.querySelectorAll('.terminal-view .xterm-rows > div');
        if (rows.length === 0) return false;
        const text = [...rows].map((row) => row.textContent).join('\\n');
        return text.includes('NOVA_AFTER_STOP');
      })()`,
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
      `document.querySelectorAll('.editor-tab').length`,
    );

    // On a fresh profile the local provider points at the default
    // address of Ollama.
    const defaultProviders = await session.evaluate(
      `window.nova.ai.providers().then((r) =>
         r.ok
           ? r.value.map((p) => p.id + '=' + p.baseUrl).join(',')
           : 'ERROR')`,
    );
    check(
      'the default address of the local provider is the default of Ollama',
      typeof defaultProviders === 'string' &&
        defaultProviders.includes('ollama=http://127.0.0.1:11434'),
      String(defaultProviders),
    );

    // The chat panel must be able to talk to a provider. The harness
    // hosts a mock of the local Ollama service.
    const mockOllama = await startMockOllama();

    // The address is changed through the settings of the panel, the way a
    // user would do it.
    const settingsOpened = await session.evaluate(
      `(() => {
        const button = document.querySelector('.ai-panel__settings-button');
        if (button === null) return false;
        button.click();
        return true;
      })()`,
    );
    check('the provider settings can be opened', settingsOpened === true);

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

    const deleteConfirmed = await session.evaluate(
      `(() => {
        const item = [...document.querySelectorAll('.ai-models__item')].find(
          (i) => i.getAttribute('data-model') === 'nova-new-model');
        if (item === undefined) return false;
        const button = [...item.querySelectorAll('button')].find(
          (b) => b.textContent.trim() === 'Delete');
        if (button === undefined) return false;
        button.click();
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

    const localBadge = await session.evaluate(
      `(() => {
        const badge = document.querySelector('.ai-badge');
        return badge === null ? '' : badge.textContent.trim();
      })()`,
    );
    check(
      'the panel shows that the provider is local',
      localBadge === 'LOCAL',
      String(localBadge),
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
      `(() => document.querySelectorAll('.editor-tab').length === ${tabsBeforeChat})()`,
    );
    check('the answer did not open a file', noFileWrite === true);

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
        const input = document.querySelector('.agent-panel__input');
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
        const buttons = [...document.querySelectorAll('.agent-panel__action')];
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
        const input = document.querySelector('.agent-panel__input');
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
        const buttons = [...document.querySelectorAll('.agent-panel__action')];
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
        const input = document.querySelector('.agent-panel__input');
        if (input === null) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(input, 'Do something that must not run');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const buttons = [...document.querySelectorAll('.agent-panel__action')];
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
        const input = document.querySelector('.agent-panel__input');
        if (input === null) return false;
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLTextAreaElement.prototype, 'value').set;
        setter.call(input, 'Stop me');
        input.dispatchEvent(new Event('input', { bubbles: true }));
        const buttons = [...document.querySelectorAll('.agent-panel__action')];
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
        const buttons = [...document.querySelectorAll('.agent-panel__action')];
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
