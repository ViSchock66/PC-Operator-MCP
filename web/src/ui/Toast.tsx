import { signal } from '@preact/signals';
import { Icon, type FluentIconName } from './Icon';

export type ToastKind = 'success' | 'error' | 'info' | 'caution';

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

export const toastsSignal = signal<ToastItem[]>([]);
let nextId = 1;

// Los avisos importantes se quedan más tiempo en pantalla que las confirmaciones.
const DURATION_MS: Record<ToastKind, number> = {
  success: 3200,
  info: 3200,
  caution: 4500,
  error: 6000,
};

export function pushToast(message: string, kind: ToastKind = 'success'): void {
  const id = nextId++;
  toastsSignal.value = [...toastsSignal.value, { id, message, kind }];
  setTimeout(() => {
    toastsSignal.value = toastsSignal.value.filter((item) => item.id !== id);
  }, DURATION_MS[kind]);
}

const KIND_ICON: Record<ToastKind, { icon: FluentIconName; colorClass: string }> = {
  success: { icon: 'checkmark_circle', colorClass: 'text-success' },
  caution: { icon: 'warning', colorClass: 'text-caution' },
  error: { icon: 'dismiss_circle', colorClass: 'text-critical' },
  info: { icon: 'info', colorClass: 'text-accent-text' },
};

export function ToastHost() {
  const items = toastsSignal.value;
  return (
    <div
      role="region"
      aria-label="Notificaciones"
      aria-live="polite"
      class="pointer-events-none fixed right-5 bottom-5 z-50 flex flex-col items-end gap-2"
    >
      {items.map((item) => {
        const cfg = KIND_ICON[item.kind];
        return (
          <div
            key={item.id}
            class="toast-enter pointer-events-auto flex max-w-sm items-start gap-3 rounded-lg border border-stroke-flyout bg-flyout px-4 py-3 text-[14px] leading-5 text-fg shadow-[0_8px_16px_rgba(0,0,0,0.28),0_0_2px_rgba(0,0,0,0.3)]"
          >
            <Icon name={cfg.icon} filled size={20} class={`${cfg.colorClass} mt-px shrink-0`} />
            <span class="min-w-0 break-words">{item.message}</span>
          </div>
        );
      })}
    </div>
  );
}
