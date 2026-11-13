import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import ICONS, { hasIcon, buildIconRegistry } from './iconRegistry.js';

const manifest = JSON.parse(readFileSync(new URL('./icons.manifest.json', import.meta.url), 'utf8'));
const GENERATED = Object.keys(manifest.icons);
const HINT = 'run `npm run prepare:assets` in frontend/ (prebuild generates the Solar icons)';

describe('school icon registry completeness', () => {
  it('registry is not empty', () => {
    expect(Object.keys(ICONS).length, `no icons loaded: ${HINT}`).toBeGreaterThan(0);
  });

  it('manifest lists icons', () => {
    expect(GENERATED.length).toBeGreaterThan(0);
  });

  it.each(GENERATED)('generated icon %s is present and renders in currentColor at 1em', (id) => {
    expect(hasIcon(id), `icon "${id}" missing: ${HINT}`).toBe(true);
    const svg = ICONS[id];
    expect(svg).toMatch(/width="1em"/);
    expect(svg).toMatch(/height="1em"/);
    expect(svg).toMatch(/currentColor/);
  });
});

describe('buildIconRegistry precedence', () => {
  it('a tracked icon wins over a stale generated one of the same name, in either glob order', () => {
    const tracked = ['./svg/writing.svg', '<svg>pencil</svg>'];
    const stale = ['./svg/generated/writing.svg', '<svg>keyboard</svg>'];
    const keyboard = ['./svg/generated/keyboard.svg', '<svg>keyboard</svg>'];
    expect(buildIconRegistry(Object.fromEntries([stale, tracked, keyboard]))).toEqual({
      writing: '<svg>pencil</svg>', keyboard: '<svg>keyboard</svg>',
    });
    expect(buildIconRegistry(Object.fromEntries([tracked, stale])).writing).toBe('<svg>pencil</svg>');
  });

  it('the real registry draws the tracked pencil for writing', () => {
    const pencil = readFileSync(new URL('./svg/writing.svg', import.meta.url), 'utf8');
    expect(ICONS.writing).toBe(pencil);
  });
});
