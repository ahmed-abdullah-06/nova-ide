/**
 * Tests for the local speech recognition (spec §15.1, Milestone 8).
 *
 * The engine is a child process; the tests use a fake one, so no binary
 * is executed and no audio leaves the machine. The conversion, the
 * parsing, the settings and the decisions of the service are covered.
 */
import { EventEmitter } from 'node:events';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_AUDIO_BYTES,
  defaultVoiceSettings,
  type VoiceSettings,
} from '../../apps/desktop/src/shared/voice-types';
import {
  LocalSpeechEngine,
  EngineError,
  type EngineSpawn,
} from '../../apps/desktop/src/main/voice/localEngine';
import {
  buildEngineArgs,
  cleanTranscript,
} from '../../apps/desktop/src/main/voice/transcript';
import { encodeWav, WAV_HEADER_BYTES } from '../../apps/desktop/src/main/voice/wav';
import { sanitizeVoiceSettings } from '../../apps/desktop/src/main/voice/voiceSettings';
import { VoiceService } from '../../apps/desktop/src/main/voice/voiceService';
import type { VoiceSettingsStore } from '../../apps/desktop/src/main/voice/voiceSettings';
import { insertTranscript } from '../../apps/desktop/src/renderer/features/voice/composer';

/** A fake child process (no binary is started). */
class FakeChild extends EventEmitter {
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdin = Object.assign(new EventEmitter(), {
    end: vi.fn(),
    write: vi.fn(),
  });
  readonly kill = vi.fn(() => {
    this.emit('close', null);
  });
}

/** Starts the engine with a fake process. */
function engineWith(child: FakeChild): {
  engine: LocalSpeechEngine;
  spawn: ReturnType<typeof vi.fn>;
} {
  const spawn = vi.fn(() => child) as unknown as ReturnType<typeof vi.fn> &
    EngineSpawn;
  return { engine: new LocalSpeechEngine(spawn as EngineSpawn), spawn };
}

const MODEL = path.resolve('model.bin');

describe('the WAV container', () => {
  it('writes a canonical 16 kHz mono header', () => {
    const wav = encodeWav(new Int16Array(16000));
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(wav.subarray(8, 12).toString('ascii')).toBe('WAVE');
    expect(wav.subarray(12, 16).toString('ascii')).toBe('fmt ');
    expect(wav.subarray(36, 40).toString('ascii')).toBe('data');
    expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
    expect(wav.readUInt16LE(20)).toBe(1);
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16000);
    expect(wav.readUInt32LE(28)).toBe(32000);
    expect(wav.readUInt16LE(32)).toBe(2);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(32000);
    expect(wav.length).toBe(WAV_HEADER_BYTES + 32000);
  });

  it('keeps every sample', () => {
    const samples = Int16Array.from([0, 1, -1, 32767, -32768]);
    const wav = encodeWav(samples);
    for (let index = 0; index < samples.length; index += 1) {
      expect(wav.readInt16LE(WAV_HEADER_BYTES + index * 2)).toBe(
        samples[index],
      );
    }
  });

  it('writes an empty recording', () => {
    const wav = encodeWav(new Int16Array(0));
    expect(wav.length).toBe(WAV_HEADER_BYTES);
    expect(wav.readUInt32LE(40)).toBe(0);
  });
});

describe('the output of the engine', () => {
  it('removes the timestamps', () => {
    expect(
      cleanTranscript(
        '[00:00:00.000 --> 00:00:04.000]  Hello world\n' +
          '[00:00:04.000 --> 00:00:06.000]  This is a test.',
      ),
    ).toBe('Hello world This is a test.');
  });

  it('removes annotations and special tokens', () => {
    expect(
      cleanTranscript(
        '[BLANK_AUDIO]\n<|startoftranscript|> real text [Music]',
      ),
    ).toBe('real text');
  });

  it('removes terminal colours', () => {
    expect(cleanTranscript('\u001b[32mhello\u001b[0m')).toBe('hello');
  });

  it('keeps an arbitrary bracket (it may be code)', () => {
    expect(cleanTranscript('const a = [1, 2]')).toBe('const a = [1, 2]');
  });

  it('collapses whitespace', () => {
    expect(cleanTranscript('  a \n\n  b  ')).toBe('a b');
  });

  it('returns empty text for silence', () => {
    expect(cleanTranscript('\n\n[BLANK_AUDIO]\n')).toBe('');
  });

  it('bounds the length of the transcript', () => {
    expect(cleanTranscript('x'.repeat(9000)).length).toBe(8000);
  });
});

