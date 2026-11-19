import type { ReactNode } from 'react';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

/** Accessible on/off switch using `role="switch"`. */
export function Toggle({
  checked,
  onChange,
  label,
  description,
  disabled = false,
}: ToggleProps): ReactNode {
  return (
    <div className="ui-toggle">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        className={`ui-toggle__switch${checked ? ' ui-toggle__switch--on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="ui-toggle__thumb" />
      </button>
      <span className="ui-toggle__text">
        <span className="ui-toggle__label">{label}</span>
        {description === undefined ? null : (
          <span className="ui-toggle__description">{description}</span>
        )}
      </span>
    </div>
  );
}
