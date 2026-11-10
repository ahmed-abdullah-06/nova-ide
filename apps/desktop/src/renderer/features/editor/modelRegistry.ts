import type * as Monaco from 'monaco-editor';

type MonacoModule = typeof Monaco;

/**
 * Registry mapping editor tabs to their Monaco text models so buffers keep
 * their content, cursor, and undo history while the user switches tabs.
 * Kept separate from the React components so it can be unit tested.
 */
const models = new Map<string, Monaco.editor.ITextModel>();

export function getOrCreateModel(
  monaco: MonacoModule,
  tab: { id: string; language: string; content: string },
): Monaco.editor.ITextModel {
  const existing = models.get(tab.id);
  if (existing && !existing.isDisposed()) {
    return existing;
  }
  const model = monaco.editor.createModel(
    tab.content,
    tab.language,
    monaco.Uri.parse(`inmemory://model/${encodeURIComponent(tab.id)}`),
  );
  models.set(tab.id, model);
  return model;
}

export function getModel(
  tabId: string,
): Monaco.editor.ITextModel | undefined {
  const model = models.get(tabId);
  return model && !model.isDisposed() ? model : undefined;
}

export function disposeModel(tabId: string): void {
  const model = models.get(tabId);
  if (model && !model.isDisposed()) {
    model.dispose();
  }
  models.delete(tabId);
}

/**
 * Re-keys a model when its owning tab is renamed (file-backed tab ids are
 * file paths). Keeps buffer content, cursor, and undo history intact.
 */
export function renameModelKey(oldId: string, newId: string): void {
  if (oldId === newId) {
    return;
  }
  const model = models.get(oldId);
  if (model === undefined) {
    return;
  }
  models.delete(oldId);
  if (!model.isDisposed()) {
    models.set(newId, model);
  }
}

export function disposeAllModels(): void {
  for (const tabId of [...models.keys()]) {
    disposeModel(tabId);
  }
}
