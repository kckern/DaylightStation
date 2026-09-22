/**
 * The floor a spoken take has to clear, shared by every School program that
 * asks a child to say something (Sentence Ladder recording rung, word ladder
 * study card). One copy, so the two cannot drift.
 */

/** Below this shaped level for SILENT_AFTER_MS, the mic is called silent. */
export const SILENT_LEVEL = 0.04;
export const SILENT_AFTER_MS = 2000;
/**
 * The floor a take has to clear to be KEPT at all: long enough to be a
 * sentence, and loud enough to have been one.
 *
 * A rung that accepts anything is a rung that can be tapped through, and the
 * evidence that this was happening is in the log for 2026-09-11: six takes, the
 * last two at ~1s each with `heard: false`, one of them accepted 1 second after
 * it stopped. Recording was being spent rather than done.
 *
 * `heard` is the strong signal and does most of the work — it means the live
 * level never once crossed SILENT_LEVEL, and a real utterance always crosses
 * it. The duration floor catches the other shape: a tap, a cough, a single loud
 * syllable that clears the level but is not an attempt at the sentence.
 *
 * 1200ms IS NOT A GUESS. The six takes from that session were pulled off disk
 * and measured, and they separate cleanly:
 *
 *   take  length   peak      whisper no_speech   text
 *   1-4   1.74s     -0.0dB   0.035-0.093         real Korean sentences
 *          -2.58s   -4.5dB                       (incl. the 이 가방은/가방들은 pair)
 *   5     1.14s    -63.5dB   0.941               silence
 *   6     0.66s    -52.6dB   0.963               silence
 *
 * A -63dB peak is under a quiet room's noise floor; the spectrograms of 5 and 6
 * are black, with no harmonics or formants anywhere. Whisper returned the same
 * byte-identical Korean broadcast sign-off for both, which is its documented
 * hallucination on silence — two different files producing one phrase is the
 * tell. Spoken takes ran 1.74-2.58s and tapped-through ones 0.66-1.14s, so the
 * floor sits in the gap with room on either side.
 */
export const MIN_TAKE_MS = 1200;

/**
 * The finished take's verdict. WE ONLY REFUSE ON WHAT WE COULD MEASURE:
 * `heard` comes from a live level meter that needs an AudioContext, so
 * loudness is judged only when a level actually arrived (`sampled`); length
 * is judged always.
 */
export function judgeTake({ heard, sampled, durationMs }) {
  if (sampled === true && !heard) return 'too-quiet';
  if (durationMs < MIN_TAKE_MS) return 'too-short';
  return null;
}
