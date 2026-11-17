/**
 * The text of the composer (spec §15.1, Milestone 8).
 *
 * The recognised speech is only ever *inserted* into the input field. The
 * user reads it, edits it and sends it — there is no path from a
 * recognition to `send()`.
 */

/** The largest text the composer accepts from a transcript. */
export const MAX_COMPOSER_CHARS = 20_000;

/**
 * Appends a transcript to the current input.
 *
 * A space is added when the input does not end with whitespace, so two
 * recognitions do not run together. The result is bounded.
 *
 * @param input The text that is in the field.
 * @param transcript The recognised text.
 * @returns The new text of the field (never automatically sent).
 */
export function insertTranscript(
  input: string,
  transcript: string,
): string {
  const text = transcript.trim();
  if (text.length === 0) {
    return input;
  }
  const separator = input.length === 0 || /\s$/.test(input) ? '' : ' ';
  return `${input}${separator}${text}`.slice(0, MAX_COMPOSER_CHARS);
}
