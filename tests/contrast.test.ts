/**
 * WCAG 2.2 AA contrast for every text-colour token on every surface, in both themes.
 * Parses src/styles/tokens.css so a token change that breaks contrast fails CI.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const css = fs.readFileSync(path.resolve(__dirname, '..', 'src', 'styles', 'tokens.css'), 'utf8');

function block(selector: string): Record<string, string> {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error(`no ${selector}`);
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]!] = m[2]!;
  return out;
}

const dark = block(':root {');
const light = { ...dark, ...block(":root[data-theme='light']") };

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const TEXT = ['fg', 'fg-muted', 'fg-subtle', 'ember-text', 'ok', 'warn', 'danger', 'info'];
const SURFACES = ['bg', 'surface', 'card', 'raised'];

describe.each([['dark', dark], ['light', light]] as const)('%s theme', (_name, t) => {
  for (const fg of TEXT) {
    for (const bg of SURFACES) {
      it(`${fg} on ${bg} ≥ 4.5:1`, () => {
        expect(ratio(t[fg]!, t[bg]!)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  it('button text on the ember gradient ≥ 4.5:1 at both ends', () => {
    expect(ratio(t['on-ember']!, t.ember!)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t['on-ember']!, t['ember-2']!)).toBeGreaterThanOrEqual(4.5);
  });
  it('macro bar colours are distinguishable from the track (≥ 3:1 non-text)', () => {
    for (const c of ['protein', 'carbs', 'fat', 'fiber']) expect(ratio(t[c]!, t.raised!), c).toBeGreaterThanOrEqual(3);
  });
});
