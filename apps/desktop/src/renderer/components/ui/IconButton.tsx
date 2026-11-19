import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  label: string;
  icon: ReactNode;
  size?: 'sm' | 'md';
  active?: boolean;
}

/** Shared icon-only button with a tooltip and accessible name. */
export function IconButton({
  label,
  icon,
  size = 'md',
  active,
  className = '',
  type = 'button',
  ...rest
}: IconButtonProps): ReactNode {
  return (
    <button
      {...rest}
      type={type}
      title={label}
      aria-label={label}
      aria-pressed={active === undefined ? undefined : active}
      className={`ui-icon-button ui-icon-button--${size}${
        active === true ? ' ui-icon-button--active' : ''
      } ${className}`.trim()}
    >
      {icon}
    </button>
  );
}
