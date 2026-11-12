/**
 * Tests for the URL policy of the providers (spec §10.3, §11.3).
 *
 * A local provider must point at the local machine — otherwise the
 * "LOCAL" badge would be a lie and project content would leave the
 * computer without the user noticing it.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_OLLAMA_URL,
  isLoopbackUrl,
  normalizeBaseUrl,
  validateProviderUrl,
} from '../../apps/desktop/src/main/providers/urlPolicy';

describe('provider url policy', () => {
  it('recognises the loopback addresses', () => {
    expect(isLoopbackUrl('http://127.0.0.1:11434')).toBe(true);
    expect(isLoopbackUrl('http://127.0.0.2:11434')).toBe(true);
    expect(isLoopbackUrl('http://localhost:11434')).toBe(true);
    expect(isLoopbackUrl('http://[::1]:11434')).toBe(true);
  });

  it('does not recognise a remote address as local', () => {
    expect(isLoopbackUrl('http://example.com')).toBe(false);
    expect(isLoopbackUrl('http://192.168.1.10:11434')).toBe(false);
    expect(isLoopbackUrl('http://10.0.0.5:11434')).toBe(false);
    expect(isLoopbackUrl('http://ollama.example.internal')).toBe(false);
  });

  it('does not recognise an invalid address as local', () => {
    expect(isLoopbackUrl('not a url')).toBe(false);
    expect(isLoopbackUrl('')).toBe(false);
    expect(isLoopbackUrl('file:///etc/passwd')).toBe(false);
  });

  it('rejects an address that is not http', () => {
    expect(validateProviderUrl('ftp://example.com')).toContain('http');
    expect(validateProviderUrl('file:///etc/passwd')).toContain('http');
  });

  it('rejects an empty or broken address', () => {
    expect(validateProviderUrl('')).toContain('empty');
    expect(validateProviderUrl('http://')).not.toBeNull();
  });

  it('accepts a normal address', () => {
    expect(validateProviderUrl('https://api.openai.com/v1')).toBeNull();
    expect(validateProviderUrl(DEFAULT_OLLAMA_URL)).toBeNull();
  });

  it('removes a trailing slash', () => {
    expect(normalizeBaseUrl('http://127.0.0.1:11434/')).toBe(
      'http://127.0.0.1:11434',
    );
    expect(normalizeBaseUrl('  http://127.0.0.1:11434//  ')).toBe(
      'http://127.0.0.1:11434',
    );
  });
});
