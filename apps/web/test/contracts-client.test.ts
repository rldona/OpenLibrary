/**
 * The web imports the contracts through their zod-free entry: nothing it re-exports as a value may
 * import zod, or zod is back in the bundle.
 */
// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const src = (f: string) =>
  readFileSync(new URL(`../../../packages/contracts/src/${f}`, import.meta.url), 'utf8');

it('keeps zod out of @openlibrary/contracts/client', () => {
  const client = src('client.ts');
  const values = [...client.matchAll(/^export \* from '\.\/(\w+)\.js';/gm)].map((m) => `${m[1]}.ts`);
  expect(values.length).toBeGreaterThan(0);
  for (const f of values) {
    const text = src(f);
    expect(text, f).not.toMatch(/from 'zod'/);
    // Only other zod-free modules, through type-only imports otherwise.
    for (const m of text.matchAll(/^import (?!type )[^;]*from '\.\/(\w+)\.js';/gm))
      expect(values, `${f} imports ${m[1]}`).toContain(`${m[1]}.ts`);
  }
});
