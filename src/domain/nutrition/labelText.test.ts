import { describe, expect, it } from 'vitest';
import { fixDigits, parseLabelText } from './labelText';

const values = (t: ReturnType<typeof parseLabelText>) => Object.fromEntries(Object.entries(t.fields).map(([k, v]) => [k, v!.value]));

describe('reading nutrition values from label text', () => {
  it('a bilingual Greek/English EU table, per 100 g', () => {
    const t = parseLabelText(`ΔΙΑΤΡΟΦΙΚΗ ΕΠΙΣΗΜΑΝΣΗ / NUTRITION DECLARATION
Μέση διατροφική αξία ανά 100g / Average values per 100g
Ενέργεια / Energy 1569 kJ / 375 kcal
Λιπαρά / Fat 9,5 g
εκ των οποίων κορεσμένα / of which saturates 3,1 g
Υδατάνθρακες / Carbohydrate 61 g
εκ των οποίων σάκχαρα / of which sugars 22 g
Φυτικές ίνες / Fibre 4,2 g
Πρωτεΐνες / Protein 8,8 g
Αλάτι / Salt 0,45 g`);
    expect(t.basis).toBe('per100g');
    expect(t.region).toBe('eu');
    expect(values(t)).toEqual({ energyKcal: 375, energyKj: 1569, fat: 9.5, satFat: 3.1, carbs: 61, sugars: 22, fiber: 4.2, protein: 8.8, salt: 0.45 });
    expect(t.fields.fat!.line).toBe('Λιπαρά / Fat 9,5 g');
    expect(t.warnings).toEqual([]);
  });

  it('two columns (per 100 g and per portion): the per-100 g column wins; kJ and kcal on separate lines', () => {
    const t = parseLabelText(`100g Μερίδα 30g
Ενέργεια 1569kJ 471kJ
375kcal 113kcal
Λιπαρά 9,5g 2,9g
κορεσμένα 3,1g 0,9g
Υδατάνθρακες 61g 18g
σάκχαρα 22g 6,6g
Πρωτεΐνες 8,8g 2,6g
Αλάτι 0,45g 0,14g`);
    expect(values(t)).toMatchObject({ energyKcal: 375, energyKj: 1569, fat: 9.5, satFat: 3.1, carbs: 61, sugars: 22, protein: 8.8, salt: 0.45 });
    expect(t.servingG).toBe(30);
  });

  it('a drink per 100 mL with "less than" values', () => {
    const t = parseLabelText(`Nutrition information per 100 ml
Energy 188 kJ / 45 kcal
Fat <0,5 g
of which saturates <0,1 g
Carbohydrate 10,4 g
of which sugars 9,8 g
Protein 0,7 g
Salt <0,01 g`);
    expect(t.basis).toBe('per100ml');
    expect(t.fields.fat).toMatchObject({ value: 0.5, lessThan: true });
    expect(t.fields.salt).toMatchObject({ value: 0.01, lessThan: true });
    expect(t.warnings.join(' ')).toMatch(/fat is printed as “less than 0.5”/);
  });

  it('US Nutrition Facts: per serving, sodium in mg, added sugars and %DV ignored', () => {
    const t = parseLabelText(`Nutrition Facts
8 servings per container
Serving size 2/3 cup (55g)
Calories 230
% Daily Value*
Total Fat 8g 10%
Saturated Fat 1g 5%
Trans Fat 0g
Cholesterol 0mg 0%
Sodium 160mg 7%
Total Carbohydrate 37g 13%
Dietary Fiber 4g 14%
Total Sugars 12g
Includes 10g Added Sugars 20%
Protein 3g`);
    expect(t.basis).toBe('perServing');
    expect(t.region).toBe('us');
    expect(t.servingG).toBe(55);
    expect(values(t)).toEqual({ energyKcal: 230, fat: 8, satFat: 1, sodiumMg: 160, carbs: 37, fiber: 4, sugars: 12, protein: 3 });
  });

  it('OCR noise: O for 0, kcaI, a name on one line and the number on the next', () => {
    const t = parseLabelText(`ανά 100 g
Ενέργεια/Energy 1O46kJ/25Okcal
Λιπαρά
9,5 g
Πρωτεΐνες / Protein 1O,2 g`);
    expect(values(t)).toMatchObject({ energyKj: 1046, energyKcal: 250, fat: 9.5, protein: 10.2 });
    expect(fixDigits('25Okcal 1O,2 g Oats')).toBe('250kcal 10,2 g Oats');
  });

  it('real mixed-script OCR output: Greek look-alike letters inside English words and units', () => {
    // Verbatim Tesseract (ell+eng) output for a rendered bilingual label.
    const t = parseLabelText('ΔΙΑΤΡΟΦΙΚΗ ΕΠΙΣΗΜΑΝΣΗ / NUTRITION\n\nανά 100 ο / per 100 g\n\nΕνέργεια / Energy 1569 kJ / 375 Κοαὶ\n\nΛιπαρά / Fat 9,5 g\n\nεκ των οποίων Kopeopéva / of which saturates 3,1 g\nΥδατάνθρακες / Carbohydrate 61 g\n\nεκ των οποίων σάκχαρα / of which sugars 22 g\nΦυτικές ives / Fibre 4,2 g\n\nMpwreiveg / Protein 8,8 g\n\nΑλάτι / Salt 0,45 g');
    expect(t.basis).toBe('per100g');
    expect(values(t)).toEqual({ energyKcal: 375, energyKj: 1569, fat: 9.5, satFat: 3.1, carbs: 61, sugars: 22, fiber: 4.2, protein: 8.8, salt: 0.45 });
    expect(parseLabelText('per 100 g\nΡrotein 7 g\nΕnergy 250 κcal').fields).toMatchObject({ protein: { value: 7 }, energyKcal: { value: 250 } });
  });

  it('never mistakes protein (πρωτεΐνες) for fibre (ίνες) or unsaturated fat for saturated', () => {
    const t = parseLabelText(`ανά 100g
Λιπαρά 20 g
εκ των οποίων μονοακόρεστα 12 g
εκ των οποίων κορεσμένα 4 g
Πρωτεΐνες 8 g`);
    expect(t.fields.fiber).toBeUndefined();
    expect(t.fields.satFat!.value).toBe(4);
    expect(t.fields.fat!.value).toBe(20);
  });

  it('flags impossible or contradictory numbers instead of passing them on', () => {
    const t = parseLabelText(`per 100 g
Energy 2200 kcal
Fat 9 g
of which saturates 12 g
Carbohydrate 150 g`);
    expect(t.fields.energyKcal).toBeUndefined();
    expect(t.fields.carbs).toBeUndefined();
    expect(t.warnings.join(' ')).toMatch(/impossible per 100/);
    expect(t.warnings.join(' ')).toMatch(/Saturated fat is higher than total fat/);
  });

  it('a photo without a nutrition table says so', () => {
    const t = parseLabelText('Best before 12/2027\nKeep refrigerated');
    expect(t.fields).toEqual({});
    expect(t.warnings[0]).toMatch(/No nutrition values found/);
  });
});
