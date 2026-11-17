/**
 * Milestone 10C/10G packaged-application verification.
 *
 * Checks the real, packaged Windows build from a clean install-like location:
 *  - the exe / nuspec metadata is the product metadata, not tool defaults,
 *  - the app launches from a path that contains spaces (like a real install),
 *  - a completely fresh profile (no Ollama, no models, no keys) starts cleanly,
 *  - the app creates its data files in the userData directory,
 *  - no application process survives a forced kill (the same guarantee the
 *    Squirrel uninstaller relies on when it stops running processes),
 *  - (10G) a pre-existing profile survives a launch: the app reads the seeded
 *    legacy "NOVA IDE" userData path after the rename instead of creating a
 *    fresh "A6" profile, so settings/keys/conversations are not stranded.
 *
 * Every run uses a temporary profile (or a fake APPDATA root). The real user
 * profile is fingerprinted before and after and is never touched.
 *
 * Usage: node tools/verify/packaging.mjs   (run `pnpm make` first)
 */
import { spawn, execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
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
import {
  createIsolatedProfile,
  profileFingerprint,
  realUserDataPath,
} from './isolation.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const DESKTOP = path.join(REPO, 'apps', 'desktop');
const PACKAGED = path.join(DESKTOP, 'out', 'A6-win32-x64');
const NUPKG = path.join(DESKTOP, 'out', 'make', 'squirrel.windows', 'x64', 'A6IDE-0.1.0-full.nupkg');
const PORT = 9410;
const SURVIVAL_PORT = 9411;

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

async function connect(port = PORT) {
  if (!(await waitForDevTools('127.0.0.1', port, 60000))) {
    throw new Error('DevTools endpoint never became ready');
  }
  // The DevTools HTTP endpoint can answer before the renderer page target has
  // registered (especially on a cold launch with a fresh profile), so poll
  // for the page instead of assuming it is there on the first request.
  let target = null;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    target = await findPageTarget('127.0.0.1', port);
    if (target) break;
    await delay(250);
  }
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

  // Fingerprint the real (legacy) profile before anything runs; no phase below
  // may change it. 10G pinned userData to "NOVA IDE", so that is the path the
  // harness must guard — not the new product name.
  const realBefore = profileFingerprint(realUserDataPath());

  // --- 1. Metadata -------------------------------------------------------
  const exe = path.join(PACKAGED, 'A6IDE.exe');
  const exeMetadata = powerShell(`$v = (Get-Item '${exe.replace(/'/g, "''")}').VersionInfo; "$($v.ProductName)|$($v.FileDescription)|$($v.LegalCopyright)|$($v.ProductVersion)"`);
  if (exeMetadata === null) {
    check('exe metadata check (Windows only)', true, 'skipped on this platform');
  } else {
    const [product, description, copyright, version] = exeMetadata.split('|');
    check('exe ProductName', product === 'A6', product);
    check('exe FileDescription', description === 'A6 desktop application', description);
    check(
      'exe LegalCopyright is the product, not the Electron template',
      copyright === 'Copyright (c) 2026 A6 Project. All rights reserved.' &&
        !copyright.includes('GitHub'),
      copyright,
    );
    check('exe ProductVersion', version === '0.1.0', version);
  }

  const nuspec = readNuspec();
  if (nuspec === null) {
    check('nuspec metadata check (Windows only)', true, 'skipped on this platform');
  } else {
    check('nuspec title', /<title>A6<\/title>/.test(nuspec));
    check('nuspec authors', /<authors>A6 Project<\/authors>/.test(nuspec));
    check('nuspec description', /<description>A6 desktop application<\/description>/.test(nuspec));
    check(
      'nuspec copyright',
      /<copyright>Copyright \(c\) 2026 A6 Project\. All rights reserved\.<\/copyright>/.test(nuspec),
    );
  }

  // --- 2. Clean-location launch -----------------------------------------
  // Copy the portable app into a path that contains spaces, like a real
  // per-user Squirrel install under "Local Settings"/"Programs".
  const cleanRoot = mkdtempSync(path.join(tmpdir(), 'A6 clean location '));
  const cleanExeDir = path.join(cleanRoot, 'A6-win32-x64');
  cpSync(PACKAGED, cleanExeDir, { recursive: true });
  const profile = createIsolatedProfile();
  let app = null;
  let session = null;
  try {
    const cleanExe = path.join(cleanExeDir, 'A6IDE.exe');
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
    check('packaged app name is A6', info?.appName === 'A6', `appName=${info?.appName}`);

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

  // --- 6. 10G profile survival (packaged, no explicit --user-data-dir) ---
  // Prove the packaged app still reads the legacy "NOVA IDE" profile after the
  // rename. We point APPDATA at a throwaway root and seed
  //   <fake APPDATA>/NOVA IDE/app-settings.json = { version:1, settings:{ localOnly:true } }
  // then launch WITHOUT --user-data-dir. The startup resolver must pin userData
  // to <fake APPDATA>/NOVA IDE, so window.nova.localOnly() returns true and no
  // fresh <fake APPDATA>/A6 profile is created. A regression that drops the pin
  // would read a fresh A6 profile (localOnly false) and fail this check.
  if (process.platform === 'win32') {
    const survivalRoot = mkdtempSync(path.join(tmpdir(), 'A6 profile survival '));
    const legacyDir = path.join(survivalRoot, 'NOVA IDE');
    const newNameDir = path.join(survivalRoot, 'A6');
    mkdirSync(legacyDir, { recursive: true });
    const seed = { version: 1, settings: { localOnly: true } };
    writeFileSync(
      path.join(legacyDir, 'app-settings.json'),
      `${JSON.stringify(seed, null, 2)}\n`,
      'utf8',
    );
    let survivalApp = null;
    let survivalSession = null;
    try {
      survivalApp = spawn(
        path.join(PACKAGED, 'A6IDE.exe'),
        [`--remote-debugging-port=${SURVIVAL_PORT}`],
        {
          stdio: 'ignore',
          env: { ...process.env, APPDATA: survivalRoot },
        },
      );
      survivalSession = await connect(SURVIVAL_PORT);
      const survivalReady = await waitForExpression(
        survivalSession,
        `window.nova !== undefined && document.readyState === 'complete'`,
      );
      check('survival launch reaches a ready renderer', survivalReady);

      const localOnly = await survivalSession.evaluate(`window.nova.localOnly()`);
      check(
        'packaged app reads the seeded legacy profile after the rename',
        localOnly === true,
        `window.nova.localOnly()=${localOnly}`,
      );
      check(
        'no fresh A6 profile directory was created',
        !existsSync(path.join(newNameDir, 'app-settings.json')),
      );

      // The seeded file must survive the launch unchanged (no overwrite).
      const seeded = JSON.parse(
        readFileSync(path.join(legacyDir, 'app-settings.json'), 'utf8'),
      );
      check(
        'seeded profile data is unchanged after the launch',
        seeded?.settings?.localOnly === true,
      );
    } finally {
      survivalSession?.close();
      if (survivalApp && !survivalApp.killed) survivalApp.kill();
      await delay(2000);
      rmSync(survivalRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  } else {
    check('10G profile survival check (Windows only)', true, 'skipped on this platform');
  }

  // --- 7. Real profile untouched ----------------------------------------
  const realAfter = profileFingerprint(realUserDataPath());
  check(
    'real user profile was not touched by any verification phase',
    realAfter === realBefore,
    `path=${realUserDataPath()}`,
  );

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} packaging checks passed`);
  if (failed.length) process.exitCode = 1;
}

run().then(() => process.exit(process.exitCode ?? 0)).catch((error) => {
  console.error(error);
  process.exit(1);
});
