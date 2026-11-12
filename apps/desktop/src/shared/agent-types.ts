/**
 * The types of the coding agent (spec §9, §10, §12, §13).
 *
 * This file is shared by the main process (the agent loop, the tool
 * executor and the permission policy) and the renderer (the agent panel).
 * It must never import Node.js or Electron runtime APIs.
 */

/** The state of an agent run. */
export type AgentRunState =
  | 'idle'
  | 'running'
  | 'waitingForApproval'
  | 'completed'
  | 'failed'
  | 'cancelled';

/** The kinds of events an agent run reports. */
export type AgentEventType =
  | 'run-started'
  | 'step-started'
  | 'tool-called'
  | 'tool-result'
  | 'approval-requested'
  | 'proposal-created'
  | 'run-finished'
  | 'run-failed'
  | 'run-cancelled';

/**
 * One event of a run.
 *
 * The events are task scoped and concise: they describe what the agent
 * did, never its private reasoning (spec §13).
 */
export interface AgentEvent {
  /** The run the event belongs to. */
  runId: string;
  /** The kind of the event. */
  type: AgentEventType;
  /** The step the event belongs to (1-based). */
  step: number;
  /** A short description of what happened. */
  summary: string;
  /** The tool that was called. */
  tool?: string;
  /** The decision of the permission policy. */
  decision?: AgentPermissionDecision;
  /** A short summary of the result of a tool. */
  result?: string;
  /** The message of an error. */
  error?: string;
  /** The time of the event (milliseconds since the epoch). */
  at: number;
}

/** The decision of the permission policy for a tool call. */
export type AgentPermissionDecision = 'allow' | 'ask' | 'deny';

/**
 * The permission level of a tool (spec §12.3).
 *
 *  - 'read': only reads the workspace,
 *  - 'workspace': proposes a change of the workspace,
 *  - 'command': runs a command,
 *  - 'system': would change something outside the workspace (never allowed).
 */
export type AgentPermissionLevel = 'read' | 'workspace' | 'command' | 'system';

/** A parameter of a tool. */
export interface AgentToolParameter {
  /** The type of the parameter. */
  type: 'string' | 'number' | 'boolean' | 'array';
  /** What the parameter means (the model reads it). */
  description: string;
  /** True when the parameter has to be given. */
  required?: boolean;
  /** The allowed values (for a string). */
  values?: string[];
  /** The type of the items (for an array). */
  itemType?: 'string';
}

/** The schema of a tool: its name, its level and its parameters. */
export interface AgentToolSchema {
  /** The id of the tool (the model calls it by this name). */
  name: string;
  /** What the tool does (the model reads it). */
  description: string;
  /** The permission level of the tool. */
  level: AgentPermissionLevel;
  /** The parameters the tool accepts. */
  parameters: Record<string, AgentToolParameter>;
}

/** A request of the agent that the user has to approve. */
export interface AgentApproval {
  /** The id of the request. */
  id: string;
  /** The run the request belongs to. */
  runId: string;
  /** What kind of approval this is. */
  kind: 'command' | 'cloud-context';
  /** The tool that needs the approval. */
  tool?: string;
  /** The command as an argument array (never a shell string). */
  argv?: string[];
  /** The script of the workspace that is run. */
  script?: string;
  /** The provider of a cloud approval. */
  providerId?: string;
  /** The model of a cloud approval. */
  model?: string;
  /** What a cloud approval covers (the scope of the content). */
  scope?: string[];
  /** Why the approval is needed. */
  reason: string;
  /** The time of the request. */
  createdAt: number;
}

/**
 * A change the agent proposes.
 *
 * A proposal is never written to the disk before the user accepts it
 * (spec §12.1 "Avoid accidental overwrites").
 */
export interface AgentProposal {
  /** The id of the proposal. */
  id: string;
  /** The run the proposal belongs to. */
  runId: string;
  /** The absolute path of the file (inside the workspace). */
  path: string;
  /** The path relative to the workspace root. */
  relativePath: string;
  /** The content of the file before the change. */
  before: string;
  /** The content of the file after the change. */
  after: string;
  /** The unified diff of the change. */
  diff: string;
  /** The time of the file when the agent read it (the conflict check). */
  expectedMtimeMs: number | null;
  /** True when the file did not exist before. */
  created: boolean;
  /** The time of the proposal. */
  createdAt: number;
}

