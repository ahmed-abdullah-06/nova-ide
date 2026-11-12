/**
 * The tool executor of the agent (spec §10.5, §12).
 *
 * The executor performs the tools of the registry. It is separate from
 * the agent loop (which decides what to do) and from the provider layer
 * (which talks to the model).
 *
 * Every call goes through the permission policy first. The executor
 * never writes to the disk on its own: the write tools create a
 * proposal that the user has to accept.
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import type {
  AgentCommandRecord,
  AgentProposal,
  AgentToolSchema,
} from '../../shared/agent-types';
import { MAX_TOOL_RESULT_CHARS } from '../../shared/agent-types';
import type { FileSystemService } from '../services/fileSystemService';
import type { GitService } from '../services/gitService';
import type { SearchService } from '../services/searchService';
import type { TaskService } from '../services/taskService';
import { checkPathPermission, checkToolPermission } from './permissions';
import type { AgentPermissionSettings } from './permissions';
import { redact } from '../providers/redact';

/** The result of a tool call. */
export interface ToolResult {
  /** True when the tool did what it was asked to do. */
  ok: boolean;
  /** The text that goes back to the model. */
  content: string;
  /** The error (for the summary of the run). */
  error?: string;
  /** True when the tool was stopped. */
  cancelled?: boolean;
  /** The files the tool looked at. */
  inspected?: string[];
  /** The command the tool ran (for the summary of the run). */
  command?: AgentCommandRecord;
}

/** What a tool needs to run. */
export interface ToolContext {
  /** The id of the run. */
  runId: string;
  /** The canonical root of the workspace. */
  root: string;
  /** Aborts the run (and every command of it). */
  signal: AbortSignal;
  /** The settings of the user. */
  settings: AgentPermissionSettings;
  /**
   * Asks the user to approve an operation.
   *
   * @returns True when the user approved it.
   */
  requestApproval: (request: {
    kind: 'command' | 'cloud-context';
    tool: string;
    argv?: string[];
    script?: string;
    reason: string;
  }) => Promise<boolean>;
  /** Creates a change proposal (the write tools). */
  createProposal: (input: {
    path: string;
    relativePath: string;
    before: string;
    after: string;
    expectedMtimeMs: number | null;
    created: boolean;
  }) => AgentProposal;
  /** The commands that ran (for the summary of the run). */
  commands: AgentCommandRecord[];
  /** The files the agent looked at. */
  inspected: string[];
}

/** The services the executor uses. */
export interface ToolExecutorDependencies {
  files: FileSystemService;
  search: SearchService;
  git: GitService;
  tasks: TaskService;
}

export class ToolExecutor {
  private readonly deps: ToolExecutorDependencies;

  constructor(deps: ToolExecutorDependencies) {
    this.deps = deps;
  }

  /**
   * Runs a tool.
   *
   * @param tool The tool the model wants to use.
   * @param args The (already validated) arguments of the model.
   * @param context What the tool needs.
   * @returns The result of the tool.
   */
  async execute(
    tool: AgentToolSchema,
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const permission = checkToolPermission(tool, context.settings);
    if (permission.decision === 'deny') {
      return {
        ok: false,
        content: `The tool "${tool.name}" is not allowed: ${permission.reason}`,
        error: permission.reason,
      };
    }

    switch (tool.name) {
      case 'list_directory':
        return this.listDirectory(args, context);
      case 'read_file':
        return this.readFile(args, context);
      case 'search_files':
        return this.searchFiles(args, context);
      case 'git_status':
        return this.gitStatus();
      case 'git_diff':
        return this.gitDiff(args, context);
      case 'write_file':
        return this.writeFile(args, context);
      case 'apply_edit':
        return this.applyEdit(args, context);
      case 'run_command':
        return this.runCommand(args, context);
      default:
        return {
          ok: false,
          content: `The tool "${tool.name}" does not exist.`,
          error: 'unknown tool',
        };
    }
  }

  /** Lists the entries of a directory. */
  private async listDirectory(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const relative = String(args.path ?? '');
    const check = await checkPathPermission(context.root, relative, {
      mustExist: true,
      allowRoot: true,
    });
    if (check.decision === 'deny') {
      return {
        ok: false,
        content: `The path cannot be read: ${check.reason}`,
        error: check.reason,
      };
    }
    const listing = await this.deps.files.readDirectory(
      path.resolve(context.root, relative),
    );
    if (!listing.ok) {
      return {
        ok: false,
        content: `The directory could not be read: ${listing.message}`,
        error: listing.message,
      };
    }
    const lines = listing.value.entries.map(
      (entry) => `${entry.kind === 'directory' ? 'd' : '-'} ${entry.name}`,
    );
    return {
      ok: true,
      content:
        lines.length === 0
          ? 'The directory is empty.'
          : `${relative}:\n${lines.join('\n')}`,
      inspected: [relative],
    };
  }

