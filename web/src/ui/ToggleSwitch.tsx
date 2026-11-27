export interface ToggleSwitchProps {
  id?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  labelledBy?: string;
}

export function ToggleSwitch({
  id,
  checked,
  onChange,
  disabled = false,
  label,
  labelledBy,
}: ToggleSwitchProps) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked ? 'true' : 'false'}
      aria-label={label}
      aria-labelledby={labelledBy}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      class="fluent-switch"
    >
      <span class="fluent-switch-knob" aria-hidden="true" />
    </button>
  );
}
