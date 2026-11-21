/**
 * Renderer-local confirmation dialog.
 *
 * Replaces native alert-style prompts so the shell has one consistent,
 * keyboard-accessible confirmation surface. The main process remains the
 * authority for close/quit; callers still use its token handshake after this
 * UI resolves.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface ConfirmOptions {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmRequest extends ConfirmOptions {
  message: string;
  resolve: (value: boolean) => void;
}

export interface ConfirmContextValue {
  confirm: (message: string, options?: ConfirmOptions) => Promise<boolean>;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }): ReactNode {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const pendingRef = useRef<ConfirmRequest | null>(null);

  const confirm = useCallback(
    (message: string, options: ConfirmOptions = {}): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        // A second request cannot open on top of the first; declining it is
        // safer than stacking modal surfaces or losing either promise.
        if (pendingRef.current !== null) {
          resolve(false);
          return;
        }
        const next: ConfirmRequest = { ...options, message, resolve };
        pendingRef.current = next;
        setRequest(next);
      }),
    [],
  );

  const settle = useCallback((value: boolean): void => {
    const current = pendingRef.current;
    if (current === null) {
      return;
    }
    pendingRef.current = null;
    setRequest(null);
    current.resolve(value);
  }, []);

  useEffect(() => {
    if (request === null) {
      return;
    }
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        settle(false);
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [request, settle]);

  const value = useMemoConfirm(confirm);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      {request === null ? null : (
        <div className="dialog-backdrop">
          <div
            className="dialog confirm-dialog"
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="a6-confirm-title"
            aria-describedby="a6-confirm-message"
          >
            <header className="dialog__header">
              <h2 className="dialog__title" id="a6-confirm-title">
                {request.title ?? 'Please confirm'}
              </h2>
            </header>
            <div className="dialog__body">
              <p className="confirm-dialog__message" id="a6-confirm-message">
                {request.message}
              </p>
              <div className="confirm-dialog__actions">
                <button
                  type="button"
                  className="ui-button"
                  autoFocus
                  onClick={() => settle(false)}
                >
                  {request.cancelLabel ?? 'Cancel'}
                </button>
                <button
                  type="button"
                  className={`ui-button ui-button--primary${
                    request.destructive === true ? ' ui-button--danger' : ''
                  }`}
                  onClick={() => settle(true)}
                >
                  {request.confirmLabel ?? 'Continue'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

/** Small helper keeps the context value referentially stable. */
function useMemoConfirm(confirm: ConfirmContextValue['confirm']): ConfirmContextValue {
  const ref = useRef<ConfirmContextValue>({ confirm });
  ref.current = { confirm };
  return ref.current;
}

export function useConfirm(): ConfirmContextValue {
  const context = useContext(ConfirmContext);
  if (context === null) {
    throw new Error('useConfirm must be used inside <ConfirmProvider>');
  }
  return context;
}
