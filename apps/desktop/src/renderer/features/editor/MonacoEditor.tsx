import { useEffect, useRef, useState, type ReactNode } from 'react';
import type * as Monaco from 'monaco-editor';
import type { EditorTab } from '../../stores/tabsReducer';
import { disposeAllModels, getModel, getOrCreateModel } from './modelRegistry';
import { loadMonaco } from './monacoSetup';
import { onReveal } from './editorCommands';

interface MonacoEditorProps {
  tab: EditorTab | null;
  theme: 'dark' | 'light';
  onChange: (content: string) => void;
  onCursorChange: (position: { line: number; column: number }) => void;
}

/**
 * Monaco editor host (spec §8).
 * One editor instance is created for the lifetime of the app; tabs swap the
 * editor's text model so each buffer keeps its own content and history.
 */
export function MonacoEditor({
  tab,
  theme,
  onChange,
  onCursorChange,
}: MonacoEditorProps): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const [ready, setReady] = useState(false);

  // Always call the latest callbacks without re-subscribing editor events.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const onCursorChangeRef = useRef(onCursorChange);
  onCursorChangeRef.current = onCursorChange;
  const activeTabIdRef = useRef<string | null>(null);
  activeTabIdRef.current = tab?.id ?? null;
  const tabRef = useRef(tab);
  tabRef.current = tab;

  // Create the editor once Monaco has loaded.
  useEffect(() => {
    let cancelled = false;
    let editor: Monaco.editor.IStandaloneCodeEditor | null = null;

    void loadMonaco().then((monaco) => {
      if (cancelled || !containerRef.current) {
        return;
      }
      editor = monaco.editor.create(containerRef.current, {
        automaticLayout: true,
        fontSize: 13,
        minimap: { enabled: true },
        tabSize: 2,
        wordWrap: 'off',
        fixedOverflowWidgets: true,
        renderLineHighlight: 'all',
        scrollBeyondLastLine: false,
      });
      editorRef.current = editor;

      editor.onDidChangeModelContent(() => {
        const id = activeTabIdRef.current;
        if (id && editor) {
          onChangeRef.current(editor.getValue());
        }
      });

      editor.onDidChangeCursorPosition((event) => {
        onCursorChangeRef.current({
          line: event.position.lineNumber,
          column: event.position.column,
        });
      });

      setReady(true);
    });

    return () => {
      cancelled = true;
      editor?.dispose();
      editorRef.current = null;
      disposeAllModels();
      setReady(false);
    };
  }, []);

  // Attach the model belonging to the active tab (and keep its language in
  // sync). Runs only when the active tab or its language changes — not on
  // every keystroke.
  const activeTabId = tab?.id ?? null;
  const activeLanguage = tab?.language ?? null;
  useEffect(() => {
    if (!ready) {
      return;
    }
    const current = tabRef.current;
    if (!current) {
      editorRef.current?.setModel(null);
      return;
    }
    void loadMonaco().then((monaco) => {
      const editor = editorRef.current;
      if (!editor || activeTabIdRef.current !== current.id) {
        return;
      }
      const model = getOrCreateModel(monaco, current);
      if (editor.getModel() !== model) {
        editor.setModel(model);
      }
      if (model.getLanguageId() !== current.language) {
        monaco.editor.setModelLanguage(model, current.language);
      }
    });
  }, [ready, activeTabId, activeLanguage]);

  // Push externally reloaded content into the Monaco model (spec §7.1).
  // The model is addressed by TAB ID (not by what the editor currently
  // shows), so background buffers reload too. No-ops during normal typing:
  // `update-content` keeps state and model equal, and a dirty buffer is
  // never reloaded by the reducer in the first place.
  useEffect(() => {
    if (!ready || tab === null) {
      return;
    }
    const model = getModel(tab.id);
    if (model === undefined || model.isDisposed()) {
      return;
    }
    if (model.getValue() !== tab.content) {
      model.setValue(tab.content);
    }
  }, [ready, tab]);

  // Follow the application theme (spec §6.2).
  useEffect(() => {
    if (!ready) {
      return;
    }
    void loadMonaco().then((monaco) => {
      monaco.editor.setTheme(theme === 'dark' ? 'vs-dark' : 'vs');
    });
  }, [ready, theme]);

  // Reveal a position requested by another panel (search results, problems).
  useEffect(() => {
    return onReveal((position) => {
      const editor = editorRef.current;
      if (editor === null) {
        return;
      }
      // The file must be the one the editor currently shows.
      const currentTabId = activeTabIdRef.current;
      if (currentTabId === null || currentTabId !== position.path) {
        return;
      }
      const line = Math.max(1, position.line);
      const column = Math.max(1, position.column);
      editor.setPosition({ lineNumber: line, column });
      editor.revealLineInCenter(line);
      editor.focus();
    });
  }, [ready]);

  return (
    <div className="editor-content">
      <div className="editor-content__mount" ref={containerRef} />
      {!ready && <div className="editor-loading">Loading editor…</div>}
    </div>
  );
}
