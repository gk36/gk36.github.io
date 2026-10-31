import { dismissToast, toasts } from '../app/store';
import { X } from './icons';

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite" aria-atomic="false">
      {toasts.value.map((t) => (
        <div class="toast" key={t.id}>
          <span class="grow">{t.text}</span>
          {t.action ? (
            <button type="button" class="btn btn-s" onClick={async () => { dismissToast(t.id); await t.action!.run(); }}>
              {t.action.label}
            </button>
          ) : null}
          <button type="button" class="btn btn-ghost btn-icon btn-s" aria-label="Dismiss" onClick={() => dismissToast(t.id)}><X size={16} /></button>
        </div>
      ))}
    </div>
  );
}
