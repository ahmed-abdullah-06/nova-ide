/**
 * Tests for the permission policy of the agent (spec §12.3, §19.4).
 *
 * The policy is the only thing that decides whether a tool call is
 * allowed, so it is tested against the real paths: a traversal attempt,
 * a symbolic link that leaves the workspace, a file with a secret and a
 * command that would change something.
 */
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  checkPathPermission,
  checkToolPermission,
  isForbiddenCommand,
  validateToolArguments,
} from '../../apps/desktop/src/main/agent/permissions';
import { AGENT_TOOLS } from '../../apps/desktop/src/main/agent/tools';
import type { AgentToolSchema } from '../../apps/desktop/src/shared/agent-types';

let root = '';
let outside = '';

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), 'nova-agent-'));
  outside = await mkdtemp(path.join(tmpdir(), 'nova-outside-'));
  await mkdir(path.join(root, 'src'), { recursive: true });
  await writeFile(
    path.join(root, 'src', 'app.ts'),
    'export const a = 1;\n',
    'utf8',
  );
  await writeFile(path.join(root, '.env'), 'SECRET=abc\n', 'utf8');
  await writeFile(path.join(outside, 'secret.txt'), 'outside\n', 'utf8');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('the permission of a tool', () => {
  /** The tool with the given name. */
  const tool = (name: string): AgentToolSchema => {
    const found = AGENT_TOOLS.find((entry) => entry.name === name);
    if (found === undefined) {
      throw new Error(`unknown tool ${name}`);
    }
    return found;
  };

  it('allows a read only tool', () => {
    const outcome = checkToolPermission(tool('read_file'), {
      allowedLevels: ['read'],
      allowCloudContext: false,
    });
    expect(outcome.decision).toBe('allow');
  });

  it('asks the user before a file is changed', () => {
    const outcome = checkToolPermission(tool('write_file'), {
      allowedLevels: ['read'],
      allowCloudContext: false,
    });
    expect(outcome.decision).toBe('ask');
  });

  it('asks the user before a command runs', () => {
    const outcome = checkToolPermission(tool('run_command'), {
      allowedLevels: ['read'],
      allowCloudContext: false,
    });
    expect(outcome.decision).toBe('ask');
  });

  it('allows a file change when the user allows it', () => {
    const outcome = checkToolPermission(tool('write_file'), {
      allowedLevels: ['read', 'workspace'],
      allowCloudContext: false,
    });
    expect(outcome.decision).toBe('allow');
  });

  it('refuses a tool that is not allowed at all', () => {
    const outcome = checkToolPermission(
      { ...tool('read_file'), name: 'delete_file' },
      {
        allowedLevels: ['read', 'workspace', 'command'],
        allowCloudContext: true,
      },
    );
    expect(outcome.decision).toBe('deny');
  });

  it('refuses a tool of the system level', () => {
    const outcome = checkToolPermission(
      { ...tool('read_file'), level: 'system' },
      {
        allowedLevels: ['read', 'workspace', 'command', 'system'],
        allowCloudContext: true,
      },
    );
    expect(outcome.decision).toBe('deny');
  });
});

describe('the permission of a path', () => {
  it('allows a file of the workspace', async () => {
    const outcome = await checkPathPermission(root, 'src/app.ts');
    expect(outcome.decision).toBe('allow');
  });

  it('refuses a traversal attempt', async () => {
    const traversal = await checkPathPermission(root, '../../etc/passwd');
    expect(traversal.decision).toBe('deny');
    const nested = await checkPathPermission(root, 'src/../../outside');
    expect(nested.decision).toBe('deny');
  });

  it('refuses an absolute path outside the workspace', async () => {
    const outcome = await checkPathPermission(
      root,
      path.join(outside, 'secret.txt'),
    );
    expect(outcome.decision).toBe('deny');
  });

  it('refuses a symbolic link that leaves the workspace', async () => {
    const link = path.join(root, 'escape.txt');
    try {
      // A junction works without special privileges on Windows.
      await symlink(path.join(outside, 'secret.txt'), link, 'junction');
    } catch {
      console.log('SKIP  junction not creatable without privilege');
      return;
    }
    const outcome = await checkPathPermission(root, 'escape.txt');
    // The canonical check resolves the link, so the file behind it is
    // outside of the workspace.
    expect(outcome.decision).toBe('deny');
  });

  it('refuses a file that holds a secret', async () => {
    const outcome = await checkPathPermission(root, '.env');
    expect(outcome.decision).toBe('deny');
    expect(outcome.reason).toContain('never read');
  });

  it('refuses a private key', async () => {
    const pem = await checkPathPermission(root, 'certs/server.pem');
    expect(pem.decision).toBe('deny');
    const rsa = await checkPathPermission(root, 'id_rsa');
    expect(rsa.decision).toBe('deny');
  });

  it('refuses the workspace root when it may not be changed', async () => {
    const outcome = await checkPathPermission(root, '.', {
      allowRoot: false,
    });
    expect(outcome.decision).toBe('deny');
  });

  it('refuses an empty path', async () => {
    const outcome = await checkPathPermission(root, '');
    expect(outcome.decision).toBe('deny');
  });
});

