/**
 * Redaction of secrets in log messages (spec §19.5).
 *
 * The implementation is shared with the renderer (the read-aloud feature
 * must redact too), so this module only re-exports it. The import path of
 * the main process stays the same.
 */
export { REDACTED, redact, redactError } from '../../shared/redact';
