import type { Blueprint, Chosen, ChosenMap, Option } from './model';

/**
 * Meal ideas: each is a real recipe shape with roles (base, protein, fruit…) that the generator fills
 * with foods and exact amounts. Instructions are written from the chosen foods, so they always match
 * the ingredient list. Cooking temperatures are USDA FSIS safe minimums: poultry 74 °C (165 °F),
 * ground beef 71 °C (160 °F), steaks and fish 63 °C (145 °F, steaks after a 3-minute rest).
 */

const o = (food: string, min: number, max: number, typical: number, label: string, extra: Partial<Option> = {}): Option => ({ food, min, max, typical, label, ...extra });

/** "a, b and c" from whatever parts are present. */
export function list(parts: readonly (string | false | null | undefined)[]): string {
  const p = parts.filter((x): x is string => !!x && x.trim().length > 0);
  if (p.length <= 1) return p[0] ?? '';
  return `${p.slice(0, -1).join(', ')} and ${p[p.length - 1]}`;
}
const t = (c: Chosen | undefined) => c?.text;
const is = (c: Chosen | undefined, key: string) => c?.food.id === `core:${key}`;
const tsp = (c: Chosen | undefined, gramsPerTsp: number) => (c ? ` (about ${Math.max(0.5, Math.round((c.amount / gramsPerTsp) * 2) / 2)} tsp)` : '');

/** Water for rice by weight: about twice the dry rice. */
const riceWater = (c: Chosen | undefined) => (c ? Math.round((c.amount * 2) / 10) * 10 : 0);
const RAW_VEG = new Set(['core:cucumber-raw', 'core:tomato-raw', 'core:lettuce-romaine']);

const FRUIT_SWEET = [
  o('banana', 60, 180, 100, 'banana'), o('strawberries', 60, 200, 120, 'strawberries'), o('blueberries', 50, 200, 100, 'blueberries'),
  o('raspberries', 50, 200, 100, 'raspberries'), o('mixed-berries', 60, 200, 120, 'mixed berries'), o('kiwi', 60, 210, 140, 'kiwi, sliced'),
  o('mango', 60, 200, 120, 'mango'),
];
const BERRIES = FRUIT_SWEET.filter((f) => f.food !== 'banana');
const SWEETENER = [o('honey', 5, 20, 10, 'honey'), o('maple-syrup', 5, 20, 10, 'maple syrup')];
const GREEK = [o('greek-yogurt-nonfat', 100, 300, 150, 'Greek yogurt (0%)'), o('greek-yogurt-lowfat', 100, 300, 150, 'Greek yogurt (2%)')];
const MILK = (min: number, max: number, typical: number) => [o('milk-skim', min, max, typical, 'skimmed milk', { unit: 'ml' }), o('milk-1', min, max, typical, '1% milk', { unit: 'ml' })];
const OIL = (min: number, max: number, typical: number) => [o('olive-oil', min, max, typical, 'olive oil')];

