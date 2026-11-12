/**
 * Workspace-scoped search service (spec §7, §21).
 *
 * Searches file names and file contents inside the active workspace only.
 *
 * Rules enforced here:
 *  - The search root is always the active workspace; nothing outside it is
 *    ever read (paths are re-validated with `resolveInWorkspace`).
 *  - `.gitignore` is honoured, and well-known build output directories
 *    (`node_modules`, `.git`, `dist`, `build`, …) are skipped.
 *  - Binary and oversized files are skipped (reusing the limits of the
 *    filesystem service).
 *  - Searches are cancellable and stop at a fixed result limit, so a huge
 *    repository can never exhaust memory or block the renderer.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type {
  FsResult,
  SearchMatch,
  SearchMode,
  SearchResults,
} from '../../shared/ipc-types';
import { fsFail, fsOk } from './results';
import { parseGitignore, type GitignoreMatcher } from './gitignore';
import {
  MAX_TEXT_FILE_BYTES,
  looksBinary,
} from './fileLimits';

/** Maximum number of results reported for a single search. */
export const MAX_SEARCH_RESULTS = 500;
/** Maximum number of files visited during a single search. */
export const MAX_SEARCH_FILES = 20000;
/** Maximum number of directories visited during a single search. */
export const MAX_SEARCH_DIRECTORIES = 5000;
/**
 * Number of matches that are collected before a batch is delivered.
 *
 * Small batches keep the renderer responsive on large workspaces: the
 * user sees the first hits while the search is still running.
 */
export const SEARCH_BATCH_SIZE = 100;
/** Length of the preview line kept for a content match. */
const MAX_PREVIEW_LENGTH = 200;
/** Maximum size of the `.gitignore` file that is parsed. */
const MAX_GITIGNORE_BYTES = 1024 * 1024;

/** Directories that are never searched (build output / VCS metadata). */
const ALWAYS_SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'dist',
  'build',
  'out',
  'coverage',
  '.next',
  '.nuxt',
  '.cache',
  '.turbo',
  '.parcel-cache',
  '.venv',
  '__pycache__',
]);

export interface SearchServiceOptions {
  /** Returns the canonical root of the active workspace, or null. */
  getRoot: () => string | null;
  /** Called with every batch of results (including the final one). */
  onResults: (results: SearchResults) => void;
}

export class SearchService {
  private readonly getRoot: () => string | null;
  private readonly onResults: (results: SearchResults) => void;
  /** Request ids that were cancelled by the renderer. */
  private readonly cancelled = new Set<string>();
  /** Request ids that are currently running. */
  private readonly running = new Set<string>();
  /**
   * The listeners of the results.
   *
   * The renderer sees the results of its searches; the agent needs the
   * results of its own search in the main process.
   */
  private readonly resultListeners = new Set<
    (results: SearchResults) => void
  >();

  constructor(options: SearchServiceOptions) {
    this.getRoot = options.getRoot;
    this.onResults = options.onResults;
  }

  /** Number of searches currently in flight (diagnostics / tests). */
  get runningCount(): number {
    return this.running.size;
  }

  /**
   * Subscribes to the results of the searches.
   *
   * @returns A function that removes the subscription.
   */
  subscribeResults(listener: (results: SearchResults) => void): () => void {
    this.resultListeners.add(listener);
    return () => {
      this.resultListeners.delete(listener);
    };
  }

  /**
   * Starts a search. The results are delivered incrementally through
   * `onResults`; the returned promise only reports whether the search was
   * accepted.
   */
  query(
    requestId: string,
    mode: SearchMode,
    pattern: string,
  ): FsResult<{ requestId: string }> {
    const root = this.getRoot();
    if (root === null) {
      return fsFail('NO_WORKSPACE', 'Open a folder before searching');
    }
    if (pattern.length === 0) {
      return fsFail('INVALID_PATH', 'The search pattern is empty');
    }
    if (this.running.has(requestId)) {
      return fsFail('UNKNOWN', 'This search is already running');
    }

    this.cancelled.delete(requestId);
    this.running.add(requestId);

    void this.run(requestId, root, mode, pattern).finally(() => {
      this.running.delete(requestId);
      this.cancelled.delete(requestId);
    });

    return fsOk<{ requestId: string }>({ requestId });
  }

  /** Cancels a running search. */
  cancel(requestId: string): FsResult<void> {
    this.cancelled.add(requestId);
    return fsOk<void>(undefined);
  }

