/**
 * Editor command bus (spec §8).
 *
 * A small, renderer-local event bus that lets other panels ask the editor to
 * reveal a position or run one of Monaco's own actions. It carries no
 * privileges: it only drives the already open editor.
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
type LayoutListener = () => void;

/** Minimal surface needed from the active Monaco editor. */
export interface EditorHandle {
  trigger(source: string, actionId: string, args: unknown): void;
  layout(): void;
  getModel(): { canUndo(): boolean; canRedo(): boolean } | null;
}

const listeners = new Set<Listener>();
const layoutListeners = new Set<LayoutListener>();
let activeEditor: EditorHandle | null = null;

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

/** Subscribes to reveal requests. */
export function onReveal(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Runs a Monaco action on the active editor, if one exists. */
export function requestEditorAction(actionId: string): void {
  activeEditor?.trigger('a6-menu', actionId, {});
}

/** Re-measures Monaco after a panel or sidebar visibility change. */
export function requestEditorLayout(): void {
  for (const listener of [...layoutListeners]) {
    listener();
  }
}

export function onEditorLayout(listener: LayoutListener): () => void {
  layoutListeners.add(listener);
  return () => {
    layoutListeners.delete(listener);
  };
}

/** Called by MonacoEditor for the lifetime of its editor instance. */
export function setActiveEditor(editor: EditorHandle | null): void {
  activeEditor = editor;
}

export function editorHistoryState(): { canUndo: boolean; canRedo: boolean } {
  const model = activeEditor?.getModel() ?? null;
  return {
    canUndo: model?.canUndo() ?? false,
    canRedo: model?.canRedo() ?? false,
  };
}

/** True once a Monaco editor instance is available to run actions on. */
export function isEditorReady(): boolean {
  return activeEditor !== null;
}
