/**
 * Tests for the redaction of secrets (spec §19.5).
 */
import { describe, expect, it } from 'vitest';
import { redact, redactError } from '../../apps/desktop/src/main/providers/redact';

describe('secret redaction', () => {
  it('removes a key of the common services', () => {
    expect(redact('the key is sk-abcdefgh12345678')).toBe(
      'the key is [redacted]',
    );
    expect(redact('sk-proj-abcdefgh12345678')).toBe('[redacted]');
  });

  it('removes an authorization header', () => {
    expect(redact('Authorization: Bearer abcdefgh12345678')).toBe(
      'Authorization: Bearer [redacted]',
    );
  });

  it('removes a key of a configuration', () => {
    expect(redact('api_key=abcdefgh123456')).toBe('api_key=[redacted]');
    expect(redact('"apiKey": "abcdefgh123456"')).toBe(
      '"apiKey": "[redacted]"',
    );
    expect(redact('token: abcdefgh123456')).toBe('token: [redacted]');
  });

  it('keeps a message without a secret', () => {
    expect(redact('the model answered in 42 ms')).toBe(
      'the model answered in 42 ms',
    );
  });

  it('redacts the message of an error', () => {
    expect(redactError(new Error('failed with sk-abcdefgh12345678'))).toBe(
      'failed with [redacted]',
    );
    expect(redactError('plain')).toBe('plain');
  });
});
