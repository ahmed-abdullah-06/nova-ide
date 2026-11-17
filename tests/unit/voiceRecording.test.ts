/**
 * Tests for the microphone permission and the capture (spec §15.1, §19.1,
 * §19.2).
 *
 * The rules of the permission live in the main process, the conversion of
 * the samples lives in the renderer — both are tested here without a real
 * microphone.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  RecordingSessions,
  SESSION_TTL_MS,
} from '../../apps/desktop/src/main/voice/recording';
import {
  LinearResampler,
  MAX_RECORDING_SECONDS,
  MAX_SAMPLES,
  SPEECH_SAMPLE_RATE,
  describeMediaError,
  mediaErrorCode,
} from '../../apps/desktop/src/renderer/features/voice/audio';

const ORIGIN = 'file:///app/index.html';

describe('the recording sessions', () => {
  let sessions: RecordingSessions;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
    sessions = new RecordingSessions();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('grants the microphone only while a session is open', () => {
    expect(sessions.allow('media', ORIGIN, ['audio'], true)).toBe(false);
    const id = sessions.open();
    expect(sessions.isOpen(id)).toBe(true);
    expect(sessions.allow('media', ORIGIN, ['audio'], true)).toBe(true);
    sessions.close(id);
    expect(sessions.isOpen(id)).toBe(false);
    expect(sessions.allow('media', ORIGIN, ['audio'], true)).toBe(false);
  });

  it('generates an unguessable id', () => {
    const a = sessions.open();
    const b = sessions.open();
    expect(a).not.toBe(b);
    expect(a.startsWith('mic-')).toBe(true);
  });

  it('closes every session when the application quits', () => {
    sessions.open();
    sessions.open();
    expect(sessions.count).toBe(2);
    sessions.closeAll();
    expect(sessions.count).toBe(0);
    expect(sessions.hasOpenSession()).toBe(false);
  });

  it('never grants a camera', () => {
    sessions.open();
    expect(sessions.allow('media', ORIGIN, ['video'], true)).toBe(false);
    expect(sessions.allow('media', ORIGIN, ['audio', 'video'], true)).toBe(false);
  });

  it('never grants a request without a media type', () => {
    sessions.open();
    expect(sessions.allow('media', ORIGIN, [], true)).toBe(false);
    expect(sessions.allow('media', ORIGIN, undefined, true)).toBe(false);
  });

  it('never grants a permission other than media', () => {
    sessions.open();
    expect(sessions.allow('notifications', ORIGIN, ['audio'], true)).toBe(false);
    expect(sessions.allow('camera', ORIGIN, ['audio'], true)).toBe(false);
    expect(sessions.allow('clipboard-read', ORIGIN, ['audio'], true)).toBe(false);
  });

  it('never grants a subframe or another origin', () => {
    sessions.open();
    expect(sessions.allow('media', ORIGIN, ['audio'], false)).toBe(false);
    expect(sessions.allow('media', 'https://evil.example', ['audio'], true)).toBe(
      false,
    );
    expect(sessions.allow('media', undefined, ['audio'], true)).toBe(false);
  });

  it('expires a session that stayed open too long', () => {
    sessions.open();
    expect(sessions.hasOpenSession()).toBe(true);
    vi.advanceTimersByTime(SESSION_TTL_MS + 1);
    expect(sessions.hasOpenSession()).toBe(false);
    expect(sessions.allow('media', ORIGIN, ['audio'], true)).toBe(false);
  });

  it('keeps a session alive within its lifetime', () => {
    sessions.open();
    vi.advanceTimersByTime(SESSION_TTL_MS - 1);
    expect(sessions.allow('media', ORIGIN, ['audio'], true)).toBe(true);
  });

  it('ignores the close of an unknown session', () => {
    const id = sessions.open();
    sessions.close('mic-unknown');
    expect(sessions.isOpen(id)).toBe(true);
  });
});

describe('the conversion of the microphone samples', () => {
  it('converts 48 kHz to 16 kHz', () => {
    const resampler = new LinearResampler(48000);
    const input = new Float32Array(4800);
    for (let i = 0; i < input.length; i += 1) {
      input[i] = Math.sin(i / 10);
    }
    const output = resampler.push(input);
    // 4800 samples at 48 kHz are 1600 samples at 16 kHz (the last one
    // needs a second sample to interpolate).
    expect(output.length).toBeGreaterThanOrEqual(1599);
    expect(output.length).toBeLessThanOrEqual(1600);
    expect(output).toBeInstanceOf(Int16Array);
  });

  it('keeps the signal bounded to 16 bit', () => {
    const resampler = new LinearResampler(48000);
    const input = new Float32Array(480);
    input.fill(2);
    const output = resampler.push(input);
    expect(Math.max(...output)).toBeLessThanOrEqual(32767);
    const negative = new Float32Array(480);
    negative.fill(-2);
    expect(Math.min(...resampler.push(negative))).toBeGreaterThanOrEqual(-32768);
  });

  it('stays continuous across blocks', () => {
    const resampler = new LinearResampler(32000);
    const first = resampler.push(new Float32Array(320).fill(0.25));
    const second = resampler.push(new Float32Array(320).fill(0.25));
    expect(first.length + second.length).toBeGreaterThanOrEqual(319);
  });

  it('drops the samples it consumed', () => {
    const resampler = new LinearResampler(48000);
    // A longer input must not make the internal buffer grow without a
    // bound.
    for (let block = 0; block < 100; block += 1) {
      resampler.push(new Float32Array(4096).fill(0.1));
    }
    const internals = resampler as unknown as { pending: number[] };
    expect(internals.pending.length).toBeLessThan(64);
  });

  it('uses the rate the engines expect', () => {
    expect(SPEECH_SAMPLE_RATE).toBe(16000);
    expect(MAX_SAMPLES).toBe(SPEECH_SAMPLE_RATE * MAX_RECORDING_SECONDS);
    expect(MAX_RECORDING_SECONDS).toBe(60);
  });
});

describe('the messages of a failed microphone request', () => {
  it('names a denied permission', () => {
    const error = { name: 'NotAllowedError' };
    expect(mediaErrorCode(error)).toBe('denied');
    expect(describeMediaError(error)).toContain('not allowed');
  });

  it('names a missing device', () => {
    expect(mediaErrorCode({ name: 'NotFoundError' })).toBe('no-device');
    expect(describeMediaError({ name: 'NotFoundError' })).toContain(
      'No microphone',
    );
  });

  it('names a busy device', () => {
    expect(mediaErrorCode({ name: 'NotReadableError' })).toBe('busy');
    expect(describeMediaError({ name: 'NotReadableError' })).toContain('busy');
  });

  it('falls back to an honest message', () => {
    expect(mediaErrorCode({})).toBe('unknown');
    expect(mediaErrorCode(null)).toBe('unknown');
    expect(describeMediaError(undefined)).toBe(
      'The microphone could not be opened.',
    );
  });
});
