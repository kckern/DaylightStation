import { describe, it, expect } from 'vitest';
import { buildManifest } from './curate-nutrition-icons.mjs';

describe('buildManifest — the hi-res set is exclusive', () => {
  const run = () => buildManifest({
    hiResFiles: ['bakery/pita-bread.png'],
    flatFiles: ['pita_bread.png', 'pitasandwich.png'],
    hiResPrefix: 'img/nutrition/icons',
    flatPrefix: 'img/icons/food',
  });

  it('aliases a flat name to its hi-res counterpart', () => {
    expect(run().aliases.pita_bread.path).toBe('img/nutrition/icons/bakery/pita-bread.png');
  });

  it('never aliases a flat name to the flat file; it is retired and reported', () => {
    const { aliases, report } = run();
    expect(aliases.pitasandwich).toBeUndefined();
    expect(report.aliasReport.retired).toBe(1);
    expect(report.retired).toEqual(['pitasandwich']);
  });

  it('no manifest path points at the flat set', () => {
    const { icons, aliases } = run();
    const paths = [...Object.values(icons), ...Object.values(aliases)].map(e => e.path);
    expect(paths.some(p => p.startsWith('img/icons/food/'))).toBe(false);
  });
});
