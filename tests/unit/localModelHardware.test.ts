/**
 * Tests for the hardware facts and the fit of a local model
 * (spec §2.1, §21).
 *
 * The tests read the real facts of the machine (they are not mocked),
 * but the estimation itself is a pure function, so every edge case can
 * be checked exactly.
 */
import { describe, expect, it } from 'vitest';
import {
  describeFit,
  estimateFit,
  formatBytes,
  LARGE_MODEL_BYTES,
  MEMORY_OVERHEAD_FACTOR,
  ollamaModelsDirectory,
  readHardwareFacts,
} from '../../apps/desktop/src/main/providers/localModels/hardware';
import type { HardwareFacts } from '../../apps/desktop/src/shared/local-model-types';

/** The facts of a machine with 16 GB of memory. */
const machine: HardwareFacts = {
  totalRamBytes: 16 * 1024 * 1024 * 1024,
  freeRamBytes: 8 * 1024 * 1024 * 1024,
  cpuCores: 8,
  diskKnown: false,
  notes: [],
};

describe('the facts of the machine', () => {
  it('reads the real facts of this machine', async () => {
    const facts = await readHardwareFacts();
    expect(facts.totalRamBytes).toBeGreaterThan(0);
    expect(facts.freeRamBytes).toBeGreaterThan(0);
    expect(facts.freeRamBytes).toBeLessThanOrEqual(facts.totalRamBytes);
    expect(facts.cpuCores).toBeGreaterThan(0);
    expect(Array.isArray(facts.notes)).toBe(true);
    // No graphics card is assumed.
    expect(facts.notes.join(' ')).toContain('No graphics card is assumed');
  });

  it('uses the directory of Ollama', () => {
    expect(ollamaModelsDirectory({}, 'C:\\Users\\test')).toBe(
      'C:\\Users\\test\\.ollama\\models',
    );
    expect(
      ollamaModelsDirectory({ OLLAMA_MODELS: 'D:\\models' }, 'C:\\Users\\test'),
    ).toBe('D:\\models');
    // An empty value is ignored.
    expect(
      ollamaModelsDirectory({ OLLAMA_MODELS: '   ' }, 'C:\\Users\\test'),
    ).toBe('C:\\Users\\test\\.ollama\\models');
  });
});

describe('the estimate of the fit of a model', () => {
  it('calls a small model likely fine', () => {
    expect(estimateFit(1_000_000_000, machine)).toBe('likely-fine');
  });

  it('calls a model that uses most of the memory slow', () => {
    // 5 GB with an overhead of 15 % is 5.75 GB of 8 GB free.
    expect(estimateFit(5_000_000_000, machine)).toBe('slow');
  });

  it('calls a model that does not fit may-not-fit', () => {
    expect(estimateFit(12_000_000_000, machine)).toBe('may-not-fit');
  });

  it('says unknown when the size of the model is unknown', () => {
    expect(estimateFit(undefined, machine)).toBe('unknown');
    expect(estimateFit(0, machine)).toBe('unknown');
    expect(estimateFit(-1, machine)).toBe('unknown');
    expect(estimateFit(Number.NaN, machine)).toBe('unknown');
  });

  it('says unknown when the free memory is unknown', () => {
    expect(
      estimateFit(1_000_000_000, {
        ...machine,
        freeRamBytes: 0,
      }),
    ).toBe('unknown');
  });

  it('uses the memory of the model with the overhead', () => {
    // Exactly at the edge of "likely fine" (35 % of the free memory).
    const size = (machine.freeRamBytes * 0.35) / MEMORY_OVERHEAD_FACTOR;
    expect(estimateFit(Math.floor(size), machine)).toBe('likely-fine');
    expect(estimateFit(Math.floor(size) + 1, machine)).toBe('slow');
  });

  it('never blocks the user: every size gets a value', () => {
    for (const size of [1, 1e6, 1e9, 1e11, 1e13]) {
      expect(['likely-fine', 'slow', 'may-not-fit']).toContain(
        estimateFit(size, machine),
      );
    }
  });
});

describe('the explanation of the fit', () => {
  it('explains every value', () => {
    expect(
      describeFit('likely-fine', 1_000_000_000, machine),
    ).toContain('should fit');
    expect(describeFit('slow', 5_000_000_000, machine)).toContain('slow');
    expect(describeFit('may-not-fit', 12_000_000_000, machine)).toContain(
      'may not fit',
    );
    expect(describeFit('unknown', undefined, machine)).toContain('unknown');
  });

  it('formats the sizes', () => {
    expect(formatBytes(1024)).toBe('1 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(undefined)).toBe('unknown');
    expect(formatBytes(-1)).toBe('unknown');
  });
});

describe('the size of a large model', () => {
  it('is the documented limit of the development machine', () => {
    expect(LARGE_MODEL_BYTES).toBe(4_000_000_000);
  });
});
