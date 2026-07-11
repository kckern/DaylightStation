// volumeCurve.js
//
// Five discrete volume steps (Off/Low/Med/High/Max), mapped onto the 0-1
// level scale PianoMixContext expects (mediaLevel / pianoLevel). Two curves:
//
//   linear — stepIndex/4, i.e. 0, .25, .5, .75, 1. Straightforward, but a
//            straight line over-indexes at the top: "Med" already sounds
//            uncomfortably loud because human perceived loudness is roughly
//            logarithmic, not linear, in amplitude.
//
//   log    — a perceptual ("audio taper") curve: level = (stepIndex/4)^EXPONENT.
//            This is the standard trick pro-audio faders use to approximate a
//            log taper with a cheap power curve — it keeps the low/mid steps
//            quieter (spreading out the useful low range) while still hitting
//            exactly 0 at Off and exactly 1 at Max. EXPONENT = 2.5 sits between
//            a gentle x^2 and a steep x^3, close to the ~x^e taper many mixing
//            consoles use for volume pots.
//
// Both directions are pure functions of STEPS.length so the round trip
// (stepToLevel -> levelToStep) always lands back on the same index.

export const STEPS = ['Off', 'Low', 'Med', 'High', 'Max'];

const LOG_EXPONENT = 2.5;

const clampIndex = (i) => Math.max(0, Math.min(STEPS.length - 1, Math.round(i)));
const clamp01 = (v) => Math.max(0, Math.min(1, v ?? 0));

/** Map a step index (0..STEPS.length-1) to a 0-1 level, per `curve`. */
export function stepToLevel(stepIndex, curve = 'log') {
  const i = clampIndex(stepIndex);
  const t = i / (STEPS.length - 1);
  if (curve === 'linear') return t;
  return Math.pow(t, LOG_EXPONENT);
}

/** Map a 0-1 level back to the nearest step index, per `curve`. */
export function levelToStep(level, curve = 'log') {
  const v = clamp01(level);
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < STEPS.length; i += 1) {
    const d = Math.abs(stepToLevel(i, curve) - v);
    if (d < bestDist) { bestDist = d; best = i; }
  }
  return best;
}
