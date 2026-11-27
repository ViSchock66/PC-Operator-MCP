import type { ComponentChildren } from 'preact';
import { Icon, type FluentIconName } from './Icon';

export type ButtonVariant = 'default' | 'accent' | 'subtle';

export interface ButtonProps {
  variant?: ButtonVariant;
  type?: 'button' | 'submit' | 'reset';
  value?: string;
  disabled?: boolean;
  autofocus?: boolean;
  onClick?: (e: MouseEvent) => void;
  title?: string;
  ariaLabel?: string;
  class?: string;
  children?: ComponentChildren;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  default:
    'bg-control hover:bg-control-hover active:bg-subtle-active border border-stroke-control border-b-stroke-bottom text-fg',
  accent:
    'bg-accent hover:bg-accent-hover text-on-accent border border-transparent font-semibold',
  subtle:
    'bg-transparent hover:bg-subtle-hover active:bg-subtle-active border border-transparent text-fg',
};

export function Button({
  variant = 'default',
  type = 'button',
  value,
  disabled = false,
  autofocus,
  onClick,
  title,
  ariaLabel,
  class: className = '',
  children,
}: ButtonProps) {
  return (
    <button
      type={type}
      value={value}
      disabled={disabled}
      autoFocus={autofocus}
      onClick={onClick}
      title={title}
      aria-label={ariaLabel}
      class={`inline-flex h-8 min-h-8 items-center justify-center gap-2 rounded px-3 text-[14px] leading-5 transition-[background-color,border-color,opacity] duration-[83ms] ease-[var(--ease-fluent)] cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed whitespace-nowrap ${VARIANT_CLASSES[variant]} ${className}`}
    >
      {children}
    </button>
  );
}

export interface IconButtonProps {
  icon: FluentIconName;
  label: string;
  size?: number;
  disabled?: boolean;
  onClick?: (e: MouseEvent) => void;
  class?: string;
}

export function IconButton({
  icon,
  label,
  size = 16,
  disabled = false,
  onClick,
  class: className = '',
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      class={`inline-flex h-8 w-8 items-center justify-center rounded bg-transparent hover:bg-subtle-hover active:bg-subtle-active text-fg-2 hover:text-fg transition-[background-color,color] duration-[83ms] ease-[var(--ease-fluent)] cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed shrink-0 ${className}`}
    >
      <Icon name={icon} size={size} />
    </button>
  );
}
