/**
 * The types of the local model management (spec §11.3, §2.1, §21).
 *
 * The file is shared by the main process (the model service), the
 * preload bridge and the renderer (the model management of the AI
 * panel). It must never import Node.js or Electron runtime APIs so it
 * stays usable in the sandboxed renderer.
 *
 * Every fact that the panel shows comes from the Ollama HTTP API or
 * from the operating system. A fact that the API does not report is
 * `undefined` — never a guess. The user interface says "unknown"
 * instead of pretending to know something.
 */

/**
 * The capabilities of a model, as they are reported by Ollama.
 *
 * `true` means that Ollama reported the capability, `false` means that
 * Ollama answered and did not list it, `undefined` means that Ollama
 * did not report any capability at all (the model is too old for the
 * endpoint). The application never claims a capability that was not
 * reported.
 */
export type ModelCapability = boolean | undefined;

/** One model that is installed on this machine. */
export interface LocalModelEntry {
  /** The id of the model (the name Ollama knows it under). */
  id: string;
  /** The name of the model. */
  name: string;
  /** The size of the model on the disk (bytes). */
  sizeBytes?: number;
  /** The parameter size (for example "7B"). */
  parameterSize?: string;
  /** The quantization (for example "Q4_K_M"). */
  quantization?: string;
  /** The family of the model (for example "llama"). */
  family?: string;
  /** The file format of the model (for example "gguf"). */
  format?: string;
  /** The moment the model was modified (ISO 8601). */
  modifiedAt?: string;
  /** The digest of the model (SHA 256). */
  digest?: string;
  /** True when the model is currently loaded in the memory. */
  loaded: boolean;
  /** The size of the model in the video memory (when Ollama reports it). */
  sizeVramBytes?: number;
  /** The moment the model is unloaded automatically (ISO 8601). */
  expiresAt?: string;
  /** The context length of the running model (when Ollama reports it). */
  contextLength?: number;
}

/**
 * One model of the API, before the fit was added.
 *
 * The parsers of Ollama do not know the machine, so they return the
 * facts of the API only; the service adds the fit afterwards.
 */
export type LocalModelEntryDraft = Omit<LocalModelEntry, 'fit' | 'fitNote'>;

/** The details of one model. */
export interface LocalModelDetails {
  /** The id of the model. */
  id: string;
  /** The name of the model. */
  name: string;
  /** The size of the model on the disk (bytes). */
  sizeBytes?: number;
  /** The parameter size (for example "7B"). */
  parameterSize?: string;
  /** The quantization (for example "Q4_K_M"). */
  quantization?: string;
  /** The family of the model (for example "llama"). */
  family?: string;
  /** The moment the model was modified (ISO 8601). */
  modifiedAt?: string;
  /** The license of the model (the text Ollama reports). */
  license?: string;
  /** The parameters of the model (the text Ollama reports, shortened). */
  parameters?: string;
  /** The capabilities Ollama reported for the model. */
  capabilities?: string[];
  /**
   * True when Ollama answered with a capability list.
   *
   * When it is false, nothing is known about the capabilities of the
   * model — the panel then says "unknown" instead of guessing.
   */
  capabilitiesKnown: boolean;
  /** True when Ollama reports the "tools" capability. */
  supportsToolCalls?: ModelCapability;
  /** True when Ollama reports the "vision" capability. */
  supportsVision?: ModelCapability;
  /** True when Ollama reports the "thinking" capability. */
  supportsThinking?: ModelCapability;
  /** The context length of the model (when Ollama reports it). */
  contextLength?: number;
}

/** The state of the local Ollama service. */
export interface LocalServiceState {
  /** True when the service answered. */
  available: boolean;
  /** The reason when it is not available. */
  reason?: string;
  /** The message for the user. */
  message?: string;
}

/** The catalog of the local models. */
export interface LocalModelCatalog {
  /** The models that are installed on this machine. */
  installed: LocalModelEntry[];
  /** The models that are currently loaded in the memory. */
  running: LocalModelEntry[];
  /** The state of the local Ollama service. */
  service: LocalServiceState;
  /**
   * True when more large models are loaded at the same time than the
   * application allows (spec §2.1: never load several large models).
   */
  tooManyLoaded: boolean;
  /** The number of large models that may be loaded at the same time. */
  maxConcurrentLoaded: number;
  /** True when the list was shortened (the cap of the service). */
  truncated: boolean;
}

/** The maximum number of models the service lists at once. */
export const MAX_LISTED_MODELS = 200;
/** The maximum length of a model name. */
export const MAX_MODEL_NAME_LENGTH = 200;
