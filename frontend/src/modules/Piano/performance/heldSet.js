/**
 * matchHeldSet — held-set chord matching with pitch-class equivalence.
 *
 * Wrongness is judged on what is CURRENTLY held (any wrong pitch class → wrong),
 * completion means every target pitch class is simultaneously down, and by
 * default the lowest held note must be the chord root (inversions rejected).
 * This is the service home of the flashcard engine's chord matcher; note-offs
 * matter here and nowhere else in the assessment model.
 *
 * @param {Map<number, any>} activeNotes
 * @param {{root: number, pitchClasses: Set<number>}|null} target
 * @param {{bassMustBeRoot?: boolean}} [options]
 * @returns {'idle'|'correct'|'wrong'|'partial'}
 */
export function matchHeldSet(activeNotes, target, { bassMustBeRoot = true } = {}) {
  if (!activeNotes || activeNotes.size === 0 || !target?.pitchClasses?.size) {
    return 'idle';
  }
  const heldClasses = new Set();
  let bass = Infinity;
  for (const [note] of activeNotes) {
    heldClasses.add(((note % 12) + 12) % 12);
    if (note < bass) bass = note;
  }
  for (const pc of heldClasses) {
    if (!target.pitchClasses.has(pc)) return 'wrong';
  }
  const complete = [...target.pitchClasses].every((pc) => heldClasses.has(pc));
  if (!complete) return 'partial';
  if (!bassMustBeRoot) return 'correct';
  return ((bass % 12) + 12) % 12 === target.root ? 'correct' : 'wrong';
}

export default { matchHeldSet };
