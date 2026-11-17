/**
 * Tests for the read-aloud (spec §15.2, Milestone 8).
 *
 * The speech engine of the operating system is replaced by a fake, so no
 * sound is produced and no voice of the machine is touched. The
 * preparation of the text and the lifecycle of one speech are covered.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  MAX_SPEECH_CHARS,
  SpeechSpeaker,
  prepareSpeech,
  splitForSpeech,
  type SynthesisLike,
  type UtteranceLike,
  type VoiceLike,
} from '../../apps/desktop/src/renderer/features/voice/speech';

/** A fake utterance (the browser object is replaced). */
function fakeUtterance(text: string): UtteranceLike {
  return {
    text,
    rate: 1,
    voice: null,
    onend: null,
    onerror: null,
  };
}

/** A fake synthesis that records the utterances. */
function fakeSynthesis(voices: VoiceLike[] = []): {
  synthesis: SynthesisLike;
  spoken: UtteranceLike[];
  cancel: ReturnType<typeof vi.fn>;
} {
  const spoken: UtteranceLike[] = [];
  const cancel = vi.fn();
  return {
    synthesis: {
      speak: (utterance) => {
        spoken.push(utterance);
      },
      cancel,
      getVoices: () => voices,
    },
    spoken,
    cancel,
  };
}

describe('the text of the read-aloud', () => {
  it('removes a secret before it is spoken', () => {
    const text = prepareSpeech('The key is sk-abcdefghijkl and that is all.');
    expect(text).not.toContain('sk-abcdefghijkl');
    expect(text).toContain('[redacted]');
  });

  it('removes the value of an assignment', () => {
    const text = prepareSpeech('Set api_key = "super-secret-value" first.');
    expect(text).not.toContain('super-secret-value');
    expect(text).toContain('api_key');
  });

  it('skips a closed code block by default', () => {
    const text = prepareSpeech(
      'Look at this:\n```ts\nconst key = 1;\n```\nIt is simple.',
    );
    expect(text).toBe('Look at this: It is simple.');
  });

  it('skips a code block the model did not close', () => {
    const text = prepareSpeech('Before.\n```ts\nconst a = 1;');
    expect(text).toBe('Before.');
  });

  it('reads the code when the setting asks for it', () => {
    const text = prepareSpeech('Try:\n```ts\nconst a = 1;\n```\nDone.', {
      readCodeBlocks: true,
    });
    expect(text).toContain('const a = 1;');
  });

  it('skips inline code by default', () => {
    expect(prepareSpeech('Call `sendMessage()` now.')).toBe('Call now.');
  });

  it('reads inline code when the setting asks for it', () => {
    expect(
      prepareSpeech('Call `sendMessage()` now.', { readCodeBlocks: true }),
    ).toBe('Call sendMessage() now.');
  });

  it('speaks the text of a link, never its address', () => {
    const text = prepareSpeech('Read [the guide](https://evil.example/x) now.');
    expect(text).toBe('Read the guide now.');
    expect(text).not.toContain('evil.example');
  });

  it('drops an autolink', () => {
    expect(prepareSpeech('See <https://example.com/secret>.')).toBe('See.');
  });

  it('drops the Markdown markers', () => {
    expect(prepareSpeech('# Title\n\n- one\n- two\n\n> quote')).toBe(
      'Title one two quote',
    );
  });

  it('keeps underscores of an identifier', () => {
    expect(prepareSpeech('The variable max_length is used.')).toBe(
      'The variable max_length is used.',
    );
  });

  it('keeps the content of a table', () => {
    const text = prepareSpeech('| a | b |\n| --- | --- |\n| 1 | 2 |');
    expect(text).toContain('a');
    expect(text).toContain('1');
    expect(text).not.toContain('---');
  });

  it('returns nothing for an answer that is only code', () => {
    expect(prepareSpeech('```ts\nconst a = 1;\n```')).toBe('');
  });

  it('bounds the length of the spoken text', () => {
    expect(prepareSpeech('x'.repeat(MAX_SPEECH_CHARS + 100)).length).toBe(
      MAX_SPEECH_CHARS,
    );
  });

  it('honours a smaller limit', () => {
    expect(prepareSpeech('hello world', { maxChars: 5 })).toBe('hello');
  });
});

describe('the splitting of the speech', () => {
  it('returns nothing for an empty text', () => {
    expect(splitForSpeech('')).toEqual([]);
    expect(splitForSpeech('   ')).toEqual([]);
  });

  it('groups short sentences', () => {
    expect(splitForSpeech('One. Two. Three.')).toEqual(['One. Two. Three.']);
  });

  it('splits at a sentence boundary', () => {
    expect(splitForSpeech('One. Two.', 6)).toEqual(['One.', 'Two.']);
  });

  it('splits a long sentence at a space', () => {
    const chunks = splitForSpeech('aaaa bbbb cccc dddd', 10);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(10);
    }
    expect(chunks.join(' ')).toBe('aaaa bbbb cccc dddd');
  });

  it('never produces an empty piece', () => {
    const chunks = splitForSpeech('hello. world!', 5);
    expect(chunks.every((chunk) => chunk.length > 0)).toBe(true);
  });
});

