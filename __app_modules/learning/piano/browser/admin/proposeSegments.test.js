import { describe, it, expect } from 'vitest';
import { buildMeasures } from '../../../../../__capabilities/music-notation/browser/renderers/osmdRender.js';
import { cutsKey, firstTimeSig, proposeSegments, proposalTargetLen, quartersPerMeasure } from './proposeSegments.js';
import { fillParts } from './scorePlan.js';

const rh = (midi) => ({ midi, staff: 0 });
const lh = (midi) => ({ midi, staff: 1 });

/**
 * A Jingle-Bells-shaped 16 bars in 4/4: four 4-bar phrases of steady melody quarters
 * over an oom-pah left hand (C on beat 1, G on beat 3, so the bass rises G→C into
 * every bar), each phrase closing on a whole note. One step per onset, the kiosk's shape.
 */
function jingleSteps() {
  const tune = [64, 64, 64, 64, 64, 64, 64, 67, 60, 62, 64, 64, 65, 65, 65, 65];
  const steps = [];
  for (let m = 0; m < 16; m += 1) {
    const at = (beat, notes) => steps.push({ onsetQuarter: m * 4 + beat, measure: m, number: m + 1, notes });
    if (m % 4 === 3) {
      at(0, [rh(tune[m]), lh(48)]);
      at(2, [lh(43)]);
    } else {
      at(0, [rh(tune[m]), lh(48)]);
      at(1, [rh(tune[m] + 2)]);
      at(2, [rh(tune[m]), lh(43)]);
      at(3, [rh(tune[m] - 1)]);
    }
  }
  return steps;
}

describe('proposeSegments', () => {
  it('cuts a Jingle-Bells-shaped tune at its phrase ends (bars 4, 8, 12)', () => {
    const steps = jingleSteps();
    const score = { measures: buildMeasures(steps), steps, sections: [], beatsPerMeasure: 4 };
    const { segments, proposal } = proposeSegments(score, { targetLen: 4, now: () => 'T' });
    expect(segments).toEqual([
      { id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 7 },
      { id: 'c', start: 8, end: 11 }, { id: 'd', start: 12, end: 15 },
    ]);
    expect(proposal).toMatchObject({ scorer: 'heuristic', model: null, at: 'T', beatsPerMeasure: 4 });
    expect(Object.keys(proposal.boundaries)).toHaveLength(15);
    // The bass rises G→C into every bar, so it earns nothing; the held notes decide.
    for (const k of [3, 7, 11]) expect(proposal.boundaries[k]).toBeGreaterThan(0.7);
    for (const k of [0, 1, 4, 8, 12]) expect(proposal.boundaries[k]).toBeLessThan(0.45);
    expect(proposal.features).toHaveLength(15);
    expect(proposal.features[0]).toHaveLength(proposal.featureKeys.length);
    expect(proposal.features.flat().every((v) => v === null || typeof v === 'number')).toBe(true);
    // The kiosk can play every proposed segment, so the draft can be saved.
    expect(fillParts(segments, { ...score, tempoMap: [], tempo: 96 }).segments).toHaveLength(4);
  });

  it('a rehearsal mark is always a cut', () => {
    const steps = jingleSteps();
    const score = { measures: buildMeasures(steps), steps, sections: [{ label: 'B', startMeasure: 7, endMeasure: 16 }], beatsPerMeasure: 4 };
    const { segments, proposal } = proposeSegments(score);
    expect(proposal.boundaries[5]).toBe(1);
    expect(segments.some((s) => s.end === 5 && segments.some((t) => t.start === 6))).toBe(true);
  });

  it('reads targetLen from household passages, else 4', () => {
    expect(proposalTargetLen({ sheetmusic: { learn: { passages: { targetMeasures: 6 } } } })).toBe(6);
    expect(proposalTargetLen({})).toBe(4);
    expect(proposalTargetLen(null)).toBe(4);
  });

  it('measures time signatures in quarter notes', () => {
    expect(quartersPerMeasure({ beats: 6, beatType: 8 })).toBe(3);
    expect(quartersPerMeasure({ beats: 3, beatType: 4 })).toBe(3);
    expect(quartersPerMeasure(undefined)).toBe(4);
  });

  it('reads the opening time signature, not the last one', () => {
    const parsed = {
      timeSig: { beats: 3, beatType: 4 },
      parts: [{ measures: [{ attributes: { time: { beats: 4, beatType: 4 } } }, {}, { attributes: { time: { beats: 3, beatType: 4 } } }] }],
    };
    expect(firstTimeSig(parsed)).toEqual({ beats: 4, beatType: 4 });
    expect(firstTimeSig({ timeSig: { beats: 6, beatType: 8 } })).toEqual({ beats: 6, beatType: 8 });
  });

  it('compares cuts without ids or names', () => {
    expect(cutsKey([{ id: 'a', start: 4, end: 7, name: 'B' }, { id: 'z', start: 0, end: 3 }]))
      .toBe(cutsKey([{ id: 'a', start: 0, end: 3 }, { id: 'b', start: 4, end: 7 }]));
  });
});
