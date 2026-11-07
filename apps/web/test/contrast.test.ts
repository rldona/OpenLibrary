// @vitest-environment node
/**
 * WCAG contrast of the colour roles defined in styles.css, light and dark, with the same pairs as the
 * Android theme's ThemeContrastTest (1.4.3 text ≥ 4.5:1, 1.4.11 component borders ≥ 3:1).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');

const DARK = '@media (prefers-color-scheme: dark)';
/** The custom properties declared in the first `:root { … }` block after `from`. */
function rootTokens(from: number): Record<string, string> {
  const start = css.indexOf(':root {', from);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}
const LIGHT = rootTokens(0);
const themeOf = (dark: boolean) => (dark ? { ...LIGHT, ...rootTokens(css.indexOf(DARK)) } : LIGHT);

function color(theme: Record<string, string>, name: string): string {
  let v = theme[name];
  for (let i = 0; v?.startsWith('var(') && i < 5; i++) v = theme[v.slice(6, -1)];
  if (!v || !/^#[0-9a-f]{6}$/i.test(v)) throw new Error(`--${name} is not a #rrggbb colour: ${v}`);
  return v;
}

const luminance = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

const SURFACES = ['background', 'surface', 'surface-container-high', 'surface-container-highest'];

describe.each([
  ['light', false],
  ['dark', true],
])('%s theme', (_, dark) => {
  const theme = themeOf(dark);
  const check = (fg: string, bg: string, min: number) => {
    const ratio = contrast(color(theme, fg), color(theme, bg));
    expect(ratio, `--${fg} on --${bg}: ${ratio.toFixed(2)}`).toBeGreaterThanOrEqual(min);
  };

  it('has readable text and visible borders on every surface', () => {
    for (const bg of SURFACES) {
      check('outline', bg, 3);
      check('on-surface', bg, 4.5);
      check('on-surface-variant', bg, 4.5);
    }
    for (const bg of ['background', 'surface', 'surface-container-high']) {
      check('primary', bg, 4.5);
      check('error', bg, 4.5);
    }
  });

  it('has readable text on its containers', () => {
    check('on-primary', 'primary', 4.5);
    check('on-primary-container', 'primary-container', 4.5);
    check('on-error', 'error', 4.5);
    check('on-error-container', 'error-container', 4.5);
    check('on-tertiary-container', 'tertiary-container', 4.5);
    check('success', 'success-container', 4.5);
    check('info', 'info-container', 4.5);
    check('on-secondary-container', 'secondary-container', 4.5);
    // Menu counters and secondary text on chips.
    check('on-surface-variant', 'surface-variant', 4.5);
  });

  it('has a readable snackbar', () => {
    check('inverse-on-surface', 'inverse-surface', 4.5);
    check('inverse-primary', 'inverse-surface', 4.5);
  });

  it('has a readable "Provisional" tag', () => check('on-provisional', 'provisional', 4.5));

  it('keeps the old names as aliases of the roles', () => {
    expect(color(theme, 'line')).toBe(color(theme, 'outline-variant'));
    expect(color(theme, 'accent')).toBe(color(theme, 'primary'));
    expect(color(theme, 'muted')).toBe(color(theme, 'on-surface-variant'));
  });
});

it('steps the surface containers away from the page', () => {
  for (const dark of [false, true]) {
    const theme = themeOf(dark);
    const ladder = ['lowest', 'low', '', 'high', 'highest'].map((s) =>
      luminance(color(theme, s ? `surface-container-${s}` : 'surface-container')),
    );
    const ordered = ladder.slice(1).every((l, i) => (dark ? l > ladder[i]! : l < ladder[i]!));
    expect(ordered, `${dark ? 'dark' : 'light'}: ${ladder.join(', ')}`).toBe(true);
  }
});
