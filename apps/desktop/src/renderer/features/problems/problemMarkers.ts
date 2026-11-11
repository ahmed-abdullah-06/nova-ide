/**
 * Collector for the diagnostics of the open files (spec §6.1, §13).
 *
 * Monaco's built-in language services (TypeScript/JavaScript, JSON, CSS
 * and HTML) report their findings as markers. The panel only shows
 * markers that the language services really produced — it never invents
 * a diagnostic.
 *
 * The markers are collected in a small external store, so both the
 * problems panel and the badge of the panel tab read the same list
 * without collecting it twice.
 */
import { MarkerSeverity, type editor } from 'monaco-editor';
import { loadMonaco } from '../editor/monacoSetup';
import {
  MONACO_SEVERITY,
  severityLabel,
  toSeverity,
  type ProblemSeverity,
} from './problemSeverity';

export { severityLabel, toSeverity };

/** One diagnostic of the problems list. */
export interface ProblemEntry {
  /** Absolute path of the file the diagnostic belongs to. */
  path: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  column: number;
  /** The diagnostic message. */
  message: string;
  /** The severity as reported by the language service. */
  severity: ProblemSeverity;
  /** The language service that produced the diagnostic. */
  source: string;
}

/** The prefix of the URI of a model created by the model registry. */
const MODEL_URI_PREFIX = 'inmemory://model/';

// The severity flags are copied from Monaco's documentation; a change of
// Monaco would break the mapping, so the values are checked here.
if (
  MarkerSeverity.Error !== MONACO_SEVERITY.Error ||
  MarkerSeverity.Warning !== MONACO_SEVERITY.Warning ||
  MarkerSeverity.Info !== MONACO_SEVERITY.Info ||
  MarkerSeverity.Hint !== MONACO_SEVERITY.Hint
) {
  throw new Error(
    'NOVA IDE: the severity flags of Monaco changed — update problemSeverity.ts',
  );
}

/** The current snapshot of the problems. */
let snapshot: ProblemEntry[] = [];
/** The listeners of the store. */
const listeners = new Set<() => void>();
/** The subscription to the marker changes (null while it is not started). */
let markerSubscription: { dispose(): void } | null = null;

/**
 * Converts a Monaco marker into a problem entry.
 *
 * Returns null when the marker does not belong to a file of the workspace.
 */
export function toProblemEntry(
  marker: editor.IMarker,
  pathByUri: ReadonlyMap<string, string>,
): ProblemEntry | null {
  const path = pathByUri.get(marker.resource.toString());
  if (path === undefined) {
    return null;
  }
  return {
    path,
    line: marker.startLineNumber,
    column: marker.startColumn,
    message: marker.message,
    severity: toSeverity(marker.severity),
    source: marker.source ?? marker.owner ?? 'editor',
  };
}

/** Extracts the file path from a model URI created by the model registry. */
export function decodeModelPath(uri: string): string | null {
  if (!uri.startsWith(MODEL_URI_PREFIX)) {
    return null;
  }
  const encoded = uri.slice(MODEL_URI_PREFIX.length);
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

/** Collects the problems of all open models. */
function collect(monaco: typeof import('monaco-editor')): ProblemEntry[] {
  const markers = monaco.editor.getModelMarkers({});
  const pathByUri = new Map<string, string>();
  for (const model of monaco.editor.getModels()) {
    // The model URI carries the file path (see `modelRegistry`).
    const path = decodeModelPath(model.uri.toString());
    if (path !== null) {
      pathByUri.set(model.uri.toString(), path);
    }
  }

  const entries: ProblemEntry[] = [];
  for (const marker of markers) {
    const entry = toProblemEntry(marker, pathByUri);
    if (entry !== null) {
      entries.push(entry);
    }
  }
  entries.sort((a, b) => {
    if (a.path !== b.path) {
      return a.path.localeCompare(b.path);
    }
    return a.line - b.line;
  });
  return entries;
}

/** Publishes a new snapshot to the listeners. */
function publish(problems: ProblemEntry[]): void {
  snapshot = problems;
  for (const listener of listeners) {
    listener();
  }
}

/** Starts the collection (idempotent). */
async function start(): Promise<void> {
  if (markerSubscription !== null) {
    return;
  }
  const monaco = await loadMonaco();
  if (markerSubscription !== null) {
    return;
  }
  markerSubscription = monaco.editor.onDidChangeMarkers(() => {
    publish(collect(monaco));
  });
  publish(collect(monaco));
}

/**
 * Subscribes to the problems.
 *
 * @returns A function that removes the subscription.
 */
export function subscribeProblems(listener: () => void): () => void {
  listeners.add(listener);
  void start().catch(() => {
    // Monaco could not be loaded (e.g. the panel is used outside the
    // editor); the list simply stays empty.
  });
  return () => {
    listeners.delete(listener);
  };
}

/** The current problems (for `useSyncExternalStore`). */
export function getProblems(): ProblemEntry[] {
  return snapshot;
}
