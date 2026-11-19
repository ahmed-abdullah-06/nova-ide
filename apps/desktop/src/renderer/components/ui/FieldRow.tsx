import type { ReactNode } from 'react';
import { Icon } from './icons';

export interface FieldRowProps {
  label: string;
  htmlFor?: string;
  helper?: string;
  disabledReason?: string;
  horizontal?: boolean;
  children: ReactNode;
}

/** Label + control + helper text, with an honest reason when disabled. */
export function FieldRow({
  label,
  htmlFor,
  helper,
  disabledReason,
  horizontal = false,
  children,
}: FieldRowProps): ReactNode {
  return (
    <div className={`ui-field-row${horizontal ? ' ui-field-row--horizontal' : ''}`}>
      <label className="ui-field-row__label" htmlFor={htmlFor}>
        {label}
      </label>
      <div className="ui-field-row__control">{children}</div>
      {helper === undefined ? null : (
        <p className="ui-field-row__helper">{helper}</p>
      )}
      {disabledReason === undefined ? null : (
        <p className="ui-field-row__disabled">
          <Icon name="info" size={12} />
          <span>{disabledReason}</span>
        </p>
      )}
    </div>
  );
}
