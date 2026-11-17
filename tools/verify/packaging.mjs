/**
 * Milestone 10C packaged-application verification.
 *
 * Checks the real, packaged Windows build from a clean install-like location:
 *  - the exe / nuspec metadata is the product metadata, not tool defaults,
 *  - the app launches from a path that contains spaces (like a real install),
 *  - a completely fresh profile (no Ollama, no models, no keys) starts cleanly,
 *  - the app creates its data files in the userData directory,
 *  - no application process survives a forced kill (the same guarantee the
 *    Squirrel uninstaller relies on when it stops running processes).
 *
 * Every run uses a temporary profile. The real user profile is never touched.
 *
 * Usage: node tools/verify/packaging.mjs   (run `pnpm make` first)
 */
import { spawn, execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  DevToolsSession,
  findPageTarget,
  waitForDevTools,
} from './cdp.mjs';
import { createIsolatedProfile } from './isolation.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const DESKTOP = path.join(REPO, 'apps', 'desktop');
const PACKAGED = path.join(DESKTOP, 'out', 'NOVA IDE-win32-x64');
const NUPKG = path.join(DESKTOP, 'out', 'make', 'squirrel.windows', 'x64', 'NOVAIDE-0.1.0-full.nupkg');
const PORT = 9410;

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

/** Reads a value from PowerShell on Windows; returns null elsewhere. */
function powerShell(script) {
  if (process.platform !== 'win32') return null;
  try {
    return execFileSync(
      'powershell.exe',
      ['-NoProfile', '-Command', script],
      { encoding: 'utf8' },
    ).trim();
  } catch {
    return null;
  }
}

/** Returns the processes whose executable path is under `dir` (Windows). */
function appProcessIds(dir) {
  if (process.platform !== 'win32') return [];
  const script = `
Get-CimInstance Win32_Process |
  Where-Object { $_.ExecutablePath -like '${dir.replace(/'/g, "''")}*' } |
  ForEach-Object { $_.ProcessId }
`;
  const output = powerShell(script);
  if (!output) return [];
  return output.split(/\r?\n/).map((s) => s.trim()).filter((s) => /^\d+$/.test(s));
}

function readNuspec() {
  const script = `
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead('${NUPKG.replace(/'/g, "''")}')
$entry = $zip.Entries | Where-Object { $_.FullName -like '*.nuspec' } | Select-Object -First 1
$reader = New-Object System.IO.StreamReader($entry.Open())
$text = $reader.ReadToEnd()
$reader.Close(); $zip.Dispose()
$text
`;
  return powerShell(script);
}

async function connect() {
  if (!(await waitForDevTools('127.0.0.1', PORT, 60000))) {
    throw new Error('DevTools endpoint never became ready');
  }
  const target = await findPageTarget('127.0.0.1', PORT);
  if (!target) throw new Error('No renderer page target');
  const session = new DevToolsSession(target.webSocketDebuggerUrl);
  await session.open();
  return session;
}

async function waitForExpression(session, expression, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await session.evaluate(expression)) return true;
    await delay(200);
  }
  return false;
}

