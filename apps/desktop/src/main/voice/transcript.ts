/**
 * The text that the local speech engine printed (spec §15.1).
 *
 * whisper.cpp prints a timestamped line per segment unless `-nt` was
 * passed. The parser accepts both forms, so a user who configured the
 * engine without the flag still gets clean text. The output is untrusted:
 * it is only ever placed in the composer, never executed and never sent
 * by itself.
 */
import { MAX_TRANSCRIPT_CHARS } from '../../shared/voice-types';

/** A timestamped segment prefix (`[00:00:00.000 --> 00:00:04.000]`). */
const TIMESTAMP_PREFIX = /\[\d{2}:\d{2}:\d{2}[.,]\d{3}\s*-->\s*[^\]]*\]/g;
/** A line that is only an annotation (`[BLANK_AUDIO]`, `[Music]`, …). */
const ANNOTATION_LINE = /^\s*[[(][^\])]*[\])]\s*$/;
/**
 * A known annotation inside a line (`[Music]`, `(applause)`, …).
 *
 * Only known words are removed: an arbitrary bracket is left alone, so a
 * recognised `const a = [1, 2]` is not damaged.
 */
const ANNOTATION =
  /[[(]\s*(?:blank_audio|music|applause|laughter|sighs|coughs|no speech|inaudible|silence)\s*[\])]/gi;
/** A special token of the model (`<|startoftranscript|>`). */
const SPECIAL_TOKEN = /<\|[^|]*\|>/g;
/** Terminal colour codes. */
const ANSI = /\u001b\[[0-9;]*m/g;

/**
 * Turns the output of an engine into the text the user sees.
 *
 * @param raw The standard output of the engine.
 * @returns The clean text (bounded in length).
 */
export function cleanTranscript(raw: string): string {
  const withoutAnsi = raw.replace(ANSI, '');
  const lines = withoutAnsi
    .replace(SPECIAL_TOKEN, '')
    .replace(TIMESTAMP_PREFIX, '')
    .replace(ANNOTATION, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !ANNOTATION_LINE.test(line));
  const text = lines.join(' ').replace(/\s+/g, ' ').trim();
  return text.slice(0, MAX_TRANSCRIPT_CHARS);
}

/**
 * The arguments of the local engine.
 *
 * `{model}` in the configured arguments is replaced with the path of the
 * model. When the template does not mention the model, `-m <path>` is
 * appended — the engine always receives a model.
 *
 * @param template The arguments from the settings.
 * @param modelPath The absolute path of the model file.
 * @returns The arguments of the process.
 */
export function buildEngineArgs(
  template: readonly string[],
  modelPath: string,
): string[] {
  const mentionsModel = template.some((argument) =>
    argument.includes('{model}'),
  );
  const args = template.map((argument) =>
    argument.split('{model}').join(modelPath),
  );
  return mentionsModel ? args : [...args, '-m', modelPath];
}
