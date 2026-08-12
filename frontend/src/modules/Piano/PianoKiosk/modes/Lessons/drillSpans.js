/**
 * drillSpans — one assessment span per expanded transposition cell (right hand,
 * the hand the drill follows). Concatenated spans equal handMidiSequence's
 * flattened right hand, so the follow cursor and the grader walk the same notes.
 */
export function drillSpans(expanded) {
  const cells = expanded?.hands?.right || [];
  return cells
    .map((cell, i) => ({
      id: i,
      expectedMidi: (cell.notes || [])
        .filter((n) => !n?.rest && n?.midi != null)
        .map((n) => n.midi),
    }))
    .filter((span) => span.expectedMidi.length > 0);
}

export default { drillSpans };
