import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { ICONS } from './Icon.jsx';

const manifest = JSON.parse(readFileSync(new URL('./icons.manifest.json', import.meta.url), 'utf8'));
const GENERATED = Object.keys(manifest.icons);
const HINT = 'run `npm run prepare:assets` in frontend/ (prebuild generates the Solar icons)';

describe('piano icon registry completeness', () => {
  it('registry is not empty', () => {
    expect(Object.keys(ICONS).length, `no icons loaded: ${HINT}`).toBeGreaterThan(0);
  });

  it('manifest lists icons', () => {
    expect(GENERATED.length).toBeGreaterThan(0);
  });

  it.each(GENERATED)('generated icon %s is present and renders in currentColor at 1em', (id) => {
    const svg = ICONS[id];
    expect(svg, `icon "${id}" missing: ${HINT}`).toBeTruthy();
    expect(svg).toMatch(/width="1em"/);
    expect(svg).toMatch(/height="1em"/);
    expect(svg).toMatch(/currentColor/);
  });
});
