/** Neutral held-key recognition for theory questions and game commands. */
export function recognizeHeldSet(activeNotes, expectation = {}, policy = {}) {
  if (!expectation) return 'idle';
  if (policy.equivalence === 'pitch-class' || expectation.pitchClasses) {
    if (!activeNotes?.size) return 'idle';
    const target = expectation.pitchClasses instanceof Set ? expectation.pitchClasses : new Set(expectation.pitchClasses || []);
    if (!target.size) return 'idle';
    const heldClasses = new Set();
    let bass = Infinity;
    for (const [note] of activeNotes) {
      heldClasses.add(((note % 12) + 12) % 12);
      if (note < bass) bass = note;
    }
    if ([...heldClasses].some((pitchClass) => !target.has(pitchClass))) return 'wrong';
    if (![...target].every((pitchClass) => heldClasses.has(pitchClass))) return 'partial';
    if (policy.bassMustBeRoot === false) return 'correct';
    return ((bass % 12) + 12) % 12 === expectation.root ? 'correct' : 'wrong';
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