describe('the arguments of the engine', () => {
  it('replaces the model placeholder', () => {
    expect(
      buildEngineArgs(['-m', '{model}', '-f', '-'], MODEL),
    ).toEqual(['-m', MODEL, '-f', '-']);
  });

  it('appends the model when the template does not name it', () => {
    expect(buildEngineArgs(['--file', '-'], MODEL)).toEqual([
      '--file',
      '-',
      '-m',
      MODEL,
    ]);
  });

  it('does not change the template', () => {
    const template = ['-m', '{model}'];
    buildEngineArgs(template, MODEL);
    expect(template).toEqual(['-m', '{model}']);
  });
});

describe('the settings of the voice assistant', () => {
  it('uses the defaults for an empty value', () => {
    expect(sanitizeVoiceSettings(null)).toEqual(defaultVoiceSettings());
    expect(sanitizeVoiceSettings(undefined)).toEqual(defaultVoiceSettings());
    expect(sanitizeVoiceSettings(42)).toEqual(defaultVoiceSettings());
  });

  it('keeps a valid value', () => {
    const settings: VoiceSettings = {
      ...defaultVoiceSettings(),
      enabled: true,
      engine: 'local',
      rate: 1.5,
      enginePath: path.resolve('engine.exe'),
      modelPath: path.resolve('model.bin'),
    };
    expect(sanitizeVoiceSettings(settings)).toEqual(settings);
  });

  it('rejects an unknown engine', () => {
    expect(sanitizeVoiceSettings({ engine: 'google' }).engine).toBe('none');
  });

  it('clamps the rate and the length', () => {
    expect(sanitizeVoiceSettings({ rate: 9 }).rate).toBe(2);
    expect(sanitizeVoiceSettings({ rate: 0.1 }).rate).toBe(0.5);
    expect(sanitizeVoiceSettings({ maxRecordingSeconds: 100000 }).maxRecordingSeconds).toBe(120);
    expect(sanitizeVoiceSettings({ maxRecordingSeconds: 1 }).maxRecordingSeconds).toBe(5);
  });

  it('rejects arguments that are too long or not strings', () => {
    const defaults = defaultVoiceSettings().engineArgs;
    expect(sanitizeVoiceSettings({ engineArgs: ['x'.repeat(600)] }).engineArgs).toEqual(defaults);
    expect(sanitizeVoiceSettings({ engineArgs: ['ok', 42] }).engineArgs).toEqual(defaults);
  });

  it('never enables the assistant from a string', () => {
    expect(sanitizeVoiceSettings({ enabled: 'true' }).enabled).toBe(false);
  });
});

