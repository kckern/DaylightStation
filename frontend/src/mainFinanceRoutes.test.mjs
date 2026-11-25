import fs from 'node:fs';
import { describe, it, expect } from 'vitest';

const source = fs.readFileSync(new URL('./main.jsx', import.meta.url), 'utf8');

describe('Finance routes in main.jsx', () => {
  it('/budget and /finances sit inside the BrowserAppViewport layout route', () => {
    const open = source.indexOf('<Route element={<BrowserAppViewport />}>');
    const close = source.indexOf('</Route>', open);
    expect(open).toBeGreaterThan(-1);
    const block = source.slice(open, close);
    expect(block).toContain('path="/budget"');
    expect(block).toContain('path="/finances"');
    expect(source.indexOf('path="/budget"')).toBeLessThan(source.indexOf('path="/office"'));
  });

  it('the route chunk preload still matches both finance paths', () => {
    const m = source.match(/\[(\/\^\\\/\(budget\|finances\)\$\/), loadFinanceApp\]/);
    expect(m).not.toBeNull();
    const re = new RegExp(m[1].slice(1, -1));
    expect(re.test('/budget')).toBe(true);
    expect(re.test('/finances')).toBe(true);
  });
});
