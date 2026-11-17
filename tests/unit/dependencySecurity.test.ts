/**
 * Dependency security regression test (Milestone 10A).
 *
 * `monaco-editor@0.57.0` pins `dompurify@3.4.15`, which is affected by the
 * high/critical advisories GHSA-cg2g-xh64-v4q7 and GHSA-mrv2-3pqr-j5jr.
 * The patched release is >=3.4.17, pinned via `pnpm-workspace.yaml`
 * `overrides`. This test fails if that override is ever dropped or weakened.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../../', import.meta.url));

function versionParts(version: string): number[] {
  return version.split('.').map((part) => Number.parseInt(part, 10) || 0);
}

describe('renderer dependency security (10A)', () => {
  it('uses a DOMPurify release with the shipped advisories patched', () => {
    const pkgPath = `${root}/node_modules/dompurify/package.json`;
    const installed = (JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string }).version;
    const [major = 0, minor = 0, patch = 0] = versionParts(installed);
    const patched =
      major > 3 ||
      (major === 3 && minor > 4) ||
      (major === 3 && minor === 4 && patch >= 17);
    expect(patched).toBe(true);
  });

  it('keeps the override declaration in the workspace config', () => {
    const workspace = readFileSync(`${root}/pnpm-workspace.yaml`, 'utf8');
    expect(workspace).toMatch(/overrides:\s*\n\s+dompurify:\s*3\.4\.18/);
  });
});
