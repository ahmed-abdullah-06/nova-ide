/**
 * The URL policy of the providers (spec §10.3, §11.3).
 *
 * A provider URL is never trusted: the renderer may only change it
 * through an explicit, confirmed setting. A local provider must point at
 * the local machine — otherwise the "LOCAL" badge would be a lie and
 * project content would silently leave the computer.
 */

/** The default address of the local Ollama service. */
export const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434';

/**
 * True when the URL points at the local machine.
 *
 * Only the loopback range and `localhost` count as local.
 */
export function isLoopbackUrl(baseUrl: string): boolean {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return false;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false;
  }
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host === '::1') {
    return true;
  }
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * Validates a provider URL.
 *
 * @param baseUrl The URL to check.
 * @returns An error message, or null when the URL is acceptable.
 */
export function validateProviderUrl(baseUrl: string): string | null {
  if (baseUrl.trim().length === 0) {
    return 'The address of the provider is empty.';
  }
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return 'The address of the provider is not a valid URL.';
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'The address of the provider must use http or https.';
  }
  return null;
}

/**
 * Normalizes a base URL (no trailing slash).
 */
export function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.trim().replace(/\/+$/, '');
}
