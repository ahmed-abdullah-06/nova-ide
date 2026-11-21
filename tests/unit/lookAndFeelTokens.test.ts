/**
 * LF1 token regression: the Monaco theme mirror must stay in sync with the
 * CSS custom properties in tokens.css, otherwise the editor and workbench
 * drift apart visually. Also guards the compact-density target and the
 * "no vendor branding in user-facing source" constraint.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  A6_MONACO_THEME_IDS,
  A6_WORKBENCH_MIRROR,
  buildMonacoTheme,
  type A6Theme,
  type WorkbenchMirror,
} from '../../apps/desktop/src/renderer/features/editor/monacoTheme';

const root = fileURLToPath(new URL('../../', import.meta.url));
const tokensCss = readFileSync(
  `${root}/apps/desktop/src/renderer/styles/tokens.css`,
  'utf8',
);

const VAR_FOR_FIELD: Readonly<Record<keyof WorkbenchMirror, string>> = {
  editorBackground: '--surface-app',
  editorForeground: '--text',
  border: '--border',
  textMuted: '--text-muted',
  textFaint: '--text-faint',
  accent: '--accent',
  listHover: '--surface-hover',
  listActive: '--surface-active',
  surfaceInput: '--surface-input',
};

/** Extracts one variable's value from a theme block in tokens.css. */
function cssVar(block: string, name: string): string {
  const match = block.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  const value = match?.[1];
  if (value === undefined) {
    throw new Error(`missing ${name} in tokens.css theme block`);
  }
  return value.trim().toLowerCase();
}

function themeBlock(mode: A6Theme): string {
  const marker =
    mode === 'dark' ? ':root {' : ":root[data-theme='light'] {";
  const start = tokensCss.indexOf(marker);
  if (start < 0) {
    throw new Error(`missing ${mode} theme block in tokens.css`);
  }
  return tokensCss.slice(start, tokensCss.indexOf('\n}', start));
}

describe('look and feel: theme tokens (LF1)', () => {
  it('registers workbench-matched Monaco theme ids', () => {
    expect(A6_MONACO_THEME_IDS).toEqual({
      dark: 'a6-dark',
      light: 'a6-light',
    });
  });

  it.each<A6Theme>(['dark', 'light'])(
    'keeps the %s Monaco mirror identical to tokens.css',
    (mode) => {
      const block = themeBlock(mode);
      for (const [field, cssName] of Object.entries(VAR_FOR_FIELD)) {
        const key = field as keyof WorkbenchMirror;
        expect(A6_WORKBENCH_MIRROR[mode][key].toLowerCase(), cssName).toBe(
          cssVar(block, cssName),
        );
      }
    },
  );

  it.each<A6Theme>(['dark', 'light'])(
    'builds a complete %s Monaco theme with no stock theme ids',
    (mode) => {
      const theme = buildMonacoTheme(mode);
      expect(theme.base === 'vs-dark' || theme.base === 'vs').toBe(true);
      expect(theme.rules.length).toBeGreaterThan(0);
      expect(theme.colors?.['editor.background']).toBe(
        A6_WORKBENCH_MIRROR[mode].editorBackground,
      );
      expect(theme.colors?.['editor.foreground']).toBe(
        A6_WORKBENCH_MIRROR[mode].editorForeground,
      );
      expect(theme.colors?.['editorCursor.foreground']).toBe(
        A6_WORKBENCH_MIRROR[mode].accent,
      );
    },
  );

  it('uses the compact 28px tab height target', () => {
    expect(cssVar(themeBlock('dark'), '--tab-height')).toBe('28px');
  });

  it('does not mention vendor branding in user-facing renderer source', () => {
    const rendererRoot = `${root}/apps/desktop/src/renderer`;
    const banned = /visual studio code|vscode|vs code/i;
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((entry) => {
        const full = `${dir}/${entry}`;
        return statSync(full).isDirectory()
          ? walk(full)
          : /\.(tsx?|css)$/.test(entry)
            ? [full]
            : [];
      });
    for (const file of walk(rendererRoot)) {
      expect(banned.test(readFileSync(file, 'utf8')), file).toBe(false);
    }
  });
});
