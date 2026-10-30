import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Minus, Plus } from './icons';
import { useId } from './hooks';
import { formatAmount, parseAmount } from '../domain/nutrition/quantity';

/** Accessible single-choice control (radiogroup with arrow-key support). */
export function Segmented<T extends string>({ label, value, options, onChange, hideLabel }: {
  label: string;
  value: T;
  options: readonly { value: T; label: ComponentChildren; disabled?: boolean }[];
  onChange: (v: T) => void;
  hideLabel?: boolean;
}) {
  const id = useId('seg');
  const onKey = (e: KeyboardEvent) => {
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    e.preventDefault();
    const enabled = options.filter((o) => !o.disabled);
    const i = enabled.findIndex((o) => o.value === value);
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : -1;
    const next = enabled[(i + step + enabled.length) % enabled.length];
    if (next) {
      onChange(next.value);
      requestAnimationFrame(() => (document.querySelector(`#${id} [data-v="${CSS.escape(next.value)}"]`) as HTMLElement | null)?.focus());
    }
  };
  // Roving tabindex: the checked option is the tab stop; with nothing checked yet, the first enabled one is.
  const anyChecked = options.some((o) => o.value === value);
  const firstEnabled = options.find((o) => !o.disabled)?.value;
  return (
    <div class="field">
      <span id={`${id}-l`} class={hideLabel ? 'sr-only' : 'label'}>{label}</span>
      <div id={id} class="seg" role="radiogroup" aria-labelledby={`${id}-l`} onKeyDown={onKey}>
        {options.map((o) => (
          <button
            type="button" role="radio" key={o.value} data-v={o.value} aria-checked={o.value === value}
            tabIndex={o.value === value || (!anyChecked && o.value === firstEnabled) ? 0 : -1} disabled={o.disabled} onClick={() => onChange(o.value)}
          >{o.label}</button>
        ))}
      </div>
    </div>
  );
}

/**
 * Number entry that accepts "41,5" and "41.5", with ± steppers. Keeps the raw text while typing
 * so a half-typed "41," is never clobbered; reports a parsed number (or null when invalid).
 */
export function AmountInput({ label, value, onChange, step = 1, min = 0, suffix, id: idProp, autoFocus }: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  suffix?: string;
  id?: string;
  autoFocus?: boolean;
}) {
  const auto = useId('amt');
  const id = idProp ?? auto;
  const [text, setText] = useState(formatAmount(value));
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const parsed = parseAmount(text);
    if (parsed === null || Math.abs(parsed - value) > 1e-9) setText(formatAmount(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  // The autofocus attribute only fires once per page/dialog open; when a sheet switches views
  // (search → amount) focus must be moved explicitly so keyboard and screen-reader users follow.
  useEffect(() => {
    if (!autoFocus) return;
    const el = inputRef.current;
    if (el) { el.focus({ preventScroll: true }); el.select(); }
  }, []);
  const commit = (s: string) => {
    setText(s);
    const v = parseAmount(s);
    setInvalid(v === null);
    if (v !== null) onChange(Math.max(min, v));
  };
  const nudge = (dir: 1 | -1) => {
    const next = Math.max(min, Math.round((value + dir * step) * 1000) / 1000);
    onChange(next);
    setText(formatAmount(next));
    setInvalid(false);
  };
  return (
    <div class="field">
      <label for={id}>{label}{suffix ? <span class="subtle"> ({suffix})</span> : null}</label>
      <div class="amount">
        <button type="button" class="btn btn-icon" aria-label={`Decrease ${label} by ${step}`} onClick={() => nudge(-1)}><Minus size={18} /></button>
        <input
          ref={inputRef} id={id} class="input input-num" inputMode="decimal" autoComplete="off" value={text} aria-invalid={invalid}
          onInput={(e) => commit(e.currentTarget.value)}
          onKeyDown={(e) => { if (e.key === 'ArrowUp') { e.preventDefault(); nudge(1); } if (e.key === 'ArrowDown') { e.preventDefault(); nudge(-1); } }}
          onFocus={(e) => e.currentTarget.select()}
        />
        <button type="button" class="btn btn-icon" aria-label={`Increase ${label} by ${step}`} onClick={() => nudge(1)}><Plus size={18} /></button>
      </div>
      {invalid ? <span class="error" role="alert">Enter a number like 41 or 41,5</span> : null}
    </div>
  );
}

export function Field({ label, hint, error, children, for: htmlFor }: { label: string; hint?: ComponentChildren; error?: string | null; children: ComponentChildren; for?: string }) {
  return (
    <div class="field">
      <label for={htmlFor}>{label}</label>
      {children}
      {hint ? <span class="hint">{hint}</span> : null}
      {error ? <span class="error" role="alert">{error}</span> : null}
    </div>
  );
}

export function Checkbox({ label, checked, onChange, disabled, hint }: { label: ComponentChildren; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  return (
    <div class="stack-s">
      <label class="checkbox">
        <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.currentTarget.checked)} />
        <span>{label}</span>
      </label>
      {hint ? <span class="hint">{hint}</span> : null}
    </div>
  );
}

export function NumberField({ label, value, onChange, suffix, min, max, step, hint, id: idProp, placeholder }: {
  label: string; value: number | null | undefined; onChange: (v: number | null) => void; suffix?: string;
  min?: number; max?: number; step?: number; hint?: string; id?: string; placeholder?: string;
}) {
  const auto = useId('num');
  const id = idProp ?? auto;
  const [text, setText] = useState(value === null || value === undefined ? '' : formatAmount(value));
  useEffect(() => {
    const p = parseAmount(text);
    if (value === null || value === undefined) { if (text !== '' && p !== null) setText(''); return; }
    if (p === null || Math.abs(p - value) > 1e-9) setText(formatAmount(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const p = parseAmount(text);
  const outOfRange = p !== null && ((min !== undefined && p < min) || (max !== undefined && p > max));
  const invalid = text.trim() !== '' && (p === null || outOfRange);
  return (
    <div class="field">
      <label for={id}>{label}{suffix ? <span class="subtle"> ({suffix})</span> : null}</label>
      <input
        id={id} class="input input-num" inputMode="decimal" autoComplete="off" value={text} placeholder={placeholder}
        aria-invalid={invalid} step={step}
        onInput={(e: JSX.TargetedEvent<HTMLInputElement>) => {
          const s = e.currentTarget.value;
          setText(s);
          if (s.trim() === '') return onChange(null);
          const v = parseAmount(s);
          if (v !== null && !((min !== undefined && v < min) || (max !== undefined && v > max))) onChange(v);
        }}
      />
      {invalid ? <span class="error" role="alert">{outOfRange ? `Enter ${min ?? 0}–${max ?? '∞'}` : 'Enter a number (41 or 41,5)'}</span> : hint ? <span class="hint">{hint}</span> : null}
    </div>
  );
}