export const BLUEPRINTS: readonly Blueprint[] = [
  {
    id: 'protein-cream-of-rice', name: 'Protein cream of rice', meals: ['breakfast', 'snack'], taste: 'sweet', minutes: 8, needs: [['hob'], ['microwave']],
    roles: [
      { key: 'base', label: 'Cream of rice (dry)', options: [o('cream-of-rice-dry', 35, 110, 60, 'cream of rice')] },
      { key: 'milk', label: 'Milk to cook in', optional: true, options: MILK(80, 300, 0) },
      { key: 'protein', label: 'Protein', options: [o('whey-protein', 15, 45, 30, 'whey protein'), o('egg-white-raw', 90, 250, 150, 'egg whites'), o('greek-yogurt-nonfat', 100, 250, 150, 'Greek yogurt (0%)')] },
      { key: 'fruit', label: 'Fruit', options: FRUIT_SWEET },
      { key: 'sweet', label: 'Sweetener', optional: true, options: SWEETENER },
      { key: 'spice', label: 'Spice', optional: true, options: [o('cinnamon', 1, 3, 2, 'cinnamon')] },
    ],
    steps: (c) => {
      const base = c.base!;
      const liquid = Math.round((base.amount * 5) / 10) * 10;
      const milk = c.milk;
      const water = Math.max(0, liquid - (milk?.amount ?? 0));
      const s = [milk
        ? `Heat ${water ? `${water} mL water and ` : ''}${milk.text} in a small pot over medium heat until it just boils — milk catches, so stir.`
        : `Bring ${liquid} mL water to a boil in a small pot (about 5 mL per gram of cereal; use less for a thicker bowl).`];
      s.push(`Sprinkle in ${base.text} while whisking. Turn the heat to low and simmer about 1 minute, stirring, until thick, then let it stand 1 minute. (Microwave instead: mix in a large bowl, cook 1 minute, stir, then 30–60 seconds more.)`);
      const p = c.protein!;
      if (is(p, 'whey-protein')) s.push(`Off the heat, let it cool for a minute, then stir in ${p.text} with a splash of water — whey stirred into boiling cereal goes lumpy.`);
      else if (is(p, 'egg-white-raw')) s.push(`Pour in ${p.text} while whisking and keep stirring over low heat for 2–3 minutes, until no runny white is left and it turns fluffy.`);
      else s.push(`Off the heat, stir through ${p.text}, or spoon it on top.`);
      s.push(`Top with ${list([t(c.fruit), t(c.sweet), t(c.spice)])}.`);
      return s;
    },
  },
  {
    id: 'protein-oat-pancakes', name: 'Protein oat pancakes', meals: ['breakfast'], taste: 'sweet', minutes: 20, needs: [['hob']],
    roles: [
      { key: 'oats', label: 'Oats', options: [o('oats-dry', 40, 90, 60, 'rolled oats')] },
      { key: 'whites', label: 'Egg whites', options: [o('egg-white-raw', 90, 250, 150, 'egg whites')] },
      { key: 'egg', label: 'Whole egg', optional: true, options: [o('egg-whole-raw', 1, 2, 1, 'eggs', { unit: 'piece', labelOne: 'egg' })] },
      { key: 'banana', label: 'Banana in the batter', optional: true, options: [o('banana', 40, 120, 60, 'ripe banana')] },
      { key: 'milk', label: 'Milk', optional: true, options: MILK(30, 150, 60) },
      { key: 'rise', label: 'Baking powder', options: [o('baking-powder', 3, 6, 4, 'baking powder')] },
      { key: 'spice', label: 'Spice', optional: true, options: [o('cinnamon', 1, 3, 2, 'cinnamon')] },
      { key: 'whey', label: 'Extra protein', optional: true, options: [o('whey-protein', 10, 30, 0, 'whey protein')] },
      { key: 'yogurt', label: 'Yogurt topping', optional: true, options: GREEK.map((g) => ({ ...g, min: 60, max: 200, typical: 100 })) },
      { key: 'fruit', label: 'Fruit', options: BERRIES },
      { key: 'syrup', label: 'Syrup', optional: true, options: SWEETENER.map((x) => ({ ...x, min: 5, max: 25, typical: 15 })) },
    ],
    steps: (c) => [
      `Blend ${c.oats!.text} into a coarse flour. (No blender: use quick oats and a whisk.)`,
      `Add ${list([t(c.whites), t(c.egg), c.banana ? `${c.banana.text}, mashed` : null, t(c.milk), `${c.rise!.text}${tsp(c.rise, 4.6)}`, t(c.spice), t(c.whey)])} and blend or whisk until smooth. Let the batter rest 5 minutes so the oats thicken it.`,
      'Heat a non-stick pan over medium-low heat and wipe it with a drop of oil. Pour about 3 tablespoons of batter per pancake. Cook 2–3 minutes, until bubbles show and the edges look set, then flip and cook 1–2 minutes more — the centre should spring back.',
      `Serve topped with ${list([t(c.yogurt), t(c.fruit), t(c.syrup)])}.`,
    ],
  },
  {
    id: 'cheesecake-bowl', name: 'Cheesecake yogurt bowl', meals: ['breakfast', 'snack'], taste: 'sweet', minutes: 5, needs: [[]],
    roles: [
      { key: 'yogurt', label: 'Greek yogurt', options: GREEK.map((g) => ({ ...g, min: 150, max: 350, typical: 250 })) },
      { key: 'cottage', label: 'Cottage cheese', optional: true, options: [o('cottage-cheese-1', 50, 200, 100, 'cottage cheese (1%)')] },
      { key: 'vanilla', label: 'Vanilla', options: [o('vanilla-extract', 2, 6, 4, 'vanilla extract')] },
      { key: 'sweet', label: 'Sweetener', options: SWEETENER.map((x) => ({ ...x, typical: 12 })) },
      { key: 'lemon', label: 'Lemon', optional: true, options: [o('lemon-juice', 3, 10, 5, 'lemon juice')] },
      { key: 'whey', label: 'Extra protein', optional: true, options: [o('whey-protein', 10, 25, 0, 'whey protein')] },
      { key: 'crumb', label: 'Biscuit "base"', optional: true, options: [o('graham-crackers', 8, 30, 14, 'graham crackers')] },
      { key: 'fruit', label: 'Fruit', options: BERRIES },
    ],
    steps: (c) => [
      c.cottage
        ? `Blend ${c.cottage.text} until completely smooth (a stick blender, or a fork and some patience), then mix in ${list([t(c.yogurt), `${c.vanilla!.text}${tsp(c.vanilla, 4.2)}`, t(c.sweet), t(c.lemon)])}.`
        : `Stir ${list([t(c.yogurt), `${c.vanilla!.text}${tsp(c.vanilla, 4.2)}`, t(c.sweet), t(c.lemon)])} together until smooth.`,
      ...(c.whey ? [`Stir in ${c.whey.text}; add a spoon of water if it gets too thick.`] : []),
      ...(c.crumb ? [`Just before eating, crush ${c.crumb.text} over it as the "base" — it stays crunchy that way.`] : []),
      `Top with ${t(c.fruit)}. For a firmer, more cheesecake-like set, chill it 10–15 minutes first.`,
    ],
  },
  {
    id: 'overnight-oats', name: 'Protein overnight oats', meals: ['breakfast'], taste: 'sweet', minutes: 5, needs: [[]], ahead: 'Make it the night before (at least 4 hours in the fridge).',
    roles: [
      { key: 'oats', label: 'Oats', options: [o('oats-dry', 35, 80, 50, 'rolled oats')] },
      { key: 'milk', label: 'Milk', options: MILK(100, 250, 150) },
      { key: 'yogurt', label: 'Greek yogurt', optional: true, options: GREEK.map((g) => ({ ...g, min: 80, max: 200, typical: 120 })) },
      { key: 'chia', label: 'Chia', optional: true, options: [o('chia-seeds', 5, 15, 8, 'chia seeds')] },
      { key: 'whey', label: 'Extra protein', optional: true, options: [o('whey-protein', 10, 30, 0, 'whey protein')] },
      { key: 'fruit', label: 'Fruit', options: FRUIT_SWEET },
      { key: 'sweet', label: 'Sweetener', optional: true, options: SWEETENER.map((x) => ({ ...x, typical: 8 })) },
      { key: 'spice', label: 'Spice', optional: true, options: [o('cinnamon', 1, 3, 1, 'cinnamon')] },
    ],
    steps: (c) => [
      `In a jar or box, stir ${list([t(c.oats), t(c.milk), t(c.yogurt), t(c.chia), t(c.whey), t(c.spice)])} together.`,
      'Cover and refrigerate overnight — at least 4 hours.',
      `In the morning, stir (add a splash of milk if it's too thick) and top with ${list([t(c.fruit), t(c.sweet)])}.`,
    ],
  },
  {
    id: 'protein-porridge', name: 'Protein porridge', meals: ['breakfast'], taste: 'sweet', minutes: 8, needs: [['hob'], ['microwave']],
    roles: [
      { key: 'oats', label: 'Oats', options: [o('oats-dry', 40, 90, 60, 'rolled oats')] },
      { key: 'milk', label: 'Milk', options: MILK(150, 350, 250) },
      { key: 'protein', label: 'Protein', options: [o('whey-protein', 15, 35, 25, 'whey protein'), o('egg-white-raw', 90, 200, 120, 'egg whites')] },
      { key: 'fruit', label: 'Fruit', options: FRUIT_SWEET },
      { key: 'sweet', label: 'Sweetener', optional: true, options: SWEETENER.map((x) => ({ ...x, typical: 8 })) },
      { key: 'spice', label: 'Spice', optional: true, options: [o('cinnamon', 1, 3, 2, 'cinnamon')] },
      { key: 'extra', label: 'Topping', optional: true, options: [o('peanut-butter', 8, 16, 0, 'peanut butter')] },
    ],
    steps: (c) => {
      const p = c.protein!;
      return [
        `Simmer ${list([t(c.oats), t(c.milk)])} over medium heat for 4–5 minutes, stirring, until creamy — add a splash of water if you like it looser. (Microwave: 2½–3 minutes in a large bowl, stirring halfway.)`,
        is(p, 'whey-protein')
          ? `Off the heat, let it cool for a minute, then stir in ${p.text} with a splash of milk or water.`
          : `Stir in ${p.text} and keep cooking 2–3 minutes, stirring, until no runny white is left.`,
        `Top with ${list([t(c.fruit), t(c.sweet), t(c.spice), t(c.extra)])}.`,
      ];
    },
  },
  {
    id: 'yogurt-parfait', name: 'Greek yogurt parfait', meals: ['breakfast', 'snack'], taste: 'sweet', minutes: 3, needs: [[]],
    roles: [
      { key: 'yogurt', label: 'Greek yogurt', options: GREEK.map((g) => ({ ...g, min: 150, max: 300, typical: 200 })) },
      { key: 'whey', label: 'Extra protein', optional: true, options: [o('whey-protein', 10, 25, 0, 'whey protein')] },
      { key: 'fruit', label: 'Fruit', options: FRUIT_SWEET },
      { key: 'crunch', label: 'Crunch', options: [o('oats-dry', 15, 40, 25, 'rolled oats'), o('graham-crackers', 8, 28, 14, 'graham crackers, crushed')] },
      { key: 'sweet', label: 'Sweetener', optional: true, options: SWEETENER.map((x) => ({ ...x, typical: 8 })) },
    ],
    steps: (c) => [
      ...(c.whey ? [`Stir ${c.whey.text} into the yogurt (a spoon of water helps).`] : []),
      `In a glass or bowl, layer ${list([t(c.yogurt), t(c.fruit), t(c.crunch)])}.`,
      ...(c.sweet ? [`Drizzle with ${c.sweet.text}.`] : []),
    ],
  },
  {
    id: 'cottage-fruit-bowl', name: 'Cottage cheese fruit bowl', meals: ['snack', 'breakfast'], taste: 'sweet', minutes: 3, needs: [[]],
    roles: [
      { key: 'cottage', label: 'Cottage cheese', options: [o('cottage-cheese-1', 150, 300, 200, 'cottage cheese (1%)'), o('cottage-cheese-2', 150, 300, 200, 'cottage cheese (2%)')] },
      { key: 'fruit', label: 'Fruit', options: FRUIT_SWEET.map((f) => ({ ...f, typical: 130 })) },
      { key: 'sweet', label: 'Sweetener', optional: true, options: [o('honey', 4, 15, 8, 'honey')] },
      { key: 'spice', label: 'Spice', optional: true, options: [o('cinnamon', 1, 2, 1, 'cinnamon')] },
    ],
    steps: (c) => [
      `Spoon ${c.cottage!.text} into a bowl (blend it first if you prefer it smooth).`,
      `Top with ${list([t(c.fruit), t(c.sweet), t(c.spice)])}.`,
    ],
  },
  {
    id: 'protein-shake', name: 'Fruit protein shake', meals: ['snack', 'breakfast'], taste: 'sweet', minutes: 3, needs: [['blender']],
    roles: [
      { key: 'whey', label: 'Whey', options: [o('whey-protein', 20, 45, 30, 'whey protein')] },
      { key: 'liquid', label: 'Liquid', options: [...MILK(200, 400, 300), o('kefir-plain', 200, 400, 300, 'kefir', { unit: 'ml' })] },
      { key: 'fruit', label: 'Fruit', options: FRUIT_SWEET.map((f) => ({ ...f, min: 50, max: 150, typical: 100 })) },
      { key: 'oats', label: 'Oats', optional: true, options: [o('oats-dry', 15, 40, 0, 'rolled oats')] },
      { key: 'pb', label: 'Peanut butter', optional: true, options: [o('peanut-butter', 8, 16, 0, 'peanut butter')] },
    ],
    steps: (c) => [
      `Blend ${list([t(c.liquid), t(c.whey), t(c.fruit), t(c.oats), t(c.pb)])} for 30–45 seconds until smooth.`,
      'Add a few ice cubes for a thicker, colder shake.',
    ],
  },
  {
    id: 'rice-cakes-pb-banana', name: 'Rice cakes with peanut butter and banana', meals: ['snack'], taste: 'sweet', minutes: 3, needs: [[]],
    roles: [
      { key: 'cakes', label: 'Rice cakes', options: [o('rice-cakes', 2, 4, 3, 'rice cakes', { unit: 'piece', labelOne: 'rice cake' })] },
      { key: 'pb', label: 'Peanut butter', options: [o('peanut-butter', 10, 25, 15, 'peanut butter')] },
      { key: 'fruit', label: 'Fruit', options: [o('banana', 60, 130, 100, 'banana, sliced'), o('strawberries', 60, 150, 100, 'strawberries, sliced')] },
      { key: 'sweet', label: 'Honey', optional: true, options: [o('honey', 3, 10, 5, 'honey')] },
      { key: 'spice', label: 'Spice', optional: true, options: [o('cinnamon', 1, 2, 1, 'cinnamon')] },
    ],
    steps: (c) => [
      `Spread ${c.pb!.text} over ${c.cakes!.text}.`,
      `Top with ${list([t(c.fruit), c.sweet ? `a drizzle of ${c.sweet.text}` : null, t(c.spice)])}.`,
    ],
  },
  {
    id: 'egg-potato-hash', name: 'Egg and potato hash', meals: ['breakfast', 'lunch'], taste: 'savory', minutes: 25, needs: [['hob'], ['airfryer', 'hob']],
    roles: [
      { key: 'potato', label: 'Potatoes', options: [o('potato-raw', 150, 350, 250, 'potatoes')] },
      { key: 'eggs', label: 'Eggs', options: [o('egg-whole-raw', 1, 3, 2, 'eggs', { unit: 'piece', labelOne: 'egg' })] },
      { key: 'whites', label: 'Extra egg whites', optional: true, options: [o('egg-white-raw', 60, 200, 100, 'egg whites')] },
      { key: 'pepper', label: 'Pepper', options: [o('pepper-red-raw', 50, 150, 80, 'red pepper')] },
      { key: 'onion', label: 'Onion', optional: true, options: [o('onion-raw', 30, 80, 40, 'onion'), o('spring-onion', 10, 30, 15, 'spring onion')] },
      { key: 'cheese', label: 'Cheese', optional: true, options: [o('feta', 10, 40, 20, 'feta'), o('mozzarella-part-skim', 10, 40, 20, 'mozzarella')] },
      { key: 'oil', label: 'Oil', options: OIL(3, 10, 5) },
    ],
    steps: (c) => [
      `Dice ${c.potato!.text} into 1.5 cm cubes. Air-fry at 200 °C for 15–18 minutes with ${c.oil!.text}, shaking halfway — or cook them in a non-stick pan with the oil over medium heat, lid on for the first 8 minutes, about 15 minutes in all, until golden and tender.`,
      `Add the diced ${list([c.pepper!.text, t(c.onion)])} for the last 5 minutes.`,
      `Make space in the pan, add ${list([t(c.eggs), t(c.whites)])} and scramble until fully set.`,
      `${c.cheese ? `Crumble ${c.cheese.text} over, ` : ''}${c.cheese ? 'season' : 'Season'} with salt and pepper.`,
    ],
  },
  {
    id: 'egg-white-omelette', name: 'Egg white omelette with toast', meals: ['breakfast'], taste: 'savory', minutes: 12, needs: [['hob']],
    roles: [
      { key: 'whites', label: 'Egg whites', options: [o('egg-white-raw', 120, 300, 200, 'egg whites')] },
      { key: 'eggs', label: 'Whole egg', optional: true, options: [o('egg-whole-raw', 1, 2, 1, 'eggs', { unit: 'piece', labelOne: 'egg' })] },
      { key: 'veg', label: 'Vegetables', options: [o('mushrooms-white-raw', 30, 120, 60, 'mushrooms'), o('pepper-red-raw', 30, 120, 70, 'red pepper'), o('tomato-raw', 40, 150, 80, 'tomato')] },
      { key: 'cheese', label: 'Cheese', optional: true, options: [o('feta', 10, 30, 15, 'feta'), o('mozzarella-part-skim', 10, 30, 15, 'mozzarella')] },
      { key: 'bread', label: 'Bread', options: [o('bread-sourdough', 40, 120, 70, 'sourdough bread')] },
      { key: 'oil', label: 'Oil', options: OIL(2, 6, 3) },
    ],
    steps: (c) => [
      `Slice ${c.veg!.text} and soften it in a non-stick pan with ${c.oil!.text} over medium heat, 2–3 minutes.`,
      `Whisk ${list([t(c.whites), t(c.eggs)])} with a pinch of salt and pour it over the vegetables. Cook 2–3 minutes, lifting the edges, until set${c.cheese ? `; add ${c.cheese.text}, fold, and cook 30 seconds more` : '; fold it over'}.`,
      `Toast ${c.bread!.text} and serve alongside.`,
    ],
  },
  {
    id: 'chicken-rice-bowl', name: 'Chicken and rice bowl', meals: ['lunch', 'dinner'], taste: 'savory', minutes: 25, needs: [['hob']],
    roles: [
      { key: 'protein', label: 'Protein', options: [o('chicken-breast-raw', 120, 260, 180, 'chicken breast'), o('turkey-breast-raw', 120, 260, 180, 'turkey breast'), o('chicken-thigh-raw', 120, 220, 160, 'chicken thigh')] },
      { key: 'rice', label: 'Rice (dry)', options: [o('rice-white-raw', 50, 140, 85, 'white rice'), o('rice-short-raw', 50, 140, 85, 'short-grain rice')] },
      { key: 'veg', label: 'Vegetables', options: [o('pepper-red-raw', 60, 200, 100, 'red pepper'), o('carrots-raw', 50, 150, 80, 'carrots'), o('mushrooms-white-raw', 50, 150, 80, 'mushrooms'), o('cucumber-raw', 60, 200, 100, 'cucumber'), o('tomato-raw', 60, 200, 120, 'tomatoes')] },
      { key: 'veg2', label: 'More vegetables', optional: true, options: [o('carrots-raw', 30, 120, 60, 'carrots'), o('cucumber-raw', 40, 150, 80, 'cucumber'), o('spring-onion', 5, 30, 15, 'spring onion'), o('onion-raw', 30, 80, 40, 'onion')] },
      { key: 'sauce', label: 'Sauce', options: [o('soy-sauce', 5, 20, 10, 'soy sauce'), o('lemon-juice', 5, 20, 10, 'lemon juice')] },
      { key: 'garlic', label: 'Garlic', optional: true, options: [o('garlic', 2, 9, 3, 'garlic')] },
      { key: 'oil', label: 'Oil', options: OIL(3, 12, 7) },
    ],
    steps: (c) => {
      const cooked = [c.veg, c.veg2].filter((v) => v && !RAW_VEG.has(v.food.id));
      const raw = [c.veg, c.veg2].filter((v) => v && RAW_VEG.has(v.food.id));
      const thigh = is(c.protein, 'chicken-thigh-raw');
      return [
        `Rinse ${c.rice!.text}. Simmer it with about ${riceWater(c.rice)} mL water and a pinch of salt, lid on, on low heat for 12–15 minutes until the water is absorbed; rest 5 minutes off the heat.`,
        `Cut ${c.protein!.text} into strips, season with salt and pepper and cook in ${c.oil!.text} over medium-high heat for ${thigh ? '8–10' : '6–8'} minutes, turning, until cooked through — 74 °C in the thickest piece, no pink.`,
        ...(cooked.length || c.garlic ? [`Add ${list([...cooked.map((v) => v!.text), c.garlic ? `${c.garlic.text}, chopped` : null])} for the last 2–3 minutes.`] : []),
        `Serve over the rice${raw.length ? ` with ${list(raw.map((v) => `${v!.text}, sliced`))} on the side` : ''}, dressed with ${c.sauce!.text}.`,
      ];
    },
  },
  {
    id: 'steak-potatoes', name: 'Steak and potatoes', meals: ['lunch', 'dinner'], taste: 'savory', minutes: 40, needs: [['hob', 'oven'], ['hob', 'airfryer'], ['hob']],
    roles: [
      { key: 'steak', label: 'Steak', options: [o('beef-steak-lean-raw', 150, 260, 200, 'lean sirloin steak')] },
      { key: 'carb', label: 'Potatoes', options: [o('potato-raw', 200, 450, 300, 'potatoes'), o('potato-russet-raw', 200, 450, 300, 'baking potatoes'), o('sweet-potato-raw', 200, 400, 280, 'sweet potato')] },
      { key: 'leaf', label: 'Salad leaves', options: [o('lettuce-romaine', 30, 120, 60, 'romaine lettuce')] },
      { key: 'salad', label: 'Salad', optional: true, options: [o('tomato-raw', 60, 200, 120, 'tomatoes'), o('cucumber-raw', 60, 200, 100, 'cucumber')] },
      { key: 'salad2', label: 'More salad', optional: true, options: [o('cucumber-raw', 60, 200, 100, 'cucumber'), o('pepper-red-raw', 40, 120, 60, 'red pepper')] },
      { key: 'oil', label: 'Oil', options: OIL(4, 12, 7) },
      { key: 'acid', label: 'Lemon', optional: true, options: [o('lemon-juice', 5, 15, 10, 'lemon juice')] },
    ],
    steps: (c) => [
      `Cut ${c.carb!.text} into wedges and toss with half of ${c.oil!.text}. Roast at 220 °C for 30–35 minutes (or air-fry at 200 °C for 20–25 minutes), turning once, until golden. No oven: boil them in salted water for 15–20 minutes until tender.`,
      `Pat ${c.steak!.text} dry and season well. Sear in a very hot pan with a drop of the oil, 2–4 minutes per side depending on thickness. 63 °C inside is medium — USDA's safe minimum for steak after a 3-minute rest.`,
      'Rest the steak 5 minutes, then slice it across the grain.',
      `Toss ${list([t(c.leaf), t(c.salad), t(c.salad2)])} with the rest of the oil${c.acid ? ` and ${c.acid.text}` : ''}.`,
    ],
  },
  {
    id: 'sweet-chili-chicken-noodles', name: 'Sweet chili chicken noodles', meals: ['lunch', 'dinner'], taste: 'savory', minutes: 25, needs: [['hob']],
    roles: [
      { key: 'chicken', label: 'Chicken', options: [o('chicken-breast-raw', 120, 220, 170, 'chicken breast')] },
      { key: 'noodles', label: 'Noodles (dry)', options: [o('rice-noodles-dry', 50, 110, 75, 'rice noodles'), o('egg-noodles-dry', 50, 110, 75, 'egg noodles')] },
      { key: 'sauce', label: 'Sweet chili sauce', options: [o('match:sweet chili', 20, 80, 40, 'sweet chili sauce')] },
      { key: 'soy', label: 'Soy sauce', options: [o('soy-sauce', 5, 20, 10, 'soy sauce')] },
      { key: 'veg', label: 'Vegetables', options: [o('pepper-red-raw', 60, 160, 100, 'red pepper')] },
      { key: 'veg2', label: 'More vegetables', optional: true, options: [o('carrots-raw', 30, 100, 60, 'carrots'), o('mushrooms-white-raw', 30, 100, 60, 'mushrooms')] },
      { key: 'onion', label: 'Spring onion', optional: true, options: [o('spring-onion', 5, 30, 15, 'spring onion')] },
      { key: 'garlic', label: 'Garlic', optional: true, options: [o('garlic', 2, 9, 3, 'garlic')] },
      { key: 'lime', label: 'Lime', optional: true, options: [o('lime-juice', 5, 15, 8, 'lime juice')] },
      { key: 'oil', label: 'Oil', options: OIL(3, 10, 5) },
    ],
    steps: (c) => [
      is(c.noodles, 'rice-noodles-dry')
        ? `Soak ${c.noodles!.text} in just-boiled water for 5–8 minutes (or as the packet says) until tender; drain and rinse with cold water so they don't stick.`
        : `Boil ${c.noodles!.text} for 4–6 minutes (or as the packet says); drain.`,
      `Slice ${c.chicken!.text} into thin strips and stir-fry in ${c.oil!.text} over high heat for 5–6 minutes, until cooked through — 74 °C, no pink.`,
      `Add ${list([t(c.veg), t(c.veg2), c.garlic ? `${c.garlic.text}, chopped` : null])}; stir-fry 2 minutes.`,
      `Add the noodles, ${c.sauce!.text} and ${c.soy!.text}; toss for 1 minute until glossy and hot.`,
      ...(c.onion || c.lime ? [`Finish with ${list([c.onion ? `${c.onion.text}, sliced` : null, t(c.lime)])}.`] : []),
    ],
  },
  {
    id: 'lean-beef-soup', name: 'Lean beef and vegetable soup', meals: ['lunch', 'dinner'], taste: 'savory', minutes: 40, needs: [['hob']],
    tip: 'Makes one big bowl. Multiply everything for a pot — it keeps 3 days in the fridge and freezes well.',
    roles: [
      { key: 'beef', label: 'Lean beef', options: [o('beef-ground-95-raw', 120, 220, 160, 'lean beef mince (5% fat)'), o('beef-steak-lean-raw', 120, 220, 160, 'lean beef, diced')] },
      { key: 'potato', label: 'Potato', options: [o('potato-raw', 100, 300, 180, 'potato')] },
      { key: 'carrot', label: 'Carrot', options: [o('carrots-raw', 40, 150, 80, 'carrot')] },
      { key: 'onion', label: 'Onion', options: [o('onion-raw', 30, 120, 70, 'onion')] },
      { key: 'celery', label: 'Celery', optional: true, options: [o('celery', 20, 80, 40, 'celery')] },
      { key: 'tomato', label: 'Tomato', optional: true, options: [o('tomato-raw', 50, 200, 100, 'tomato')] },
      { key: 'garlic', label: 'Garlic', optional: true, options: [o('garlic', 2, 9, 3, 'garlic')] },
      { key: 'broth', label: 'Broth', optional: true, options: [o('beef-broth', 300, 700, 450, 'beef broth', { unit: 'ml' })] },
      { key: 'oil', label: 'Oil', options: OIL(2, 8, 4) },
    ],
    steps: (c) => {
      const mince = is(c.beef, 'beef-ground-95-raw');
      return [
        `Dice ${list([t(c.onion), t(c.carrot), t(c.celery), t(c.potato), t(c.tomato)])}${c.garlic ? `; chop ${c.garlic.text}` : ''}.`,
        mince
          ? `Brown ${c.beef!.text} in a pot with ${c.oil!.text} over medium-high heat for 4–5 minutes, breaking it up.`
          : `Brown ${c.beef!.text} in a pot with ${c.oil!.text} over medium-high heat, 3–4 minutes, in one layer.`,
        `Add the onion, carrot${c.celery ? ', celery' : ''}${c.garlic ? ' and garlic' : ''}; cook 3 minutes, stirring.`,
        `Add the potato${c.tomato ? ' and tomato' : ''} and ${c.broth ? c.broth.text : 'about 450 mL water with salt to taste'}. Bring to a boil, then cover and simmer gently — ${mince ? '20–25 minutes' : '60–75 minutes, until the beef is tender'} — until the potato is soft${mince ? ' and the beef is cooked through (71 °C)' : ''}.`,
        'Season with salt and pepper.',
      ];
    },
  },
  {
    id: 'fish-potatoes', name: 'Fish, potatoes and salad', meals: ['lunch', 'dinner'], taste: 'savory', minutes: 35, needs: [['oven'], ['airfryer']],
    roles: [
      { key: 'fish', label: 'Fish', options: [o('salmon-raw', 120, 200, 150, 'salmon fillet'), o('cod-raw', 150, 260, 200, 'cod fillet')] },
      { key: 'carb', label: 'Potatoes', options: [o('potato-raw', 150, 400, 250, 'potatoes'), o('sweet-potato-raw', 150, 400, 250, 'sweet potato')] },
      { key: 'veg', label: 'Salad', options: [o('tomato-raw', 60, 200, 120, 'tomatoes'), o('cucumber-raw', 60, 200, 100, 'cucumber'), o('lettuce-romaine', 30, 120, 60, 'romaine lettuce')] },
      { key: 'veg2', label: 'More salad', optional: true, options: [o('cucumber-raw', 60, 200, 100, 'cucumber'), o('lettuce-romaine', 30, 120, 60, 'romaine lettuce')] },
      { key: 'lemon', label: 'Lemon', options: [o('lemon-juice', 5, 20, 10, 'lemon juice')] },
      { key: 'oil', label: 'Oil', optional: true, options: OIL(2, 8, 4) },
    ],
    steps: (c) => [
      `Cut ${c.carb!.text} into chunks${c.oil ? ` and toss with half of ${c.oil.text}` : ''}. Roast at 210 °C for 30 minutes (or air-fry at 200 °C for 20 minutes).`,
      `Season ${c.fish!.text} with salt, pepper and a little of ${c.lemon!.text}; add it to the tray for the last 12–15 minutes (10–12 in the air fryer), until it flakes easily — 63 °C inside.`,
      `Serve with ${list([t(c.veg), t(c.veg2)])}, dressed with the rest of the lemon${c.oil ? ' and oil' : ''}.`,
    ],
  },
  {
    id: 'tuna-rice-bowl', name: 'Tuna rice bowl', meals: ['lunch', 'dinner'], taste: 'savory', minutes: 20, needs: [['hob']],
    roles: [
      { key: 'tuna', label: 'Tuna', options: [o('tuna-canned-water-drained', 80, 160, 120, 'tuna in water, drained')] },
      { key: 'rice', label: 'Rice (dry)', options: [o('rice-white-raw', 50, 120, 75, 'white rice'), o('rice-short-raw', 50, 120, 75, 'short-grain rice')] },
      { key: 'veg', label: 'Vegetables', options: [o('cucumber-raw', 60, 150, 100, 'cucumber')] },
      { key: 'veg2', label: 'More vegetables', optional: true, options: [o('carrots-raw', 30, 100, 50, 'carrot'), o('pepper-red-raw', 30, 100, 50, 'red pepper')] },
      { key: 'onion', label: 'Spring onion', optional: true, options: [o('spring-onion', 5, 20, 10, 'spring onion')] },
      { key: 'sauce', label: 'Soy sauce', options: [o('soy-sauce', 5, 15, 8, 'soy sauce')] },
      { key: 'acid', label: 'Lemon', optional: true, options: [o('lemon-juice', 3, 10, 5, 'lemon juice')] },
      { key: 'oil', label: 'Oil', optional: true, options: OIL(2, 8, 4) },
    ],
    steps: (c) => [
      `Rinse ${c.rice!.text}. Simmer it with about ${riceWater(c.rice)} mL water, lid on, on low heat for 12–15 minutes until the water is absorbed; rest 5 minutes.`,
      `Slice ${list([t(c.veg), t(c.veg2), t(c.onion)])}.`,
      `Top the rice with ${c.tuna!.text} and the vegetables; dress with ${list([t(c.sauce), t(c.acid), t(c.oil)])}.`,
    ],
  },
  {
    id: 'tomato-pasta', name: 'Chicken tomato pasta', meals: ['lunch', 'dinner'], taste: 'savory', minutes: 25, needs: [['hob']],
    roles: [
      { key: 'pasta', label: 'Pasta (dry)', options: [o('pasta-dry', 60, 120, 85, 'pasta')] },
      { key: 'protein', label: 'Protein', options: [o('chicken-breast-raw', 120, 200, 150, 'chicken breast'), o('beef-ground-95-raw', 120, 200, 150, 'lean beef mince (5% fat)'), o('turkey-breast-raw', 120, 200, 150, 'turkey breast')] },
      { key: 'tomato', label: 'Tomatoes', options: [o('tomato-raw', 100, 300, 200, 'ripe tomatoes')] },
      { key: 'onion', label: 'Onion', options: [o('onion-raw', 30, 90, 50, 'onion')] },
      { key: 'garlic', label: 'Garlic', optional: true, options: [o('garlic', 2, 9, 3, 'garlic')] },
      { key: 'oil', label: 'Oil', options: OIL(3, 10, 6) },
      { key: 'cheese', label: 'Cheese', optional: true, options: [o('mozzarella-part-skim', 10, 40, 20, 'mozzarella'), o('feta', 10, 40, 20, 'feta')] },
    ],
    steps: (c) => {
      const mince = is(c.protein, 'beef-ground-95-raw');
      return [
        `Boil ${c.pasta!.text} in well-salted water as the packet says (usually 9–11 minutes); keep a cup of the cooking water.`,
        mince
          ? `Brown ${c.protein!.text} in ${c.oil!.text} over medium-high heat for 4–5 minutes, breaking it up, until no pink remains (71 °C).`
          : `Dice ${c.protein!.text} and cook it in ${c.oil!.text} over medium-high heat for 6–7 minutes, until cooked through (74 °C).`,
        `Add ${list([`${c.onion!.text}, chopped`, c.garlic ? `${c.garlic.text}, chopped` : null])}; cook 3 minutes. Add ${c.tomato!.text}, chopped, with a pinch of salt and simmer 8–10 minutes until saucy.`,
        `Toss with the pasta, loosening with a splash of the cooking water${c.cheese ? `, and top with ${c.cheese.text}` : ''}.`,
      ];
    },
  },
  {
    id: 'traybake', name: 'Turkey and sweet potato traybake', meals: ['lunch', 'dinner'], taste: 'savory', minutes: 35, needs: [['oven'], ['airfryer']],
    roles: [
      { key: 'protein', label: 'Protein', options: [o('turkey-breast-raw', 130, 220, 170, 'turkey breast'), o('chicken-breast-raw', 130, 220, 170, 'chicken breast')] },
      { key: 'carb', label: 'Potatoes', options: [o('sweet-potato-raw', 150, 400, 250, 'sweet potato'), o('potato-raw', 150, 400, 250, 'potatoes')] },
      { key: 'veg', label: 'Vegetables', options: [o('pepper-red-raw', 60, 200, 100, 'red pepper'), o('carrots-raw', 60, 160, 90, 'carrots')] },
      { key: 'veg2', label: 'More vegetables', optional: true, options: [o('onion-raw', 30, 80, 50, 'red or white onion'), o('mushrooms-white-raw', 40, 120, 70, 'mushrooms')] },
      { key: 'oil', label: 'Oil', options: OIL(4, 10, 6) },
    ],
    steps: (c) => [
      `Cut ${c.carb!.text} into 2 cm cubes, toss with half of ${c.oil!.text} and roast at 210 °C for 15 minutes (air fryer: 200 °C for 10 minutes).`,
      `Add ${c.protein!.text} in chunks, ${list([t(c.veg), t(c.veg2)])} and the rest of the oil; roast 15–18 minutes more (air fryer 10–12), until the meat is cooked through — 74 °C, no pink — and the potato is tender.`,
      'Season with salt, pepper and any dried herbs you like.',
    ],
  },
];
