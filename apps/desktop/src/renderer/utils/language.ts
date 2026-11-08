/**
 * Language support for M1: the initial prioritised language list from the
 * specification (spec §8.1) plus filename → Monaco language detection.
 */

export interface LanguageOption {
  id: string;
  label: string;
}

/** Languages available in the M1 language selector and for detection. */
export const LANGUAGES: readonly LanguageOption[] = [
  { id: 'plaintext', label: 'Plain Text' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'typescript', label: 'TypeScript' },
  { id: 'html', label: 'HTML' },
  { id: 'css', label: 'CSS' },
  { id: 'json', label: 'JSON' },
  { id: 'python', label: 'Python' },
  { id: 'java', label: 'Java' },
  { id: 'c', label: 'C' },
  { id: 'cpp', label: 'C++' },
  { id: 'markdown', label: 'Markdown' },
  { id: 'sql', label: 'SQL' },
] as const;

const EXTENSION_TO_LANGUAGE: Readonly<Record<string, string>> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  html: 'html',
  htm: 'html',
  css: 'css',
  scss: 'css',
  less: 'css',
  json: 'json',
  py: 'python',
  java: 'java',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  md: 'markdown',
  markdown: 'markdown',
  sql: 'sql',
};

/** Detects the Monaco language id for a file name (used from Milestone 2 on). */
export function detectLanguage(fileName: string): string {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0 || dot === fileName.length - 1) {
    return 'plaintext';
  }
  const extension = fileName.slice(dot + 1).toLowerCase();
  return EXTENSION_TO_LANGUAGE[extension] ?? 'plaintext';
}

export function getLanguageLabel(languageId: string): string {
  return (
    LANGUAGES.find((language) => language.id === languageId)?.label ??
    languageId
  );
}
