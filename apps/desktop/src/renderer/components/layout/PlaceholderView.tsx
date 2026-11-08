import type { ReactNode } from 'react';

interface PlaceholderViewProps {
  title: string;
  note: string;
  milestone: string;
}

/**
 * Honest empty state for features that are specified but not yet
 * implemented (spec §26.7 — never present fake features as working).
 */
export function PlaceholderView({
  title,
  note,
  milestone,
}: PlaceholderViewProps): ReactNode {
  return (
    <div className="placeholder-view" role="status">
      <span className="placeholder-view__title">{title}</span>
      <span className="placeholder-view__note">{note}</span>
      <span className="placeholder-view__milestone">{milestone}</span>
    </div>
  );
}
