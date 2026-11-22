/**
 * Pure geometry and input rules for the three workbench sashes (LF5).
 *
 * Sizes are renderer-local pixel values. Keeping the clamping and input
 * mapping here makes the behaviour testable without mounting React or the
 * packaged app; the component only forwards pointer/keyboard coordinates.
 */

export type SashAxis = 'x' | 'y';

/** Direction a positive pointer/keyboard delta moves the controlled pane edge. */
export type SashDirection = 1 | -1;

export interface SashRange {
  min: number;
  max: number;
}

export const SIDEBAR_WIDTH_RANGE: SashRange = { min: 180, max: 520 };
export const BOTTOM_PANEL_HEIGHT_RANGE: SashRange = { min: 120, max: 520 };
export const AI_PANEL_WIDTH_RANGE: SashRange = { min: 240, max: 560 };

const KEY_STEP = 10;
const KEY_STEP_LARGE = 40;

/** Clamps a stored or dragged size to a sane, integer pixel value. */
export function clampSashSize(value: number, range: SashRange): number {
  if (!Number.isFinite(value)) {
    return range.min;
  }
  return Math.min(range.max, Math.max(range.min, Math.round(value)));
}

/** Maps a pointer delta to a pane size. */
export function sashSizeFromPointer(
  startSize: number,
  startCoordinate: number,
  currentCoordinate: number,
  direction: SashDirection,
  range: SashRange,
): number {
  return clampSashSize(
    startSize + (currentCoordinate - startCoordinate) * direction,
    range,
  );
}

export type SashKey =
  | 'ArrowLeft'
  | 'ArrowRight'
  | 'ArrowUp'
  | 'ArrowDown'
  | 'Home'
  | 'End'
  | 'Escape';

/**
 * Maps a focused sash key press to the next pane size, or `null` when the key
 * is not owned by the sash. `Escape` restores the size captured on focus.
 */
export function sashSizeFromKey(
  currentSize: number,
  focusStartSize: number,
  key: string,
  largeStep: boolean,
  direction: SashDirection,
  range: SashRange,
): number | null {
  if (key === 'Home') {
    return range.min;
  }
  if (key === 'End') {
    return range.max;
  }
  if (key === 'Escape') {
    return clampSashSize(focusStartSize, range);
  }

  let sign = 0;
  if (key === 'ArrowLeft' || key === 'ArrowUp') {
    sign = -1;
  } else if (key === 'ArrowRight' || key === 'ArrowDown') {
    sign = 1;
  }
  if (sign === 0) {
    return null;
  }
  return clampSashSize(
    currentSize + sign * (largeStep ? KEY_STEP_LARGE : KEY_STEP) * direction,
    range,
  );
}
