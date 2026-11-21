/**
 * Platform-aware keybinding normalization, conflict detection, and chord
 * resolution. This module is pure so it can be tested without a DOM.
 */
import type {
  CommandContext,
  CommandDefinition,
  KeyPart,
  KeybindingSpec,
  KeybindingsForPlatform,
  ModifierSet,
  Platform,
} from './types';

export interface CanonicalModifiers {
  ctrl: boolean;
  meta: boolean;
  shift: boolean;
  alt: boolean;
}

export interface CanonicalKeyPart {
  key: string;
  modifiers: CanonicalModifiers;
}

export interface KeyEventLike {
  code?: string;
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

export interface ResolvedBinding {
  commandId: string;
  spec: KeybindingSpec;
  editorOwned: boolean;
}

export type ResolveResult =
  | { kind: 'none' }
  | { kind: 'passthrough' }
  | { kind: 'chord'; hint: string }
  | { kind: 'command'; commandId: string };

const PLATFORMS: readonly Platform[] = ['win32', 'darwin', 'linux'];

/**
 * Keys the integrated terminal owns. They must reach xterm/shell unchanged,
 * including the first half of the Ctrl+K chord.
 */
const TERMINAL_KEY_NAMES: ReadonlySet<string> = new Set([
  'b',
  'j',
  'l',
  'p',
  'w',
  'k',
  'z',
  'c',
  'v',
]);

/** Normalizes the single-spec and alias-array forms to a stable list. */
function specsForPlatform(
  value: KeybindingsForPlatform | undefined,
): readonly KeybindingSpec[] {
  if (value === undefined || value === null) {
    return [];
  }
  return 'first' in value ? [value] : value;
}

function canonicalModifiers(
  modifiers: ModifierSet,
  platform: Platform,
): CanonicalModifiers {
  const primary = modifiers.primary === true;
  return {
    ctrl: modifiers.ctrl === true || (primary && platform !== 'darwin'),
    meta: modifiers.meta === true || (primary && platform === 'darwin'),
    shift: modifiers.shift === true,
    alt: modifiers.alt === true,
  };
}

/** Resolves the logical `primary` modifier for a platform. */
export function canonicalizeKeyPart(
  part: KeyPart,
  platform: Platform,
): CanonicalKeyPart {
  return { key: canonicalKeyName(part.key), modifiers: canonicalModifiers(part.modifiers, platform) };
}

/** Normalizes `event.code` (preferred) or `event.key` to one stable name. */
export function canonicalKeyName(value: string): string {
  if (/^Key[A-Z]$/.test(value)) {
    return value.slice(3).toLowerCase();
  }
  if (/^Digit\d$/.test(value)) {
    return value.slice(5);
  }
  if (value === 'Backquote') {
    return '`';
  }
  if (value === 'Equal') {
    return '=';
  }
  if (value === 'Minus') {
    return '-';
  }
  if (/^F\d{1,2}$/.test(value)) {
    return value.toLowerCase();
  }
  return value.length === 1 ? value.toLowerCase() : value;
}

export function eventToKeyPart(event: KeyEventLike): CanonicalKeyPart {
  const raw = event.code !== undefined && event.code !== '' ? event.code : event.key;
  return {
    key: canonicalKeyName(raw),
    modifiers: {
      ctrl: event.ctrlKey,
      meta: event.metaKey,
      shift: event.shiftKey,
      alt: event.altKey,
    },
  };
}

function sameModifiers(a: CanonicalModifiers, b: CanonicalModifiers): boolean {
  return (
    a.ctrl === b.ctrl &&
    a.meta === b.meta &&
    a.shift === b.shift &&
    a.alt === b.alt
  );
}

function samePart(a: CanonicalKeyPart, b: CanonicalKeyPart): boolean {
  return a.key === b.key && sameModifiers(a.modifiers, b.modifiers);
}

function partId(part: CanonicalKeyPart): string {
  const { ctrl, meta, shift, alt } = part.modifiers;
  return [
    ctrl ? 'ctrl' : '',
    meta ? 'meta' : '',
    shift ? 'shift' : '',
    alt ? 'alt' : '',
    part.key,
  ]
    .filter((value) => value !== '')
    .join('+');
}

function contextMatches(when: KeybindingSpec['when'], context: CommandContext): boolean {
  switch (when ?? 'always') {
    case 'always':
      return true;
    case 'monacoFocused':
      return context.focus.kind === 'monaco';
    case 'notMonacoFocused':
      return context.focus.kind !== 'monaco';
    case 'notTerminalFocused':
      return context.focus.kind !== 'terminal';
  }
}

function displayKey(key: string): string {
  if (/^[a-z]$/.test(key) || /^f\d{1,2}$/.test(key)) {
    return key.toUpperCase();
  }
  return key;
}

/** Builds the label directly from the stored binding; menu data has no label strings. */
export function describeKeyPart(part: KeyPart, platform: Platform): string {
  const modifiers = canonicalModifiers(part.modifiers, platform);
  const pieces: string[] = [];
  if (modifiers.ctrl) {
    pieces.push('Ctrl');
  }
  if (modifiers.meta) {
    pieces.push('Cmd');
  }
  if (modifiers.shift) {
    pieces.push('Shift');
  }
  if (modifiers.alt) {
    pieces.push('Alt');
  }
  pieces.push(displayKey(canonicalKeyName(part.key)));
  return pieces.join('+');
}

export function describeKeybinding(spec: KeybindingSpec, platform: Platform): string {
  const first = describeKeyPart(spec.first, platform);
  return spec.second === undefined
    ? first
    : `${first} ${describeKeyPart(spec.second, platform)}`;
}

/** Menu/palette label for a single spec or a set of true command aliases. */
export function describeKeybindings(
  value: KeybindingsForPlatform | undefined,
  platform: Platform,
): string | null {
  const specs = specsForPlatform(value);
  if (specs.length === 0) {
    return null;
  }
  return specs.map((spec) => describeKeybinding(spec, platform)).join(' / ');
}

function partLabel(part: CanonicalKeyPart): string {
  const { ctrl, meta, shift, alt } = part.modifiers;
  const pieces: string[] = [];
  if (ctrl) {
    pieces.push('Ctrl');
  }
  if (meta) {
    pieces.push('Cmd');
  }
  if (shift) {
    pieces.push('Shift');
  }
  if (alt) {
    pieces.push('Alt');
  }
  pieces.push(displayKey(part.key));
  return pieces.join('+');
}

function terminalPassthrough(part: CanonicalKeyPart): boolean {
  const { ctrl, meta, shift, alt } = part.modifiers;
  return ctrl && !meta && !shift && !alt && TERMINAL_KEY_NAMES.has(part.key);
}

/** All bindings for one platform, with command metadata attached. */
export function collectBindings(
  definitions: readonly CommandDefinition[],
  platform: Platform,
): ResolvedBinding[] {
  const result: ResolvedBinding[] = [];
  for (const definition of definitions) {
    for (const spec of specsForPlatform(definition.keybindings?.[platform])) {
      result.push({
        commandId: definition.id,
        spec,
        editorOwned: definition.editorOwned === true,
      });
    }
  }
  return result;
}

function conflictKey(binding: ResolvedBinding, platform: Platform): string {
  const first = canonicalizeKeyPart(binding.spec.first, platform);
  const second =
    binding.spec.second === undefined
      ? undefined
      : canonicalizeKeyPart(binding.spec.second, platform);
  return [partId(first), second === undefined ? '' : partId(second)].join('|');
}

/**
 * Two contexts conflict unless they are provably disjoint. `always` overlaps
 * every scope, and `notTerminalFocused` overlaps both Monaco and non-Monaco
 * focus; only `monacoFocused` and `notMonacoFocused` are mutually exclusive.
 */
function contextsOverlap(a: KeybindingSpec['when'], b: KeybindingSpec['when']): boolean {
  const first = a ?? 'always';
  const second = b ?? 'always';
  if (first === second) {
    return true;
  }
  if (first === 'always' || second === 'always') {
    return true;
  }
  const monaco = 'monacoFocused';
  const notMonaco = 'notMonacoFocused';
  return !((first === monaco && second === notMonaco) || (first === notMonaco && second === monaco));
}

/**
 * Fails fast when two different commands claim the same key in overlapping
 * contexts. Aliases of one command are allowed; genuine focus-scope pairs
 * (`monacoFocused` / `notMonacoFocused`) stay legal.
 */
export function assertNoKeybindingConflicts(
  definitions: readonly CommandDefinition[],
): void {
  for (const platform of PLATFORMS) {
    const seen = new Map<string, ResolvedBinding[]>();
    for (const binding of collectBindings(definitions, platform)) {
      const key = conflictKey(binding, platform);
      const existing = seen.get(key) ?? [];
      const clash = existing.find(
        (candidate) =>
          candidate.commandId !== binding.commandId &&
          contextsOverlap(candidate.spec.when, binding.spec.when),
      );
      if (clash !== undefined) {
        throw new Error(
          `Duplicate keybinding "${describeKeybinding(binding.spec, platform)}" on ${platform} in overlapping contexts "${clash.spec.when ?? 'always'}" and "${binding.spec.when ?? 'always'}" for "${clash.commandId}" and "${binding.commandId}"`,
        );
      }
      existing.push(binding);
      seen.set(key, existing);
    }
  }
}

interface PendingChord {
  first: CanonicalKeyPart;
  candidates: ResolvedBinding[];
  timer: ReturnType<typeof setTimeout>;
}

/**
 * Resolves single keys and two-part chords. The owner calls `dispose()` when
 * the app unmounts; the visible hint is delivered through `onHint`.
 */
export class KeybindingResolver {
  private readonly bindings: ResolvedBinding[];
  private readonly platform: Platform;
  private readonly timeoutMs: number;
  private readonly onHint: (hint: string | null) => void;
  private pending: PendingChord | null = null;

