/**
 * Corrupted settings recovery (Milestone 10B).
 *
 * Every JSON store follows the same rule: a file that cannot be parsed or
 * that does not have its expected top-level shape is renamed to a `.bak`
 * file, the application starts with safe defaults, and a redacted message
 * is written to the log. Nothing about the user's file content is logged.
 */
import { promises as fs } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { redactError } from '../../shared/redact';

export interface RecoveryResult<T> {
  value: T;
  /** True when a corrupt file was moved aside. */
  backedUp: boolean;
}

/**
 * Reads a JSON file, backs up a corrupt one, and returns a safe value.
 *
 * @param filePath Absolute path of the file.
 * @param expectedKey Top-level key that must exist, or `null` when the file
 * must contain an array.
 * @param sanitize Converts a validated parse result into the store's type.
 * @param fallback Value used when the file is missing or corrupt.
 * @param label Short, non-secret label for the log message.
 */
export async function readJsonWithBackup<T>(
  filePath: string,
  expectedKey: string | null,
  sanitize: (parsed: unknown) => T,
  fallback: T,
  label: string,
): Promise<RecoveryResult<T>> {
  let raw: string;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') {
      console.error(`[recovery] ${label} could not be read:`, redactError(error));
    }
    return { value: fallback, backedUp: false };
  }

  let parsed: unknown;
  let valid = true;
  try {
    parsed = JSON.parse(raw);
    if (expectedKey === null) {
      valid = Array.isArray(parsed);
    } else {
      valid =
        typeof parsed === 'object' &&
        parsed !== null &&
        expectedKey in (parsed as Record<string, unknown>);
    }
  } catch (error) {
    valid = false;
    console.error(`[recovery] ${label} is not valid JSON:`, redactError(error));
  }

  if (valid) {
    return { value: sanitize(parsed), backedUp: false };
  }

  // Keep the user's original bytes; a backup is always preferable to
  // silently deleting data. The backup name cannot collide with a real
  // store file.
  const backup = `${filePath}.corrupt-${Date.now()}-${randomUUID().slice(0, 6)}.bak`;
  try {
    await fs.rename(filePath, backup);
    console.error(`[recovery] ${label} was corrupt; a backup was kept`);
  } catch (error) {
    console.error(`[recovery] ${label} was corrupt; backup failed:`, redactError(error));
  }
  return { value: fallback, backedUp: true };
}
