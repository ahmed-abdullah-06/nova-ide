/**
 * Bounded redacted logging and safe error messages (Milestone 10B).
 */
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AppLogger,
  formatLogLine,
  installErrorHandlers,
  SAFE_ERROR_MESSAGE,
} from '../../apps/desktop/src/main/logging/appLogger';

let dir = '';

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'nova-logger-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('application log', () => {
  it('redacts secrets before writing a line', () => {
    const line = formatLogLine(
      'ERROR', 'main', 'request failed api_key=sk-abcdefgh12345678 Bearer token12345678',
    );
    expect(line).not.toContain('sk-abcdefgh12345678');
    expect(line).not.toContain('token12345678');
    expect(line).toContain('[redacted]');
  });

  it('writes a bounded number of rotated files', async () => {
    const logger = new AppLogger({ directory: dir, maxBytes: 120, maxFiles: 3 });
    for (let index = 0; index < 12; index += 1) {
      logger.info('test', `message number ${index} with some padding characters`);
      await logger.flush();
    }
    const files = (await readdir(dir)).sort();
    expect(files).toEqual(['1.app.log', '2.app.log', 'app.log']);
    for (const file of files) {
      const content = await readFile(path.join(dir, file), 'utf8');
      expect(content.length).toBeLessThanOrEqual(300);
    }
  });

  it('keeps only the newest log lines', async () => {
    const logger = new AppLogger({ directory: dir, maxBytes: 60, maxFiles: 2 });
    logger.info('test', 'first line that is long enough to rotate');
    await logger.flush();
    logger.info('test', 'second line that is long enough to rotate');
    await logger.flush();
    const active = await readFile(logger.logFilePath, 'utf8');
    expect(active).toContain('second line');
    expect(active).not.toContain('first line');
  });

  it('never writes the raw secret of an error to the log', async () => {
    const logger = new AppLogger({ directory: dir });
    logger.error('test', 'request failed', new Error('api key sk-abcdefgh12345678 rejected'));
    await logger.flush();
    const content = await readFile(logger.logFilePath, 'utf8');
    expect(content).not.toContain('sk-abcdefgh12345678');
    expect(content).toContain('[redacted]');
  });
});

describe('unhandled error handlers', () => {
  it('shows a safe message and logs a redacted error', async () => {
    const logger = new AppLogger({ directory: dir });
    const target = new EventEmitter();
    const messages: string[] = [];
    installErrorHandlers({
      logger,
      target: target as unknown as import('../../apps/desktop/src/main/logging/appLogger').ErrorHandlerTarget,
      showMessage: (_title, message) => messages.push(message),
    });

    target.emit('unhandledRejection', new Error('token sk-abcdefgh12345678 leaked'));
    await logger.flush();

    expect(messages).toEqual([SAFE_ERROR_MESSAGE]);
    expect(messages[0]).not.toContain('sk-abcdefgh12345678');
    const content = await readFile(logger.logFilePath, 'utf8');
    expect(content).not.toContain('sk-abcdefgh12345678');
    expect(content).toContain('unhandled rejection');
  });

  it('shows a safe message for an uncaught exception', async () => {
    const logger = new AppLogger({ directory: dir });
    const target = new EventEmitter();
    const messages: string[] = [];
    installErrorHandlers({
      logger,
      target: target as unknown as import('../../apps/desktop/src/main/logging/appLogger').ErrorHandlerTarget,
      showMessage: (_title, message) => messages.push(message),
    });
    target.emit('uncaughtException', new Error('child process crashed: api_key=sk-abcdefgh12345678'));
    await logger.flush();
    expect(messages).toEqual([SAFE_ERROR_MESSAGE]);
    const content = await readFile(logger.logFilePath, 'utf8');
    expect(content).not.toContain('sk-abcdefgh12345678');
    expect(content).toContain('uncaught exception');
  });

  it('treats the known node-pty fuse rejection as a warning only', async () => {
    const logger = new AppLogger({ directory: dir });
    const target = new EventEmitter();
    let shown = 0;
    installErrorHandlers({
      logger,
      target: target as unknown as import('../../apps/desktop/src/main/logging/appLogger').ErrorHandlerTarget,
      showMessage: () => { shown += 1; },
    });
    target.emit('unhandledRejection', new Error('runAsNode fuse disabled'));
    await logger.flush();
    expect(shown).toBe(0);
    expect(await readFile(logger.logFilePath, 'utf8')).toContain('node-pty helper unavailable');
  });

  it('keeps a pre-existing log file readable and appends to it', async () => {
    const logger = new AppLogger({ directory: dir });
    await writeFile(logger.logFilePath, 'existing line\n', 'utf8');
    logger.info('test', 'new line');
    await logger.flush();
    const content = await readFile(logger.logFilePath, 'utf8');
    expect(content).toContain('existing line');
    expect(content).toContain('new line');
  });
});
