import type { ComponentChildren } from 'preact';

export interface TextFieldProps {
  id?: string;
  type?: 'text' | 'password' | 'number' | 'search' | 'url';
  value: string | number;
  onValueChange: (val: string) => void;
  placeholder?: string;
  min?: number;
  max?: number;
  step?: number;
  minLength?: number;
  maxLength?: number;
  mono?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
  class?: string;
}

export function TextField({
  id,
  type = 'text',
  value,
  onValueChange,
  placeholder,
  min,
  max,
  step,
  minLength,
  maxLength,
  mono = false,
  disabled = false,
  ariaLabel,
  class: className = '',
}: TextFieldProps) {
  return (
    <input
      id={id}
      type={type as 'text'}
      value={value}
      placeholder={placeholder}
      min={min}
      max={max}
      step={step}
      minLength={minLength}
      maxLength={maxLength}
      disabled={disabled}
      aria-label={ariaLabel}
      onInput={(e) => onValueChange((e.currentTarget as HTMLInputElement).value)}
      class={`fluent-input w-full ${mono ? 'font-mono text-[13px]' : ''} ${className}`}
    />
  );
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps {
  id?: string;
  value: string;
  onValueChange: (val: string) => void;
  options: SelectOption[];
  ariaLabel?: string;
  ariaLabelledBy?: string;
  disabled?: boolean;
  class?: string;
}

export function Select({
  id,
  value,
  onValueChange,
  options,
  ariaLabel,
  ariaLabelledBy,
  disabled = false,
  class: className = '',
}: SelectProps) {
  return (
    <select
      id={id}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      onChange={(e) => onValueChange((e.currentTarget as HTMLSelectElement).value)}
      class={`fluent-select ${className}`}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

export interface CheckboxProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: ComponentChildren;
  disabled?: boolean;
}

export function Checkbox({ id, checked, onChange, label, disabled = false }: CheckboxProps) {
  return (
    <label class="inline-flex items-center gap-2.5 text-[14px] text-fg cursor-pointer select-none">
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange((e.currentTarget as HTMLInputElement).checked)}
        class="h-4 w-4 rounded-[3px] accent-accent cursor-pointer"
      />
      <span>{label}</span>
    </label>
  );
}
