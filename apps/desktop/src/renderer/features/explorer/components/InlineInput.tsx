import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';

interface InlineInputProps {
  /** Pre-filled value (rename); empty for create. */
  defaultValue?: string;
  ariaLabel: string;
  /** Left padding so the input lines up with the row's icon/label. */
  indent: number;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}

/**
 * Inline text field used for create/rename inside the tree (spec §7.1).
 * Enter commits, Escape or blur cancels; the settled flag prevents a blur
 * triggered by unmount from cancelling twice after a submit.
 */
export function InlineInput({
  defaultValue = '',
  ariaLabel,
  indent,
  onSubmit,
  onCancel,
}: InlineInputProps): ReactNode {
  const [value, setValue] = useState(defaultValue);
  const settledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const input = inputRef.current;
    if (input === null) {
      return;
    }
    input.focus();
    // Rename pre-selects the base name (extension left out), like editors do.
    const dot = defaultValue.lastIndexOf('.');
    const end = dot > 0 ? dot : defaultValue.length;
    input.setSelectionRange(0, end);
  }, [defaultValue]);

  const settle = (action: () => void): void => {
    if (settledRef.current) {
      return;
    }
    settledRef.current = true;
    action();
  };

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    settle(() => onSubmit(value));
  };

  return (
    <form
      className="tree-node__input-row"
      style={{ paddingLeft: indent }}
      onSubmit={handleSubmit}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
    >
      <input
        ref={inputRef}
        className="tree-node__input"
        value={value}
        aria-label={ariaLabel}
        spellCheck={false}
        autoComplete="off"
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            settle(onCancel);
          }
        }}
        onBlur={() => settle(onCancel)}
      />
    </form>
  );
}
