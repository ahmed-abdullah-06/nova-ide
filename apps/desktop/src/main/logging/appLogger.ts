/**
 * Bounded, redacted, rotating application log (Milestone 10B).
 *
 * The log is written to Electron's `logs` directory. Secrets are removed
 * with the shared redactor before a line reaches the disk. Files rotate at
 * a fixed size so the log can never grow without limit.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { redact, redactError } from '../../shared/redact';

export const DEFAULT_LOG_FILE = 'app.log';
export const DEFAULT_MAX_BYTES = 256 * 1024;
export const DEFAULT_MAX_FILES = 4;

/** The message shown to the user; it never contains error details. */
export const SAFE_ERROR_MESSAGE =
  'An unexpected error occurred. The details were written to the application ' +
  'log without secrets. You can open the log folder from Help → Open Logs Folder.';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

/** Formats one redacted log line. */
export function formatLogLine(
  level: LogLevel,
  scope: string,
  message: string,
  now: Date = new Date(),
): string {
  return `${now.toISOString()} ${level} [${scope}] ${redact(message)}\n`;
}

export interface AppLoggerOptions {
  directory: string;
  fileName?: string;
  maxBytes?: number;
  maxFiles?: number;
}

export class AppLogger {
  readonly directory: string;
  readonly fileName: string;
  readonly maxBytes: number;
  readonly maxFiles: number;
  private queue: Promise<void> = Promise.resolve();

  constructor(options: AppLoggerOptions) {
    this.directory = options.directory;
    this.fileName = options.fileName ?? DEFAULT_LOG_FILE;
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  }

  /** The path of the active log file. */
  get logFilePath(): string {
    return path.join(this.directory, this.fileName);
  }

  info(scope: string, message: string): void {
    this.write('INFO', scope, message);
  }

  warn(scope: string, message: string): void {
    this.write('WARN', scope, message);
  }

  error(scope: string, message: string, error?: unknown): void {
    const detail = error === undefined ? message : `${message}: ${redactError(error)}`;
    this.write('ERROR', scope, detail);
  }

  /** Waits until every queued line has been written. */
  async flush(): Promise<void> {
    await this.queue;
  }

  private write(level: LogLevel, scope: string, message: string): void {
    const line = formatLogLine(level, scope, message);
    this.queue = this.queue
      .then(() => this.append(line))
      .catch(() => undefined);
  }

  private async append(line: string): Promise<void> {
    await fs.mkdir(this.directory, { recursive: true });
    let size = 0;
    try {
      size = (await fs.stat(this.logFilePath)).size;
    } catch {
      // A missing file starts at zero.
    }
    if (size >= this.maxBytes) {
      await this.rotate();
    }
    await fs.appendFile(this.logFilePath, line, 'utf8');
  }

  /** Keeps at most `maxFiles` files, oldest discarded first. */
  private async rotate(): Promise<void> {
    for (let index = this.maxFiles - 1; index >= 1; index -= 1) {
      const target = path.join(this.directory, `${index}.${this.fileName}`);
      const source =
        index === 1
          ? this.logFilePath
          : path.join(this.directory, `${index - 1}.${this.fileName}`);
      try {
        await fs.rm(target, { force: true });
      } catch {
        // A missing older file is fine.
      }
      try {
        await fs.rename(source, target);
      } catch {
        // A missing source file is fine.
      }
    }
  }
}

/** The process methods used by the error handlers (injectable in tests). */
export interface ErrorHandlerTarget {
  on(event: string, listener: (error: unknown) => void): unknown;
}

export interface ErrorHandlerOptions {
  logger: AppLogger;
  /** Shows a safe, detail-free message in a dialog. */
  showMessage: (title: string, message: string) => void;
  /** Installs additional handlers (used by the tests). */
  target?: ErrorHandlerTarget;
}

/**
 * Installs the process-level error handlers. The known node-pty helper
 * rejection caused by the disabled RunAsNode fuse is logged as a warning
 * only; every other error shows the same safe message.
 */
export function installErrorHandlers(options: ErrorHandlerOptions): void {
  const target = options.target ?? process;
  const { logger, showMessage } = options;

  target.on('uncaughtException', (error: unknown) => {
    logger.error('main', 'uncaught exception', error);
    showMessage('Unexpected error', SAFE_ERROR_MESSAGE);
  });

  target.on('unhandledRejection', (reason: unknown) => {
    const message = redactError(reason);
    if (message.includes('runAsNode fuse')) {
      logger.warn('main', `node-pty helper unavailable: ${message}`);
      return;
    }
    logger.error('main', 'unhandled rejection', reason);
    showMessage('Unexpected error', SAFE_ERROR_MESSAGE);
  });
}
