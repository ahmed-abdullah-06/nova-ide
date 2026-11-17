/**
 * Generates THIRD_PARTY_NOTICES.md from the installed dependency tree.
 *
 * No dependency is added: the script reads the real package.json and license
 * files under node_modules. Run after `pnpm install` / before packaging:
 *   node tools/release/generate-notices.mjs
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const OUTPUT = path.join(REPO, 'THIRD_PARTY_NOTICES.md');

const LICENSE_NAMES = [
  'LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENSE-MIT', 'LICENSE-APACHE',
  'COPYING', 'COPYING.txt', 'LICENSE.BSD',
];

/** Collects every installed package in the hoisted pnpm layout. */
function collect() {
  const packages = new Map();

  function walk(directory) {
    let entries;
    try {
      entries = readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const full = path.join(directory, entry.name);
      if (entry.name.startsWith('@')) {
        walk(full);
        continue;
      }
      const manifest = path.join(full, 'package.json');
      if (existsSync(manifest)) {
        try {
          const json = JSON.parse(readFileSync(manifest, 'utf8'));
          if (typeof json.name === 'string' && typeof json.version === 'string') {
            const key = `${json.name}@${json.version}`;
            if (!packages.has(key)) {
              const licenseFile = LICENSE_NAMES.map((name) => path.join(full, name))
                .find((candidate) => existsSync(candidate));
              packages.set(key, {
                name: json.name,
                version: json.version,
                license: json.license || (json.licenses || []).map((l) => l.type).join(' OR ') || 'UNKNOWN',
                licenseText: licenseFile ? readFileSync(licenseFile, 'utf8') : null,
                licenseFileName: licenseFile ? path.basename(licenseFile) : null,
              });
            }
          }
        } catch {
          // A malformed manifest is not a reason to stop generating notices.
        }
      }
      const nested = path.join(full, 'node_modules');
      if (existsSync(nested)) walk(nested);
    }
  }

  walk(path.join(REPO, 'node_modules'));
  return [...packages.values()].sort((a, b) =>
    a.name.localeCompare(b.name) || a.version.localeCompare(b.version));
}

const packages = collect();
const byLicense = new Map();
for (const item of packages) {
  const list = byLicense.get(item.license) ?? [];
  list.push(item);
  byLicense.set(item.license, list);
}

const lines = [
  '# Third-party notices',
  '',
  'Generated from the installed dependency tree of this repository by',
  '`node tools/release/generate-notices.mjs`. It lists every installed package,',
  'its version and the license identifier declared by that package. License',
  'texts below are copied from the actual files shipped in `node_modules`.',
  '',
  `Generated on ${new Date().toISOString().slice(0, 10)}. Total packages: ${packages.length}.`,
  '',
  '## Packages',
  '',
  '| Package | Version | Declared license |',
  '|---|---|---|',
  ...packages.map((p) => `| ${p.name} | ${p.version} | ${p.license.replace(/\|/g, '\\|')} |`),
  '',
  '## License texts',
  '',
];

for (const [license, items] of [...byLicense.entries()].sort()) {
  lines.push(`### ${license}`, '');
  const withText = items.find((item) => item.licenseText !== null);
  if (withText === undefined) {
    lines.push(
      `No license file was found in the installed packages declaring this license. ` +
      `Declared by: ${items.map((i) => `${i.name}@${i.version}`).join(', ')}.`,
      '',
    );
    continue;
  }
  lines.push(
    `Representative text from ${withText.name}@${withText.version} (${withText.licenseFileName}):`,
    '',
    '```text',
    withText.licenseText.trim(),
    '```',
    '',
  );
}

writeFileSync(OUTPUT, lines.join('\n'), 'utf8');
console.log(`Wrote ${OUTPUT} (${packages.length} packages, ${byLicense.size} license identifiers)`);
