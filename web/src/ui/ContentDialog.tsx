import type { ComponentChildren } from 'preact';
import { useEffect, useId, useRef } from 'preact/hooks';
import { t } from '../i18n';
import { Button } from './Button';

export interface ContentDialogProps {
  open: boolean;
  title: string;
  onClose: () => void;
  onConfirm?: () => void;
  confirmLabel?: string;
  cancelLabel?: string;
  wide?: boolean;
  children: ComponentChildren;
}

export function ContentDialog({
  open,
  title,
  onClose,
  onConfirm,
  confirmLabel,
  cancelLabel,
  wide = false,
  children,
}: ContentDialogProps) {
  const dlgRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  // Fallback light-dismiss for browsers without <dialog closedby="any">
  useEffect(() => {
    const dlg = dlgRef.current;
    if (!dlg || 'closedBy' in HTMLDialogElement.prototype) return;
    const isOutside = (e: PointerEvent) => {
      const r = dlg.getBoundingClientRect();
      return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
    };
    let pressedOutside = false;
    const onDown = (e: PointerEvent) => {
      pressedOutside = isOutside(e);
    };
    const onUp = (e: PointerEvent) => {
      if (pressedOutside && isOutside(e)) dlg.close();
    };
    dlg.addEventListener('pointerdown', onDown);
    dlg.addEventListener('pointerup', onUp);
    return () => {
      dlg.removeEventListener('pointerdown', onDown);
      dlg.removeEventListener('pointerup', onUp);
    };
  }, []);

  return (
    <dialog
      ref={dlgRef}
      aria-labelledby={titleId}
      {...({ closedby: 'any' } as Record<string, string>)}
      onClose={() => {
        const dlg = dlgRef.current;
        const rv = dlg?.returnValue || '';
        if (dlg) dlg.returnValue = '';
        if (rv === 'confirm' && onConfirm) {
          onConfirm();
        }
        onClose();
      }}
      class={`fluent-dialog ${wide ? 'fluent-dialog-wide' : ''}`}
    >
      <div class="p-6">
        <h1 id={titleId} class="font-display text-[20px] leading-7 font-semibold text-fg">
          {title}
        </h1>
        <div class="mt-3 text-[14px] leading-5 text-fg-2">{children}</div>
      </div>
      <form
        method="dialog"
        class="flex justify-end gap-2 border-t border-stroke-card bg-bg px-6 py-4"
      >
        {onConfirm ? (
          <>
            <Button
              type="submit"
              value="cancel"
              variant="default"
              class="min-w-[112px]"
              autofocus
            >
              {cancelLabel || t('common.cancel')}
            </Button>
            <Button type="submit" value="confirm" variant="accent" class="min-w-[112px]">
              {confirmLabel || t('common.confirm')}
            </Button>
          </>
        ) : (
          <Button type="submit" value="close" variant="accent" class="min-w-[112px]" autofocus>
            {cancelLabel || t('common.close')}
          </Button>
        )}
      </form>
    </dialog>
  );
}
