/**
 * Shared limits for reading text files (spec §21).
 *
 * These constants were introduced with the filesystem service in Milestone 2
 * and are reused by the search service so that both agree on what counts as
 * a readable text file.
 */

/** Largest file NOVA opens as text. */
export const MAX_TEXT_FILE_BYTES = 10 * 1024 * 1024;
/** Bytes inspected for NUL characters when detecting binary files. */
export const BINARY_SNIFF_BYTES = 8000;

/**
 * Detects binary content by looking for a NUL byte in the first
 * {@link BINARY_SNIFF_BYTES} bytes (the same heuristic the filesystem
 * service uses to refuse opening binary files).
 */
export function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}