  /** Reads a text file. */
  private async readFile(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const relative = String(args.path ?? '');
    const check = await checkPathPermission(context.root, relative, {
      mustExist: true,
      allowRoot: false,
    });
    if (check.decision === 'deny') {
      return {
        ok: false,
        content: `The file cannot be read: ${check.reason}`,
        error: check.reason,
      };
    }
    const file = await this.deps.files.readFile(
      path.resolve(context.root, relative),
    );
    if (!file.ok) {
      return {
        ok: false,
        content: `The file could not be read: ${file.message}`,
        error: file.message,
      };
    }
    const truncated = file.value.content.length > MAX_TOOL_RESULT_CHARS;
    const content = redact(
      truncated
        ? file.value.content.slice(0, MAX_TOOL_RESULT_CHARS)
        : file.value.content,
    );
    return {
      ok: true,
      content: truncated
        ? `${content}\n--- (the file was shortened) ---`
        : content,
      inspected: [relative],
    };
  }

  /** Searches the workspace for a text. */
  private async searchFiles(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const pattern = String(args.pattern ?? '');
    if (pattern.trim().length === 0) {
      return {
        ok: false,
        content: 'The search pattern is empty.',
        error: 'empty pattern',
      };
    }
    const requestId = `agent-search-${context.runId}-${Date.now()}`;
    const matches = await this.runSearch(requestId, pattern, context.signal);
    if (matches === null) {
      return {
        ok: false,
        content: 'The search was stopped.',
        error: 'cancelled',
        cancelled: true,
      };
    }
    const lines = matches.map(
      (match) => redact(`${match.relativePath}:${match.line}`),
    );
    return {
      ok: true,
      content:
        lines.length === 0
          ? 'Nothing was found.'
          : `${lines.length} matches:\n${lines.join('\n')}`,
      inspected: matches.map((match) => match.relativePath),
    };
  }

  /** Runs a search and waits for its result. */
  private runSearch(
    requestId: string,
    pattern: string,
    signal: AbortSignal,
  ): Promise<{ relativePath: string; line: number }[] | null> {
    return new Promise((resolve) => {
      let done = false;
      const unsubscribe = this.deps.search.subscribeResults((results) => {
        if (results.requestId !== requestId || !results.done) {
          return;
        }
        done = true;
        unsubscribe();
        resolve(
          results.matches.map((match) => ({
            relativePath: match.relativePath,
            line: match.line,
          })),
        );
      });
      const stop = (): void => {
        if (done) {
          return;
        }
        done = true;
        unsubscribe();
        this.deps.search.cancel(requestId);
        resolve(null);
      };
      signal.addEventListener('abort', stop, { once: true });
      this.deps.search.query(requestId, 'content', pattern);
    });
  }

  /** Shows the state of the repository. */
  private async gitStatus(): Promise<ToolResult> {
    const status = await this.deps.git.status();
    if (!status.ok) {
      return {
        ok: false,
        content: `The state of the repository could not be read: ${status.message}`,
        error: status.message,
      };
    }
    const value = status.value;
    if (!value.isRepository) {
      return {
        ok: true,
        content: 'This folder is not a Git repository.',
      };
    }
    const lines = [
      `branch: ${value.branch ?? '(none)'}`,
      `staged: ${value.staged.map((entry) => entry.relativePath).join(', ') || '(none)'}`,
      `changed: ${value.unstaged.map((entry) => entry.relativePath).join(', ') || '(none)'}`,
      `untracked: ${value.untracked.map((entry) => entry.relativePath).join(', ') || '(none)'}`,
    ];
    return { ok: true, content: lines.join('\n') };
  }

  /** Shows the changes of a file. */
  private async gitDiff(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const relative = String(args.path ?? '');
    const check = await checkPathPermission(context.root, relative, {
      allowRoot: false,
    });
    if (check.decision === 'deny') {
      return {
        ok: false,
        content: `The file cannot be read: ${check.reason}`,
        error: check.reason,
      };
    }
    const staged = args.staged === true;
    const diff = await this.deps.git.diff(
      path.resolve(context.root, relative),
      staged,
    );
    if (!diff.ok) {
      return {
        ok: false,
        content: `The changes could not be read: ${diff.message}`,
        error: diff.message,
      };
    }
    return {
      ok: true,
      content:
        diff.value.diff.trim().length === 0
          ? 'The file has no changes.'
          : diff.value.diff,
      inspected: [relative],
    };
  }