describe('the speaker', () => {
  it('is unsupported without an engine', () => {
    const speaker = new SpeechSpeaker({ synthesis: null });
    expect(speaker.supported).toBe(false);
    expect(speaker.speak('hello')).toBe(false);
    expect(speaker.voices()).toEqual([]);
  });

  it('speaks the text in order', () => {
    const { synthesis, spoken } = fakeSynthesis();
    const speaker = new SpeechSpeaker({
      synthesis,
      createUtterance: fakeUtterance,
    });
    const long = `${'a'.repeat(500)}. ${'b'.repeat(500)}.`;
    expect(speaker.speak(long, {})).toBe(true);
    expect(spoken.length).toBe(1);
    expect(spoken[0]?.text.startsWith('a')).toBe(true);
    expect(speaker.speaking).toBe(true);
    spoken[0]?.onend?.();
    expect(spoken.length).toBe(2);
    expect(spoken[1]?.text.startsWith('b')).toBe(true);
    expect(speaker.speaking).toBe(true);
    spoken[1]?.onend?.();
    expect(speaker.speaking).toBe(false);
  });

  it('speaks a short answer as one utterance', () => {
    const { synthesis, spoken } = fakeSynthesis();
    const speaker = new SpeechSpeaker({
      synthesis,
      createUtterance: fakeUtterance,
    });
    expect(speaker.speak('One. Two.', {})).toBe(true);
    expect(spoken.map((utterance) => utterance.text)).toEqual(['One. Two.']);
  });

  it('reports the end once', () => {
    const { synthesis, spoken } = fakeSynthesis();
    const speaker = new SpeechSpeaker({
      synthesis,
      createUtterance: fakeUtterance,
    });
    const onEnd = vi.fn();
    speaker.speak('Hello.', {}, onEnd);
    spoken[0]?.onend?.();
    spoken[0]?.onend?.();
    expect(onEnd).toHaveBeenCalledOnce();
  });

  it('uses the voice of the settings and clamps the rate', () => {
    const { synthesis, spoken } = fakeSynthesis([
      { name: 'Default', lang: 'en-US' },
      { name: 'Chosen', lang: 'en-GB' },
    ]);
    const speaker = new SpeechSpeaker({
      synthesis,
      createUtterance: fakeUtterance,
    });
    speaker.speak('Hello.', { voice: 'Chosen', rate: 9 });
    expect(spoken[0]?.voice).toMatchObject({ name: 'Chosen' });
    expect(spoken[0]?.rate).toBe(2);
  });

  it('falls back to the default voice when the name is unknown', () => {
    const { synthesis, spoken } = fakeSynthesis([{ name: 'Default' }]);
    const speaker = new SpeechSpeaker({
      synthesis,
      createUtterance: fakeUtterance,
    });
    speaker.speak('Hello.', { voice: 'Missing', rate: 0.1 });
    expect(spoken[0]?.voice).toBeNull();
    expect(spoken[0]?.rate).toBe(0.5);
  });

  it('stops at once and ignores the late end of an old run', () => {
    const { synthesis, spoken, cancel } = fakeSynthesis();
    const speaker = new SpeechSpeaker({
      synthesis,
      createUtterance: fakeUtterance,
    });
    const first = vi.fn();
    speaker.speak('One. Two.', {}, first);
    const old = spoken[0];
    speaker.stop();
    expect(cancel).toHaveBeenCalled();
    expect(speaker.speaking).toBe(false);
    old?.onend?.();
    expect(first).not.toHaveBeenCalled();
  });

  it('a new speech replaces the old one', () => {
    const { synthesis, spoken } = fakeSynthesis();
    const speaker = new SpeechSpeaker({
      synthesis,
      createUtterance: fakeUtterance,
    });
    const first = vi.fn();
    speaker.speak('One.', {}, first);
    const old = spoken[0];
    speaker.speak('Two.', {});
    old?.onend?.();
    expect(first).not.toHaveBeenCalled();
    expect(spoken[spoken.length - 1]?.text).toBe('Two.');
  });

  it('finishes when the engine reports an error', () => {
    const { synthesis, spoken } = fakeSynthesis();
    const speaker = new SpeechSpeaker({
      synthesis,
      createUtterance: fakeUtterance,
    });
    const onEnd = vi.fn();
    speaker.speak('Hello.', {}, onEnd);
    spoken[0]?.onerror?.(new Error('boom'));
    expect(onEnd).toHaveBeenCalledOnce();
    expect(speaker.speaking).toBe(false);
  });

  it('finishes when the engine throws', () => {
    const synthesis: SynthesisLike = {
      speak: () => {
        throw new Error('no audio device');
      },
      cancel: () => undefined,
      getVoices: () => [],
    };
    const speaker = new SpeechSpeaker({
      synthesis,
      createUtterance: fakeUtterance,
    });
    const onEnd = vi.fn();
    expect(speaker.speak('Hello.', {}, onEnd)).toBe(true);
    expect(onEnd).toHaveBeenCalledOnce();
    expect(speaker.speaking).toBe(false);
  });

  it('does nothing for an empty text', () => {
    const { synthesis, spoken } = fakeSynthesis();
    const speaker = new SpeechSpeaker({
      synthesis,
      createUtterance: fakeUtterance,
    });
    expect(speaker.speak('   ')).toBe(true);
    expect(spoken).toEqual([]);
    expect(speaker.speaking).toBe(false);
  });

  it('survives an engine whose voices throw', () => {
    const synthesis: SynthesisLike = {
      speak: () => undefined,
      cancel: () => undefined,
      getVoices: () => {
        throw new Error('broken');
      },
    };
    const speaker = new SpeechSpeaker({
      synthesis,
      createUtterance: fakeUtterance,
    });
    expect(speaker.voices()).toEqual([]);
    expect(speaker.speak('Hello.')).toBe(true);
  });
});
