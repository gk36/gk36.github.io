import type { ComponentChildren } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { X } from './icons';
import { useId } from './hooks';

interface Props {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
  /** Extra controls next to the title (e.g. a back button). */
  lead?: ComponentChildren;
}

/**
 * Modal sheet on the native <dialog>: the browser handles focus trapping, the inert
 * background and Esc. Bottom sheet on phones, centred dialog on wider screens.
 */
export function Sheet({ title, onClose, children, footer, lead }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId('sheet-title');
  const opener = useRef<Element | null>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    opener.current = document.activeElement;
    if (!d.open) d.showModal();
    const onCancel = (e: Event) => { e.preventDefault(); onClose(); };
    d.addEventListener('cancel', onCancel);
    return () => {
      d.removeEventListener('cancel', onCancel);
      if (d.open) d.close();
      const el = opener.current as HTMLElement | null;
      if (el && typeof el.focus === 'function' && el.isConnected) el.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      class="sheet"
      aria-labelledby={titleId}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      <div class="sheet-inner">
        <div class="sheet-head">
          {lead}
          <h2 id={titleId} class="sheet-title">{title}</h2>
          <button type="button" class="btn btn-ghost btn-icon" aria-label="Close" onClick={onClose}><X size={20} /></button>
        </div>
        <div class="sheet-body">{children}</div>
        {footer ? <div class="sheet-foot">{footer}</div> : null}
      </div>
    </dialog>
  );
}
