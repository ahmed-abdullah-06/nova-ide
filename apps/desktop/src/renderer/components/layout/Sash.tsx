/**
 * Accessible resize separator for a workbench pane (LF5).
 *
 * The sash is a real, focusable control with separator semantics. Pointer and
 * arrow-key input are translated by the pure `sashModel` rules; Escape restores
 * the size captured when the sash was focused or dragged. No IPC, settings
 * bridge or new command id is needed — the size is persisted by `UiProvider`.
 */
import {
  useRef,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  sashSizeFromKey,
  sashSizeFromPointer,
  type SashAxis,
  type SashDirection,
  type SashRange,
} from '../../features/layout/sashModel';

export interface SashProps {
  /** Which pane edge this separator controls (also selects its CSS class). */
  placement: 'sidebar' | 'bottom' | 'ai';
  label: string;
  /** ARIA orientation of the separator itself. */
  orientation: 'vertical' | 'horizontal';
  axis: SashAxis;
  /** Maps an increasing coordinate to an increasing or decreasing pane size. */
  direction: SashDirection;
  value: number;
  range: SashRange;
  onChange: (value: number) => void;
}

export function Sash({
  placement,
  label,
  orientation,
  axis,
  direction,
  value,
  range,
  onChange,
}: SashProps): ReactNode {
  const dragRef = useRef<{
    pointerId: number;
    startCoordinate: number;
    startValue: number;
  } | null>(null);
  const focusStartRef = useRef(value);

  const coordinateOf = (event: PointerEvent<HTMLDivElement>): number =>
    axis === 'x' ? event.clientX : event.clientY;

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startCoordinate: coordinateOf(event),
      startValue: value,
    };
    focusStartRef.current = value;
    event.preventDefault();
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const drag = dragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) {
      return;
    }
    const next = sashSizeFromPointer(
      drag.startValue,
      drag.startCoordinate,
      coordinateOf(event),
      direction,
      range,
    );
    if (next !== value) {
      onChange(next);
    }
  };

  const handlePointerEnd = (event: PointerEvent<HTMLDivElement>): void => {
    if (dragRef.current?.pointerId !== event.pointerId) {
      return;
    }
    dragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    const next = sashSizeFromKey(
      value,
      focusStartRef.current,
      event.key,
      event.shiftKey,
      direction,
      range,
    );
    if (next === null) {
      return;
    }
    // Arrows and Escape are owned by the focused sash. Stop propagation so a
    // pending menu/chord/overlay handler cannot also consume them.
    event.preventDefault();
    event.stopPropagation();
    if (next !== value) {
      onChange(next);
    }
  };

  return (
    <div
      className={`sash sash--${placement} sash--${orientation}`}
      role="separator"
      aria-label={label}
      aria-orientation={orientation}
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      aria-valuenow={value}
      aria-valuetext={`${value} pixels`}
      tabIndex={0}
      onFocus={() => {
        focusStartRef.current = value;
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerEnd}
      onPointerCancel={handlePointerEnd}
      onLostPointerCapture={() => {
        dragRef.current = null;
      }}
      onKeyDown={handleKeyDown}
    >
      <span className="sash__grip" aria-hidden="true" />
    </div>
  );
}
