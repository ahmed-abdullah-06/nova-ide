import type { FocusKind, FocusTarget } from './types';

function labelFor(kind: FocusKind): string {
  switch (kind) {
    case 'monaco':
      return 'Editor';
    case 'terminal':
      return 'Terminal';
    case 'input':
      return 'Text field';
    case 'contenteditable':
      return 'Editable area';
    case 'other':
      return 'No editable target';
  }
}

/** Classifies the element that owns keyboard focus. */
export function getFocusTarget(): FocusTarget {
  if (typeof document === 'undefined') {
    return { kind: 'other', element: null, label: labelFor('other') };
  }
  const element = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;
  if (element === null) {
    return { kind: 'other', element: null, label: labelFor('other') };
  }
  let kind: FocusKind = 'other';
  if (element.closest('.monaco-editor') !== null) {
    kind = 'monaco';
  } else if (element.closest('.xterm') !== null) {
    kind = 'terminal';
  } else if (
    element.tagName === 'INPUT' ||
    element.tagName === 'TEXTAREA' ||
    element.tagName === 'SELECT'
  ) {
    kind = 'input';
  } else if (element.isContentEditable) {
    kind = 'contenteditable';
  }
  return { kind, element, label: labelFor(kind) };
}

export const EMPTY_FOCUS: FocusTarget = {
  kind: 'other',
  element: null,
  label: labelFor('other'),
};
