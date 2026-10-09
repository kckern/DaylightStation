import { describe, it, expect } from 'vitest';
import { STRUCTURE_TEMPLATES } from './structureTemplates.js';
import { draftReducer, applyTemplate, toSchedulerInputs } from './draftReducer.js';
import { compileArrangement } from '@shared-music/arrangementScheduler.mjs';

describe('STRUCTURE_TEMPLATES catalog', () => {
  it('ships the five templates with unique ids', () => {
    expect(STRUCTURE_TEMPLATES.map((t) => t.id)).toEqual([
      'pop', 'verse-chorus', 'aaba', 'twelve-bar', 'loop-jam',
    ]);
  });

  it('every template is structurally valid: named sections, positive integer bars, in-range arrangement refs, repeats ≥ 1', () => {
    for (const t of STRUCTURE_TEMPLATES) {
      expect(typeof t.name).toBe('string');
      expect(t.sections.length).toBeGreaterThan(0);
      expect(t.arrangement.length).toBeGreaterThan(0);
      for (const s of t.sections) {
        expect(s.name.trim().length).toBeGreaterThan(0);
        expect(Number.isInteger(s.lengthBars) && s.lengthBars >= 1).toBe(true);
      }
      for (const e of t.arrangement) {
        expect(e.section >= 0 && e.section < t.sections.length).toBe(true);
        expect(Number.isInteger(e.repeats) && e.repeats >= 1).toBe(true);
      }
    }
  });

  it('pop is the documented Intro / Verse×2 / Chorus×2 / Verse / Chorus / Outro form', () => {
    const pop = STRUCTURE_TEMPLATES.find((t) => t.id === 'pop');
    expect(pop.sections.map((s) => `${s.name}:${s.lengthBars}`)).toEqual([
      'Intro:4', 'Verse:8', 'Chorus:8', 'Outro:4',
    ]);
    expect(pop.arrangement.map((e) => `${pop.sections[e.section].name}×${e.repeats}`)).toEqual([
      'Intro×1', 'Verse×2', 'Chorus×2', 'Verse×1', 'Chorus×1', 'Outro×1',
    ]);
  });

  it('AABA reads as four explicit slots (A A B A); 12-bar and loop-jam are single-section', () => {
    const aaba = STRUCTURE_TEMPLATES.find((t) => t.id === 'aaba');
    expect(aaba.arrangement.map((e) => aaba.sections[e.section].name)).toEqual(['A', 'A', 'B', 'A']);
    const twelve = STRUCTURE_TEMPLATES.find((t) => t.id === 'twelve-bar');
    expect(twelve.sections).toEqual([{ name: 'A', lengthBars: 12 }]);
    expect(twelve.arrangement).toEqual([{ section: 0, repeats: 3 }]);
    const jam = STRUCTURE_TEMPLATES.find((t) => t.id === 'loop-jam');
    expect(jam.sections[0].lengthBars).toBe(4);
    expect(jam.arrangement).toEqual([{ section: 0, repeats: 4 }]);
  });

  it('every template applies cleanly and compiles: one block per repeat, zero-length while slots are empty', () => {
    for (const t of STRUCTURE_TEMPLATES) {
      const draft = draftReducer(null, applyTemplate(t, { keyShift: 0, bpm: 100 }));
      expect(draft.sections).toHaveLength(t.sections.length);
      const { sections, arrangement } = toSchedulerInputs(draft, {});
      const { blocks, totalMs } = compileArrangement(sections, arrangement, { bpm: 100 });
      const expectedBlocks = t.arrangement.reduce((sum, e) => sum + e.repeats, 0);
      expect(blocks).toHaveLength(expectedBlocks);
      // Empty sections occupy no TIME until filled (zero-length blocks the
      // transport's guarded walk skips) — an all-empty template can't play.
      expect(totalMs).toBe(0);
    }
  });
});
