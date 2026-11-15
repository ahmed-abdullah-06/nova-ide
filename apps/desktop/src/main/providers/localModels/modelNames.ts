/**
 * The validation of a model name (spec §11.3, §19.2).
 *
 * The renderer only ever sends the *name* of a model; the main process
 * builds the request itself and sends it to the configured Ollama
 * host. The name is nevertheless validated strictly, because it is the
 * only part of the request that the renderer controls:
 *
 *  - a name is never a URL, a path or a shell fragment,
 *  - it has a length limit and a fixed character set,
 *  - it is never used to build a file name or a command.
 *
 * The names of Ollama look like `qwen2.5:7b`, `library/llama3:8b` or
 * `my-model` — a namespace, a name and an optional tag.
 */

/** The maximum length of a model name. */
export const MAX_MODEL_NAME_LENGTH = 200;

/** One part of a model name (the namespace, the name or the tag). */
const SEGMENT = /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9_-])?$/;

/**
 * Checks a model name.
 *
 * @param name The name the renderer sent.
 * @returns An error message, or null when the name is acceptable.
 */
export function validateModelName(name: unknown): string | null {
  if (typeof name !== 'string') {
    return 'The model name must be a text.';
  }
  if (name.length === 0) {
    return 'The model name is empty.';
  }
  if (name.length > MAX_MODEL_NAME_LENGTH) {
    return `The model name is longer than ${MAX_MODEL_NAME_LENGTH} characters.`;
  }
  if (name.trim() !== name) {
    return 'The model name must not start or end with a space.';
  }
  // No control characters, no line breaks.
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(name)) {
    return 'The model name contains a control character.';
  }
  // A URL, a path or a shell fragment can never be a model name. The
  // character set below already rejects them; the explicit checks make
  // the reason of the refusal clear in the log and in the test.
  if (name.includes('://') || name.includes('\\')) {
    return 'The model name must not be an address or a path.';
  }
  if (/[;|&`$<>{}()[\]!?'"*\s]/.test(name)) {
    return 'The model name contains a character that is not allowed.';
  }
  if (name.includes('..')) {
    return 'The model name must not contain "..".';
  }

  const colon = name.indexOf(':');
  if (colon >= 0 && name.indexOf(':', colon + 1) >= 0) {
    return 'The model name contains more than one tag separator.';
  }
  const base = colon >= 0 ? name.slice(0, colon) : name;
  const tag = colon >= 0 ? name.slice(colon + 1) : null;

  if (base.length === 0) {
    return 'The model name is empty.';
  }
  const segments = base.split('/');
  if (segments.length > 2) {
    return 'The model name contains more than one namespace separator.';
  }
  for (const segment of segments) {
    if (segment.length === 0) {
      return 'The model name contains an empty part.';
    }
    if (!SEGMENT.test(segment)) {
      return `"${segment}" is not a valid part of a model name.`;
    }
  }
  if (tag !== null) {
    if (tag.length === 0) {
      return 'The tag of the model name is empty.';
    }
    if (!SEGMENT.test(tag)) {
      return `"${tag}" is not a valid tag of a model name.`;
    }
  }
  return null;
}

/** True when the model name is acceptable. */
export function isValidModelName(name: unknown): boolean {
  return validateModelName(name) === null;
}
