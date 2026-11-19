import type { ChangeEvent, ReactNode } from 'react';
import { Icon } from './icons';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  'aria-label'?: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

/** Native select with a chevron; keeps platform accessibility for free. */
export function Select({
  value,
  onChange,
  options,
  'aria-label': ariaLabel,
  id,
  disabled = false,
  className = '',
}: SelectProps): ReactNode {
  const handleChange = (event: ChangeEvent<HTMLSelectElement>): void => {
    onChange(event.target.value);
  };
  return (
    <div className={`ui-select ${className}`.trim()}>
      <select
        id={id}
        aria-label={ariaLabel}
        value={value}
        disabled={disabled}
        onChange={handleChange}
        className="ui-select__control"
      >
        {options.map((option) => (
          <option
            key={option.value}
            value={option.value}
            disabled={option.disabled}
          >
            {option.label}
          </option>
        ))}
      </select>
      <Icon name="chevronDown" size={14} className="ui-select__chevron" />
    </div>
  );
}
