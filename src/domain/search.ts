import type { Food } from './nutrition/food';

/** Lower-case, strip accents (Greek tonos, Latin diacritics), unify final sigma, drop punctuation. */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .replace(/ς/g, 'σ')
    .replace(/[^\p{L}\p{N}%]+/gu, ' ')
    .trim();
}

export interface Indexed<T extends Pick<Food, 'id' | 'names' | 'brand'>> {
  item: T;
  name: string;
  tokens: string[];
}

export function indexFoods<T extends Pick<Food, 'id' | 'names' | 'brand'>>(foods: readonly T[]): Indexed<T>[] {
  return foods.map((item) => {
    const parts = [item.names.en, item.names.el ?? '', item.brand ?? '', ...(item.names.aliases ?? [])];
    const name = normalize(`${item.brand ? `${item.brand} ` : ''}${item.names.en}`);
    const tokens = Array.from(new Set(normalize(parts.join(' ')).split(' ').filter(Boolean)));
    return { item, name, tokens };
  });
}

/**
 * Every query word must match a word of the food (prefix, or substring for 3+ letters).
 * Ranked by match quality, then a caller-supplied boost (recently/frequently used), then name length.
 */
export function searchFoods<T extends Pick<Food, 'id' | 'names' | 'brand'>>(
  index: readonly Indexed<T>[], query: string, boost: ReadonlyMap<string, number> = new Map(), limit = 60,
): T[] {
  const q = normalize(query).split(' ').filter(Boolean);
  if (q.length === 0) return [];
  const scored: { item: T; score: number; len: number }[] = [];
  for (const row of index) {
    let score = 0;
    let ok = true;
    for (const w of q) {
      let best = 0;
      for (const t of row.tokens) {
        if (t === w) { best = 3; break; }
        if (t.startsWith(w)) best = Math.max(best, 2);
        else if (w.length >= 3 && t.includes(w)) best = Math.max(best, 1);
      }
      if (best === 0) { ok = false; break; }
      score += best;
    }
    if (!ok) continue;
    if (row.name.startsWith(q.join(' '))) score += 2;
    score += boost.get(row.item.id) ?? 0;
    scored.push({ item: row.item, score, len: row.name.length });
  }
  scored.sort((a, b) => b.score - a.score || a.len - b.len);
  return scored.slice(0, limit).map((s) => s.item);
}
