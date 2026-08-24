import { matchHeldSet } from '../performance/heldSet.js';

/** Neutral held-key recognition for theory questions and game commands. */
export function recognizeHeldSet(activeNotes, expectation = {}, policy = {}) {
  if (!expectation) return 'idle';
  if (policy.equivalence === 'pitch-class' || expectation.pitchClasses) {
    return matchHeldSet(activeNotes, {
      root: expectation.root,
      pitchClasses: expectation.pitchClasses instanceof Set ? expectation.pitchClasses : new Set(expectation.pitchClasses || []),
    }, { bassMustBeRoot: policy.bassMustBeRoot !== false });
  }
  const pitches = expectation.pitches || [];
  if (!activeNotes?.size || !pitches.length) return 'idle';
  const target = new Set(pitches);
  let matched = 0;
  let extras = 0;
  for (const [note] of activeNotes) target.has(note) ? matched += 1 : extras += 1;
  if (matched === target.size && (policy.allowExtras || extras === 0)) return 'correct';
  if (extras > 0) return 'wrong';
  return matched > 0 ? 'partial' : 'idle';
}

export function recognizeOrderedPress(expectedMidi = [], progress = 0, pitch, { restartOnWrong = false } = {}) {
  if (!expectedMidi.length) return { progress: 0, wrong: true, complete: false };
  if (pitch === expectedMidi[progress]) {
    const next = progress + 1;
    return { progress: next, wrong: false, complete: next === expectedMidi.length };
  }
  const next = restartOnWrong && pitch === expectedMidi[0] ? 1 : (restartOnWrong ? 0 : progress);
  return { progress: next, wrong: true, complete: false };
}

export function recognizeCursorPress(expectedInput, struckInput, pitch, { plausibilityWindow = 24 } = {}) {
  const expected = expectedInput instanceof Set ? expectedInput : new Set(expectedInput || []);
  const struck = new Set(struckInput || []);
  if (expected.has(pitch)) {
    struck.add(pitch);
    const complete = [...expected].every((note) => struck.has(note));
    return { status: complete ? 'complete' : 'hit', struck, complete };
  }
  const plausible = [...expected].some((note) => Math.abs(pitch - note) <= plausibilityWindow);
  return { status: plausible ? 'wrong' : 'ignored', struck, complete: false };
}
