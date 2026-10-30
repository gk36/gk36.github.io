import { href } from '../app/router';
import { Activity, ChefHat, ClipboardList, Dumbbell, ExternalLink, Settings, Utensils } from '../ui/icons';

export function More() {
  const items = [
    { to: href('kitchen'), label: 'Kitchen', sub: 'Recipes, batch cooking, leftovers', icon: ChefHat },
    { to: href('nutrients'), label: 'Nutrients', sub: 'Vitamins & minerals vs reference intakes', icon: Activity },
    { to: href('foods'), label: 'Foods & saved meals', sub: 'Search, add foods from labels', icon: Utensils },
    { to: href('settings'), label: 'Settings & data', sub: 'Profile, backups, v1 import', icon: Settings },
  ];
  return (
    <div class="page">
      <h1 class="page-title">More</h1>
      <nav class="card list" aria-label="More sections">
        {items.map((i) => (
          <a key={i.to} class="item" href={i.to} style={{ textDecoration: 'none' }}>
            <i.icon size={20} aria-hidden="true" />
            <div class="item-main"><span class="item-name">{i.label}</span><span class="item-sub">{i.sub}</span></div>
          </a>
        ))}
      </nav>
      <section class="card list" aria-label="Classic pages">
        <a class="item" href="../index.html" style={{ textDecoration: 'none' }}>
          <ClipboardList size={20} aria-hidden="true" />
          <div class="item-main"><span class="item-name">Classic planner</span><span class="item-sub">The original CARBMAXX page, unchanged</span></div>
          <ExternalLink size={16} aria-hidden="true" />
        </a>
        <a class="item" href="../workout.html" style={{ textDecoration: 'none' }}>
          <Dumbbell size={20} aria-hidden="true" />
          <div class="item-main"><span class="item-name">Workout program & 3D viewer</span><span class="item-sub">Your split, supersets, muscle tags</span></div>
          <ExternalLink size={16} aria-hidden="true" />
        </a>
      </section>
    </div>
  );
}
