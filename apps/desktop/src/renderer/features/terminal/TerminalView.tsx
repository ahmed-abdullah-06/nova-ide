/**
 * A single xterm.js terminal view (spec §6.1, §17).
 *
 * The component owns the xterm instance for one session: it feeds the
 * output into the terminal, forwards keystrokes to the main process and
 * keeps the pseudo-terminal in sync with the element size.
 */
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export interface TerminalViewProps {
  /** The session this view renders. */
  sessionId: string;
  /** True when the view is the visible one (hidden views are not fitted). */
  active: boolean;
  /** Writes user input to the session. */
  onInput: (sessionId: string, data: string) => void;
  /** Resizes the pseudo-terminal. */
  onResize: (sessionId: string, cols: number, rows: number) => void;
  /** Subscribes to the output of the session. */
  subscribeOutput: (
    sessionId: string,
    listener: (chunk: string) => void,
  ) => () => void;
}

export function TerminalView({
  sessionId,
  active,
  onInput,
  onResize,
  subscribeOutput,
}: TerminalViewProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (container === null) {
      return;
    }

    const terminal = new Terminal({
      fontFamily:
        "'Cascadia Code', 'Cascadia Mono', Consolas, 'Courier New', monospace",
      fontSize: 13,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false,
      theme: {
        background: '#111318',
        foreground: '#e5e7eb',
        cursor: '#b9b1ff',
        selectionBackground: '#7c6cff33',
      },
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container);
    terminalRef.current = terminal;
    fitRef.current = fit;

    const inputDisposable = terminal.onData((data) => {
      onInput(sessionId, data);
    });

    // The subscription replays the output the session produced before the
    // view was mounted (the first prompt of a shell would otherwise be
    // lost).
    const unsubscribe = subscribeOutput(sessionId, (chunk) => {
      terminal.write(chunk);
    });

    return () => {
      unsubscribe();
      inputDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitRef.current = null;
    };
    // The session id identifies the terminal instance; the callbacks are
    // stable enough and re-subscribing on every render would replay output.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Fit the terminal to its container whenever it becomes visible or is
  // resized.
  useEffect(() => {
    const container = containerRef.current;
    const terminal = terminalRef.current;
    const fit = fitRef.current;
    if (container === null || terminal === null || fit === null || !active) {
      return;
    }

    const applyFit = (): void => {
      try {
        fit.fit();
      } catch {
        // The container may not be laid out yet; the next resize fits it.
        return;
      }
      onResize(sessionId, terminal.cols, terminal.rows);
    };

    applyFit();
    const observer = new ResizeObserver(() => {
      applyFit();
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [active, sessionId, onResize]);

  return <div className="terminal-view" ref={containerRef} />;
}
