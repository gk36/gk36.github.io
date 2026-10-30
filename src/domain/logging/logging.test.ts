import { describe, expect, it } from 'vitest';
import core from '../../data/foods/core.json';
import type { Food } from '../nutrition/food';
import { contribution } from '../nutrition/compute';
import { looksLikeMealText, parseFoodText } from './parse';
import { matchAll, matchMention, stem, wordScore, type MatchContext } from './match';

const foods = core as unknown as Food[];
const ctx: MatchContext = { foods };
const byId = (id: string) => foods.find((f) => f.id === id)!;
const blocking = (it: { issues: { blocking: boolean; kind: string }[] }) => it.issues.filter((i) => i.blocking).map((i) => i.kind);

describe('parseFoodText', () => {
  it('reads the owner\'s example sentence', () => {
    const p = parseFoodText('I ate 282 g cooked chicken breast, 300 g cooked rice, 77 g sweet chili sauce and an apple.');
    expect(p.status).toBe('eaten');
    expect(p.items.map((i) => [i.words.join(' '), i.amount?.value, i.amount?.unit, i.state])).toEqual([
      ['chicken breast', 282, 'g', 'cooked'],
      ['rice', 300, 'g', 'cooked'],
      ['sweet chili sauce', 77, 'g', null],
      ['apple', 1, null, null],
    ]);
  });

  it('keeps vague amounts vague', () => {
    const p = parseFoodText('Had 2 macarons, some pasta and 250 ml orange juice.');
    expect(p.items.map((i) => i.words.join(' '))).toEqual(['macarons', 'pasta', 'orange juice']);
    expect(p.items[0]!.amount).toMatchObject({ value: 2, unit: null, vague: false });
    expect(p.items[1]!.amount).toMatchObject({ value: null, vague: true });
    expect(p.items[2]!.amount).toMatchObject({ value: 250, unit: 'ml' });
  });

  it('reads Greek, with inflected states, units and number words', () => {
    const p = parseFoodText('Έφαγα 200 γρ κοτόπουλο ψητό, 150γρ ρύζι βρασμένο και ένα μήλο');
    expect(p.status).toBe('eaten');
    expect(p.items.map((i) => [i.words.join(' '), i.amount?.value, i.amount?.unit, i.state])).toEqual([
      ['κοτοπουλο', 200, 'g', 'roasted'],
      ['ρυζι', 150, 'g', 'boiled'],
      ['μηλο', 1, null, null],
    ]);
    expect(parseFoodText('μισή μπανάνα').items[0]!.amount).toMatchObject({ value: 0.5, unit: null });
    expect(parseFoodText('δύο αυγά').items[0]!.amount).toMatchObject({ value: 2, unit: null });
  });

  it('handles decimal commas, thousands, fractions and multipliers', () => {
    expect(parseFoodText('1,5 κιλό πατάτες').items[0]!.amount).toMatchObject({ value: 1500, unit: 'g' });
    expect(parseFoodText('0,5 l milk').items[0]!.amount).toMatchObject({ value: 500, unit: 'ml' });
    expect(parseFoodText('1,000 ml water').items[0]!.amount).toMatchObject({ value: 1000, unit: 'ml' });
    expect(parseFoodText('½ cup oats').items[0]!.amount).toMatchObject({ value: 0.5, unit: 'cup' });
    expect(parseFoodText('1 1/2 scoops whey').items[0]!.amount).toMatchObject({ value: 1.5, unit: 'scoop' });
    expect(parseFoodText('2 x 150 g yogurt').items[0]!.amount).toMatchObject({ value: 300, unit: 'g' });
    expect(parseFoodText('8 oz steak').items[0]!.amount!.value).toBeCloseTo(226.796, 2);
  });

  it('marks approximate and container amounts', () => {
    expect(parseFoodText('about 200 g chicken').items[0]!.amount).toMatchObject({ value: 200, approx: true, vague: false });
    expect(parseFoodText('a glass of orange juice').items[0]!.amount).toMatchObject({ value: 1, unit: 'glass', vague: true });
    expect(parseFoodText('περίπου 100 γρ φέτα').items[0]).toMatchObject({ words: ['φετα'], amount: { value: 100, unit: 'g', approx: true } });
  });

  it('splits on joining words but keeps compound names whole', () => {
    expect(parseFoodText('50 g sweet and sour sauce').items.map((i) => i.words.join(' '))).toEqual(['sweet sour sauce']);
    expect(parseFoodText('chicken with rice').items.map((i) => i.words.join(' '))).toEqual(['chicken', 'rice']);
    expect(parseFoodText('κοτόπουλο με ρύζι').items).toHaveLength(2);
    expect(parseFoodText('2 φέτες ψωμί').items[0]).toMatchObject({ words: ['ψωμι'], amount: { value: 2, unit: 'slice' } });
  });

  it('notices the meal and plan wording', () => {
    const p = parseFoodText('for breakfast I had 3 eggs and a banana');
    expect(p.slot).toBe('breakfast');
    expect(p.items.map((i) => [i.words.join(' '), i.amount?.value])).toEqual([['eggs', 3], ['banana', 1]]);
    const q = parseFoodText("I'll have 100g oats with 300 ml skim milk");
    expect(q.status).toBe('planned');
    expect(q.items.map((i) => [i.words.join(' '), i.amount?.value, i.amount?.unit])).toEqual([['oats', 100, 'g'], ['skim milk', 300, 'ml']]);
  });

  it('tells a typed meal apart from a search', () => {
    expect(looksLikeMealText('chicken')).toBe(false);
    expect(looksLikeMealText('greek yogurt')).toBe(false);
    expect(looksLikeMealText('2 eggs')).toBe(true);
    expect(looksLikeMealText('rice and chicken')).toBe(true);
    expect(looksLikeMealText('sweet and sour sauce')).toBe(false);
  });
});

