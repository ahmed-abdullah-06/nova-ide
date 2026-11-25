/**
 * Milestone 10B performance measurement harness.
 *
 * Drives the REAL packaged application through the DevTools protocol with an
 * isolated profile and reports measured wall-clock times and memory. No
 * numbers are hard-coded; every value printed is observed during the run.
 *
 * Usage: node tools/perf/measure.mjs
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  DevToolsSession,
  findPageTarget,
  waitForDevTools,
} from '../verify/cdp.mjs';
import { createIsolatedProfile, userDataArgument } from '../verify/isolation.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const DESKTOP = path.join(REPO, 'apps', 'desktop');
const EXE = path.join(DESKTOP, 'out', 'A6-win32-x64', 'A6IDE.exe');
const PORT = 9336;
const results = [];

function record(name, value, detail = '') {
  results.push({ name, value, detail });
  console.log(`${name}: ${value}${detail ? ` (${detail})` : ''}`);
}

function makeFixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'nova-perf-fixture-'));
  for (let dir = 0; dir < 120; dir += 1) {
    const folder = path.join(root, `folder-${String(dir).padStart(3, '0')}`);
    mkdirSync(folder, { recursive: true });
    for (let file = 0; file < 50; file += 1) {
      const name = `perfneedle-${String(dir).padStart(3, '0')}-${String(file).padStart(3, '0')}.txt`;
      writeFileSync(
        path.join(folder, name),
        `needle value ${dir}-${file}\n${'x'.repeat(180)}\n`,
        'utf8',
      );
    }
  }
  return root;
}

/** Sums the working set of a process and all of its descendants (Windows). */
function processTreeWorkingSet(rootPid) {
  const script = `
$all = Get-CimInstance Win32_Process
$ids = @(${rootPid})
$queue = [System.Collections.Generic.Queue[int]]::new()
$queue.Enqueue(${rootPid})
while ($queue.Count -gt 0) {
  $parent = $queue.Dequeue()
  foreach ($child in $all | Where-Object { $_.ParentProcessId -eq $parent }) {
    if ($ids -notcontains $child.ProcessId) {
      $ids += $child.ProcessId
      $queue.Enqueue($child.ProcessId)
    }
  }
}
$bytes = 0
foreach ($p in $all | Where-Object { $ids -contains $_.ProcessId }) { $bytes += $p.WorkingSetSize }
[math]::Round($bytes / 1MB, 1)
`;
  try {
    return Number(
      execFileSync('powershell.exe', ['-NoProfile', '-Command', script], {
        encoding: 'utf8',
        windowsHide: true,
      }).trim(),
    );
  } catch {
    return null;
  }
}

async function heapUsed(session) {
  const usage = await session.send('Runtime.getHeapUsage');
  return Math.round(usage.usedSize / (1024 * 1024) * 10) / 10;
}

async function waitForExpression(session, expression, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await session.evaluate(expression)) {
      return true;
    }
    await delay(200);
  }
  return false;
}

function startApp(profile) {
  return spawn(EXE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
  ], { stdio: 'ignore', windowsHide: true });
}

async function connect() {
  if (!(await waitForDevTools('127.0.0.1', PORT, 60000))) {
    throw new Error('DevTools endpoint never became ready');
  }
  const target = await findPageTarget('127.0.0.1', PORT);
  if (!target) {
    throw new Error('No renderer page target');
  }
  const session = new DevToolsSession(target.webSocketDebuggerUrl);
  await session.open();
  return session;
}

async function seedHistory(profile) {
  const conversations = [];
  for (let c = 0; c < 20; c += 1) {
    const messages = [];
    for (let m = 0; m < 150; m += 1) {
      messages.push({ role: m % 2 === 0 ? 'user' : 'assistant', content: `history ${c}-${m} ` + 'y'.repeat(120) });
    }
    conversations.push({
      id: `perf-conversation-${c}`,
      title: `Perf history ${c}`,
      providerId: 'ollama',
      model: 'perf-model',
      messages,
      updatedAt: new Date().toISOString(),
    });
  }
  writeFileSync(
    path.join(profile, 'conversations.json'),
    JSON.stringify({ version: 1, conversations }),
    'utf8',
  );
}

