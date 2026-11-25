import type { ReactNode } from 'react';

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

/** Accessible checkbox with the same text rhythm as the shared Toggle. */
export function Checkbox({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: CheckboxProps): ReactNode {
  return (
    <label className="ui-checkbox">
      <input
        type="checkbox"
        className="ui-checkbox__input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ui-checkbox__text">
        <span className="ui-checkbox__label">{label}</span>
        {description === undefined ? null : (
          <span className="ui-checkbox__description">{description}</span>
        )}
      </span>
    </label>
  );
}