describe('the voice service', () => {
  const baseSettings = (): VoiceSettings => ({
    ...defaultVoiceSettings(),
    enabled: true,
    engine: 'local',
    enginePath: path.resolve('whisper-cli.exe'),
    modelPath: path.resolve('ggml-base.bin'),
  });

  function service(
    settings: VoiceSettings,
    engine: {
      running: boolean;
      transcribe: ReturnType<typeof vi.fn>;
      cancel: ReturnType<typeof vi.fn>;
    } = {
      running: false,
      transcribe: vi.fn(async () => 'hello world'),
      cancel: vi.fn(),
    },
    localOnly = false,
  ): { service: VoiceService; engine: typeof engine } {
    const store = {
      get: async () => settings,
      load: async () => settings,
      save: async () => settings,
    } as unknown as VoiceSettingsStore;
    return {
      service: new VoiceService({
        settings: store,
        isLocalOnly: () => localOnly,
        engine: engine as never,
        isFile: async () => true,
      }),
      engine,
    };
  }

  afterEach(() => {
    vi.useRealTimers();
  });

  it('refuses a switched off assistant', async () => {
    const { service: voice } = service({
      ...baseSettings(),
      enabled: false,
    });
    const outcome = await voice.transcribe(new Int16Array(16000));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('disabled');
    }
  });

  it('refuses a missing engine', async () => {
    const { service: voice } = service({ ...baseSettings(), engine: 'none' });
    const outcome = await voice.transcribe(new Int16Array(16000));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('no-engine');
    }
  });

  it('refuses the cloud engine in the local-only mode even when approved', async () => {
    const { service: voice } = service(
      { ...baseSettings(), engine: 'cloud' },
      { running: false, transcribe: vi.fn(), cancel: vi.fn() },
      true,
    );
    const outcome = await voice.transcribe(new Int16Array(16000), {
      cloudApproved: true,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('local-only');
    }
  });

  it('needs the approval of the user for each cloud recording', async () => {
    const { service: voice } = service({ ...baseSettings(), engine: 'cloud' });
    const refused = await voice.transcribe(new Int16Array(16000));
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe('not-approved');
      expect(refused.message).toContain('approval');
    }
    const approved = await voice.transcribe(new Int16Array(16000), {
      cloudApproved: true,
    });
    expect(approved.ok).toBe(false);
    if (!approved.ok) {
      expect(approved.code).toBe('disabled');
      expect(approved.message).toContain('not available');
    }
  });

  it('refuses a recording that is too short', async () => {
    const { service: voice } = service(baseSettings());
    const outcome = await voice.transcribe(new Int16Array(100));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('too-short');
    }
  });

  it('refuses a recording that is too large', async () => {
    const { service: voice } = service(baseSettings());
    const outcome = await voice.transcribe(
      new Int16Array(MAX_AUDIO_BYTES / 2 + 1),
    );
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('too-large');
    }
  });

  it('refuses a missing executable or model', async () => {
    const missingEngine = await service({
      ...baseSettings(),
      enginePath: '',
    }).service.transcribe(new Int16Array(16000));
    expect(missingEngine.ok).toBe(false);
    if (!missingEngine.ok) {
      expect(missingEngine.code).toBe('no-engine');
    }
    const missingModel = await service({
      ...baseSettings(),
      modelPath: '',
    }).service.transcribe(new Int16Array(16000));
    expect(missingModel.ok).toBe(false);
    if (!missingModel.ok) {
      expect(missingModel.code).toBe('no-model');
    }
  });

  it('refuses a second recognition', async () => {
    const { service: voice } = service(baseSettings(), {
      running: true,
      transcribe: vi.fn(),
      cancel: vi.fn(),
    });
    const outcome = await voice.transcribe(new Int16Array(16000));
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe('busy');
    }
  });

  it('returns the recognised text', async () => {
    const { service: voice, engine } = service(baseSettings());
    const outcome = await voice.transcribe(
      new Int16Array(16000),
      { truncated: true },
    );
    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.value.text).toBe('hello world');
      expect(outcome.value.seconds).toBe(1);
      expect(outcome.value.truncated).toBe(true);
    }
    expect(engine.transcribe).toHaveBeenCalledOnce();
    const wav = engine.transcribe.mock.calls[0]?.[0] as Buffer;
    expect(wav.subarray(0, 4).toString('ascii')).toBe('RIFF');
  });

  it('maps the failures of the engine to honest codes', async () => {
    const failing = (code: 'timeout' | 'cancelled' | 'failed') => ({
      running: false,
      transcribe: vi.fn(async () => {
        throw new EngineError('boom', code);
      }),
      cancel: vi.fn(),
    });
    for (const code of ['timeout', 'cancelled', 'failed'] as const) {
      const outcome = await service(baseSettings(), failing(code)).service.transcribe(
        new Int16Array(16000),
      );
      expect(outcome.ok).toBe(false);
      if (!outcome.ok) {
        expect(outcome.code).toBe(code);
      }
    }
  });
});