async function run() {
  const { existsSync } = await import('node:fs');
  if (!existsSync(EXE)) {
    throw new Error(`Packaged app missing: ${EXE}. Run pnpm package first.`);
  }
  const profile = createIsolatedProfile();
  const fixture = makeFixture();
  let app = null;
  let session = null;
  try {
    const started = Date.now();
    app = startApp(profile.dir);
    session = await connect();
    await waitForExpression(
      session,
      `window.nova !== undefined && document.readyState === 'complete'`,
    );
    record('cold_start_to_renderer_ready_ms', Date.now() - started, 'spawn -> window.nova + DOM complete');
    await delay(2000);
    record('idle_working_set_mb', processTreeWorkingSet(app.pid), 'main + renderer + GPU process tree');
    record('idle_renderer_js_heap_mb', await heapUsed(session));

    // Open a 6,000-file folder.
    const openStarted = Date.now();
    const opened = await session.evaluate(
      `window.nova.workspace.open(${JSON.stringify(fixture)}).then(r => r.ok)`,
    );
    await session.evaluate(`window.dispatchEvent(new Event('focus'))`);
    await waitForExpression(
      session,
      `document.querySelector('.explorer__title') !== null`,
      30000,
    );
    record('large_folder_open_to_title_ms', Date.now() - openStarted, `6000 files; ok=${opened}; explorer title rendered`);
    await session.evaluate(`(() => {
      const root = document.querySelector('.tree-node');
      if (root !== null && root.getAttribute('aria-expanded') === 'false') root.click();
      return true;
    })()`);
    await waitForExpression(session, `document.querySelectorAll('.tree-node').length > 100`, 30000);
    record('large_folder_tree_expanded_ms', Date.now() - openStarted, 'open -> >100 rendered tree nodes');
    record('large_folder_tree_nodes', await session.evaluate(`document.querySelectorAll('.tree-node').length`));
    record('after_folder_working_set_mb', processTreeWorkingSet(app.pid));

    // Search the large tree.
    const search = await session.evaluate(`(async () => {
      const id = 'perf-search-' + Date.now();
      const started = performance.now();
      let done = false, matches = 0;
      const unsubscribe = window.nova.search.onResults((r) => {
        if (r.requestId === id) { matches += r.matches.length; if (r.done) done = true; }
      });
      await window.nova.search.query(id, 'files', 'perfneedle');
      const deadline = Date.now() + 60000;
      while (!done && Date.now() < deadline) { await new Promise(r => setTimeout(r, 50)); }
      unsubscribe();
      return { ms: Math.round(performance.now() - started), matches, done };
    })()`);
    record('large_tree_search_ms', search.ms, `${search.matches} matches; done=${search.done}`);

    // Long terminal output.
    const terminal = await session.evaluate(`(async () => {
      const r = await window.nova.terminal.create();
      if (!r.ok) return { ok: false, error: r.error };
      let chars = 0;
      const unsubscribe = window.nova.terminal.onData((data) => {
        chars += (data.data || '').length;
      });
      const started = performance.now();
      await window.nova.terminal.write(r.value.id,
        '1..4000 | ForEach-Object { \"PERFLINE-$_-abcdefghijklmnopqrstuvwxyz\" }\\r');
      const deadline = Date.now() + 30000;
      while (chars < 100000 && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 50));
      }
      unsubscribe();
      return { ok: true, ms: Math.round(performance.now() - started), chars, id: r.value.id };
    })()`);
    record('long_terminal_output_ms', terminal.ms ?? -1, `~${terminal.chars} rendered chars; ok=${terminal.ok}`);
    record('after_terminal_working_set_mb', processTreeWorkingSet(app.pid));
    if (terminal.id) {
      await session.evaluate(`window.nova.terminal.kill(${JSON.stringify(terminal.id)})`);
      await delay(1000);
      record('after_terminal_closed_working_set_mb', processTreeWorkingSet(app.pid));
    }

    // Close the workspace and observe memory again.
    await session.evaluate(`window.nova.workspace.close()`);
    await delay(1500);
    await session.send('HeapProfiler.enable');
    await session.send('HeapProfiler.collectGarbage');
    await delay(500);
    record('after_close_working_set_mb', processTreeWorkingSet(app.pid), 'after GC');
    record('after_close_renderer_js_heap_mb', await heapUsed(session), 'after GC');

    // Second launch with a large seeded conversation history.
    app.kill();
    await delay(2500);
    await seedHistory(profile.dir);
    const historyStarted = Date.now();
    app = startApp(profile.dir);
    session = await connect();
    await waitForExpression(session, `window.nova !== undefined && document.readyState === 'complete'`);
    const history = await session.evaluate(`(async () => {
      const started = performance.now();
      const result = await window.nova.ai.conversations();
      return { ms: Math.round(performance.now() - started), count: Array.isArray(result) ? result.length : -1 };
    })()`);
    record('cold_start_with_history_ms', Date.now() - historyStarted, 'spawn -> renderer with 20x150 messages');
    record('large_history_load_ms', history.ms, `${history.count} conversations`);
    record('large_history_working_set_mb', processTreeWorkingSet(app.pid));

    writeFileSync(
      path.join(REPO, 'tools', 'perf', 'last-results.json'),
      JSON.stringify({ date: new Date().toISOString(), results }, null, 2),
      'utf8',
    );
  } finally {
    if (session) session.close();
    if (app && !app.killed) app.kill();
    await delay(1000);
    profile.cleanup();
    rmSync(fixture, { recursive: true, force: true });
  }
}

run().then(() => process.exit(0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
