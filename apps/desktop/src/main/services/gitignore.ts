/**
 * Minimal `.gitignore` matcher (spec §7 — search must respect `.gitignore`).
 *
 * Implements the subset of the gitignore format that matters when walking a
 * project tree:
 *
 *  - blank lines and `#` comments are ignored,
 *  - a trailing `/` restricts the pattern to directories,
 *  - a leading `/` anchors the pattern to the ignore file's directory,
 *  - a pattern containing a `/` (other than a trailing one) is anchored,
 *  - `*` matches within one path segment, `?` matches one character,
 *  - `**` matches across segments,
 *  - a leading `!` negates a previous match,
 *  - the last matching rule wins (as in git).
 *
 * Paths are compared with `/` separators and are relative to the directory
 * that contains the ignore file.
 */

/** A compiled ignore rule. */
interface IgnoreRule {
  /** Regular expression source matched against the relative path. */
  pattern: RegExp;
  /** True when the rule only applies to directories. */
  directoryOnly: boolean;
  /** True when the rule re-includes previously ignored paths. */
  negated: boolean;
}

/** Matches paths against a set of ignore rules. */
export interface GitignoreMatcher {
  /**
   * Returns true when the path is ignored.
   *
   * @param relativePath Path relative to the ignore file's directory,
   *   always using `/` separators.
   * @param isDirectory True when the path is a directory.
   */
  ignores(relativePath: string, isDirectory: boolean): boolean;
}

/** Converts a path to the `/`-separated form used by the matcher. */
export function toPosixPath(value: string): string {
  return value.split('\\').join('/');
}

/**
 * Compiles a single gitignore pattern into a rule.
 *
 * Returns null for patterns that cannot be compiled (they are then ignored
 * instead of breaking the whole search).
 */
function compilePattern(pattern: string): IgnoreRule | null {
  let negated = false;
  let body = pattern;

  if (body.startsWith('!')) {
    negated = true;
    body = body.slice(1);
  }

  // A trailing slash restricts the rule to directories.
  const directoryOnly = body.endsWith('/');
  if (directoryOnly) {
    body = body.slice(0, -1);
  }

  // A leading slash anchors the rule to the ignore file's directory.
  // A pattern that contains a slash (other than the removed trailing one)
  // is anchored as well.
  const anchored = body.startsWith('/') || body.includes('/');
  if (body.startsWith('/')) {
    body = body.slice(1);
  }

  if (body.length === 0) {
    return null;
  }

  let source = '';
  for (let index = 0; index < body.length; index += 1) {
    const char = body[index] as string;
    if (char === '*') {
      const isDoubleStar =
        body[index + 1] === '*' &&
        (index === 0 || body[index - 1] === '/');
      if (isDoubleStar) {
        // `**/` matches zero or more directories.
        if (body[index + 2] === '/') {
          source += '(?:.*/)?';
          index += 2;
        } else {
          source += '.*';
          index += 1;
        }
        continue;
      }
      source += '[^/]*';
      continue;
    }
    if (char === '?') {
      source += '[^/]';
      continue;
    }
    // Escape every regex metacharacter.
    source += char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  const prefix = anchored ? '^' : '^(?:.*/)?';
  // A rule also matches everything below a matched directory.
  const suffix = '(?:/.*)?$';
  try {
    return {
      pattern: new RegExp(`${prefix}${source}${suffix}`),
      directoryOnly,
      negated,
    };
  } catch {
    return null;
  }
}

/**
 * Parses the content of a `.gitignore` file into a matcher.
 *
 * An empty file yields a matcher that ignores nothing.
 */
export function parseGitignore(content: string): GitignoreMatcher {
  const rules: IgnoreRule[] = [];

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith('#')) {
      continue;
    }
    const rule = compilePattern(line);
    if (rule !== null) {
      rules.push(rule);
    }
  }

  return {
    ignores(relativePath: string, isDirectory: boolean): boolean {
      const candidate = toPosixPath(relativePath);
      let ignored = false;
      for (const rule of rules) {
        if (rule.directoryOnly && !isDirectory) {
          // A directory-only rule can still match a file below that
          // directory, but the caller asks about the file itself.
          continue;
        }
        if (rule.pattern.test(candidate)) {
          ignored = !rule.negated;
        }
      }
      return ignored;
    },
  };
}

/** A matcher that ignores nothing. */
export const EMPTY_GITIGNORE: GitignoreMatcher = {
  ignores: () => false,
};
