/** Advance an ordered scale, restarting cleanly when a wrong note is played. */
export function advanceScaleProgress(expectedMidi, progress, playedNote) {
  if (!Array.isArray(expectedMidi) || expectedMidi.length === 0) {
    return { progress: 0, wrong: true, complete: false };
  }
  if (playedNote === expectedMidi[progress]) {
    const next = progress + 1;
    return { progress: next, wrong: false, complete: next === expectedMidi.length };
  }
  const restarted = playedNote === expectedMidi[0] ? 1 : 0;
  return { progress: restarted, wrong: true, complete: false };
}