  /** Proposes the content of a file (nothing is written). */
  private async writeFile(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const relative = String(args.path ?? '');
    const content = String(args.content ?? '');
    const check = await checkPathPermission(context.root, relative, {
      allowRoot: false,
    });
    if (check.decision === 'deny') {
      return {
        ok: false,
        content: `The file cannot be changed: ${check.reason}`,
        error: check.reason,
      };
    }
    const absolute = path.resolve(context.root, relative);
    const existing = await this.deps.files.readFile(absolute);
    const before = existing.ok ? existing.value.content : '';
    const expectedMtimeMs = existing.ok ? existing.value.mtimeMs : null;
    const created = !existing.ok;

    context.createProposal({
      path: absolute,
      relativePath: relative,
      before,
      after: content,
      expectedMtimeMs,
      created,
    });
    return {
      ok: true,
      content:
        `The change of "${relative}" was prepared. ` +
        'The user has to accept it before it is written.',
      inspected: [relative],
    };
  }

  /** Proposes a change of a file by replacing a text (nothing is written). */
  private async applyEdit(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const relative = String(args.path ?? '');
    const search = String(args.search ?? '');
    const replace = String(args.replace ?? '');
    const check = await checkPathPermission(context.root, relative, {
      mustExist: true,
      allowRoot: false,
    });
    if (check.decision === 'deny') {
      return {
        ok: false,
        content: `The file cannot be changed: ${check.reason}`,
        error: check.reason,
      };
    }
    const existing = await this.deps.files.readFile(
      path.resolve(context.root, relative),
    );
    if (!existing.ok) {
      return {
        ok: false,
        content: `The file could not be read: ${existing.message}`,
        error: existing.message,
      };
    }
    if (!existing.value.content.includes(search)) {
      return {
        ok: false,
        content: `The text to replace was not found in "${relative}".`,
        error: 'the text was not found',
      };
    }
    const after = existing.value.content.replace(search, replace);
    context.createProposal({
      path: path.resolve(context.root, relative),
      relativePath: relative,
      before: existing.value.content,
      after,
      expectedMtimeMs: existing.value.mtimeMs,
      created: false,
    });
    return {
      ok: true,
      content:
        `The change of "${relative}" was prepared. ` +
        'The user has to accept it before it is written.',
      inspected: [relative],
    };
  }

  /** Runs a command of the workspace. */
  private async runCommand(
    args: Record<string, unknown>,
    context: ToolContext,
  ): Promise<ToolResult> {
    const script = args.script;
    const argv = args.argv;

    if (typeof script === 'string' && script.length > 0) {
      return this.runScript(script, context);
    }
    if (Array.isArray(argv) && argv.length > 0) {
      return this.runArgv(argv.map((entry) => String(entry)), context);
    }
    return {
      ok: false,
      content:
        'The tool "run_command" needs either a script of the package.json ' +
        'or a command as an argument array.',
      error: 'invalid arguments',
    };
  }

  /** Runs a script of the workspace through the task runner of Milestone 3. */
  private async runScript(
    script: string,
    context: ToolContext,
  ): Promise<ToolResult> {
    const approved = await context.requestApproval({
      kind: 'command',
      tool: 'run_command',
      script,
      reason: `The agent wants to run the script "${script}".`,
    });
    if (!approved) {
      return {
        ok: false,
        content: `The user did not allow the script "${script}".`,
        error: 'the user rejected the command',
      };
    }
    if (context.signal.aborted) {
      return { ok: false, content: 'The run was stopped.', cancelled: true };
    }

    const started = await this.deps.tasks.run(script);
    if (!started.ok) {
      return {
        ok: false,
        content: `The script "${script}" could not be started: ${started.message}`,
        error: started.message,
      };
    }
    const taskId = started.value.taskId;

    const output = await this.collectTaskOutput(taskId, context.signal);
    const record: AgentCommandRecord = {
      argv: ['npm', 'run', script],
      script,
      exitCode: output.exitCode,
      summary: output.summary,
    };
    context.commands.push(record);
    return {
      ok: output.exitCode === 0,
      content:
        `The script "${script}" finished with the exit code ` +
        `${output.exitCode ?? 'none'}.\n${output.summary}`,
      error: output.exitCode === 0 ? undefined : 'the command failed',
      command: record,
    };
  }

