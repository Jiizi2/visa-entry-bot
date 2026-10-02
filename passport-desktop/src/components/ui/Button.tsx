import type { ComponentProps } from 'react';

type ButtonProps = ComponentProps<'button'> & {
  variant?: 'primary' | 'secondary' | 'ghost';
  compact?: boolean;
  danger?: boolean;
};

/** Native button props, handlers, disabled state, and refs pass through unchanged. */
export default function Button({ variant = 'secondary', compact = false, danger = false, className = '', ...props }: ButtonProps) {
  const variantClass = variant === 'primary' ? 'primary-action' : `${variant}-button`;
  return <button {...props} className={`${variantClass}${compact ? ' compact' : ''}${danger ? ' is-danger' : ''} ${className}`} />;
}
