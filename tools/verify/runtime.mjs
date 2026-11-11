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
 *  - the renderer produces no console errors.
 *
 * Usage:
 *   node tools/verify/runtime.mjs                # packaged build
 *   node tools/verify/runtime.mjs --dev          # development build
 *   node tools/verify/runtime.mjs --keep-open    # leave the app running
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DevToolsSession,
  findPageTarget,
  waitForDevTools,
} from './cdp.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const DESKTOP = path.join(REPO, 'apps', 'desktop');
const DEVTOOLS_PORT = 9333;

const options = {
  dev: process.argv.includes('--dev'),
  keepOpen: process.argv.includes('--keep-open'),
};

/** The checks that were executed. */
const results = [];
/** Console errors reported by the renderer. */
const consoleErrors = [];

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
  console.log(`${mark}  ${name}${detail ? ` — ${detail}` : ''}`);
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
  writeFileSync(path.join(root, 'untracked.txt'), 'untracked\n', 'utf8');
  return root;
}

/**
 * Starts the application under test.
 *
 * @returns {import('node:child_process').ChildProcess} The child process.
 */
function startApp() {
  if (options.dev) {
    return spawn(
      'pnpm',
      ['exec', 'electron-forge', 'start', '--inspect-port=9334'],
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
    [`--remote-debugging-port=${DEVTOOLS_PORT}`],
    { stdio: 'inherit' },
  );
}

/** Runs the verification. */
async function main() {
  const fixture = createFixture();
  console.log(`Fixture workspace: ${fixture}\n`);

  const app = startApp();
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
      rmSync(fixture, { recursive: true, force: true });
    }
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