describe('word matching', () => {
  it('stems English plurals and Greek endings', () => {
    expect(stem('eggs')).toBe('egg');
    expect(stem('potatoes')).toBe('potato');
    expect(stem('strawberries')).toBe('strawberry');
    expect(stem('μηλα')).toBe(stem('μηλο'));
    expect(stem('κοτοπουλου')).toBe(stem('κοτοπουλο'));
    expect(stem('μπανανεσ')).toBe(stem('μπανανα'));
  });
  it('treats look-alikes as unsure', () => {
    expect(wordScore('macarons', 'macaroni').sure).toBe(false);
    expect(wordScore('pea', 'peanut').sure).toBe(false);
    expect(wordScore('tomato', 'tomatoes').sure).toBe(true);
  });
});

describe('matching typed items to foods', () => {
  it('matches the example sentence with real USDA numbers', () => {
    const items = matchAll(parseFoodText('I ate 282 g cooked chicken breast, 300 g cooked rice, 77 g sweet chili sauce and an apple.').items, ctx);
    expect(items.map((i) => i.food?.id ?? null)).toEqual(['core:chicken-breast-roasted', 'core:rice-white-cooked', null, 'core:apple']);
    expect(blocking(items[0]!)).toEqual([]);
    expect(blocking(items[1]!)).toEqual([]);
    expect(blocking(items[2]!)).toEqual(['no-match']);
    expect(blocking(items[3]!)).toEqual([]);
    expect(items[3]!.notes.join(' ')).toMatch(/Size assumed: 1 medium/);
    const chicken = contribution(items[0]!.food!, items[0]!.qty!);
    if ('error' in chicken) throw new Error(chicken.error);
    // USDA FDC 171477: 165 kcal and 31.02 g protein per 100 g.
    expect(chicken.n.kcal).toBeCloseTo(165 * 2.82, 5);
    expect(chicken.n.protein).toBeCloseTo(byId('core:chicken-breast-roasted').n.protein! * 2.82, 5);
    const apple = contribution(items[3]!.food!, items[3]!.qty!);
    if ('error' in apple) throw new Error(apple.error);
    expect(apple.grams).toBe(182);
  });

  it('asks instead of guessing: unknown food, vague amount, cooked or dry', () => {
    const items = matchAll(parseFoodText('Had 2 macarons, some pasta and 250 ml orange juice.').items, ctx);
    expect(items[0]!.food).toBeNull();
    expect(blocking(items[0]!)).toEqual(['no-match']);
    // "macaroni" is only offered as a suggestion, never chosen.
    expect(items[0]!.alternatives.map((f) => f.id)).toContain('core:pasta-dry');
    expect(blocking(items[1]!).sort()).toEqual(['amount', 'state']);
    expect(items[1]!.statePair).not.toBeNull();
    expect(items[2]!.food?.id).toBe('core:orange-juice');
    expect(blocking(items[2]!)).toEqual([]);
    expect(items[2]!.qty).toEqual({ amount: 250, unit: 'ml' });
  });

  it('matches Greek', () => {
    const items = matchAll(parseFoodText('Έφαγα 200 γρ κοτόπουλο ψητό, 150γρ ρύζι βρασμένο και ένα μήλο').items, ctx);
    expect(items.map((i) => i.food?.id)).toEqual(['core:chicken-breast-roasted', 'core:rice-white-cooked', 'core:apple']);
    expect(items.flatMap(blocking)).toEqual([]);
  });

  it('asks raw or cooked for weighed foods that have both', () => {
    const [rice] = matchAll(parseFoodText('300 g rice').items, ctx);
    expect(blocking(rice!)).toEqual(['state']);
    expect([rice!.food?.id, rice!.statePair?.id].sort()).toEqual(['core:rice-white-cooked', 'core:rice-white-raw']);
    const [eggs] = matchAll(parseFoodText('2 eggs').items, ctx);
    expect(eggs!.food?.id).toBe('core:egg-whole-raw');
    expect(blocking(eggs!)).toEqual([]);
    expect(eggs!.qty).toMatchObject({ amount: 2, unit: 'portion' });
    expect(contribution(eggs!.food!, eggs!.qty!)).toMatchObject({ grams: 100 });
  });

  it('refuses to use dry values for a cooked weight', () => {
    const [oats] = matchAll(parseFoodText('300 g cooked oatmeal').items, ctx);
    expect(oats!.food?.id).toBe('core:oats-dry');
    expect(blocking(oats!)).toContain('state');
  });

  it('makes the user choose between foods that differ a lot in calories', () => {
    const [milk] = matchAll(parseFoodText('200 ml milk').items, ctx);
    expect(blocking(milk!)).toEqual(['choose-food']);
    const [usual] = matchAll(parseFoodText('200 ml milk').items, { ...ctx, boost: new Map([['core:milk-1', 2]]) });
    expect(usual!.food?.id).toBe('core:milk-1');
    expect(blocking(usual!)).toEqual([]);
  });

  it('uses USDA kitchen measures and refuses unknown ones', () => {
    const [honey] = matchAll(parseFoodText('2 tbsp honey').items, ctx);
    expect(contribution(honey!.food!, honey!.qty!)).toMatchObject({ grams: 42 });
    const [rice] = matchAll(parseFoodText('1 cup cooked rice').items, ctx);
    expect(contribution(rice!.food!, rice!.qty!)).toMatchObject({ grams: 158 });
    const [whey] = matchAll(parseFoodText('1 scoop whey').items, ctx);
    expect(whey!.food?.id).toBe('core:whey-protein');
    expect(blocking(whey!)).toEqual(['unit']);
  });

  it('remembers corrections', () => {
    const sauce: Food = {
      id: 'custom:sauce', names: { en: 'Thai sweet chilli dipping sauce' }, kind: 'custom', group: 'other', prep: 'as-sold', basis: { per: '100g' },
      portions: [], n: { kcal: 200, protein: 0.5, carbs: 48, fat: 0.5 }, carbsIncludeFiber: false, kcalOrigin: 'label', src: { type: 'label', confidence: 'high' },
    };
    const mention = parseFoodText('77 g sweet chili sauce').items[0]!;
    expect(matchMention(mention, { foods: [...foods, sauce] }).food?.id).not.toBe('custom:sauce');
    const learned = matchMention(mention, { foods: [...foods, sauce], learned: new Map([['sweet chili sauce', 'custom:sauce']]) });
    expect(learned.food?.id).toBe('custom:sauce');
    expect(blocking(learned)).toEqual([]);
    expect(learned.qty).toEqual({ amount: 77, unit: 'g' });
  });

  it('never matches a generic word on its own', () => {
    const [sauce] = matchAll(parseFoodText('50 g garlic sauce').items, ctx);
    // "garlic" is a real food, but only half the phrase: the user must confirm.
    expect(blocking(sauce!)).toContain('confirm-food');
    const [peas] = matchAll(parseFoodText('100 g peas').items, ctx);
    expect(peas!.food).toBeNull();
  });
});
