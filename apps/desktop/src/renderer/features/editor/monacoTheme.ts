/**
 * Monaco themes that follow the CSS workbench tokens in `styles/tokens.css`.
 *
 * Monaco needs concrete colour strings, so the values are mirrored here. The
 * mirror is deliberately small and is checked against tokens.css by
 * `tests/unit/lookAndFeelTokens.test.ts` to prevent drift.
 */
import type * as Monaco from 'monaco-editor';

export type A6Theme = 'dark' | 'light';

export const A6_MONACO_THEME_IDS: Readonly<Record<A6Theme, string>> = {
  dark: 'a6-dark',
  light: 'a6-light',
};

export interface WorkbenchMirror {
  /** `--surface-app` — editor background. */
  editorBackground: string;
  /** `--text` — primary foreground. */
  editorForeground: string;
  /** `--border`. */
  border: string;
  /** `--text-muted`. */
  textMuted: string;
  /** `--text-faint`. */
  textFaint: string;
  /** `--accent`. */
  accent: string;
  /** `--surface-hover`. */
  listHover: string;
  /** `--surface-active`. */
  listActive: string;
  /** `--surface-input`. */
  surfaceInput: string;
}

export const A6_WORKBENCH_MIRROR: Readonly<Record<A6Theme, WorkbenchMirror>> = {
  dark: {
    editorBackground: '#1f1f1f',
    editorForeground: '#cccccc',
    border: '#2b2b2b',
    textMuted: '#9d9d9d',
    textFaint: '#737373',
    accent: '#0078d4',
    listHover: '#2a2d2e',
    listActive: '#37373d',
    surfaceInput: '#313131',
  },
  light: {
    editorBackground: '#ffffff',
    editorForeground: '#1f1f1f',
    border: '#d4d4d4',
    textMuted: '#616161',
    textFaint: '#8b8b8b',
    accent: '#0078d4',
    listHover: '#e8e8e8',
    listActive: '#e4e6f1',
    surfaceInput: '#ffffff',
  },
};

interface SyntaxRule {
  token: string;
  foreground: string;
  fontStyle?: string;
}

const SYNTAX_RULES: Readonly<Record<A6Theme, readonly SyntaxRule[]>> = {
  dark: [
    { token: 'comment', foreground: '6A9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'C586C0' },
    { token: 'string', foreground: 'CE9178' },
    { token: 'number', foreground: 'B5CEA8' },
    { token: 'type', foreground: '4EC9B0' },
    { token: 'type.identifier', foreground: '4EC9B0' },
    { token: 'identifier.function', foreground: 'DCDCAA' },
    { token: 'delimiter', foreground: 'CCCCCC' },
  ],
  light: [
    { token: 'comment', foreground: '008000', fontStyle: 'italic' },
    { token: 'keyword', foreground: 'AF00DB' },
    { token: 'string', foreground: 'A31515' },
    { token: 'number', foreground: '098658' },
    { token: 'type', foreground: '267F99' },
    { token: 'type.identifier', foreground: '267F99' },
    { token: 'identifier.function', foreground: '795E26' },
    { token: 'delimiter', foreground: '1F1F1F' },
  ],
};

/** Builds one complete Monaco theme from the mirrored workbench values. */
export function buildMonacoTheme(
  mode: A6Theme,
): Monaco.editor.IStandaloneThemeData {
  const mirror = A6_WORKBENCH_MIRROR[mode];
  return {
    base: mode === 'dark' ? 'vs-dark' : 'vs',
    inherit: true,
    rules: SYNTAX_RULES[mode].map((rule) => ({ ...rule })),
    colors: {
      'focusBorder': mirror.accent,
      'editor.background': mirror.editorBackground,
      'editor.foreground': mirror.editorForeground,
      'editor.lineHighlightBackground': mirror.listHover,
      'editor.selectionBackground': mirror.listActive,
      'editor.inactiveSelectionBackground': mirror.listActive,
      'editorCursor.foreground': mirror.accent,
      'editorIndentGuide.background1': mirror.border,
      'editorIndentGuide.activeBackground1': mirror.textFaint,
      'editorWhitespace.foreground': mirror.border,
      'editorLineNumber.foreground': mirror.textFaint,
      'editorLineNumber.activeForeground': mirror.textMuted,
      'editorGutter.background': mirror.editorBackground,
      'editorBracketMatch.background': mirror.listActive,
      'editorBracketMatch.border': mirror.textFaint,
      'editorWidget.background': mirror.surfaceInput,
      'editorWidget.border': mirror.border,
      'editorSuggestWidget.background': mirror.surfaceInput,
      'editorSuggestWidget.border': mirror.border,
      'editorHoverWidget.background': mirror.surfaceInput,
      'editorHoverWidget.border': mirror.border,
      'input.background': mirror.surfaceInput,
      'input.border': mirror.border,
      'list.hoverBackground': mirror.listHover,
      'list.activeSelectionBackground': mirror.listActive,
      'minimap.background': mirror.editorBackground,
      'scrollbarSlider.background': `${mirror.textFaint}40`,
      'scrollbarSlider.hoverBackground': `${mirror.textMuted}70`,
      'scrollbarSlider.activeBackground': `${mirror.accent}90`,
    },
  };
}

let themesDefined = false;

/** Registers both themes once, before any editor calls `setTheme`. */
export function defineMonacoThemes(monaco: typeof Monaco): void {
  if (themesDefined) {
    return;
  }
  monaco.editor.defineTheme(
    A6_MONACO_THEME_IDS.dark,
    buildMonacoTheme('dark'),
  );
  monaco.editor.defineTheme(
    A6_MONACO_THEME_IDS.light,
    buildMonacoTheme('light'),
  );
  themesDefined = true;
}
