import type { ReactNode } from 'react';

export interface BadgeProps {
  children: ReactNode;
  tone?: 'neutral' | 'accent' | 'success' | 'warning' | 'danger';
  title?: string;
}

/** Small status/capability badge. */
export function Badge({
  children,
  tone = 'neutral',
  title,
}: BadgeProps): ReactNode {
  return (
    <span className={`ui-badge ui-badge--${tone}`} title={title}>
      {children}
    </span>
  );
}