  constructor(
    definitions: readonly CommandDefinition[],
    platform: Platform,
    options: { timeoutMs?: number; onHint?: (hint: string | null) => void } = {},
  ) {
    assertNoKeybindingConflicts(definitions);
    this.bindings = collectBindings(definitions, platform);
    this.platform = platform;
    this.timeoutMs = options.timeoutMs ?? 1000;
    this.onHint = options.onHint ?? (() => undefined);
  }

  handleKey(event: KeyEventLike, context: CommandContext): ResolveResult {
    const part = eventToKeyPart(event);
    return this.handlePart(part, context);
  }

  handlePart(part: CanonicalKeyPart, context: CommandContext): ResolveResult {
    if (this.pending !== null) {
      if (context.focus.kind === 'terminal') {
        this.cancel();
      } else {
        const pending = this.pending;
        const match = pending.candidates.find(
          (candidate) =>
            candidate.spec.second !== undefined &&
            samePart(canonicalizeKeyPart(candidate.spec.second, this.platform), part) &&
            contextMatches(candidate.spec.when, context),
        );
        this.cancel();
        if (match !== undefined) {
          return { kind: 'command', commandId: match.commandId };
        }
      }
    }

    if (context.focus.kind === 'terminal' && terminalPassthrough(part)) {
      return { kind: 'passthrough' };
    }

    const matches = this.bindings.filter(
      (binding) =>
        samePart(canonicalizeKeyPart(binding.spec.first, this.platform), part) &&
        contextMatches(binding.spec.when, context),
    );

    if (context.focus.kind === 'monaco' && matches.every((binding) => binding.editorOwned)) {
      return { kind: 'passthrough' };
    }

    const chord = matches.find((binding) => binding.spec.second !== undefined);
    if (chord !== undefined) {
      const first = canonicalizeKeyPart(chord.spec.first, this.platform);
      const hint = `${partLabel(first)}… then ${describeKeybinding(chord.spec, this.platform).slice(partLabel(first).length).trim()}`;
      const candidates = matches.filter((binding) => binding.spec.second !== undefined);
      this.pending = {
        first,
        candidates,
        timer: setTimeout(() => {
          this.cancel();
        }, this.timeoutMs),
      };
      this.onHint(hint);
      return { kind: 'chord', hint };
    }

    const single = matches.find((binding) => binding.spec.second === undefined);
    return single === undefined
      ? { kind: 'none' }
      : { kind: 'command', commandId: single.commandId };
  }

  cancel(): void {
    if (this.pending === null) {
      return;
    }
    clearTimeout(this.pending.timer);
    this.pending = null;
    this.onHint(null);
  }

  dispose(): void {
    this.cancel();
  }
}
