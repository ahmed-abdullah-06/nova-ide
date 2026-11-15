/**
 * The parser of the answers of the Ollama HTTP API (spec §11.3).
 *
 * The shapes come from the official API documentation of Ollama:
 *
 *  - `GET /api/tags` → `{ models: [{ name, model, modified_at, size,
 *    digest, details: { format, family, families, parameter_size,
 *    quantization_level } }] }`,
 *  - `GET /api/ps` → `{ models: [{ name, size, digest, details,
 *    expires_at, size_vram, context_length }] }`,
 *  - `POST /api/show` → `{ license, parameters, template, details,
 *    model_info, capabilities, modified_at }`.
 *
 * Every field is optional: an older version of Ollama answers with less
 * information, and a broken answer must never crash the application.
 * A missing field stays `undefined` — the panel then says "unknown".
 */
import type {
  LocalModelEntryDraft,
  ModelCapability,
} from '../../../shared/local-model-types';

/** The capability that Ollama reports for a model that can call tools. */
export const OLLAMA_TOOL_CAPABILITY = 'tools';
/** The capability that Ollama reports for a model that reads images. */
export const OLLAMA_VISION_CAPABILITY = 'vision';
/** The capability that Ollama reports for a model that can think. */
export const OLLAMA_THINKING_CAPABILITY = 'thinking';

/** One entry of `/api/tags` or `/api/ps`. */
interface OllamaModelEntry {
  name?: unknown;
  model?: unknown;
  modified_at?: unknown;
  size?: unknown;
  digest?: unknown;
  expires_at?: unknown;
  size_vram?: unknown;
  context_length?: unknown;
  details?: {
    format?: unknown;
    family?: unknown;
    families?: unknown;
    parameter_size?: unknown;
    quantization_level?: unknown;
  };
}

/** The answer of `/api/show`. */
interface OllamaShowEntry {
  license?: unknown;
  parameters?: unknown;
  template?: unknown;
  modified_at?: unknown;
  capabilities?: unknown;
  details?: {
    format?: unknown;
    family?: unknown;
    parameter_size?: unknown;
    quantization_level?: unknown;
  };
  model_info?: Record<string, unknown>;
}

/** Reads a number that the API reported (undefined when it is not one). */
function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Reads a text that the API reported (undefined when it is not one). */
function readText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** The models of a list answer (`/api/tags` or `/api/ps`). */
function readModels(payload: unknown): OllamaModelEntry[] {
  if (typeof payload !== 'object' || payload === null) {
    return [];
  }
  const models = (payload as { models?: unknown }).models;
  if (!Array.isArray(models)) {
    return [];
  }
  return models.filter(
    (entry): entry is OllamaModelEntry =>
      typeof entry === 'object' && entry !== null,
  );
}

/**
 * Parses the answer of `/api/tags`.
 *
 * @param payload The parsed JSON of the answer.
 * @returns The installed models (an entry without a name is skipped).
 */
export function parseInstalledModels(payload: unknown): LocalModelEntryDraft[] {
  const entries: LocalModelEntryDraft[] = [];
  for (const entry of readModels(payload)) {
    const id = readText(entry.name) ?? readText(entry.model);
    if (id === undefined) {
      // A model without a name cannot be selected or deleted.
      continue;
    }
    entries.push({
      id,
      name: id,
      sizeBytes: readNumber(entry.size),
      parameterSize: readText(entry.details?.parameter_size),
      quantization: readText(entry.details?.quantization_level),
      family: readText(entry.details?.family),
      format: readText(entry.details?.format),
      modifiedAt: readText(entry.modified_at),
      digest: readText(entry.digest),
      loaded: false,
    });
  }
  return entries;
}

/**
 * Parses the answer of `/api/ps`.
 *
 * @param payload The parsed JSON of the answer.
 * @returns The models that are loaded in the memory.
 */
export function parseRunningModels(payload: unknown): LocalModelEntryDraft[] {
  const entries: LocalModelEntryDraft[] = [];
  for (const entry of readModels(payload)) {
    const id = readText(entry.name) ?? readText(entry.model);
    if (id === undefined) {
      continue;
    }
    entries.push({
      id,
      name: id,
      sizeBytes: readNumber(entry.size),
      parameterSize: readText(entry.details?.parameter_size),
      quantization: readText(entry.details?.quantization_level),
      family: readText(entry.details?.family),
      format: readText(entry.details?.format),
      digest: readText(entry.digest),
      loaded: true,
      sizeVramBytes: readNumber(entry.size_vram),
      expiresAt: readText(entry.expires_at),
      contextLength: readNumber(entry.context_length),
    });
  }
  return entries;
}

/** The result of parsing the answer of `/api/show`. */
export interface ParsedModelDetails {
  license?: string;
  parameters?: string;
  modifiedAt?: string;
  family?: string;
  parameterSize?: string;
  quantization?: string;
  capabilities?: string[];
  capabilitiesKnown: boolean;
  supportsToolCalls: ModelCapability;
  supportsVision: ModelCapability;
  supportsThinking: ModelCapability;
  contextLength?: number;
}

/** The maximum length of the text of the parameters that is kept. */
const MAX_PARAMETERS_CHARS = 4000;

/**
 * Parses the answer of `/api/show`.
 *
 * @param payload The parsed JSON of the answer.
 * @returns The facts of the model (the capabilities stay unknown when
 *   Ollama did not report any).
 */
export function parseModelDetails(payload: unknown): ParsedModelDetails {
  const empty: ParsedModelDetails = {
    capabilitiesKnown: false,
    supportsToolCalls: undefined,
    supportsVision: undefined,
    supportsThinking: undefined,
  };
  if (typeof payload !== 'object' || payload === null) {
    return empty;
  }
  const entry = payload as OllamaShowEntry;

  let capabilities: string[] | undefined;
  if (Array.isArray(entry.capabilities)) {
    capabilities = entry.capabilities.filter(
      (value): value is string => typeof value === 'string',
    );
  }
  const capabilitiesKnown = capabilities !== undefined;

  const contextLength = readContextLength(entry.model_info);

  return {
    license: readText(entry.license),
    parameters: readText(entry.parameters)?.slice(0, MAX_PARAMETERS_CHARS),
    modifiedAt: readText(entry.modified_at),
    family: readText(entry.details?.family),
    parameterSize: readText(entry.details?.parameter_size),
    quantization: readText(entry.details?.quantization_level),
    capabilities,
    capabilitiesKnown,
    supportsToolCalls: readCapability(capabilities, OLLAMA_TOOL_CAPABILITY),
    supportsVision: readCapability(capabilities, OLLAMA_VISION_CAPABILITY),
    supportsThinking: readCapability(capabilities, OLLAMA_THINKING_CAPABILITY),
    contextLength,
  };
}

/**
 * Reads a capability of the capability list.
 *
 * `undefined` means that Ollama did not report any capability, `false`
 * means that Ollama answered and did not list it.
 */
function readCapability(
  capabilities: string[] | undefined,
  capability: string,
): ModelCapability {
  if (capabilities === undefined) {
    return undefined;
  }
  return capabilities.includes(capability);
}

/** Reads the context length out of the `model_info` of `/api/show`. */
function readContextLength(
  modelInfo: Record<string, unknown> | undefined,
): number | undefined {
  if (modelInfo === undefined) {
    return undefined;
  }
  for (const [key, value] of Object.entries(modelInfo)) {
    if (key.endsWith('.context_length')) {
      const length = readNumber(value);
      if (length !== undefined) {
        return length;
      }
    }
  }
  return undefined;
}
