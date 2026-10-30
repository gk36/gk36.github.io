import { useEffect } from 'preact/hooks';
import { href, route, type RouteName } from './router';
import { openSheet, profile, sheet, todayKey } from './store';
import { undoLast } from './actions';
import {
  Activity, BookOpen, ChefHat, ClipboardList, Dumbbell, Ellipsis, LayoutDashboard, Plus, Refrigerator, Settings, Utensils,
} from '../ui/icons';
import { Pantry } from '../screens/Pantry';
import { Nutrients } from '../screens/Nutrients';
import { Kitchen } from '../screens/Kitchen';
import { Toasts } from '../ui/Toasts';
import { SheetHost } from '../sheets/SheetHost';
import { Today } from '../screens/Today';
import { Diary } from '../screens/Diary';
import { PlanScreen } from '../screens/Plan';
import { Foods } from '../screens/Foods';
import { SettingsScreen } from '../screens/Settings';
import { More } from '../screens/More';
import { Train } from '../screens/Train';
import { Onboarding } from '../screens/Onboarding';
import { StorageChip } from '../screens/parts/StorageChip';
import { isDayKey } from '../domain/time';

const NAV: { name: RouteName; label: string; icon: typeof LayoutDashboard; mobile: boolean }[] = [
  { name: 'today', label: 'Today', icon: LayoutDashboard, mobile: true },
  { name: 'diary', label: 'Diary', icon: BookOpen, mobile: true },
  { name: 'plan', label: 'Plan', icon: ClipboardList, mobile: true },
  { name: 'nutrients', label: 'Nutrients', icon: Activity, mobile: false },
  { name: 'kitchen', label: 'Kitchen', icon: ChefHat, mobile: false },
  { name: 'pantry', label: 'Pantry', icon: Refrigerator, mobile: false },
  { name: 'foods', label: 'Foods', icon: Utensils, mobile: false },
  { name: 'train', label: 'Train', icon: Dumbbell, mobile: true },
  { name: 'settings', label: 'Settings', icon: Settings, mobile: false },
  { name: 'more', label: 'More', icon: Ellipsis, mobile: true },
];

function currentDay(): string {
  const r = route.value;
  if (r.name === 'diary' && r.params[0] && isDayKey(r.params[0])) return r.params[0];
  return todayKey.value;
}

export function App() {
  const r = route.value;
  const p = profile.value;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = !!t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
      if (sheet.value || typing || e.altKey || e.metaKey) return;
      if ((e.key === '/' || e.key.toLowerCase() === 'n') && !e.ctrlKey) {
        e.preventDefault();
        openSheet({ kind: 'quicklog', dayKey: currentDay() });
      } else if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        void undoLast();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!p) return <div class="page"><p class="muted">Loading…</p></div>;
  if (!p.onboarded) return <><Onboarding /><Toasts /></>;

  const active = (n: RouteName) => (r.name === n || (n === 'more' && ['foods', 'nutrients', 'settings', 'kitchen', 'pantry'].includes(r.name)) ? 'page' : undefined);
  const screen = (() => {
    switch (r.name) {
      case 'diary': return <Diary dayKey={r.params[0] && isDayKey(r.params[0]) ? r.params[0] : todayKey.value} />;
      case 'plan': return <PlanScreen />;
      case 'nutrients': return <Nutrients dayKey={r.params[0] && isDayKey(r.params[0]) ? r.params[0] : todayKey.value} />;
      case 'kitchen': return <Kitchen />;
      case 'pantry': return <Pantry tab={r.params[0] === 'shopping' ? 'shopping' : 'stock'} />;
      case 'foods': return <Foods tab={r.params[0]} />;
      case 'settings': return <SettingsScreen />;
      case 'more': return <More />;
      case 'train': return <Train params={r.params} />;
      default: return <Today />;
    }
  })();
  // Today has its own "What did you eat?" box, so the floating button would only cover it.
  const showFab = ['diary', 'plan', 'foods'].includes(r.name);

  return (
    <div class="app">
      <button type="button" class="skip-link" onClick={() => document.getElementById('main')?.focus()}>Skip to content</button>
      <nav class="sidebar" aria-label="Main">
        <a class="brand" href={href('today')} aria-label="CARBMAXX home">
          <span class="brand-mark" aria-hidden="true"><Utensils size={17} /></span>
          <span>CARB<b>MAXX</b></span>
        </a>
        {NAV.filter((n) => n.name !== 'more').map((n) => (
          <a key={n.name} class="side-item" href={href(n.name)} aria-current={active(n.name)}><n.icon size={19} aria-hidden="true" />{n.label}</a>
        ))}
        <div class="side-foot">
          <button type="button" class="btn btn-primary btn-block" onClick={() => openSheet({ kind: 'quicklog', dayKey: currentDay() })}><Plus size={18} /> Log food</button>
          <p style={{ marginTop: '10px' }}>Press <span class="kbd">/</span> to search · <span class="kbd">Ctrl</span>+<span class="kbd">Z</span> undo</p>
        </div>
      </nav>
      <div>
        <header class="topbar">
          <a class="brand" href={href('today')} aria-label="CARBMAXX home">
            <span class="brand-mark" aria-hidden="true"><Utensils size={17} /></span>
            <span>CARB<b>MAXX</b></span>
          </a>
          <span class="topbar-spacer" />
          <StorageChip />
        </header>
        <main id="main" class="main" tabIndex={-1}>{screen}</main>
      </div>
      <nav class="bottom-nav" aria-label="Main">
        {NAV.filter((n) => n.mobile).map((n) => (
          <a key={n.name} class="nav-item" href={href(n.name)} aria-current={active(n.name)}><n.icon size={22} aria-hidden="true" />{n.label}</a>
        ))}
      </nav>
      {showFab ? (
        <button type="button" class="fab" onClick={() => openSheet({ kind: 'quicklog', dayKey: currentDay() })}><Plus size={20} aria-hidden="true" /> Log</button>
      ) : null}
      <SheetHost />
      <Toasts />
    </div>
  );
}
