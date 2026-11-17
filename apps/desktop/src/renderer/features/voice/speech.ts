/**
 * The read-aloud text (spec §15.2, Milestone 8).
 *
 * The answer of a model is Markdown; a speech engine needs plain text.
 * The preparation here is deliberately conservative:
 *
 *  - secrets are redacted before anything is spoken,
 *  - fenced and inline code is skipped by default (the user can switch it
 *    on),
 *  - a link is spoken as its text, never as its address,
 *  - identifiers with underscores survive: only real emphasis markers are
 *    removed,
 *  - the result is bounded, so a huge answer cannot exhaust the memory.
 *
 * Nothing here touches the network: the voice is the offline voice of the
 * operating system.
 */
import { redact } from '../../../shared/redact';

/** The options of the preparation. */
export interface PrepareSpeechOptions {
  /** True when the code blocks of the answer are read aloud too. */
  readCodeBlocks?: boolean;
  /** The maximum number of characters that are spoken. */
  maxChars?: number;
}

/** The default limit of the spoken text. */
export const MAX_SPEECH_CHARS = 20_000;

/**
 * Turns the Markdown of an answer into text that can be spoken.
 *
 * @param markdown The answer of the model (untrusted).
 * @param options The options of the settings.
 * @returns The plain text (possibly empty).
 */
export function prepareSpeech(
  markdown: string,
  options: PrepareSpeechOptions = {},
): string {
  const readCodeBlocks = options.readCodeBlocks === true;
  const maxChars = options.maxChars ?? MAX_SPEECH_CHARS;
  let text = redact(markdown);

  // Fenced code blocks.
  if (readCodeBlocks) {
    text = text.replace(/^```[^\n]*$/gm, '').replace(/```/g, '');
  } else {
    // A closed fence.
    text = text.replace(/^```[^\n]*\n[\s\S]*?^```[^\n]*$/gm, '\n');
    // A fence that the model did not close.
    text = text.replace(/^```[^\n]*\n[\s\S]*$/m, '\n');
  }

  // Inline code.
  text = text.replace(
    /`([^`]+)`/g,
    readCodeBlocks ? '$1' : ' ',
  );

  // Images and links: the text, never the address.
  text = text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<https?:\/\/[^>]*>/g, '');

  // Markup that has no sound.
  text = text
    .replace(/<[a-zA-Z/][^>]*>/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*\d+[.)]\s+/gm, '')
    .replace(/^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/^\s*([-*_])\1{2,}\s*$/gm, '');

  return text
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([.,!?;:])/g, '$1')
    .replace(/\s*\n\s*/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, maxChars);
}

/**
 * Splits the text into utterances that a speech engine handles well.
 *
 * A very long utterance is stopped by some engines; the text is split at
 * sentence boundaries first and at spaces when a sentence is too long.
 *
 * @param text The text that is spoken.
 * @param limit The maximum length of one utterance.
 * @returns The pieces (empty when there is nothing to say).
 */
export function splitForSpeech(text: string, limit = 800): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length === 0) {
    return [];
  }
  const sentences = normalized.split(/(?<=[.!?])\s+/);
  const chunks: string[] = [];
  let current = '';
  const push = (piece: string): void => {
    if (piece.length > 0) {
      chunks.push(piece);
    }
  };
  const flush = (): void => {
    push(current.trim());
    current = '';
  };
  for (const sentence of sentences) {
    if (sentence.length > limit) {
      flush();
      let rest = sentence;
      while (rest.length > limit) {
        const cut = rest.lastIndexOf(' ', limit);
        const at = cut > limit / 2 ? cut : limit;
        push(rest.slice(0, at).trim());
        rest = rest.slice(at);
      }
      current = rest;
      continue;
    }
    if (current.length === 0) {
      current = sentence;
    } else if (current.length + 1 + sentence.length <= limit) {
      current = `${current} ${sentence}`;
    } else {
      flush();
      current = sentence;
    }
  }
  flush();
  return chunks;
}

/** A voice as the speaker sees it. */
export interface VoiceLike {
  /** The name of the voice (the setting stores the name). */
  name: string;
  /** The language of the voice (for display). */
  lang?: string;
}

/** An utterance as the speaker sees it (injected in the tests). */
export interface UtteranceLike {
  text: string;
  rate: number;
  voice: unknown;
  onend: (() => void) | null;
  onerror: ((error: unknown) => void) | null;
}