  /** Runs the search, streaming results as they are found. */
  private async run(
    requestId: string,
    root: string,
    mode: SearchMode,
    pattern: string,
  ): Promise<void> {
    const matcher = await this.loadGitignore(root);
    const needle = pattern.toLowerCase();
    /** Matches that were found but not delivered yet. */
    let pending: SearchMatch[] = [];
    /** Total number of matches found (delivered + pending). */
    let totalMatches = 0;
    let truncated = false;
    let filesVisited = 0;
    let directoriesVisited = 0;

    const isCancelled = (): boolean => this.cancelled.has(requestId);

    /**
     * Delivers the collected matches and empties the buffer.
     *
     * @param done True when this is the final batch of the search.
     */
    const flush = (done: boolean): void => {
      if (pending.length === 0 && !done) {
        return;
      }
      this.onResults({
        requestId,
        matches: pending,
        done,
        truncated,
      });
      pending = [];
    };

    /** Records a match and reports whether the result cap was reached. */
    const addMatch = (match: SearchMatch): boolean => {
      pending.push(match);
      totalMatches += 1;
      return totalMatches >= MAX_SEARCH_RESULTS;
    };

    const stack: string[] = [root];

    while (stack.length > 0) {
      if (isCancelled()) {
        break;
      }
      if (directoriesVisited >= MAX_SEARCH_DIRECTORIES) {
        truncated = true;
        break;
      }
      const directory = stack.pop() as string;
      directoriesVisited += 1;

      let entries;
      try {
        entries = await fs.readdir(directory, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        if (isCancelled()) {
          break;
        }
        const fullPath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          if (ALWAYS_SKIPPED_DIRECTORIES.has(entry.name)) {
            continue;
          }
          const relative = path.relative(root, fullPath);
          if (matcher !== null && matcher.ignores(relative, true)) {
            continue;
          }
          stack.push(fullPath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        const relative = path.relative(root, fullPath);
        if (matcher !== null && matcher.ignores(relative, false)) {
          continue;
        }

        filesVisited += 1;
        if (filesVisited > MAX_SEARCH_FILES) {
          truncated = true;
          break;
        }

        if (mode === 'files') {
          if (entry.name.toLowerCase().includes(needle)) {
            const reachedLimit = addMatch({
              path: fullPath,
              relativePath: relative,
              name: entry.name,
              line: 0,
              column: 0,
              preview: relative,
            });
            if (reachedLimit) {
              truncated = true;
              break;
            }
          }
        } else {
          const contentMatch = await this.searchInFile(
            fullPath,
            relative,
            needle,
          );
          if (contentMatch !== null) {
            const reachedLimit = addMatch(contentMatch);
            if (reachedLimit) {
              truncated = true;
              break;
            }
          }
        }

        // Deliver the batch, so the renderer can show the hits that were
        // already found while the search continues.
        if (pending.length >= SEARCH_BATCH_SIZE) {
          flush(false);
        }

      }

      if (totalMatches >= MAX_SEARCH_RESULTS) {
        break;
      }
    }

    // The final batch carries the remaining matches.
    flush(true);
  }

  /**
   * Searches one file for the pattern.
   *
   * Returns the first match of the file (one hit per file keeps the result
   * list readable and bounded); binary and oversized files are skipped.
   */
  private async searchInFile(
    fullPath: string,
    relativePath: string,
    needle: string,
  ): Promise<SearchMatch | null> {
    let stat;
    try {
      stat = await fs.stat(fullPath);
    } catch {
      return null;
    }
    if (!stat.isFile() || stat.size > MAX_TEXT_FILE_BYTES) {
      return null;
    }

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(fullPath);
    } catch {
      return null;
    }
    if (looksBinary(buffer)) {
      return null;
    }

    const lines = buffer.toString('utf8').split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index] as string;
      const column = line.toLowerCase().indexOf(needle);
      if (column !== -1) {
        return {
          path: fullPath,
          relativePath,
          name: path.basename(fullPath),
          line: index + 1,
          column: column + 1,
          preview: truncatePreview(line),
        };
      }
    }
    return null;
  }

  /** Loads and parses the `.gitignore` of the workspace root. */
  private async loadGitignore(root: string): Promise<GitignoreMatcher | null> {
    try {
      const stat = await fs.stat(path.join(root, '.gitignore'));
      if (!stat.isFile() || stat.size > MAX_GITIGNORE_BYTES) {
        return null;
      }
      const content = await fs.readFile(path.join(root, '.gitignore'), 'utf8');
      return parseGitignore(content);
    } catch {
      return null;
    }
  }
}

/** Shortens a preview line to a display-friendly length. */
export function truncatePreview(line: string): string {
  const trimmed = line.replace(/\s+$/, '');
  if (trimmed.length <= MAX_PREVIEW_LENGTH) {
    return trimmed;
  }
  return `${trimmed.slice(0, MAX_PREVIEW_LENGTH - 1)}…`;
}
