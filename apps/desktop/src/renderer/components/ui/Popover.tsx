import { useEffect, useRef, type ReactNode } from 'react';

export interface PopoverProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  align?: 'start' | 'end';
  children: ReactNode;
  className?: string;
}

/**
 * Controlled floating panel for menus, pickers and permission popovers.
 *
 * The parent owns `open` and positions the popover inside a `position: relative`
 * wrapper. Escape and outside pointer presses call `onClose`.
 */
export function Popover({
  open,
  onClose,
  title,
  align = 'start',
  children,
  className = '',
}: PopoverProps): ReactNode {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent): void => {
      if (ref.current !== null && !ref.current.contains(event.target as Node)) {
        onClose();
      }
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      ref={ref}
      className={`ui-popover ui-popover--${align} ${className}`.trim()}
      role="dialog"
    >
      {title === undefined ? null : (
        <div className="ui-popover__title">{title}</div>
      )}
      <div className="ui-popover__body">{children}</div>
    </div>
  );
}
