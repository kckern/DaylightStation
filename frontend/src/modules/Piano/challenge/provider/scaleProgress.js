import { advanceOrderedCursor } from '../../performance/assessmentSession.js';

/** Advance an ordered scale, restarting cleanly when a wrong note is played. */
export function advanceScaleProgress(expectedMidi, progress, playedNote) {
  return advanceOrderedCursor(expectedMidi, progress, playedNote, { restartOnWrong: true });
}
