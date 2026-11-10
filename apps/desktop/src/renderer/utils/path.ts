/**
 * Minimal path helpers for the renderer.
 *
 * The sandboxed renderer has no Node.js (`path` module) and must never get
 * one; it only manipulates path *strings* it received from the main
 * process (which always returns OS-canonical absolute paths).
 */

/** Separator used by an absolute path returned by the main process. */
export function pathSeparator(p: string): string {
  // POSIX paths always contain '/', even when a file name contains '\'.
  return p.includes('\\') && !p.includes('/') ? '\\' : '/';
}

/** Last segment of a path (`C:\a\b.ts` → `b.ts`, `/a/b.ts` → `b.ts`). */
export function pathBaseName(p: string): string {
  const index = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return index === -1 ? p : p.slice(index + 1);
}

/**
 * Parent of a path.
 * `/a/b` → `/a`, `/a` → `/`, `C:\a\b` → `C:\a`, `C:\a` → `C:\`.
 * Returns '' when the input has no parent (already a bare root-like path).
 */
export function pathParent(p: string): string {
  const index = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  if (index === -1) {
    return '';
  }
  if (index === 0) {
    return p.slice(0, 1);
  }
  const parent = p.slice(0, index);
  if (/^[A-Za-z]:$/.test(parent)) {
    return parent + (p[index] ?? '\\');
  }
  return parent;
}

/** Joins a directory and a bare entry name. */
export function pathJoin(parent: string, name: string): string {
  if (parent === '') {
    return name;
  }
  const separator = pathSeparator(parent);
  const endsWithSeparator =
    parent.endsWith('/') || parent.endsWith('\\');
  return endsWithSeparator ? parent + name : parent + separator + name;
}

/**
 * True when `path` is expanded AND every ancestor up to the workspace root
 * is expanded too — i.e. the directory is actually visible on screen and
 * worth loading (collapsed-but-remembered branches stay cached, not read).
 */
export function isVisibleExpanded(
  path: string,
  expanded: ReadonlySet<string>,
  rootPath: string,
): boolean {
  let current = path;
  for (;;) {
    if (!expanded.has(current)) {
      return false;
    }
    if (current === rootPath) {
      return true;
    }
    const parent = pathParent(current);
    if (parent === '' || parent === current) {
      // Walked past the root without matching it — not part of this tree.
      return false;
    }
    current = parent;
  }
}
