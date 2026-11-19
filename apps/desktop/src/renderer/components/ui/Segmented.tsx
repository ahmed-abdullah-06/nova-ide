import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly SegmentedOption<T>[];
  onValueChange: (value: T) => void;
}

/** Shared segmented tabs / switcher. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onValueChange,
}: SegmentedProps<T>): ReactNode {
  return (
    <div className="ui-segmented" role="tablist" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          role="tab"
          aria-selected={option.id === value}
          disabled={option.disabled}
          className={`ui-segmented__item${
            option.id === value ? ' ui-segmented__item--active' : ''
          }`}
          onClick={() => onValueChange(option.id)}
        >
          {option.icon === undefined ? null : (
            <span className="ui-segmented__icon">{option.icon}</span>
          )}
          {option.label}
        </button>
      ))}
    </div>
  );
}