/** The state of a proposal. */
export type AgentProposalState = 'pending' | 'accepted' | 'rejected';

/** One command that the agent ran. */
export interface AgentCommandRecord {
  /** The command as an argument array. */
  argv: string[];
  /** The script of the workspace (when a script was run). */
  script?: string;
  /** The exit code of the command (null when it was stopped). */
  exitCode: number | null;
  /** A short summary of the output. */
  summary: string;
}

/** The final summary of a run (spec §13). */
export interface AgentRunSummary {
  /** The id of the run. */
  runId: string;
  /** The final state of the run. */
  state: AgentRunState;
  /** The task of the user. */
  task: string;
  /** The provider that was used. */
  providerId: string;
  /** The model that was used. */
  model: string;
  /** 'local' or 'cloud' (the badge of the panel). */
  kind: 'local' | 'cloud';
  /** The number of steps the run took. */
  steps: number;
  /** The files the agent looked at. */
  inspected: string[];
  /** The proposals of the run. */
  proposals: AgentProposal[];
  /** The commands that ran (with their exit codes). */
  commands: AgentCommandRecord[];
  /** The errors that happened. */
  errors: string[];
  /** The problems the agent could not solve. */
  unresolved: string[];
  /** The final answer of the agent. */
  finalMessage: string;
  /** When the run started. */
  startedAt: number;
  /** When the run ended (null while it runs). */
  finishedAt: number | null;
}

/** The state of the agent that the renderer sees. */
export interface AgentState {
  /** The state of the current run. */
  state: AgentRunState;
  /** The id of the current run (null when there is none). */
  runId: string | null;
  /** The task of the current run. */
  task: string;
  /** The provider of the current run. */
  providerId: string;
  /** The model of the current run. */
  model: string;
  /** 'local' or 'cloud'. */
  kind: 'local' | 'cloud';
  /** The events of the current run. */
  events: AgentEvent[];
  /** The approval the run is waiting for (null when it is not waiting). */
  approval: AgentApproval | null;
  /** The proposals of the current run. */
  proposals: AgentProposal[];
  /** The summary of the current run. */
  summary: AgentRunSummary | null;
}

/** The limits of a run (the user may lower them, never raise them). */
export interface AgentLimits {
  /** The maximum number of steps. */
  maxSteps: number;
  /** The maximum duration of the run (milliseconds). */
  maxDurationMs: number;
  /** The maximum number of characters the model may produce. */
  maxCharacters: number;
  /** The maximum number of consecutive failures. */
  maxConsecutiveFailures: number;
}

/** The default limits of a run. */
export const DEFAULT_AGENT_LIMITS: AgentLimits = {
  maxSteps: 12,
  maxDurationMs: 5 * 60_000,
  maxCharacters: 200_000,
  maxConsecutiveFailures: 3,
};

/** The maximum number of characters a tool result may have. */
export const MAX_TOOL_RESULT_CHARS = 20_000;
/** The maximum number of characters a file of the workspace may have. */
export const MAX_AGENT_FILE_BYTES = 512 * 1024;
/** The maximum number of steps the agent may repair a malformed answer. */
export const MAX_REPAIR_ATTEMPTS = 1;
/** The maximum number of entries a directory listing may have. */
export const MAX_DIRECTORY_ENTRIES = 500;

/**
 * One entry of the audit log (spec §10.5, §19.5).
 *
 * The log holds metadata only: never a secret, never the content of a
 * file, never the reasoning of the model.
 */
export interface AgentAuditEntry {
  /** The run the entry belongs to. */
  runId: string;
  /** The step of the run. */
  step: number;
  /** What happened. */
  kind: 'tool' | 'permission' | 'approval' | 'proposal' | 'run' | 'command';
  /** The tool that was used. */
  tool?: string;
  /** The decision of the permission policy. */
  decision?: string;
  /** A short description (never the content of a file). */
  summary: string;
  /** The time of the entry. */
  at: number;
}
