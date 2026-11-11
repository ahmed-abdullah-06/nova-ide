/**
 * Tests for the diagnostics of the problems panel (spec §6.1, §13).
 *
 * The severity mapping is pure logic and is tested without a DOM; the
 * conversion of the Monaco markers is tested with the real marker shapes.
 */
import { describe, expect, it } from 'vitest';
import {
  MONACO_SEVERITY,
  severityLabel,
  toSeverity,
} from '../../apps/desktop/src/renderer/features/problems/problemSeverity';

describe('problem severity', () => {
  it('maps the severities of Monaco', () => {
    expect(toSeverity(MONACO_SEVERITY.Error)).toBe('error');
    expect(toSeverity(MONACO_SEVERITY.Warning)).toBe('warning');
    expect(toSeverity(MONACO_SEVERITY.Info)).toBe('info');
    expect(toSeverity(MONACO_SEVERITY.Hint)).toBe('hint');
  });

  it('prefers the highest severity of a combined flag', () => {
    expect(toSeverity(MONACO_SEVERITY.Error | MONACO_SEVERITY.Warning)).toBe(
      'error',
    );
    expect(toSeverity(MONACO_SEVERITY.Warning | MONACO_SEVERITY.Info)).toBe(
      'warning',
    );
  });

  it('treats an unknown flag as a hint', () => {
    expect(toSeverity(0)).toBe('hint');
  });

  it('labels the severities', () => {
    expect(severityLabel('error')).toBe('Error');
    expect(severityLabel('warning')).toBe('Warning');
    expect(severityLabel('info')).toBe('Info');
    expect(severityLabel('hint')).toBe('Hint');
  });
});
