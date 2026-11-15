/**
 * The facts about the machine (spec §2.1, §21).
 *
 * The main process reads the real facts of the machine — the memory,
 * the processors and the free space of the drive that holds the models
 * of Ollama. Nothing is assumed: there is no GPU in the facts, so the
 * application never promises the speed of a graphics card it cannot
 * see (spec §2.1: "Do not assume the computer has a dedicated NVIDIA
 * GPU").
 *
 * The fit of a model is only an estimate — it compares the size of the
 * model with the free memory and never blocks the user.
 */
import { statfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type {
  HardwareFacts,
  ModelFit,
} from '../../../shared/local-model-types';

/**
 * The factor between the size of a model on the disk and the memory it
 * needs.
 *
 * Ollama maps the file of the model and adds the cache of the context
 * and a little room for the runtime.
 */
export const MEMORY_OVERHEAD_FACTOR = 1.15;

/** A model of this size is a "large" model (4 GB). */
export const LARGE_MODEL_BYTES = 4_000_000_000;

/** The free memory a large model may use before it is called slow. */
const SLOW_RATIO = 0.75;
/** The free memory a model may use before it is called "likely fine". */
const FINE_RATIO = 0.35;

/**
 * The directory that holds the models of Ollama.
 *
 * Ollama uses `OLLAMA_MODELS` when it is set and stores the models in
 * `.ollama/models` otherwise.
 */
export function ollamaModelsDirectory(
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir(),
): string {
  const configured = env.OLLAMA_MODELS;
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return path.resolve(configured.trim());
  }
  return path.join(home, '.ollama', 'models');
}

/**
 * Reads the facts of the machine.
 *
 * @returns The facts (the disk is `unknown` when it could not be read).
 */
export async function readHardwareFacts(): Promise<HardwareFacts> {
  const notes: string[] = [];
  const modelsDirectory = ollamaModelsDirectory();
  const disk = await readDiskSpace(modelsDirectory);

  notes.push(
    'No graphics card is assumed: the local model runs on the processor ' +
      'unless Ollama reports otherwise.',
  );
  if (disk.path !== modelsDirectory) {
    notes.push(
      `The directory of the models (${modelsDirectory}) does not exist yet; ` +
        `the free space of ${disk.path ?? 'the drive'} is shown.`,
    );
  }

  return {
    totalRamBytes: os.totalmem(),
    freeRamBytes: os.freemem(),
    // Node.js cannot tell the physical cores from the threads.
    cpuCores: os.availableParallelism(),
    diskFreeBytes: disk.freeBytes,
    diskPath: disk.path ?? undefined,
    diskKnown: disk.freeBytes !== undefined,
    notes,
  };
}

/** The free space of the drive that holds the models. */
async function readDiskSpace(
  directory: string,
): Promise<{ path?: string; freeBytes?: number }> {
  let current = directory;
  for (let depth = 0; depth < 6; depth += 1) {
    try {
      const stats = await statfs(current);
      const freeBytes = Number(stats.bavail) * Number(stats.bsize);
      return {
        path: current,
        freeBytes: Number.isFinite(freeBytes) ? freeBytes : undefined,
      };
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        return {};
      }
      current = parent;
    }
  }
  return {};
}

/**
 * Estimates whether a model fits into the free memory of the machine.
 *
 * @param sizeBytes The size of the model on the disk (undefined when
 *   Ollama did not report it).
 * @param hardware The facts of the machine.
 * @returns The fit (an estimate, never a promise).
 */
export function estimateFit(
  sizeBytes: number | undefined,
  hardware: Pick<HardwareFacts, 'freeRamBytes' | 'totalRamBytes'>,
): ModelFit {
  if (
    sizeBytes === undefined ||
    !Number.isFinite(sizeBytes) ||
    sizeBytes <= 0 ||
    hardware.freeRamBytes <= 0
  ) {
    return 'unknown';
  }
  const needed = sizeBytes * MEMORY_OVERHEAD_FACTOR;
  const ratio = needed / hardware.freeRamBytes;
  if (ratio <= FINE_RATIO) {
    return 'likely-fine';
  }
  if (ratio <= SLOW_RATIO) {
    return 'slow';
  }
  return 'may-not-fit';
}

/**
 * Explains the fit of a model in one sentence.
 *
 * @param fit The estimate.
 * @param sizeBytes The size of the model on the disk.
 * @param hardware The facts of the machine.
 * @returns The explanation (the user interface labels it as an estimate).
 */
export function describeFit(
  fit: ModelFit,
  sizeBytes: number | undefined,
  hardware: Pick<HardwareFacts, 'freeRamBytes' | 'totalRamBytes'>,
): string {
  switch (fit) {
    case 'likely-fine':
      return (
        `About ${formatBytes((sizeBytes ?? 0) * MEMORY_OVERHEAD_FACTOR)} are ` +
        `needed and ${formatBytes(hardware.freeRamBytes)} are free — the ` +
        'model should fit into the memory.'
      );
    case 'slow':
      return (
        `About ${formatBytes((sizeBytes ?? 0) * MEMORY_OVERHEAD_FACTOR)} are ` +
        `needed and only ${formatBytes(hardware.freeRamBytes)} are free — ` +
        'the model will fit, but the answers will be slow without a ' +
        'graphics card.'
      );
    case 'may-not-fit':
      return (
        `About ${formatBytes((sizeBytes ?? 0) * MEMORY_OVERHEAD_FACTOR)} are ` +
        `needed and only ${formatBytes(hardware.freeRamBytes)} are free — ` +
        'the model may not fit into the memory. A smaller model is ' +
        'recommended.'
      );
    default:
      return 'The size of the model or the free memory is unknown.';
  }
}

/** Formats a number of bytes for the user interface. */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) {
    return 'unknown';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
}
