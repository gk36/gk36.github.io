import { toast } from './store';

/**
 * Registers the offline service worker (production builds only). A new version never takes over
 * mid-session: the user gets a toast and chooses when to reload.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  // Inside a frame (an embedded preview) a service worker can't control the page anyway.
  if (window.top !== window.self) return;
  // The first install also fires controllerchange (clients.claim); reloading then would wipe
  // whatever the user is typing, so only a user-requested update reloads.
  const hadController = !!navigator.serviceWorker.controller;
  let userAsked = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (userAsked) { userAsked = false; location.reload(); return; }
    if (hadController) toast('CARBMAXX was updated in another tab.', { ms: 30_000, action: { label: 'Reload', run: () => location.reload() } });
  });
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', { scope: './' }).then((reg) => {
      const offer = (w: ServiceWorker | null) => {
        if (!w || !navigator.serviceWorker.controller) return;
        toast('A new version of CARBMAXX is ready.', { ms: 30_000, action: { label: 'Reload', run: () => { userAsked = true; w.postMessage('skipWaiting'); } } });
      };
      if (reg.waiting) offer(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const w = reg.installing;
        w?.addEventListener('statechange', () => { if (w.state === 'installed') offer(w); });
      });
    }).catch((e: unknown) => console.warn('Service worker registration failed', e));
  });
}
