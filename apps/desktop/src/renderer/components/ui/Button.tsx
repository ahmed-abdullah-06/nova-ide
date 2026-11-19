import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: 'primary' | 'secondary' | 'ghost';
  size?: 'sm' | 'md';
  icon?: ReactNode;
  children?: ReactNode;
}

/** Shared A6 button. */
export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  children,
  className = '',
  type = 'button',
  ...rest
}: ButtonProps): ReactNode {
  return (
    <button
      {...rest}
      type={type}
      className={`ui-button ui-button--${variant} ui-button--${size} ${className}`.trim()}
    >
      {icon === undefined ? null : <span className="ui-button__icon">{icon}</span>}
      {children === undefined ? null : <span>{children}</span>}
    </button>
  );
}
