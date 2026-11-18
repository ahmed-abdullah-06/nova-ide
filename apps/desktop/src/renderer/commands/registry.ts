/**
 * Central renderer command registry. Every menu item, shortcut and future
 * palette entry goes through one of these ids.
 */
import { assertNoKeybindingConflicts } from './keybindings';
import type { CommandContext, CommandDefinition, CommandSource } from './types';

export class DuplicateCommandIdError extends Error {
  constructor(id: string) {
    super(`Command "${id}" is already registered`);
    this.name = 'DuplicateCommandIdError';
  }
}

export class UnknownCommandError extends Error {
  constructor(id: string) {
    super(`Unknown command "${id}"`);
    this.name = 'UnknownCommandError';
  }
}

export class UntrustedCommandSourceError extends Error {
  constructor(source: unknown) {
    super(`Refusing to execute a command from source "${String(source)}"`);
    this.name = 'UntrustedCommandSourceError';
  }
}

/** Non-sensitive trace used by packaged-app verification only. */
export interface CommandTraceEntry {
  readonly sequence: number;
  readonly id: string;
  readonly source: CommandSource;
  readonly outcome: 'ran' | 'blocked';
}

const TRACE_LIMIT = 32;
const trace: CommandTraceEntry[] = [];
let sequence = 0;

function isTrustedSource(source: unknown): source is CommandSource {
  return source === 'user-menu' || source === 'user-keyboard';
}

/** Returns a frozen snapshot; callers cannot mutate the trace. */
export function getCommandTrace(): readonly CommandTraceEntry[] {
  return Object.freeze(trace.map((entry) => Object.freeze({ ...entry })));
}

/**
 * Publishes the read-only trace accessor used by packaged verification.
 *
 * The accessor only returns frozen, non-sensitive entries and cannot run a
 * command, so untrusted model/voice content that finds it learns nothing.
 */
export function exposeCommandTrace(): () => void {
  // A narrow cast keeps this module type-safe in both the renderer and the
  // unit-test tsconfig (which does not load the renderer env declaration).
  const target = globalThis as typeof globalThis & {
    __a6CommandTrace?: () => readonly CommandTraceEntry[];
  };
  if (typeof window === 'undefined' || target.__a6CommandTrace !== undefined) {
    return () => undefined;
  }
  target.__a6CommandTrace = getCommandTrace;
  return () => {
    delete target.__a6CommandTrace;
  };
}

function recordTrace(
  id: string,
  source: CommandSource,
  outcome: CommandTraceEntry['outcome'],
): void {
  sequence += 1;
  trace.push({ sequence, id, source, outcome });
  if (trace.length > TRACE_LIMIT) {
    trace.shift();
  }
}

export class CommandRegistry {
  private readonly commands = new Map<string, CommandDefinition>();

  register(definition: CommandDefinition): void {
    if (this.commands.has(definition.id)) {
      throw new DuplicateCommandIdError(definition.id);
    }
    if (definition.id.length === 0 || definition.title.length === 0) {
      throw new Error('A command needs an id and a title');
    }
    this.commands.set(definition.id, definition);
    assertNoKeybindingConflicts(this.list());
  }

  has(id: string): boolean {
    return this.commands.has(id);
  }

  get(id: string): CommandDefinition {
    const definition = this.commands.get(id);
    if (definition === undefined) {
      throw new UnknownCommandError(id);
    }
    return definition;
  }

  list(): readonly CommandDefinition[] {
    return [...this.commands.values()];
  }

  /** Rejects untrusted sources and disabled commands before running anything. */
  async execute(
    id: string,
    context: CommandContext,
    source: unknown,
    args?: unknown,
  ): Promise<'ran' | 'blocked'> {
    if (!isTrustedSource(source)) {
      throw new UntrustedCommandSourceError(source);
    }
    const definition = this.commands.get(id);
    if (definition === undefined) {
      throw new UnknownCommandError(id);
    }
    if (definition.enabled !== undefined && !definition.enabled(context)) {
      recordTrace(id, source, 'blocked');
      return 'blocked';
    }
    await definition.run(context, args);
    recordTrace(id, source, 'ran');
    return 'ran';
  }
}
