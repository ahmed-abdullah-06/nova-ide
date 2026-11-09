import { describe, expect, it } from 'vitest';
import { detectLanguage, getLanguageLabel, LANGUAGES } from '../../apps/desktop/src/renderer/utils/language';

describe('detectLanguage', () => {
  it('maps common source extensions to Monaco language ids', () => {
    expect(detectLanguage('index.ts')).toBe('typescript');
    expect(detectLanguage('App.tsx')).toBe('typescript');
    expect(detectLanguage('main.js')).toBe('javascript');
    expect(detectLanguage('styles.css')).toBe('css');
    expect(detectLanguage('page.html')).toBe('html');
    expect(detectLanguage('package.json')).toBe('json');
    expect(detectLanguage('script.py')).toBe('python');
    expect(detectLanguage('Main.java')).toBe('java');
    expect(detectLanguage('kernel.c')).toBe('c');
    expect(detectLanguage('engine.cpp')).toBe('cpp');
    expect(detectLanguage('README.md')).toBe('markdown');
    expect(detectLanguage('query.sql')).toBe('sql');
  });

  it('is case-insensitive for extensions', () => {
    expect(detectLanguage('MAIN.TS')).toBe('typescript');
  });

  it('falls back to plaintext', () => {
    expect(detectLanguage('noextension')).toBe('plaintext');
    expect(detectLanguage('archive.unknownext')).toBe('plaintext');
    expect(detectLanguage('.gitignore')).toBe('plaintext');
    expect(detectLanguage('trailing.')).toBe('plaintext');
  });
});

describe('language list', () => {
  it('covers the priority languages from the specification', () => {
    const ids = LANGUAGES.map((language) => language.id);
    for (const required of [
      'javascript',
      'typescript',
      'html',
      'css',
      'json',
      'python',
      'java',
      'c',
      'cpp',
      'markdown',
      'sql',
    ]) {
      expect(ids).toContain(required);
    }
  });

  it('has a display label for every language', () => {
    for (const language of LANGUAGES) {
      expect(getLanguageLabel(language.id)).toBe(language.label);
    }
    expect(getLanguageLabel('unknown-id')).toBe('unknown-id');
  });
});
