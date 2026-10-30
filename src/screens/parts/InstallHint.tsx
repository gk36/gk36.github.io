import { useState } from 'preact/hooks';
import { Share, X } from '../../ui/icons';

const KEY = 'carbmaxx.installHintDismissed';

export function isIos(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** iPhone Safari deletes site data after 7 days without a visit; Home Screen apps are exempt. */
export function InstallHint() {
  const [hidden, setHidden] = useState(() => {
    try { return localStorage.getItem(KEY) === '1'; } catch { return false; }
  });
  if (hidden || !isIos() || isStandalone()) return null;
  return (
    <div class="callout warn" role="note">
      <div class="spread">
        <b>Add CARBMAXX to your Home Screen</b>
        <button type="button" class="btn btn-ghost btn-icon btn-s" aria-label="Dismiss" onClick={() => { setHidden(true); try { localStorage.setItem(KEY, '1'); } catch { /* ignore */ } }}><X size={16} /></button>
      </div>
      <p class="small">Safari deletes a website's data after 7 days unused; Home Screen apps keep it. Tap <Share size={14} aria-label="Share" style={{ display: 'inline' }} /> → <b>Add to Home Screen</b>, then open CARBMAXX from there. Do it before logging lots: the Home Screen app starts with its own storage (move data over with a backup).</p>
    </div>
  );
}
