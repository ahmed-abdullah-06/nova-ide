/**
 * Tests for the voice settings and the push-to-talk key (spec §15.3,
 * Milestone 8).
 *
 * The key of the microphone is parsed from the settings and matched
 * against a keyboard event; the bindings are pure, so the tests need no
 * keyboard and no window.
 */
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PUSH_TO_TALK_KEY,
  describePushToTalkEvent,
  formatPushToTalkBinding,
  matchesPushToTalkKey,
  matchesPushToTalkRelease,
  parsePushToTalkKey,
  type KeyEventLike,
} from '../../apps/desktop/src/shared/pushToTalk';
import {
  defaultVoiceSettings,
  type VoiceSettings,
} from '../../apps/desktop/src/shared/voice-types';
import {
  sanitizeVoiceSettings,
  validateVoicePaths,
} from '../../apps/desktop/src/main/voice/voiceSettings';

/** One keyboard event with sane defaults. */
function keyEvent(patch: Partial<KeyEventLike>): KeyEventLike {
  return {
    code: '',
    key: '',
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...patch,
  };
}

describe('the push-to-talk key', () => {
  it('accepts a function key', () => {
    expect(parsePushToTalkKey('F8')).toEqual({
      key: 'F8',
      ctrl: false,
      alt: false,
      shift: false,
      meta: false,
    });
  });

  it('accepts a combination of modifiers', () => {
    expect(parsePushToTalkKey('Control+Shift+V')).toEqual({
      key: 'V',
      ctrl: true,
      alt: false,
      shift: true,
      meta: false,
    });
  });

  it('accepts the short names and the lower case', () => {
    expect(parsePushToTalkKey('ctrl+alt+f9')).toMatchObject({
      key: 'f9',
      ctrl: true,
      alt: true,
    });
    expect(parsePushToTalkKey('Cmd+K')).toMatchObject({ key: 'K', meta: true });
  });

  it('rejects an empty or malformed text', () => {
    expect(parsePushToTalkKey('')).toBeNull();
    expect(parsePushToTalkKey('   ')).toBeNull();
    expect(parsePushToTalkKey('Control+')).toBeNull();
    expect(parsePushToTalkKey('+V')).toBeNull();
    expect(parsePushToTalkKey('Control+Control+V')).toBeNull();
    expect(parsePushToTalkKey('Hyper+V')).toBeNull();
    expect(parsePushToTalkKey('Hello')).toBeNull();
    expect(parsePushToTalkKey('V'.repeat(80))).toBeNull();
  });

  it('matches exactly the binding', () => {
    const binding = parsePushToTalkKey('Control+Shift+V');
    expect(
      matchesPushToTalkKey(
        keyEvent({ code: 'KeyV', key: 'V', ctrlKey: true, shiftKey: true }),
        binding,
      ),
    ).toBe(true);
    // A modifier that the binding does not name must be up.
    expect(
      matchesPushToTalkKey(
        keyEvent({
          code: 'KeyV',
          key: 'V',
          ctrlKey: true,
          shiftKey: true,
          altKey: true,
        }),
        binding,
      ),
    ).toBe(false);
    expect(
      matchesPushToTalkKey(
        keyEvent({ code: 'KeyV', key: 'V', ctrlKey: true }),
        binding,
      ),
    ).toBe(false);
  });

  it('matches a single character by its key', () => {
    expect(
      matchesPushToTalkKey(keyEvent({ code: 'KeyV', key: 'V' }), parsePushToTalkKey('V')),
    ).toBe(true);
  });

  it('ignores a held key and a composing text', () => {
    const binding = parsePushToTalkKey('F8');
    expect(
      matchesPushToTalkKey(keyEvent({ code: 'F8', key: 'F8', repeat: true }), binding),
    ).toBe(false);
    expect(
      matchesPushToTalkKey(
        keyEvent({ code: 'F8', key: 'F8', isComposing: true }),
        binding,
      ),
    ).toBe(false);
  });

  it('has no binding when the setting is empty', () => {
    expect(matchesPushToTalkKey(keyEvent({ code: 'F8', key: 'F8' }), null)).toBe(
      false,
    );
  });

  it('stops on the release even when a modifier is already up', () => {
    const binding = parsePushToTalkKey('Control+Shift+V');
    expect(
      matchesPushToTalkRelease(keyEvent({ code: 'KeyV', key: 'V' }), binding),
    ).toBe(true);
    expect(
      matchesPushToTalkRelease(keyEvent({ code: 'KeyX', key: 'X' }), binding),
    ).toBe(false);
  });

  it('describes a pressed key for the settings field', () => {
    expect(
      describePushToTalkEvent(keyEvent({ code: 'F8', key: 'F8' })),
    ).toBe('F8');
    expect(
      describePushToTalkEvent(
        keyEvent({ code: 'KeyV', key: 'V', ctrlKey: true, shiftKey: true }),
      ),
    ).toBe('Control+Shift+V');
    // A modifier alone is not a binding yet.
    expect(
      describePushToTalkEvent(keyEvent({ code: 'ShiftLeft', key: 'Shift', shiftKey: true })),
    ).toBeNull();
    expect(
      describePushToTalkEvent(keyEvent({ code: 'Unidentified', key: 'Unidentified' })),
    ).toBeNull();
  });

  it('formats a binding back to the stored text', () => {
    expect(
      formatPushToTalkBinding({
        key: 'F9',
        ctrl: true,
        alt: false,
        shift: false,
        meta: true,
      }),
    ).toBe('Control+Meta+F9');
  });

  it('uses a function key by default', () => {
    expect(defaultVoiceSettings().pushToTalkKey).toBe('F8');
    expect(DEFAULT_PUSH_TO_TALK_KEY).toBe('F8');
    expect(parsePushToTalkKey(defaultVoiceSettings().pushToTalkKey)).not.toBeNull();
  });
});

describe('the voice settings', () => {
  it('keeps a valid key', () => {
    const settings = sanitizeVoiceSettings({ pushToTalkKey: 'Control+Shift+V' });
    expect(settings.pushToTalkKey).toBe('Control+Shift+V');
  });

  it('falls back for an invalid key', () => {
    expect(sanitizeVoiceSettings({ pushToTalkKey: 'nonsense!' }).pushToTalkKey).toBe(
      DEFAULT_PUSH_TO_TALK_KEY,
    );
    expect(
      sanitizeVoiceSettings({ pushToTalkKey: 'x'.repeat(100) }).pushToTalkKey,
    ).toBe(DEFAULT_PUSH_TO_TALK_KEY);
  });

  it('does not store an automatic reading flag', () => {
    const settings = sanitizeVoiceSettings({
      enabled: true,
      readAloud: true,
    }) as unknown as Record<string, unknown>;
    expect('readAloud' in settings).toBe(false);
  });

  it('accepts a path that is absolute and refuses a relative one', () => {
    const base = defaultVoiceSettings();
    const absolute: VoiceSettings = {
      ...base,
      enginePath: path.resolve('whisper-cli.exe'),
      modelPath: path.resolve('ggml-base.bin'),
    };
    expect(validateVoicePaths(absolute)).toBeNull();
    expect(validateVoicePaths(base)).toBeNull();
    expect(
      validateVoicePaths({ ...base, enginePath: 'whisper-cli.exe' }),
    ).toContain('absolute');
    expect(validateVoicePaths({ ...base, modelPath: 'models/base.bin' })).toContain(
      'absolute',
    );
  });
});
