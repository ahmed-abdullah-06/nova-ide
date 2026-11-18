/**
 * Minimal Chrome DevTools Protocol client.
 *
 * The Milestone 3 runtime verification drives the real application through
 * the DevTools protocol: it evaluates JavaScript in the renderer, collects
 * console output and reports the result. Only the standard library is used,
 * so the harness has no dependencies of its own.
 */
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Waits until the DevTools endpoint of the application answers.
 *
 * @param {string} host Host of the DevTools endpoint.
 * @param {number} port Port of the DevTools endpoint.
 * @param {number} timeoutMs Maximum time to wait.
 * @returns {Promise<boolean>} True when the endpoint answered.
 */
export async function waitForDevTools(
  host,
  port,
  timeoutMs = 60000,
) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://${host}:${port}/json/version`);
      if (response.ok) {
        return true;
      }
    } catch {
      // The application is not listening yet.
    }
    await delay(250);
  }
  return false;
}

/**
 * Finds the page target of the application (the renderer window).
 *
 * @param {string} host Host of the DevTools endpoint.
 * @param {number} port Port of the DevTools endpoint.
 * @returns {Promise<{id: string, url: string, webSocketDebuggerUrl: string} | null>}
 */
export async function findPageTarget(host, port) {
  const response = await fetch(`http://${host}:${port}/json/list`);
  if (!response.ok) {
    return null;
  }
  const targets = await response.json();
  for (const target of targets) {
    if (target.type === 'page' && target.webSocketDebuggerUrl) {
      return target;
    }
  }
  return null;
}

/**
 * A connection to the DevTools protocol of one target.
 */
export class DevToolsSession {
  #socket;
  #nextId = 1;
  #pending = new Map();
  #listeners = new Set();

  /**
   * @param {string} webSocketDebuggerUrl The WebSocket URL of the target.
   */
  constructor(webSocketDebuggerUrl) {
    this.#socket = new WebSocket(webSocketDebuggerUrl);
    this.#socket.addEventListener('message', (event) => {
      this.#handleMessage(String(event.data));
    });
  }

  /** Opens the connection and waits until it is usable. */
  async open() {
    if (this.#socket.readyState === WebSocket.OPEN) {
      return;
    }
    await new Promise((resolve, reject) => {
      this.#socket.addEventListener('open', resolve, { once: true });
      this.#socket.addEventListener('error', reject, { once: true });
    });
  }

  /** Closes the connection. */
  close() {
    this.#socket.close();
  }

  /**
   * Registers a listener for protocol events.
   *
   * @param {(method: string, params: object) => void} listener The listener.
   * @returns {() => void} A function that removes the listener.
   */
  on(listener) {
    this.#listeners.add(listener);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  /**
   * Sends a protocol command and waits for its answer.
   *
   * @param {string} method The method name.
   * @param {object} [params] The method parameters.
   * @returns {Promise<object>} The result of the command.
   */
  send(method, params = {}) {
    const id = this.#nextId;
    this.#nextId += 1;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
      this.#socket.send(payload);
    });
  }

  /**
   * Evaluates an expression in the renderer and returns its value.
   *
   * @param {string} expression The JavaScript expression to evaluate.
   * @returns {Promise<unknown>} The value of the expression.
   */
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
      allowUnsafeEvalBlockedByCSP: false,
    });
    if (result.exceptionDetails) {
      const text =
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        'evaluation failed';
      throw new Error(`Evaluation failed: ${text}`);
    }
    return result.result?.value;
  }

  /**
   * Sends text to the focused element as if it was typed.
   *
   * This is how the harness drives the terminal: the focus is moved to
   * the terminal's input area first, then the text is inserted.
   *
   * @param {string} text The text to insert.
   */
  async insertText(text) {
    await this.send('Input.insertText', { text });
  }

  /**
   * Types text with real key events. Monaco ignores `Input.insertText`
   * on some of its hidden textareas, but handles ordinary key events.
   *
   * @param {string} text The characters to type.
   */
  async typeText(text) {
    for (const char of text) {
      const upper = char.toUpperCase();
      const base = {
        key: char,
        code: `Key${upper}`,
        windowsVirtualKeyCode: upper.charCodeAt(0),
        nativeVirtualKeyCode: upper.charCodeAt(0),
      };
      await this.send('Input.dispatchKeyEvent', {
        ...base,
        type: 'keyDown',
        text: char,
      });
      await this.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
    }
  }

  /**
   * Presses a key, optionally with modifiers (for example Ctrl+K).
   *
   * @param {string} key The key value (for example `Enter` or `k`).
   * @param {number} [keyCode] The Windows virtual key code.
   * @param {string[]} [modifiers] Any of `alt`, `ctrl`, `meta`, `shift`.
   */
  async pressKey(key, keyCode, modifiers = []) {
    await this.#dispatchKey(key, key, keyCode, modifiers);
  }

  /**
   * Presses a key with an explicit `code`, so shortcuts such as Ctrl+K can
   * be driven exactly as the renderer's `KeyboardEvent.code` sees them.
   *
   * @param {string} key The key value (for example `k`).
   * @param {string} code The physical key code (for example `KeyK`).
   * @param {number} [keyCode] The Windows virtual key code.
   * @param {string[]} [modifiers] Any of `alt`, `ctrl`, `meta`, `shift`.
   */
  async pressShortcut(key, code, keyCode, modifiers = []) {
    await this.#dispatchKey(key, code, keyCode, modifiers);
  }

  /**
   * Types text with real `char` key events. Monaco does not reliably accept
   * `Input.insertText`, but handles these like ordinary keyboard input.
   *
   * @param {string} text The characters to type.
   */
  async typeText(text) {
    for (const char of text) {
      const upper = char.toUpperCase();
      await this.send('Input.dispatchKeyEvent', {
        type: 'char',
        text: char,
        key: char,
        code: `Key${upper}`,
        windowsVirtualKeyCode: upper.charCodeAt(0),
        nativeVirtualKeyCode: upper.charCodeAt(0),
      });
    }
  }

  /**
   * @param {string} key
   * @param {string} code
   * @param {number} keyCode
   * @param {string[]} modifiers
   */
  async #dispatchKey(key, code, keyCode, modifiers) {
    const bits = { alt: 1, ctrl: 2, meta: 4, shift: 8 };
    const modifierMask = modifiers.reduce(
      (mask, name) => mask | (bits[name] ?? 0),
      0,
    );
    const base = {
      key,
      code,
      windowsVirtualKeyCode: keyCode,
      nativeVirtualKeyCode: keyCode,
      modifiers: modifierMask,
    };
    await this.send('Input.dispatchKeyEvent', { ...base, type: 'keyDown' });
    await this.send('Input.dispatchKeyEvent', { ...base, type: 'keyUp' });
  }

  /** Handles an incoming protocol message. */
  #handleMessage(raw) {    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (typeof message.id === 'number') {
      const pending = this.#pending.get(message.id);
      if (pending !== undefined) {
        this.#pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message));
        } else {
          pending.resolve(message.result ?? {});
        }
      }
      return;
    }
    if (typeof message.method === 'string') {
      for (const listener of this.#listeners) {
        listener(message.method, message.params ?? {});
      }
    }
  }
}
