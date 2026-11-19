import type { ReactNode } from 'react';

export interface CardProps {
  title?: string;
  actions?: ReactNode;
  children: ReactNode;
  tone?: 'default' | 'accent' | 'warning' | 'danger';
  className?: string;
}

/** Shared surface for settings groups, plan steps and agent results. */
export function Card({
  title,
  actions,
  children,
  tone = 'default',
  className = '',
}: CardProps): ReactNode {
  return (
    <section className={`ui-card ui-card--${tone} ${className}`.trim()}>
      {title === undefined && actions === undefined ? null : (
        <header className="ui-card__header">
          {title === undefined ? null : <h3 className="ui-card__title">{title}</h3>}
          {actions === undefined ? null : (
            <div className="ui-card__actions">{actions}</div>
          )}
        </header>
      )}
      <div className="ui-card__body">{children}</div>
    </section>
  );
}
