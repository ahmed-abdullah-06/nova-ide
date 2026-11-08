import type * as Monaco from 'monaco-editor';
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/esm/vs/languages/features/json/json.worker?worker';
import CssWorker from 'monaco-editor/esm/vs/languages/features/css/css.worker?worker';
import HtmlWorker from 'monaco-editor/esm/vs/languages/features/html/html.worker?worker';
import TsWorker from 'monaco-editor/esm/vs/languages/features/typescript/ts.worker?worker';

type MonacoModule = typeof Monaco;

let monacoPromise: Promise<MonacoModule> | null = null;

/**
 * Lazily loads Monaco and configures its web workers exactly once
 * (spec §21 — lazy-load heavy interface modules).
 *
 * Workers:
 *  - editor worker: text operations for every language
 *  - json/css/html/ts workers: language services (intelliSense, diagnostics)
 */
export function loadMonaco(): Promise<MonacoModule> {
  if (!monacoPromise) {
    monacoPromise = (async (): Promise<MonacoModule> => {
      const monaco = await import('monaco-editor');

      self.MonacoEnvironment = {
        getWorker: (_workerId: string, label: string): Worker => {
          switch (label) {
            case 'json':
              return new JsonWorker();
            case 'css':
            case 'scss':
            case 'less':
              return new CssWorker();
            case 'html':
            case 'handlebars':
            case 'razor':
              return new HtmlWorker();
            case 'typescript':
            case 'javascript':
              return new TsWorker();
            default:
              return new EditorWorker();
          }
        },
      };

      return monaco;
    })();
  }
  return monacoPromise;
}
