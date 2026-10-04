import { describe, expect, it } from 'vitest';
import { SHEET_MUSIC_DEFAULTS } from './sheetMusicConfig.js';
import { resolveLearnPlan } from './resolveLearnPlan.js';

const score = (count = 8, extra = {}) => {
  const measures = Array.from({ length: count }, (_, index) => ({
    index,
    number: index === 0 ? 'P' : String(index + 1),
    firstStep: index,
    lastStep: index,
  }));
  const steps = measures.map(({ index }) => ({ notes: [
    { midi: 60 + index, staff: 0 }, { midi: 48 + index, staff: 1 },
  ] }));
  return { id: 'piece', measures, steps, sections: [], tempoMap: [{ onsetQuarter: 0, bpm: 100 }, { onsetQuarter: 8, bpm: 120 }], ...extra };
};

const resolve = (over = {}) => resolveLearnPlan({ defaults: SHEET_MUSIC_DEFAULTS.learn, score: score(), ...over });

describe('resolveLearnPlan', () => {
  it('deep-merges layers in defaults → category → piece → user → user-piece order', () => {
    const plan = resolve({
      category: { passages: { targetMeasures: 3 }, navigation: { sequential: true }, tempo: { fallbackBpm: 70 } },
      piece: { passages: { maxMeasures: 6 }, navigation: { sequential: false } },
      user: { passages: { minMeasures: 2 }, tempo: { fallbackBpm: 75 } },
      userPiece: { passages: { targetMeasures: 5 }, tempo: { fallbackBpm: 80 } },
    });
    expect(plan.navigation.sequential).toBe(false);
    expect(plan.settings.passages).toEqual({ targetMeasures: 5, minMeasures: 2, maxMeasures: 6 });
    expect(plan.settings.tempo.fallbackBpm).toBe(80);
  });

  it('defaults segment navigation to open and labels generated segments by number before bars', () => {
    const plan = resolve();
    expect(plan.navigation).toEqual({ sequential: false });
    expect(plan.segments[0]).toMatchObject({ id: 'm0-3', number: 1, label: 'Segment 1', barLabel: 'Bars P–4' });
    expect(plan.segments[1]).toMatchObject({ number: 2, label: 'Segment 2', barLabel: 'Bars 5–8' });
  });

  it('prefers valid authored boundaries and preserves stable ids through a name change', () => {
    const piece = { segments: [
      { id: 'opening', start: 0, end: 2, name: 'Opening' },
      { id: 'answer', start: 3, end: 7, name: 'Answer' },
    ] };
    const first = resolve({ piece });
    const renamed = resolve({ piece: { segments: [{ ...piece.segments[0], name: 'First idea' }, piece.segments[1]] } });
    expect(first.segments.map(({ id, label, name, barLabel }) => ({ id, label, name, barLabel }))).toEqual([
      { id: 'opening', label: 'Segment 1', name: 'Opening', barLabel: 'Bars P–3' },
      { id: 'answer', label: 'Segment 2', name: 'Answer', barLabel: 'Bars 4–8' },
    ]);
    expect(renamed.revision).toBe(first.revision);
  });

  it('falls back atomically to generated segments when authored enrichment is invalid', () => {
    const plan = resolve({ piece: { segments: [{ id: 'bad', start: 4, end: 99 }] } });
    expect(plan.configFallback).toBe(true);
    expect(plan.segments.map((segment) => segment.id)).toEqual(['m0-3', 'm4-7']);
  });

  it('omits hand-specific rungs for a single-staff score but retains together/mastery work', () => {
    const oneStaff = score(4);
    oneStaff.steps = oneStaff.steps.map((step) => ({ notes: step.notes.filter((note) => note.staff === 0) }));
    const plan = resolveLearnPlan({ defaults: SHEET_MUSIC_DEFAULTS.learn, score: oneStaff });
    expect(plan.segments[0].ladder.map((rung) => rung.id)).not.toContain('right');
    expect(plan.segments[0].ladder.map((rung) => rung.id)).not.toContain('left');
    expect(plan.segments[0].ladder.map((rung) => rung.id)).toContain('mastery');
  });

  it('uses the complete MusicXML tempo map and forces mastery and Test Out to 100%', () => {
    const plan = resolve({
      piece: {
        ladder: [
          { id: 'slow', label: 'Slow', parts: ['rh', 'lh'], scope: 'all-parts', mode: 'cued', sets: 1, reps: 2, tempoPercent: 60 },
          { id: 'mastery', label: 'Mastery', parts: ['rh', 'lh'], scope: 'all-parts', mode: 'cued', sets: 1, reps: 1, tempoPercent: 75, mastery: true },
        ],
        testOut: { tempoPercent: 40, reps: 2 },
      },
    });
    expect(plan.tempoMap).toEqual([{ onsetQuarter: 0, bpm: 100 }, { onsetQuarter: 8, bpm: 120 }]);
    expect(plan.tempoSource).toBe('musicxml');
    expect(plan.ladder.map(({ id, tempoPercent }) => [id, tempoPercent])).toEqual([['slow', 60], ['mastery', 100]]);
    expect(plan.testOut).toMatchObject({ tempoPercent: 100, reps: 2, mastery: true });
  });

  it('uses and identifies a configurable inferred tempo only when MusicXML has none', () => {
    const noTempo = score(4, { tempoMap: [], tempo: null });
    const plan = resolveLearnPlan({ defaults: SHEET_MUSIC_DEFAULTS.learn, category: { tempo: { fallbackBpm: 72 } }, score: noTempo });
    expect(plan.tempoMap).toEqual([{ onsetQuarter: 0, bpm: 72 }]);
    expect(plan.tempoSource).toBe('inferred');
  });

  it('changes revision for boundaries or ladder meaning, not names or prototype keys', () => {
    const base = resolve({ piece: { segments: [{ id: 'a', start: 0, end: 7, name: 'A' }] } });
    const renamed = resolve({ piece: { segments: [{ id: 'a', start: 0, end: 7, name: 'Renamed', __proto__: { sequential: true } }] } });
    const moved = resolve({ piece: { segments: [{ id: 'a', start: 0, end: 6, name: 'A' }] } });
    const changedRung = resolve({ piece: { segments: [{ id: 'a', start: 0, end: 7 }], ladder: [{ id: 'x', label: 'X', parts: ['rh', 'lh'], scope: 'all-parts', mode: 'free', sets: 1, reps: 1 }] } });
    expect(renamed.revision).toBe(base.revision);
    expect(renamed.segments[0].fingerprint).toBe(base.segments[0].fingerprint);
    expect(moved.revision).not.toBe(base.revision);
    expect(moved.segments[0].fingerprint).not.toBe(base.segments[0].fingerprint);
    expect(changedRung.revision).not.toBe(base.revision);
    expect(changedRung.segments[0].fingerprint).not.toBe(base.segments[0].fingerprint);
    expect({}.sequential).toBeUndefined();
  });
});
