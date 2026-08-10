import { describe, it, expect } from 'vitest';
import { buildCompatibleSet, rankCompatible } from './libraryRanking.js';

const TRIAD = Array.from({ length: 16 }, () => [0, 4, 7]);
const ROOTS = Array.from({ length: 16 }, (_, index) => [index % 7]);

function catalog(size = 3231) {
  return Array.from({ length: size }, (_, index) => {
    if (index < 8) return { path: `percussion/${index}.musicxml`, slug: `groove-${index}`, type: 'groove', feel: 'rock' };
    const line = index % 2 === 0;
    return {
      path: `${line ? 'melodies' : 'chords'}/${index}.musicxml`,
      slug: `entry-${index}`,
      type: line ? 'melody' : 'chord-progression',
      timeline: line ? ROOTS : TRIAD,
      timelineRoot: 0,
      specificity: line ? 'root' : 'triad',
      genre: ['pop'], emotion: [], tags: [], quality: 'best',
    };
  });
}

describe('catalog-scale ranking performance', () => {
  it('guardrails and ranks the audited 3,231-entry scale within the kiosk budget', () => {
    const entries = catalog();
    const base = { ...entries[9], path: 'chords/base.musicxml' };
    const started = performance.now();
    const compatible = buildCompatibleSet({ entries, baseEntry: base });
    const ranked = rankCompatible(compatible, base);
    const elapsed = performance.now() - started;
    expect(ranked.length).toBeGreaterThan(1000);
    expect(elapsed).toBeLessThan(500);
  });
});
