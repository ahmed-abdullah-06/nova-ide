/**
 * Redaction of secrets in log messages (spec §19.5).
 *
 * A key must never reach a log file. The helpers here replace the
 * patterns that look like a secret before a message is written.
 */

/** The patterns that are replaced in a log message. */
const SECRET_PATTERNS: readonly RegExp[] = [
  // `sk-...`, `sk-proj-...` and similar keys of the common services.
  /\b(sk-[A-Za-z0-9_-]{8,})\b/g,
  // `api_key=...`, `token: ...`, `"key": "..."`. The value of an
  // authorization header is handled by the next pattern.
  /\b(api[_-]?key|apikey|access[_-]?token|token|authorization|secret|password)(["']?\s*[:=]\s*["']?)(?!(?:Bearer)\b)[^\s"',}]{6,}/gi,
  // `Bearer <token>` of an authorization header.
  /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{8,}/gi,
];

/** The text that replaces a secret. */
export const REDACTED = '[redacted]';

/**
 * Removes the secrets from a message.
 *
 * @param text The message that is written to the log.
 * @returns The message without the secrets.
 */
export function redact(text: string): string {
  let result = text;
  result = result.replace(SECRET_PATTERNS[0] as RegExp, REDACTED);
  result = result.replace(
    SECRET_PATTERNS[1] as RegExp,
    (_match, name: string, separator: string) =>
      `${name}${separator}${REDACTED}`,
  );
  result = result.replace(
    SECRET_PATTERNS[2] as RegExp,
    (_match, scheme: string) => `${scheme} ${REDACTED}`,
  );
  return result;
}

/**
 * Removes the secrets from an unknown error before it is logged.
 */
export function redactError(error: unknown): string {
  if (error instanceof Error) {
    return redact(error.message);
  }
  return redact(String(error));
}