  /** Collects the output of a task of the task runner. */
  private collectTaskOutput(
    taskId: string,
    signal: AbortSignal,
  ): Promise<{ exitCode: number | null; summary: string }> {
    return new Promise((resolve) => {
      let text = '';
      let exitCode: number | null = null;
      let settled = false;

      const unsubscribeOutput = this.deps.tasks.subscribeOutput((output) => {
        if (output.taskId !== taskId || settled) {
          return;
        }
        text += output.chunk;
        if (text.length > MAX_TOOL_RESULT_CHARS) {
          text = text.slice(0, MAX_TOOL_RESULT_CHARS);
        }
      });
      const unsubscribeStatus = this.deps.tasks.subscribeStatus((status) => {
        if (status.taskId !== taskId || settled) {
          return;
        }
        if (status.status === 'running') {
          return;
        }
        settled = true;
        exitCode = status.exitCode;
        unsubscribeOutput();
        unsubscribeStatus();
        resolve({
          exitCode,
          summary:
            text.length > 0
              ? text.slice(0, MAX_TOOL_RESULT_CHARS)
              : '(no output)',
        });
      });

      const stop = (): void => {
        if (settled) {
          return;
        }
        settled = true;
        void this.deps.tasks.cancel(taskId);
        unsubscribeOutput();
        unsubscribeStatus();
        resolve({ exitCode: null, summary: '(the command was stopped)' });
      };
      signal.addEventListener('abort', stop, { once: true });
    });
  }

  /**
   * Runs a command as an argument array.
   *
   * There is no shell: the program is started directly, with the working
   * directory locked to the workspace.
   */
  private async runArgv(
    argv: string[],
    context: ToolContext,
  ): Promise<ToolResult> {
    const { isForbiddenCommand } = await import('./permissions');
    if (isForbiddenCommand(argv)) {
      return {
        ok: false,
        content:
          'This command is not allowed. Only the scripts of the ' +
          'package.json and harmless inspection commands are allowed.',
        error: 'the command is forbidden',
      };
    }
    const approved = await context.requestApproval({
      kind: 'command',
      tool: 'run_command',
      argv,
      reason: `The agent wants to run "${argv.join(' ')}".`,
    });
    if (!approved) {
      return {
        ok: false,
        content: `The user did not allow "${argv.join(' ')}".`,
        error: 'the user rejected the command',
      };
    }
    if (context.signal.aborted) {
      return { ok: false, content: 'The run was stopped.', cancelled: true };
    }

    const outcome = await this.spawnCommand(argv, context);
    const record: AgentCommandRecord = {
      argv,
      exitCode: outcome.exitCode,
      summary: outcome.summary,
    };
    context.commands.push(record);
    return {
      ok: outcome.exitCode === 0,
      content:
        `The command finished with the exit code ${outcome.exitCode ?? 'none'}.\n` +
        outcome.summary,
      error: outcome.exitCode === 0 ? undefined : 'the command failed',
      command: record,
    };
  }

  /**
   * Starts a command and collects its output.
   *
   * The command is started without a shell, with the working directory
   * locked to the workspace and with a limit for the output.
   */
  private spawnCommand(
    argv: string[],
    context: ToolContext,
  ): Promise<{ exitCode: number | null; summary: string }> {
    return new Promise((resolve) => {
      let text = '';
      let settled = false;
      const program = argv[0] ?? '';
      let child: ReturnType<typeof spawn>;
      try {
        child = spawn(program, argv.slice(1), {
          cwd: context.root,
          shell: false,
          windowsHide: true,
          env: {
            ...process.env,
            CI: '1',
          },
        });
      } catch (error) {
        resolve({
          exitCode: null,
          summary: `The command could not be started: ${redact(
            error instanceof Error ? error.message : 'unknown error',
          )}`,
        });
        return;
      }

      const finish = (exitCode: number | null, summary: string): void => {
        if (settled) {
          return;
        }
        settled = true;
        resolve({ exitCode, summary });
      };

      child.stdout?.setEncoding('utf8');
      child.stderr?.setEncoding('utf8');
      child.stdout?.on('data', (chunk: string) => {
        text += chunk;
        if (text.length > MAX_TOOL_RESULT_CHARS) {
          text = text.slice(0, MAX_TOOL_RESULT_CHARS);
        }
      });
      child.stderr?.on('data', (chunk: string) => {
        text += chunk;
        if (text.length > MAX_TOOL_RESULT_CHARS) {
          text = text.slice(0, MAX_TOOL_RESULT_CHARS);
        }
      });
      child.on('error', (error) => {
        finish(null, `The command could not be started: ${redact(error.message)}`);
      });
      child.on('close', (code) => {
        finish(
          code,
          text.length > 0 ? redact(text) : '(no output)',
        );
      });

      const stop = (): void => {
        if (settled) {
          return;
        }
        try {
          child.kill('SIGKILL');
        } catch {
          // The process may already be gone.
        }
        finish(null, '(the command was stopped)');
      };
      context.signal.addEventListener('abort', stop, { once: true });
    });
  }
}
