/**
 * Milestone 10D — local release-readiness checklist.
 *
 * Verifies release HYGIENE (clean tree, no committed secrets/personal paths,
 * required files and artifacts present, metadata consistent) and prints the
 * owner's manual steps. It never pushes, tags, signs or publishes anything.
 *
 * Usage: node tools/release/checklist.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

function git(args) {
  try {
    return execFileSync('git', args, { cwd: REPO, encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function trackedFiles() {
  return git(['ls-files']).split(/\r?\n/).filter(Boolean);
}

// Patterns that must never appear in a tracked source file.
const SECRET_PATTERNS = [
  { name: 'OpenAI-style API key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { name: 'GitHub personal access token', re: /\bghp_[A-Za-z0-9]{20,}\b/ },
  { name: 'Google API key', re: /\bAIza[A-Za-z0-9_-]{20,}\b/ },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
];
const PERSONAL_PATH_PATTERNS = [
  { name: 'hard-coded Windows user path', re: /[A-Za-z]:\\Users\\[A-Za-z0-9._-]+\\/ },
  { name: 'hard-coded POSIX home path', re: /\/(?:home|Users)\/[A-Za-z0-9._-]+\// },
];
// Test fixtures legitimately contain fake secrets/paths to test redaction.
const ALLOWED_TEST_FILE = /^tests\//;

function scanTracked() {
  const findings = [];
  for (const file of trackedFiles()) {
    let content;
    try {
      if (statSync(path.join(REPO, file)).size > 2_000_000) continue;
      content = readFileSync(path.join(REPO, file), 'utf8');
    } catch {
      continue;
    }
    if (content.includes('\0')) continue; // binary
    for (const { name, re } of [...SECRET_PATTERNS, ...PERSONAL_PATH_PATTERNS]) {
      if (ALLOWED_TEST_FILE.test(file)) continue;
      const match = re.exec(content);
      if (match) {
        findings.push(`${file}: ${name} (${match[0].slice(0, 32)})`);
      }
    }
  }
  return findings;
}

function readJson(file) {
  return JSON.parse(readFileSync(path.join(REPO, file), 'utf8'));
}

function run() {
  console.log('A6 — local release-readiness checklist\n');

  // 1. Clean working tree.
  const dirty = git(['status', '--porcelain']);
  check('working tree is clean', dirty === '', dirty ? dirty.split(/\r?\n/)[0] : 'no uncommitted changes');

  // 2. No committed secrets or personal paths.
  const findings = scanTracked();
  check('no secrets or personal paths in tracked files', findings.length === 0, findings.slice(0, 5).join(' | '));

  // 3. Required source files.
  for (const file of ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'docs/PACKAGING.md', 'docs/PRIVACY.md', 'docs/development/PERFORMANCE.md']) {
    const exists = existsSync(path.join(REPO, file));
    const size = exists ? statSync(path.join(REPO, file)).size : 0;
    check(`required file ${file}`, exists && size > 100, `${size} bytes`);
  }

  // 4. Build artifacts exist (the release candidate was actually built).
  const artifacts = [
    'apps/desktop/out/A6-win32-x64/A6IDE.exe',
    'apps/desktop/out/make/squirrel.windows/x64/A6IDE-0.1.0-full.nupkg',
    'apps/desktop/out/make/squirrel.windows/x64/RELEASES',
    'apps/desktop/out/make/squirrel.windows/x64/A6-0.1.0 Setup.exe',
  ];
  for (const file of artifacts) {
    check(`artifact ${path.basename(file)}`, existsSync(path.join(REPO, file)));
  }

  // 5. Metadata consistency.
  const root = readJson('package.json');
  const desktop = readJson('apps/desktop/package.json');
  check(
    'product name is consistent',
    root.description?.startsWith('A6') &&
      desktop.description?.startsWith('A6') &&
      desktop.productName === 'A6',
    desktop.productName,
  );
  check('version is consistent', root.version === desktop.version, `${root.version} / ${desktop.version}`);
  check('app is private (npm publish blocked)', root.private === true && desktop.private === true);
  const forge = readFileSync(path.join(REPO, 'apps', 'desktop', 'forge.config.mts'), 'utf8');
  check('exe name + Squirrel id documented in Forge config', forge.includes("executableName: 'A6IDE'") && forge.includes("name: 'A6IDE'"));
  check('appCopyright is wired (LegalCopyright)' , forge.includes('appCopyright: PRODUCT_COPYRIGHT'));

  // 6. License decision is explicitly flagged to the owner.
  const license = readFileSync(path.join(REPO, 'LICENSE'), 'utf8');
  check('license has an owner-replace notice', /NOTE FOR THE OWNER/i.test(license));

  const failed = checks.filter((c) => !c.ok);
  console.log(`\nAutomated checks: ${checks.length - failed.length}/${checks.length} passed`);

  console.log(`
Manual steps that MUST be done by the owner before a public release
(this script does NOT do any of them, and no secrets belong in the repo):

  1. Decide and install the real license (replace the conservative LICENSE).
  2. Supply an HTTPS-hosted icon URL for the Squirrel nuspec iconUrl field.
  3. Obtain a code-signing certificate; sign Windows build and verify it.
     (macOS: also notarize with Apple credentials.)
  4. Perform a real Squirrel install -> uninstall smoke test on Windows.
  5. Smoke-test a fresh first run with no Ollama / models / API keys.
  6. Upgrade an existing "NOVA IDE" profile: confirm its settings, encrypted
     keys and conversations survive the rename to A6 (the isolated packaged
     check proves this in a throwaway profile; a real profile is never touched
     by automated verification).
  7. Review docs/RELEASE_CHECKLIST.md and docs/PACKAGING.md in full.
  8. Create the release, tag and upload artifacts through your own account.
     This repository's tooling never pushes, tags or publishes.

This script is local-only: it made no network calls and changed no files.
`);

  if (failed.length) process.exitCode = 1;
}

run();
