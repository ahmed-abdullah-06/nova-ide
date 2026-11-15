/**
 * Tests for the validation of a model name (spec §11.3, §19.2).
 *
 * The renderer only sends a name; the main process builds the request
 * itself. The tests prove that a name that looks like a URL, a path or
 * a shell fragment never reaches Ollama.
 */
import { describe, expect, it } from 'vitest';
import {
  isValidModelName,
  MAX_MODEL_NAME_LENGTH,
  validateModelName,
} from '../../apps/desktop/src/main/providers/localModels/modelNames';

describe('the validation of a model name', () => {
  it('accepts the names that Ollama uses', () => {
    for (const name of [
      'qwen2.5',
      'qwen2.5:7b',
      'llama3:8b-instruct-q4_0',
      'library/llama3',
      'library/llama3:8b',
      'my-model',
      'a',
      'gemma4',
    ]) {
      expect(validateModelName(name)).toBeNull();
      expect(isValidModelName(name)).toBe(true);
    }
  });

  it('refuses a URL', () => {
    for (const name of [
      'http://example.com/model',
      'https://registry.example.com/m',
      '//example.com/m',
    ]) {
      expect(validateModelName(name)).not.toBeNull();
    }
  });

  it('refuses a path', () => {
    for (const name of [
      '../../etc/passwd',
      '..\\..\\windows\\system32',
      'C:\\models\\evil',
      '/etc/passwd',
      'models/../../secret',
    ]) {
      expect(validateModelName(name)).not.toBeNull();
    }
  });

  it('refuses a shell fragment', () => {
    for (const name of [
      'model; rm -rf /',
      'model && curl example.com',
      'model | tee out',
      '$(whoami)',
      '`whoami`',
      'model\nrm',
      'model > out',
      'model & background',
    ]) {
      expect(validateModelName(name)).not.toBeNull();
    }
  });

  it('refuses an empty or a blank name', () => {
    expect(validateModelName('')).not.toBeNull();
    expect(validateModelName('   ')).not.toBeNull();
    expect(validateModelName(' model')).not.toBeNull();
    expect(validateModelName('model ')).not.toBeNull();
    expect(validateModelName(undefined)).not.toBeNull();
    expect(validateModelName(42)).not.toBeNull();
  });

  it('refuses a name that is too long', () => {
    expect(validateModelName('a'.repeat(MAX_MODEL_NAME_LENGTH))).toBeNull();
    expect(
      validateModelName('a'.repeat(MAX_MODEL_NAME_LENGTH + 1)),
    ).not.toBeNull();
  });

  it('refuses a name with more than one tag or namespace', () => {
    expect(validateModelName('a:b:c')).not.toBeNull();
    expect(validateModelName('a/b/c')).not.toBeNull();
    expect(validateModelName('a:')).not.toBeNull();
    expect(validateModelName(':b')).not.toBeNull();
    expect(validateModelName('a//b')).not.toBeNull();
  });

  it('refuses a control character', () => {
    expect(validateModelName('model\u0000')).not.toBeNull();
    expect(validateModelName('model\u007f')).not.toBeNull();
  });

  it('refuses a name with a strange character', () => {
    for (const name of ['mo*del', 'mo?del', 'mo"del', "mo'del", 'mo[del]']) {
      expect(validateModelName(name)).not.toBeNull();
    }
  });
});
