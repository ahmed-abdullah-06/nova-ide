/**
 * Watchdog for the child processes of the application (spec §19.6).
 *
 * On a normal quit the application terminates its children itself. But
 * a crash or a forced termination (`TerminateProcess`, a killed
 * console) skips every cleanup handler — and on Windows the children of
 * a dead process are *not* terminated by the operating system, so a
 * task or a shell would keep running in the background.
 *
 * The watchdog is a small helper process that
 *
 *  - knows the process ids of every child the application owns,
 *  - watches the main process, and
 *  - terminates the whole tree of every child once the main process is
 *    gone.
 *
 * The helper is a detached `cmd.exe` (Windows) or `/bin/sh` (POSIX)
 * script. It has to be detached: a child that belongs to the process
 * tree of the application is terminated together with it and could
 * never clean up.
 *
 * The helper cannot ask the operating system whether the main process
 * is still alive (`tasklist` needs a console, which a detached process
 * does not have). Instead the main process writes a heartbeat, and the
 * helper watches that counter: if it stops changing, the main process
 * is gone.
 */
import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

/** The directory the helper files live in. */
const WORK_DIR = path.join(tmpdir(), `nova-watchdog-${randomUUID()}`);

/** The file that holds the heartbeat of the main process. */
const HEARTBEAT_FILE = path.join(WORK_DIR, 'heartbeat.txt');

/** The file that holds the process ids of the children. */
const PID_FILE = path.join(WORK_DIR, 'children.pids');

/** How often the main process writes the heartbeat. */
const HEARTBEAT_INTERVAL_MS = 1000;

/** How many missed heartbeats mean that the main process is gone. */
const MISSED_HEARTBEATS = 5;

/**
 * The script of the watchdog (Windows).
 *
 * Only commands that work without a console are used: the builtins of
 * `cmd.exe` plus `ping` (which sleeps) and `taskkill` (which ends the
 * process tree).
 */
const WINDOWS_SCRIPT = [
  '@echo off',
  'setlocal',
  'set "LAST="',
  'set /a MISSED=0',
  ':loop',
  'set "COUNTER="',
  'set /p COUNTER<"%~1"',
  'if not "%COUNTER%"=="%LAST%" (',
  '  set "LAST=%COUNTER%"',
  '  set /a MISSED=0',
  ') else (',
  '  set /a MISSED+=1',
  ')',
  `if %MISSED% GEQ ${MISSED_HEARTBEATS} goto dead`,
  'ping -n 2 127.0.0.1 >NUL',
  'goto loop',
  ':dead',
  'for /f "usebackq tokens=*" %%p in ("%~2") do taskkill /T /F /PID %%p >NUL 2>&1',
  'exit /b 0',
  '',
].join('\r\n');

/** The script of the watchdog (POSIX). */
const POSIX_SCRIPT = [
  '#!/bin/sh',
  'last=""',
  'missed=0',
  'while true; do',
  '  counter=$(cat "$1" 2>/dev/null)',
  '  if [ "$counter" != "$last" ]; then',
  '    last="$counter"',
  '    missed=0',
  '  else',
  '    missed=$((missed + 1))',
  '  fi',
  '  if [ "$missed" -ge 5 ]; then',  '    break',
  '  fi',
  '  sleep 1',
  'done',
  'while read -r pid; do',
  '  [ -n "$pid" ] || continue',
  '  kill -TERM "-$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null',
  'done < "$2"',
  'sleep 1',
  'while read -r pid; do',
  '  [ -n "$pid" ] || continue',
  '  kill -KILL "-$pid" 2>/dev/null || kill -KILL "$pid" 2>/dev/null',
  'done < "$2"',
  'exit 0',
  '',
].join('\n');

export class ChildWatchdog {
  /** The helper process (null while it is not running). */
  private helper: ChildProcess | null = null;
  /** The process ids the application owns. */
  private readonly children = new Set<number>();
  /** The heartbeat counter (incremented every second). */
  private counter = 0;
  /** The timer that writes the heartbeat. */
  private timer: NodeJS.Timeout | null = null;
  /** True once the helper files have been written. */
  private started = false;

  /** Starts the watchdog. Safe to call more than once. */
  start(): void {
    if (this.started) {
      return;
    }
    this.started = true;
    try {
      mkdirSync(WORK_DIR, { recursive: true });
      this.writeHeartbeat();
      this.writePidFile();

      const isWindows = process.platform === 'win32';
      const scriptPath = path.join(
        WORK_DIR,
        isWindows ? 'watchdog.cmd' : 'watchdog.sh',
      );
      writeFileSync(
        scriptPath,
        isWindows ? WINDOWS_SCRIPT : POSIX_SCRIPT,
        'utf8',
      );

      const helper = isWindows
        ? spawn(
            'cmd.exe',
            ['/d', '/s', '/c', scriptPath, HEARTBEAT_FILE, PID_FILE],
            {
              windowsHide: true,
              stdio: 'ignore',
              // The helper has to survive the death of the application —
              // that is the whole point of the watchdog.
              detached: true,
            },
          )
        : spawn(
            '/bin/sh',
            [scriptPath, HEARTBEAT_FILE, PID_FILE],
            { stdio: 'ignore', detached: true },
          );
      helper.unref();
      helper.on('error', (error) => {
        console.error('[watchdog] the helper could not be started:', error);
        this.helper = null;
      });
      this.helper = helper;

      this.timer = setInterval(() => {
        this.writeHeartbeat();
      }, HEARTBEAT_INTERVAL_MS);
      this.timer.unref();
    } catch (error) {
      console.error('[watchdog] the helper could not be started:', error);
      this.helper = null;
    }
  }

  /**
   * Registers a child process.
   *
   * The process is terminated with its whole tree when the application
   * dies unexpectedly.
   */
  track(pid: number | undefined): void {
    if (pid === undefined || !Number.isInteger(pid) || pid <= 0) {
      return;
    }
    this.children.add(pid);
    this.writePidFile();
  }

  /** Forgets a child process that has ended by itself. */
  untrack(pid: number | undefined): void {
    if (pid === undefined) {
      return;
    }
    this.children.delete(pid);
    this.writePidFile();
  }

  /** Writes the heartbeat, so the helper knows the app is still alive. */
  private writeHeartbeat(): void {
    this.counter += 1;
    try {
      writeFileSync(HEARTBEAT_FILE, String(this.counter), 'utf8');
    } catch {
      // The helper cannot be reached; the cleanup is lost for this run.
    }
  }

  /** Writes the process ids of the children, so the helper can read them. */
  private writePidFile(): void {
    try {
      writeFileSync(PID_FILE, [...this.children].join('\r\n'), 'utf8');
    } catch (error) {
      console.error('[watchdog] the process list could not be written:', error);
    }
  }

  /**
   * Stops the watchdog.
   *
   * The children are not terminated here — the services do that.
   */
  stop(): void {
    this.children.clear();
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
    try {
      this.helper?.kill();
    } catch {
      // The helper may already be gone.
    }
    this.helper = null;
  }
}
