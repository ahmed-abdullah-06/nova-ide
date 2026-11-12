/**
 * The central permission policy of the agent (spec §12.3, §19.4).
 *
 * EVERY tool call passes through this module — the agent and the model
 * can never widen a permission. The policy decides:
 *
 *  1. is the tool on the allowlist at all,
 *  2. is its permission level allowed by the settings of the user,
 *  3. is the path inside the workspace (the canonical check of the M2
 *     path security, which resolves symbolic links),
 *  4. is the file excluded (a secret, an ignored file, a binary file,
 *     a file that is too large),
 *  5. does the user have to approve it.
 *
 * The decisions are made in the main process; the renderer can only
 * approve a request that already exists for the active run.
 */
import path from 'node:path';
import type {
  AgentPermissionDecision,
  AgentPermissionLevel,
  AgentToolParameter,
  AgentToolSchema,
} from '../../shared/agent-types';
import { isExcludedFile } from '../providers/privacy';
import { resolveInWorkspace } from '../services/pathSecurity';

/** The tools the agent may use. */
export const AGENT_TOOL_NAMES = [
  'list_directory',
  'read_file',
  'search_files',
  'git_status',
  'git_diff',
  'write_file',
  'apply_edit',
  'run_command',
] as const;

/** The name of a tool of the agent. */
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

/** The settings that decide which levels are allowed. */
export interface AgentPermissionSettings {
  /** The levels the user allows without an approval. */
  allowedLevels: AgentPermissionLevel[];
  /** True when the user allows the agent to send content to a cloud provider. */
  allowCloudContext: boolean;
}

/** The default settings: everything that changes something needs a user. */
export const DEFAULT_PERMISSION_SETTINGS: AgentPermissionSettings = {
  allowedLevels: ['read'],
  allowCloudContext: false,
};

/** The result of a permission check. */
export interface PermissionOutcome {
  /** The decision. */
  decision: AgentPermissionDecision;
  /** The reason (shown to the user, never to the model). */
  reason: string;
  /** The level of the tool. */
  level: AgentPermissionLevel;
}

/**
 * The tools that are never allowed in this milestone (spec: no delete, no
 * rename, no git commit or push, no installation).
 */
const FORBIDDEN_TOOL_NAMES = new Set([
  'delete_file',
  'delete_directory',
  'rename_file',
  'git_commit',
  'git_push',
  'git_reset',
  'git_checkout',
  'install_package',
  'run_tests_outside_workspace',
]);

/** The programs that are never allowed, whatever the approval is. */
const FORBIDDEN_PROGRAMS = new Set([
  // Package installation.
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'pip',
  'pip3',
  'gem',
  'composer',
  'choco',
  'winget',
  'brew',
  // Deleting.
  'rm',
  'del',
  'rmdir',
  'rd',
  'erase',
  'remove-item',
  // Shells (they would bypass the argument array).
  'sh',
  'bash',
  'zsh',
  'cmd',
  'powershell',
  'pwsh',
  // System configuration.
  'sudo',
  'su',
  'chmod',
  'chown',
  'setx',
  'reg',
  'regedit',
  'sc',
  'net',
  'netsh',
  'taskkill',
  'tasklist',
]);

/** The interpreters: a script is fine, an inline program is a shell. */
const INTERPRETERS = new Set(['node', 'python', 'python3', 'perl', 'ruby']);

/** The arguments of an interpreter that turn it into a shell. */
const INLINE_ARGUMENTS = new Set(['-e', '--eval', '-c', '-p', '--print']);

/** The git commands that change the history or publish something. */
const FORBIDDEN_GIT_SUBCOMMANDS = new Set([
  'commit',
  'push',
  'reset',
  'rebase',
  'merge',
  'tag',
  'checkout',
  'switch',
  'clean',
  'am',
]);