describe('the local engine process', () => {
  it('writes the audio to stdin and reads the text', async () => {
    const child = new FakeChild();
    const { engine, spawn } = engineWith(child);
    const pending = engine.transcribe(Buffer.from([1, 2, 3, 4]), {
      executable: 'engine',
      args: ['-m', 'model'],
    });
    child.stdout.emit('data', Buffer.from('[00:00:00.000 --> 00:00:01.000] hi'));
    child.emit('close', 0);
    await expect(pending).resolves.toBe('hi');
    expect(spawn).toHaveBeenCalledOnce();
    expect(spawn.mock.calls[0]?.[2]).toMatchObject({ shell: false });
    expect(child.stdin.end).toHaveBeenCalledOnce();
    expect(child.stdin.end.mock.calls[0]?.[0]).toEqual(
      Buffer.from([1, 2, 3, 4]),
    );
    expect(engine.running).toBe(false);
  });

  it('fails on a non-zero code with the error output', async () => {
    const child = new FakeChild();
    const { engine } = engineWith(child);
    const pending = engine.transcribe(Buffer.alloc(2), {
      executable: 'engine',
      args: [],
    });
    child.stderr.emit('data', Buffer.from('model not found'));
    child.emit('close', 2);
    await expect(pending).rejects.toMatchObject({
      code: 'failed',
      message: expect.stringContaining('model not found'),
    });
  });

  it('does not fail when the engine wrote text but exited non-zero', async () => {
    const child = new FakeChild();
    const { engine } = engineWith(child);
    const pending = engine.transcribe(Buffer.alloc(2), {
      executable: 'engine',
      args: [],
    });
    child.stdout.emit('data', Buffer.from('hello'));
    child.emit('close', 1);
    await expect(pending).resolves.toBe('hello');
  });

  it('stops an engine that takes too long', async () => {
    vi.useFakeTimers();
    const child = new FakeChild();
    const { engine } = engineWith(child);
    const pending = engine.transcribe(Buffer.alloc(2), {
      executable: 'engine',
      args: [],
      timeoutMs: 50,
    });
    vi.advanceTimersByTime(60);
    await expect(pending).rejects.toMatchObject({ code: 'timeout' });
    expect(child.kill).toHaveBeenCalled();
  });

  it('stops a cancelled engine', async () => {
    const child = new FakeChild();
    const { engine } = engineWith(child);
    const pending = engine.transcribe(Buffer.alloc(2), {
      executable: 'engine',
      args: [],
    });
    engine.cancel();
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('refuses a second process', async () => {
    const child = new FakeChild();
    const { engine } = engineWith(child);
    const first = engine.transcribe(Buffer.alloc(2), {
      executable: 'engine',
      args: [],
    });
    await expect(
      engine.transcribe(Buffer.alloc(2), { executable: 'engine', args: [] }),
    ).rejects.toMatchObject({ code: 'busy' });
    child.emit('close', 0);
    await first;
  });

  it('stops an engine that floods the output', async () => {
    const child = new FakeChild();
    const { engine } = engineWith(child);
    const pending = engine.transcribe(Buffer.alloc(2), {
      executable: 'engine',
      args: [],
    });
    child.stdout.emit('data', Buffer.alloc(70 * 1024));
    await expect(pending).rejects.toMatchObject({ code: 'failed' });
  });
});

describe('the composer', () => {
  it('inserts the text into an empty field', () => {
    expect(insertTranscript('', 'hello')).toBe('hello');
  });

  it('appends the text to existing input', () => {
    expect(insertTranscript('look at', 'this file')).toBe('look at this file');
  });

  it('adds no second space when the input already ends with one', () => {
    expect(insertTranscript('look at ', 'this')).toBe('look at this');
    expect(insertTranscript('line\n', 'next')).toBe('line\nnext');
  });

  it('ignores an empty transcript', () => {
    expect(insertTranscript('keep me', '   ')).toBe('keep me');
  });

  it('bounds the length of the field', () => {
    expect(insertTranscript('x'.repeat(19_999), 'end').length).toBe(20_000);
  });
});