describe('the forbidden commands', () => {
  it('refuses the installation of a package', () => {
    expect(isForbiddenCommand(['npm', 'install'])).toBe(true);
    expect(isForbiddenCommand(['pnpm', 'add', 'left-pad'])).toBe(true);
    expect(isForbiddenCommand(['pip', 'install', 'requests'])).toBe(true);
  });

  it('refuses git commands that change the history', () => {
    expect(isForbiddenCommand(['git', 'commit', '-m', 'x'])).toBe(true);
    expect(isForbiddenCommand(['git', 'push'])).toBe(true);
    expect(isForbiddenCommand(['git', 'reset', '--hard'])).toBe(true);
  });

  it('refuses the deletion of files', () => {
    expect(isForbiddenCommand(['rm', '-rf', 'x'])).toBe(true);
    expect(isForbiddenCommand(['del', 'x'])).toBe(true);
  });

  it('refuses a shell (it would bypass the argument array)', () => {
    expect(isForbiddenCommand(['bash', '-c', 'ls'])).toBe(true);
    expect(isForbiddenCommand(['cmd.exe', '/c', 'dir'])).toBe(true);
    expect(isForbiddenCommand(['powershell', '-Command', 'ls'])).toBe(true);
  });

  it('refuses an interpreter with an inline program', () => {
    expect(isForbiddenCommand(['node', '-e', 'process.exit(1)'])).toBe(true);
    expect(isForbiddenCommand(['python', '-c', 'print(1)'])).toBe(true);
  });

  it('allows an inspection command', () => {
    expect(isForbiddenCommand(['git', 'status'])).toBe(false);
    expect(isForbiddenCommand(['node', '--version'])).toBe(false);
    expect(isForbiddenCommand(['node', 'scripts/build.js'])).toBe(false);
  });

  it('refuses an empty command', () => {
    expect(isForbiddenCommand([])).toBe(true);
  });
});

describe('the validation of the arguments of a tool', () => {
  const readFile = AGENT_TOOLS.find((entry) => entry.name === 'read_file');

  it('accepts the arguments of the tool', () => {
    const result = validateToolArguments(readFile!, { path: 'a.ts' });
    expect(result.ok).toBe(true);
  });

  it('refuses an unknown property', () => {
    const result = validateToolArguments(readFile!, {
      path: 'a.ts',
      evil: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('no parameter');
    }
  });

  it('refuses a missing required property', () => {
    const result = validateToolArguments(readFile!, {});
    expect(result.ok).toBe(false);
  });

  it('refuses a property with the wrong type', () => {
    const result = validateToolArguments(readFile!, { path: 42 });
    expect(result.ok).toBe(false);
  });

  it('refuses arguments that are not an object', () => {
    expect(validateToolArguments(readFile!, 'path').ok).toBe(false);
    expect(validateToolArguments(readFile!, ['path']).ok).toBe(false);
    expect(validateToolArguments(readFile!, null).ok).toBe(false);
  });

  it('refuses an argument that is too long', () => {
    const result = validateToolArguments(readFile!, { path: 'x'.repeat(9000) });
    expect(result.ok).toBe(false);
  });

  it('refuses a value that is not in the list of the parameter', () => {
    const runCommand = AGENT_TOOLS.find((entry) => entry.name === 'run_command');
    const result = validateToolArguments(runCommand!, {
      script: 'build',
      argv: 'not an array',
    });
    expect(result.ok).toBe(false);
  });
});