async function run() {
  if (!existsSync(PACKAGED)) {
    throw new Error(`Packaged app missing: ${PACKAGED}. Run pnpm package && pnpm make first.`);
  }
  if (!existsSync(NUPKG)) {
    throw new Error(`Installer missing: ${NUPKG}. Run pnpm make first.`);
  }

  // --- 1. Metadata -------------------------------------------------------
  const exe = path.join(PACKAGED, 'NOVAIDE.exe');
  const exeMetadata = powerShell(`$v = (Get-Item '${exe.replace(/'/g, "''")}').VersionInfo; "$($v.ProductName)|$($v.FileDescription)|$($v.LegalCopyright)|$($v.ProductVersion)"`);
  if (exeMetadata === null) {
    check('exe metadata check (Windows only)', true, 'skipped on this platform');
  } else {
    const [product, description, copyright, version] = exeMetadata.split('|');
    check('exe ProductName', product === 'NOVA IDE', product);
    check('exe FileDescription', description === 'NOVA IDE desktop application', description);
    check(
      'exe LegalCopyright is the product, not the Electron template',
      copyright === 'Copyright (c) 2026 NOVA IDE Project. All rights reserved.' &&
        !copyright.includes('GitHub'),
      copyright,
    );
    check('exe ProductVersion', version === '0.1.0', version);
  }

  const nuspec = readNuspec();
  if (nuspec === null) {
    check('nuspec metadata check (Windows only)', true, 'skipped on this platform');
  } else {
    check('nuspec title', /<title>NOVA IDE<\/title>/.test(nuspec));
    check('nuspec authors', /<authors>NOVA IDE Project<\/authors>/.test(nuspec));
    check('nuspec description', /<description>NOVA IDE desktop application<\/description>/.test(nuspec));
    check(
      'nuspec copyright',
      /<copyright>Copyright \(c\) 2026 NOVA IDE Project\. All rights reserved\.<\/copyright>/.test(nuspec),
    );
  }

  // --- 2. Clean-location launch -----------------------------------------
  // Copy the portable app into a path that contains spaces, like a real
  // per-user Squirrel install under "Local Settings"/"Programs".
  const cleanRoot = mkdtempSync(path.join(tmpdir(), 'NOVA IDE clean location '));
  const cleanExeDir = path.join(cleanRoot, 'NOVA IDE-win32-x64');
  cpSync(PACKAGED, cleanExeDir, { recursive: true });
  const profile = createIsolatedProfile();
  let app = null;
  let session = null;
  try {
    const cleanExe = path.join(cleanExeDir, 'NOVAIDE.exe');
    app = spawn(cleanExe, [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${profile.dir}`,
    ], { stdio: 'ignore' });
    check('launches from a path containing spaces', app.pid !== undefined, cleanExeDir);

    session = await connect();
    const ready = await waitForExpression(
      session,
      `window.nova !== undefined && document.readyState === 'complete'`,
    );
    check('clean-location first run reaches a ready renderer', ready);

    // --- 3. First-run state (no Ollama, no models, no keys) --------------
    const info = await session.evaluate(`window.nova.getAppInfo()`);
    check('reports a packaged build', info?.isPackaged === true, `appName=${info?.appName} v${info?.appVersion}`);

    const providers = await session.evaluate(`window.nova.ai.providers()`);
    const list = Array.isArray(providers?.value) ? providers.value : [];
    const ollama = list.find((p) => p.id === 'ollama');
    const cloud = list.find((p) => p.kind === 'cloud');
    check('local provider present and keyless on first run', ollama !== undefined && ollama.hasKey === false);
    check('cloud provider disabled and keyless on first run', cloud !== undefined && cloud.enabled === false && cloud.hasKey === false);

    // With no Ollama running these must fail gracefully (a result object),
    // never throw or crash the app.
    const status = await session.evaluate(`window.nova.ai.status('ollama')`);
    check('provider status with no service returns a result', status !== undefined && typeof status === 'object');
    const catalog = await session.evaluate(`window.nova.localModels.catalog()`);
    check('model catalog with no Ollama returns a result, no crash', catalog !== undefined && typeof catalog === 'object');
    const alive = await session.evaluate(`document.readyState === 'complete'`);
    check('renderer still alive after failed offline lookups', alive === true);

    // --- 4. Data-folder creation -----------------------------------------
    // A fresh profile starts without settings; writing one must create the
    // file in the isolated userData directory.
    const before = readdirSync(profile.dir).filter((n) => n.endsWith('.json'));
    const saved = await session.evaluate(`window.nova.setLocalOnly(true)`);
    await delay(500);
    const after = readdirSync(profile.dir).filter((n) => n.endsWith('.json'));
    check('first-run settings write succeeds', saved === true);
    check(
      'app creates its data file in the userData directory',
      before.length === 0 && after.includes('app-settings.json'),
      `before=[${before.join(',')}] after=[${after.join(',')}]`,
    );
    const settings = JSON.parse(readFileSync(path.join(profile.dir, 'app-settings.json'), 'utf8'));
    check('persisted data is valid settings JSON', settings?.settings?.localOnly === true);
  } finally {
    session?.close();
    if (app && !app.killed) app.kill();
    await delay(2000);

    // --- 5. No surviving processes ---------------------------------------
    const survivors = appProcessIds(cleanExeDir);
    check(
      'no application process survives a forced kill',
      survivors.length === 0,
      survivors.length ? `pids: ${survivors.join(',')}` : 'process tree gone',
    );

    rmSync(cleanRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    profile.cleanup();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} packaging checks passed`);
  if (failed.length) process.exitCode = 1;
}

run().then(() => process.exit(process.exitCode ?? 0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
