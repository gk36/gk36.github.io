import { useMemo, useState } from 'preact/hooks';
import { useLive } from '../ui/hooks';
import { Segmented } from '../ui/controls';
import { Pencil, Search, Star } from '../ui/icons';
import { SourceBadge } from '../ui/nutrition';
import { allFoods, customFoods } from '../data/foods/registry';
import { db } from '../data/db';
import type { SavedMeal } from '../data/types';
import { indexFoods, searchFoods } from '../domain/search';
import { displayName, PREP_LABEL, type Food } from '../domain/nutrition/food';
import { openSheet } from '../app/store';
import { navigate } from '../app/router';

type Tab = 'all' | 'mine' | 'meals';

export function Foods({ tab: tabParam }: { tab?: string }) {
  const tab: Tab = tabParam === 'mine' || tabParam === 'meals' ? tabParam : 'all';
  const [q, setQ] = useState('');
  const foods = useLive(() => allFoods(), [], [] as Food[]);
  const mine = useLive(() => customFoods(), [], [] as Food[]);
  const meals = useLive(async () => (await db().savedMeals.toArray()).filter((m) => !m.deletedAt), [], [] as SavedMeal[]);
  const index = useMemo(() => indexFoods(tab === 'mine' ? mine : foods), [foods, mine, tab]);
  const list = q.trim() ? searchFoods(index, q, new Map(), 120) : (tab === 'mine' ? mine : foods);

  return (
    <div class="page">
      <div class="page-head">
        <h1 class="page-title">Foods</h1>
        <button type="button" class="btn btn-primary" onClick={() => openSheet({ kind: 'food-editor' })}><Pencil size={16} aria-hidden="true" /> New food from label</button>
      </div>
      <Segmented label="Show" hideLabel value={tab} onChange={(v) => navigate('foods', v)}
        options={[{ value: 'all', label: `All (${foods.length})` }, { value: 'mine', label: `My foods (${mine.length})` }, { value: 'meals', label: `Saved meals (${meals.length})` }]} />
      {tab === 'meals' ? (
        meals.length ? (
          <div class="card list">
            {meals.map((m) => (
              <button type="button" key={m.id} class="item" onClick={() => openSheet({ kind: 'saved-meal', mealId: m.id })}>
                <Star size={18} aria-hidden="true" />
                <div class="item-main"><span class="item-name">{m.name}</span><span class="item-sub">{m.items.map((i) => displayName(i.food)).join(', ')}</span></div>
              </button>
            ))}
          </div>
        ) : <div class="card empty"><Star size={26} aria-hidden="true" /><h3>No saved meals yet</h3><p>In the Diary, use “Save … as a meal” to log a whole meal in one tap next time.</p></div>
      ) : (
        <>
          <div class="field">
            <label for="foods-q" class="sr-only">Search foods</label>
            <input id="foods-q" class="input" type="search" placeholder="Search (English or Ελληνικά)…" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
          </div>
          {list.length ? (
            <div class="card list">
              {list.map((f) => (
                <button type="button" key={f.id} class="item" onClick={() => openSheet({ kind: 'food', food: f })}>
                  <div class="item-main">
                    <span class="item-name">{displayName(f)}</span>
                    <span class="item-sub cluster">{f.recipe ? <span class="badge">{f.recipe.example ? 'Example recipe' : f.recipe.cookedOn ? 'Batch' : 'Recipe'}</span> : <SourceBadge src={f.src} />}{f.prep !== 'as-sold' ? <span>{PREP_LABEL[f.prep]}</span> : null}{f.names.el ? <span lang="el">{f.names.el}</span> : null}</span>
                  </div>
                  <div class="item-end small num">{f.n.kcal === undefined ? '?' : `${f.partial?.includes('kcal') ? '≥ ' : ''}${Math.round(f.n.kcal)}`} kcal<span class="xs subtle">{f.basis.per === 'unit' ? `per ${f.basis.unitLabel}` : f.basis.per === '100ml' ? '/100 mL' : '/100 g'}</span></div>
                </button>
              ))}
            </div>
          ) : (
            <div class="card empty"><Search size={26} aria-hidden="true" /><h3>{tab === 'mine' ? 'No foods of your own yet' : 'No match'}</h3><p>Add packaged foods from their nutrition label — Greek or English, per 100 g, per 100 mL or per serving.</p></div>
          )}
          <p class="xs subtle">Generic foods: USDA FoodData Central (public domain), SR Legacy 2018. Values marked Proxy/Estimate are labelled as such.</p>
        </>
      )}
    </div>
  );
}
