/** Native Edit actions never use DOM clipboard APIs and never target another window. */
import { describe, expect, it, vi } from 'vitest';
import {
  createEditHandlers,
  runWebContentsAction,
  type EditableWebContents,
} from '../../apps/desktop/src/main/ipc/edit';
import type { EditWebContentsAction } from '../../apps/desktop/src/shared/ipc-types';

function fakeWebContents(): EditableWebContents {
  return {
    undo: vi.fn(),
    redo: vi.fn(),
    cut: vi.fn(),
    copy: vi.fn(),
    paste: vi.fn(),
  };
}

describe('native edit actions', () => {
  it('dispatches each action to the matching native method', () => {
    const actions: EditWebContentsAction[] = ['undo', 'redo', 'cut', 'copy', 'paste'];
    for (const action of actions) {
      const target = fakeWebContents();
      runWebContentsAction(target, action);
      for (const method of actions) {
        expect(target[method]).toHaveBeenCalledTimes(method === action ? 1 : 0);
      }
    }
  });

  it('acts only on the sender webContents', async () => {
    const sender = fakeWebContents();
    const other = fakeWebContents();
    const handlers = createEditHandlers();
    // Electron's event.sender is the webContents. Any extra fields a hostile
    // renderer might try to smuggle in are ignored.
    const event = { sender, otherWebContents: other };
    await handlers.webContentsAction(event as never, 'copy');
    expect(sender.copy).toHaveBeenCalledTimes(1);
    expect(other.copy).not.toHaveBeenCalled();
  });
});
