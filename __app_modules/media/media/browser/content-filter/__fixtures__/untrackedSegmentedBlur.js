/**
 * One untracked Blur on a long two-segment shown part, as the live film served it on 2026-11-23
 * (rating key 775444, cue va3283906): the refined EDL cue (VidAngel clock, frame precision, two
 * segments 3 s apart, no region track), its override (effect blur, refined on part 841878) and the
 * copy's sync. Only ids and timings; nothing else from the film.
 */
export const PART = '841878';

export const edl = {
  timebase: { clock: 'vidangel' },
  cues: [{
    id: 'va3283906', type: 'skip', category: 'sex_any/sexually_suggestive', group: 'sex_any',
    in: 3801.598, out: 3840.145, source: 'vidangel', precision: 'frame',
    segments: [{ in: 3801.598, out: 3808.357 }, { in: 3811.402, out: 3840.145 }],
    refine: { v: 1, at: '2026-11-23', kind: 'visual' },
  }],
};

export const override = {
  cueOverrides: {
    va3283906: {
      effect: 'blur', in: 3801.631, out: 3840.17, precision: 'frame', frameIn: 91148, frameOut: 92071,
      segments: [{ in: 3801.631, out: 3808.388 }, { in: 3811.433, out: 3840.17 }],
      refine: { v: 1, part: PART, at: '2026-11-23', kind: 'visual' },
    },
  },
  sync: { offsetSec: 0.854, scale: 0.999784, method: 'transcript', part: PART, frames: { fps: '24000/1001', startTime: 0 } },
};

/** The household profile: this category skips; the effect comes from the override. */
export const profile = (maxSec = 5) => ({
  categories: { sex_any: { effect: 'skip' } },
  treatments: { 'full-blur': { maxSec }, blackout: { text: 'Picture hidden.' } },
});

/** The unsaved draft the review held at 18:46:32: the part's out moved to the playhead (refused: > 30 s). */
export const DRAFT = { va3283906: [3801.48, 3805.39] };
