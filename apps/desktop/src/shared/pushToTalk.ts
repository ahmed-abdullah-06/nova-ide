/**
 * The push-to-talk key (spec §15.3, Milestone 8).
 *
 * The setting stores one key combination as text (`F8`,
 * `Control+Shift+V`). The helpers here parse it and match a keyboard
 * event against it; the parsing is pure, so a hand-edited settings file
 * cannot produce a binding that keeps the microphone open.
 *
 * The binding is only ever started by the key press of the user: a
 * recognition never starts from a timer, a model or an answer.
 */
import { MAX_PUSH_TO_TALK_CHARS } from './voice-types';

/** The default key (a function key, so typing never records). */
export const DEFAULT_PUSH_TO_TALK_KEY = 'F8';

/** The modifiers of the binding. */
export interface PushToTalkBinding {
  /** The `KeyboardEvent.code` (or the `key` of a single character). */
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

/** The part of a keyboard event the matcher needs (injected in tests). */
export interface KeyEventLike {
  code: string;
  key: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
}

/** The modifiers as they may appear in the settings. */
const MODIFIERS: Readonly<Record<string, 'ctrl' | 'alt' | 'shift' | 'meta'>> = {
  control: 'ctrl',
  ctrl: 'ctrl',
  alt: 'alt',
  option: 'alt',
  shift: 'shift',
  meta: 'meta',
  cmd: 'meta',
  command: 'meta',
};

/** True when a single key token is acceptable. */
function isKeyToken(token: string): boolean {
  return /^(?:F\d{1,2}|[A-Za-z0-9]|Arrow(?:Up|Down|Left|Right)|Space|Tab|Home|End|PageUp|PageDown|Insert|Delete|Escape|Backspace|Enter|Numpad\d)$/i.test(
    token,
  );
}

/**
 * Parses the stored key.
 *
 * @param value The text of the settings.
 * @returns The binding, or null when the text is not a valid key.
 */
export function parsePushToTalkKey(value: string): PushToTalkBinding | null {
  const text = value.trim();
  if (text.length === 0 || text.length > MAX_PUSH_TO_TALK_CHARS) {
    return null;
  }
  const parts = text.split('+').map((part) => part.trim());
  const key = parts.pop() ?? '';
  if (!isKeyToken(key)) {
    return null;
  }
  const binding: PushToTalkBinding = {
    key,
    ctrl: false,
    alt: false,
    shift: false,
    meta: false,
  };
  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (modifier === undefined) {
      return null;
    }
    if (binding[modifier]) {
      // The same modifier twice is a malformed binding.
      return null;
    }
    binding[modifier] = true;
  }
  return binding;
}

/** True when a keyboard event is the key of the binding. */
function isSameKey(event: KeyEventLike, key: string): boolean {
  if (event.code.toLowerCase() === key.toLowerCase()) {
    return true;
  }
  return event.key.toLowerCase() === key.toLowerCase();
}

/**
 * True when the event is exactly the stored binding.
 *
 * A modifier that the binding does not name must be up, so `F8` does not
 * fire on `Ctrl+F8`. A repeated key press is ignored: holding the key
 * records once, and the release is the stop.
 */
export function matchesPushToTalkKey(
  event: KeyEventLike,
  binding: PushToTalkBinding | null,
): boolean {
  if (binding === null) {
    return false;
  }
  if (event.repeat === true || event.isComposing === true) {
    return false;
  }
  if (
    event.ctrlKey !== binding.ctrl ||
    event.altKey !== binding.alt ||
    event.shiftKey !== binding.shift ||
    event.metaKey !== binding.meta
  ) {
    return false;
  }
  return isSameKey(event, binding.key);
}

/**
 * True when the release of the key ends the recording.
 *
 * The modifiers are not required on the release: the user may let go of
 * `Shift` before the key itself, and the recording must still stop.
 */
export function matchesPushToTalkRelease(
  event: KeyEventLike,
  binding: PushToTalkBinding | null,
): boolean {
  if (binding === null || event.repeat === true) {
    return false;
  }
  return isSameKey(event, binding.key);
}

/** The text of a binding (the inverse of `parsePushToTalkKey`). */
export function formatPushToTalkBinding(
  binding: Omit<PushToTalkBinding, 'key'> & { key: string },
): string {
  const parts: string[] = [];
  if (binding.ctrl) {
    parts.push('Control');
  }
  if (binding.alt) {
    parts.push('Alt');
  }
  if (binding.shift) {
    parts.push('Shift');
  }
  if (binding.meta) {
    parts.push('Meta');
  }
  parts.push(binding.key);
  return parts.join('+');
}

/**
 * The text of the key that was pressed (for the settings field).
 *
 * A modifier that is pressed alone produces null: the user is still
 * building the combination.
 */
export function describePushToTalkEvent(event: KeyEventLike): string | null {
  if (MODIFIERS[event.key.toLowerCase()] !== undefined) {
    return null;
  }
  const fromCode = parsePushToTalkKey(event.code) !== null;
  if (!fromCode && parsePushToTalkKey(event.key) === null) {
    return null;
  }
  const key = fromCode ? event.code : event.key;
  return formatPushToTalkBinding({
    key,
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: event.metaKey,
  });
}
