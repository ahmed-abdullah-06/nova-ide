/**
 * Editor navigation commands (spec §8).
 *
 * A small, renderer-local event bus that lets other panels ask the editor
 * to reveal a position (used by the search results and the problems
 * panel). It carries no privileges: it only moves the cursor of the
 * already open editor.
 */

/** A position inside a file. */
export interface RevealPosition {
  /** Absolute path of the file. */
  path: string;
  /** 1-based line number. */
  line: number;
  /** 1-based column number. */
  column: number;
}

type Listener = (position: RevealPosition) => void;

const listeners = new Set<Listener>();

/**
 * Asks the editor to reveal a position.
 *
 * The request is delivered to the editor component, which then moves the
 * cursor. Unknown files are ignored (the caller opens them first).
 */
export function requestReveal(position: RevealPosition): void {
  for (const listener of [...listeners]) {
    listener(position);
  }
}

/**
 * Subscribes to reveal requests.
 *
 * @returns An unsubscribe function.
 */
export function onReveal(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
