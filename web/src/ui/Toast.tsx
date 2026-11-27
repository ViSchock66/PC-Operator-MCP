import { signal } from '@preact/signals';

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastItem {
  id: number;
  message: string;
  kind: ToastKind;
}

export const toastsSignal = signal<ToastItem[]>([]);
let nextId = 1;

export function pushToast(message: string, kind: ToastKind = 'success'): void {
  const id = nextId++;
  toastsSignal.value = [...toastsSignal.value, { id, message, kind }];
  setTimeout(() => {
    toastsSignal.value = toastsSignal.value.filter((item) => item.id !== id);
  }, 3200);
}

const BORDER_MAP: Record<ToastKind, string> = {
  success: 'border-success/40',
  error: 'border-critical/40',
  info: 'border-stroke-control',
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
      {items.map((item) => (
        <div
          key={item.id}
          class={`pointer-events-auto max-w-sm rounded-lg border bg-card px-4 py-2.5 text-[13px] leading-[18px] text-fg ${BORDER_MAP[item.kind]}`}
        >
          {item.message}
        </div>
      ))}
    </div>
  );
}
