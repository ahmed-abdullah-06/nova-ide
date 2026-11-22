/**
 * LF5 sash input rules: clamping, pointer deltas and keyboard ownership.
 * These are pure functions so the packaged drag/focus behaviour has a stable
 * contract without mounting React or the workbench.
 */
import { describe, expect, it } from 'vitest';
import {
  AI_PANEL_WIDTH_RANGE,
  BOTTOM_PANEL_HEIGHT_RANGE,
  SIDEBAR_WIDTH_RANGE,
  clampSashSize,
  sashSizeFromKey,
  sashSizeFromPointer,
} from '../../apps/desktop/src/renderer/features/layout/sashModel';

describe('look and feel: LF5 sash geometry', () => {
  it('clamps sizes to whole pixels inside each pane range', () => {
    for (const range of [
      SIDEBAR_WIDTH_RANGE,
      BOTTOM_PANEL_HEIGHT_RANGE,
      AI_PANEL_WIDTH_RANGE,
    ]) {
      expect(range.min).toBeLessThan(range.max);
      expect(clampSashSize(range.min - 100, range)).toBe(range.min);
      expect(clampSashSize(range.max + 100, range)).toBe(range.max);
      expect(clampSashSize(250.7, range)).toBe(251);
      expect(clampSashSize(Number.NaN, range)).toBe(range.min);
    }
  });

  it('maps pointer direction per pane', () => {
    const range = { min: 100, max: 400 };
    expect(sashSizeFromPointer(200, 500, 560, 1, range)).toBe(260);
    expect(sashSizeFromPointer(200, 500, 560, -1, range)).toBe(140);
    expect(sashSizeFromPointer(200, 500, 900, 1, range)).toBe(400);
    expect(sashSizeFromPointer(200, 500, 600, -1, range)).toBe(100);
  });

  it('moves the focused sash with arrows and larger Shift steps', () => {
    const range = { min: 100, max: 400 };
    expect(sashSizeFromKey(200, 200, 'ArrowRight', false, 1, range)).toBe(210);
    expect(sashSizeFromKey(200, 200, 'ArrowLeft', false, 1, range)).toBe(190);
    expect(sashSizeFromKey(200, 200, 'ArrowDown', true, -1, range)).toBe(160);
    expect(sashSizeFromKey(200, 200, 'ArrowUp', false, -1, range)).toBe(210);
    expect(sashSizeFromKey(105, 105, 'ArrowLeft', true, 1, range)).toBe(100);
  });

  it('supports Home, End and Escape restore without claiming other keys', () => {
    const range = { min: 100, max: 400 };
    expect(sashSizeFromKey(220, 180, 'Home', false, 1, range)).toBe(100);
    expect(sashSizeFromKey(220, 180, 'End', false, -1, range)).toBe(400);
    expect(sashSizeFromKey(260, 180, 'Escape', false, 1, range)).toBe(180);
    expect(sashSizeFromKey(220, 180, 'a', false, 1, range)).toBeNull();
    expect(sashSizeFromKey(220, 180, 'Enter', false, 1, range)).toBeNull();
  });
});
