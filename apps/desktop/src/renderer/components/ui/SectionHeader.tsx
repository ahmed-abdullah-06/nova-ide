import type { ReactNode } from 'react';

export interface SectionHeaderProps {
  title: string;
  description?: string;
  action?: ReactNode;
}

/** Title, helper copy and optional action slot shared by settings/panels. */
export function SectionHeader({
  title,
  description,
  action,
}: SectionHeaderProps): ReactNode {
  return (
    <header className="ui-section-header">
      <div className="ui-section-header__text">
        <h2 className="ui-section-header__title">{title}</h2>
        {description === undefined ? null : (
          <p className="ui-section-header__description">{description}</p>
        )}
      </div>
      {action === undefined ? null : (
        <div className="ui-section-header__action">{action}</div>
      )}
    </header>
  );
}
