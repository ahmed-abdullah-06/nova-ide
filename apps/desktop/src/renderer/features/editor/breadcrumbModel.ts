/** Pure breadcrumb model shared by the editor UI and its unit tests. */

export interface BreadcrumbSegment {
  label: string;
  /** Absolute path of this segment, or null for the workspace label. */
  path: string | null;
}

function normalize(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Builds the crumb trail for a file-backed tab. When the file lives under the
 * open workspace the first crumb is the workspace name and the rest are the
 * relative path segments; otherwise the full path is shown.
 */
export function breadcrumbSegments(
  filePath: string | null,
  workspaceRoot: string | null,
  fallbackName: string,
): BreadcrumbSegment[] {
  if (filePath === null) {
    return [{ label: fallbackName, path: null }];
  }
  const file = normalize(filePath);
  const root = workspaceRoot === null ? null : normalize(workspaceRoot);
  const inWorkspace =
    root !== null &&
    (file.toLowerCase().startsWith(`${root.toLowerCase()}/`) ||
      file.toLowerCase() === root.toLowerCase());

  const relative = inWorkspace && root !== null ? file.slice(root.length + 1) : file;
  const parts = relative.split('/').filter((part) => part.length > 0);
  const segments: BreadcrumbSegment[] = [];

  if (inWorkspace && root !== null) {
    const rootLabel = root.split('/').at(-1) ?? root;
    segments.push({ label: rootLabel, path: null });
  }

  let cursor = inWorkspace && root !== null ? root : '';
  for (const part of parts) {
    cursor = cursor.length === 0 ? part : `${cursor}/${part}`;
    segments.push({ label: part, path: cursor });
  }
  return segments.length === 0
    ? [{ label: fallbackName, path: null }]
    : segments;
}