/** True when the command is on the list of forbidden commands. */
export function isForbiddenCommand(argv: readonly string[]): boolean {
  if (argv.length === 0) {
    return true;
  }
  const program = (path.basename(argv[0] ?? '') ?? '')
    .toLowerCase()
    .replace(/\.exe$/, '');

  if (FORBIDDEN_PROGRAMS.has(program)) {
    return true;
  }
  if (INTERPRETERS.has(program)) {
    // An interpreter with an inline program is a shell in disguise.
    if (
      argv
        .slice(1)
        .some((argument) => INLINE_ARGUMENTS.has(argument.toLowerCase()))
    ) {
      return true;
    }
  }
  if (program === 'git') {
    const subcommand = (argv[1] ?? '').toLowerCase();
    if (FORBIDDEN_GIT_SUBCOMMANDS.has(subcommand)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks the tool call against the allowlist and the settings.
 *
 * @param tool The tool the model wants to use.
 * @param settings The settings of the user.
 * @returns The decision.
 */
export function checkToolPermission(
  tool: AgentToolSchema,
  settings: AgentPermissionSettings,
): PermissionOutcome {
  if (FORBIDDEN_TOOL_NAMES.has(tool.name)) {
    return {
      decision: 'deny',
      level: tool.level,
      reason: `The tool "${tool.name}" is not available in this version.`,
    };
  }
  if (tool.level === 'system') {
    return {
      decision: 'deny',
      level: tool.level,
      reason: 'This operation would change something outside the workspace.',
    };
  }
  if (settings.allowedLevels.includes(tool.level)) {
    return {
      decision: 'allow',
      level: tool.level,
      reason: 'The user allows this kind of operation.',
    };
  }
  return {
    decision: 'ask',
    level: tool.level,
    reason:
      tool.level === 'command'
        ? 'The agent wants to run a command.'
        : 'The agent wants to change a file of the workspace.',
  };
}

/**
 * Checks a path against the workspace and the exclusions.
 *
 * The canonical check of Milestone 2 is used, so a symbolic link that
 * leaves the workspace is refused as well.
 *
 * @param root The canonical root of the workspace.
 * @param relativePath The path relative to the workspace.
 * @param options The kind of the check.
 * @returns The decision.
 */
export async function checkPathPermission(
  root: string,
  relativePath: string,
  options: { mustExist?: boolean; allowRoot?: boolean } = {},
): Promise<PermissionOutcome> {
  const allow: PermissionOutcome = {
    decision: 'allow',
    level: 'read',
    reason: '',
  };

  if (relativePath.length === 0) {
    return {
      decision: 'deny',
      level: 'read',
      reason: 'The path is empty.',
    };
  }
  if (relativePath.includes('\0')) {
    return {
      decision: 'deny',
      level: 'read',
      reason: 'The path is not valid.',
    };
  }

  const absolute = path.resolve(root, relativePath);
  const relation = path.relative(path.resolve(root), absolute);
  if (relation.startsWith('..') || path.isAbsolute(relation)) {
    return {
      decision: 'deny',
      level: 'read',
      reason: 'The path is outside the workspace.',
    };
  }
  if (relation === '' && options.allowRoot === false) {
    return {
      decision: 'deny',
      level: 'read',
      reason: 'The workspace root cannot be changed.',
    };
  }

  if (isExcludedFile(relation)) {
    return {
      decision: 'deny',
      level: 'read',
      reason:
        'This file is never read by the agent ' +
        '(it usually holds a secret or it is ignored by Git).',
    };
  }

  // The canonical check: the deepest existing ancestor is resolved, so a
  // symbolic link that points outside of the workspace is refused.
  const resolved = await resolveInWorkspace(root, absolute, {
    allowRoot: options.allowRoot !== false,
    mustExist: options.mustExist === true,
  });
  if (!resolved.ok) {
    return {
      decision: 'deny',
      level: 'read',
      reason:
        resolved.code === 'OUTSIDE_WORKSPACE'
          ? 'The path is outside the workspace.'
          : resolved.message,
    };
  }

  return allow;
}

/**
 * Validates the arguments of a tool against its schema.
 *
 * The output of a model is never trusted: an unknown property, a missing
 * property or a wrong type is an error, not something that is "made to
 * work".
 *
 * @param tool The tool that is called.
 * @param args The arguments of the model.
 * @returns The validated arguments, or the reason why they are invalid.
 */
export function validateToolArguments(
  tool: AgentToolSchema,
  args: unknown,
): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return { ok: false, reason: 'The arguments must be an object.' };
  }
  const record = args as Record<string, unknown>;
  const value: Record<string, unknown> = {};

  for (const key of Object.keys(record)) {
    if (!(key in tool.parameters)) {
      return {
        ok: false,
        reason: `The tool "${tool.name}" has no parameter "${key}".`,
      };
    }
  }

  for (const [name, parameter] of Object.entries(tool.parameters)) {
    const given = record[name];
    if (given === undefined || given === null) {
      if (parameter.required === true) {
        return {
          ok: false,
          reason: `The parameter "${name}" is required.`,
        };
      }
      continue;
    }
    const checked = checkValue(parameter, given);
    if (checked === null) {
      return {
        ok: false,
        reason: `The parameter "${name}" has the wrong type.`,
      };
    }
    value[name] = checked;
  }

  return { ok: true, value };
}

/** Checks one value against its parameter description. */
function checkValue(
  parameter: AgentToolParameter,
  given: unknown,
): unknown | null {
  switch (parameter.type) {
    case 'string': {
      if (typeof given !== 'string') {
        return null;
      }
      if (given.length > 8192) {
        return null;
      }
      if (
        parameter.values !== undefined &&
        !parameter.values.includes(given)
      ) {
        return null;
      }
      return given;
    }
    case 'number': {
      return typeof given === 'number' && Number.isFinite(given)
        ? given
        : null;
    }
    case 'boolean': {
      return typeof given === 'boolean' ? given : null;
    }
    case 'array': {
      if (!Array.isArray(given)) {
        return null;
      }
      if (given.length > 100) {
        return null;
      }
      if (parameter.itemType === 'string') {
        if (!given.every((item) => typeof item === 'string')) {
          return null;
        }
      }
      return given;
    }
    default:
      return null;
  }
}
