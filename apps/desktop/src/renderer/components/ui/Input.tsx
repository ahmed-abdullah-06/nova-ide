import type { InputHTMLAttributes, ReactNode } from 'react';

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  type?: 'text' | 'password' | 'search' | 'number' | 'range';
}

/** Shared A6 text input. */
export function Input({
  type = 'text',
  className = '',
  ...rest
}: InputProps): ReactNode {
  return (
    <input
      {...rest}
      type={type}
      className={`ui-input ${className}`.trim()}
    />
  );
}
