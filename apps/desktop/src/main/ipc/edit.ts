/**
 * Native Edit actions for text fields outside Monaco.
 *
 * There is no `document.execCommand` and no renderer clipboard access: the
 * main process applies Electron's own editing actions to the webContents that
 * sent the request. A renderer cannot name another window or inject a script.
 */
import type { IpcMainInvokeEvent } from 'electron';
import type { EditWebContentsAction } from '../../shared/ipc-types';

/** The small part of `WebContents` these actions need (unit-testable). */
export interface EditableWebContents {
  undo(): void;
  redo(): void;
  cut(): void;
  copy(): void;
  paste(): void;
}

export function runWebContentsAction(
  target: EditableWebContents,
  action: EditWebContentsAction,
): void {
  switch (action) {
    case 'undo':
      target.undo();
      break;
    case 'redo':
      target.redo();
      break;
    case 'cut':
      target.cut();
      break;
    case 'copy':
      target.copy();
      break;
    case 'paste':
      target.paste();
      break;
  }
}

export interface EditHandlers {
  webContentsAction(
    event: IpcMainInvokeEvent,
    action: EditWebContentsAction,
  ): Promise<void>;
}

export function createEditHandlers(): EditHandlers {
  return {
    async webContentsAction(event, action) {
      // Electron's `event.sender` IS the webContents of the invoking renderer.
      // It is the only valid target: never a window chosen by the renderer.
      runWebContentsAction(event.sender, action);
    },
  };
}
