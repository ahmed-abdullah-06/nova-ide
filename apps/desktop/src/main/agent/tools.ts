/**
 * The tool registry of the agent (spec §10.4, §12).
 *
 * Every tool defines its id, its name, its description, its input
 * schema, its validation and its permission level. The registry is the
 * only place that knows the tools, so a new tool can be added without
 * touching the agent loop.
 *
 * The tools of this milestone:
 *
 *  - read only: list_directory, read_file, search_files, git_status,
 *    git_diff,
 *  - workspace: write_file and apply_edit — they create a PROPOSAL, they
 *    never write to the disk (the user accepts the proposal),
 *  - command: run_command — the scripts of the workspace, or a command
 *    as an argument array after an explicit approval.
 */
import type { AgentToolSchema } from '../../shared/agent-types';

/** The schema of every tool of this milestone. */
export const AGENT_TOOLS: readonly AgentToolSchema[] = [
  {
    name: 'list_directory',
    description:
      'List the files and folders of a directory of the workspace.',
    level: 'read',
    parameters: {
      path: {
        type: 'string',
        description:
          'The path of the directory, relative to the root of the workspace.',
        required: true,
      },
    },
  },
  {
    name: 'read_file',
    description:
      'Read a text file of the workspace. The content is truncated when it ' +
      'is very long.',
    level: 'read',
    parameters: {
      path: {
        type: 'string',
        description:
          'The path of the file, relative to the root of the workspace.',
        required: true,
      },
    },
  },
  {
    name: 'search_files',
    description:
      'Search the workspace for a text. The result lists the files that ' +
      'contain the text.',
    level: 'read',
    parameters: {
      pattern: {
        type: 'string',
        description: 'The text to look for.',
        required: true,
      },
    },
  },
  {
    name: 'git_status',
    description:
      'Show the state of the repository: the branch and the changed files.',
    level: 'read',
    parameters: {},
  },
  {
    name: 'git_diff',
    description: 'Show the changes of a file of the repository.',
    level: 'read',
    parameters: {
      path: {
        type: 'string',
        description:
          'The path of the file, relative to the root of the workspace.',
        required: true,
      },
      staged: {
        type: 'boolean',
        description: 'True to show the changes that are staged.',
      },
    },
  },
  {
    name: 'write_file',
    description:
      'Propose the content of a file of the workspace. The change is not ' +
      'written before the user accepts it.',
    level: 'workspace',
    parameters: {
      path: {
        type: 'string',
        description:
          'The path of the file, relative to the root of the workspace.',
        required: true,
      },
      content: {
        type: 'string',
        description: 'The new content of the file.',
        required: true,
      },
    },
  },
  {
    name: 'apply_edit',
    description:
      'Propose a change of a file of the workspace by replacing a text ' +
      'with another one. The change is not written before the user accepts it.',
    level: 'workspace',
    parameters: {
      path: {
        type: 'string',
        description:
          'The path of the file, relative to the root of the workspace.',
        required: true,
      },
      search: {
        type: 'string',
        description: 'The text that is replaced.',
        required: true,
      },
      replace: {
        type: 'string',
        description: 'The text that replaces it.',
        required: true,
      },
    },
  },
  {
    name: 'run_command',
    description:
      'Run a command of the workspace. Use the script parameter for a ' +
      'script of the package.json. Every command needs the approval of ' +
      'the user.',
    level: 'command',
    parameters: {
      script: {
        type: 'string',
        description: 'The name of a script of the package.json.',
      },
      argv: {
        type: 'array',
        description:
          'A command as an argument array (the first entry is the ' +
          'program). Never a shell string.',
        itemType: 'string',
      },
    },
  },
];

/** The tool registry of the agent. */
export class ToolRegistry {
  private readonly tools = new Map<string, AgentToolSchema>();

  constructor(tools: readonly AgentToolSchema[] = AGENT_TOOLS) {
    for (const tool of tools) {
      this.tools.set(tool.name, tool);
    }
  }

  /** The tool with the given name (undefined when it is unknown). */
  get(name: string): AgentToolSchema | undefined {
    return this.tools.get(name);
  }

  /** Every tool of the registry. */
  list(): AgentToolSchema[] {
    return [...this.tools.values()];
  }

  /**
   * The description of the tools for the model.
   *
   * It is a plain, stable format — the model is asked to answer with
   * JSON, so the format has to be easy to reproduce.
   */
  describe(): string {
    const lines: string[] = [];
    for (const tool of this.tools.values()) {
      lines.push(`${tool.name}: ${tool.description}`);
      for (const [name, parameter] of Object.entries(tool.parameters)) {
        const required = parameter.required === true ? ' (required)' : '';
        lines.push(`  - ${name}: ${parameter.description}${required}`);
      }
    }
    return lines.join('\n');
  }
}
