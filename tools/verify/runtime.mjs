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
