import { recognizeOrderedPress } from '../../input/recognition.js';

/** Advance an ordered scale, restarting cleanly when a wrong note is played. */
export function advanceScaleProgress(expectedMidi, progress, playedNote) {
  return recognizeOrderedPress(expectedMidi, progress, playedNote, { restartOnWrong: true });
}
