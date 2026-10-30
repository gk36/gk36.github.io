import { signal } from '@preact/signals';

/** Hash routes work on GitHub Pages without server rewrites: #/diary/2026-10-30 */
export type RouteName = 'today' | 'diary' | 'plan' | 'foods' | 'train' | 'more' | 'settings' | 'nutrients' | 'kitchen' | 'pantry' | 'progress';

export interface Route { name: RouteName; params: string[] }

const NAMES: readonly RouteName[] = ['today', 'diary', 'plan', 'foods', 'train', 'more', 'settings', 'nutrients', 'kitchen', 'pantry', 'progress'];

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const name = (parts[0] ?? 'today') as RouteName;
  return NAMES.includes(name) ? { name, params: parts.slice(1) } : { name: 'today', params: [] };
}

export const route = signal<Route>(typeof location === 'undefined' ? { name: 'today', params: [] } : parseHash(location.hash));

if (typeof window !== 'undefined') {
  window.addEventListener('hashchange', () => {
    route.value = parseHash(location.hash);
    document.getElementById('main')?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  });
}

export function href(name: RouteName, ...params: string[]): string {
  return `#/${[name, ...params].map(encodeURIComponent).join('/')}`;
}

export function navigate(name: RouteName, ...params: string[]): void {
  location.hash = href(name, ...params);
}