/** The speech engine as the speaker sees it (injected in the tests). */
export interface SynthesisLike {
  speak(utterance: UtteranceLike): void;
  cancel(): void;
  getVoices(): readonly VoiceLike[];
}

/** The options of one speech. */
export interface SpeakOptions {
  /** The name of the voice (empty = the default of the system). */
  voice?: string;
  /** The speed (0.5 … 2). */
  rate?: number;
}

/** The engine and the factory (the defaults use the browser API). */
export interface SpeakerDeps {
  synthesis?: SynthesisLike | null;
  createUtterance?: (text: string) => UtteranceLike;
}

/** The default synthesis of the renderer (or null when unavailable). */
function defaultSynthesis(): SynthesisLike | null {
  const synthesis = globalThis.speechSynthesis;
  if (synthesis === undefined) {
    return null;
  }
  return {
    speak: (utterance) =>
      synthesis.speak(utterance as unknown as SpeechSynthesisUtterance),
    cancel: () => synthesis.cancel(),
    getVoices: () => synthesis.getVoices(),
  };
}

/** The default utterance factory. */
function defaultUtterance(text: string): UtteranceLike {
  const Constructor = globalThis.SpeechSynthesisUtterance;
  if (Constructor === undefined) {
    throw new Error('The speech synthesis is not available.');
  }
  return new Constructor(text) as unknown as UtteranceLike;
}

/**
 * Speaks the answers with the offline voices of the operating system.
 *
 * The speaker is not a singleton and holds no timers: `stop()` cancels the
 * engine at once, and every `speak()` invalidates the previous run, so a
 * late `onend` of an old utterance cannot start the next one.
 */
export class SpeechSpeaker {
  private readonly synthesis: SynthesisLike | null;
  private readonly createUtterance: (text: string) => UtteranceLike;
  private generation = 0;
  private active = false;

  constructor(deps: SpeakerDeps = {}) {
    this.synthesis =
      deps.synthesis !== undefined ? deps.synthesis : defaultSynthesis();
    this.createUtterance = deps.createUtterance ?? defaultUtterance;
  }

  /** True when the operating system offers a speech engine. */
  get supported(): boolean {
    return this.synthesis !== null;
  }

  /** True while a text is spoken. */
  get speaking(): boolean {
    return this.active;
  }

  /** The voices of the operating system. */
  voices(): VoiceLike[] {
    if (this.synthesis === null) {
      return [];
    }
    try {
      return [...this.synthesis.getVoices()];
    } catch {
      return [];
    }
  }

  /**
   * Speaks a text.
   *
   * @param text The text (already prepared and redacted).
   * @param options The voice and the speed.
   * @param onEnd Called when the last piece ended, failed or was stopped.
   * @returns False when the system has no speech engine.
   */
  speak(
    text: string,
    options: SpeakOptions = {},
    onEnd?: () => void,
  ): boolean {
    const synthesis = this.synthesis;
    if (synthesis === null) {
      return false;
    }
    this.stop();
    const chunks = splitForSpeech(text);
    if (chunks.length === 0) {
      return true;
    }
    const generation = ++this.generation;
    this.active = true;
    let done = false;
    const finish = (): void => {
      if (done || generation !== this.generation) {
        return;
      }
      done = true;
      this.active = false;
      onEnd?.();
    };
    const voice =
      options.voice !== undefined && options.voice.length > 0
        ? (this.voices().find((entry) => entry.name === options.voice) ?? null)
        : null;
    const rate = Math.min(2, Math.max(0.5, options.rate ?? 1));
    const next = (index: number): void => {
      if (generation !== this.generation) {
        return;
      }
      if (index >= chunks.length) {
        finish();
        return;
      }
      const utterance = this.createUtterance(chunks[index] as string);
      utterance.rate = rate;
      utterance.voice = voice;
      utterance.onend = () => next(index + 1);
      utterance.onerror = () => finish();
      try {
        synthesis.speak(utterance);
      } catch {
        finish();
      }
    };
    next(0);
    return true;
  }

  /** Stops the speech at once. */
  stop(): void {
    this.generation += 1;
    this.active = false;
    try {
      this.synthesis?.cancel();
    } catch {
      // A broken engine must not break the panel.
    }
  }
}
