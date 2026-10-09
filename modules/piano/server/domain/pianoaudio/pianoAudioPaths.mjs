/**
 * pianoAudioPaths — pure path math for the piano MIDI→artifact mirror.
 * Layer: DOMAIN (2_domains/pianoaudio). No I/O.
 * @module domains/pianoaudio/pianoAudioPaths
 */

/**
 * Mirror a MIDI relative path to a sibling artifact path: swap a trailing `.mid`
 * (case-insensitive) for `.<ext>`, preserving all leading subdirectories.
 * @param {string} rel - relative path ending in `.mid`
 * @param {string} ext - target extension without the dot (e.g. 'mp3', 'png')
 * @returns {string} the same path with a `.<ext>` extension
 * @throws {Error} if `rel` is not a string ending in `.mid`
 */
export function mirrorRelForMidiRel(rel, ext) {
  if (typeof rel !== 'string' || !/\.mid$/i.test(rel)) {
    throw new Error(`mirrorRelForMidiRel: not a .mid path: ${rel}`);
  }
  return rel.replace(/\.mid$/i, `.${ext}`);
}

/** Mirror a MIDI relative path to its `.mp3` sibling. */
export function mp3RelForMidiRel(rel) {
  return mirrorRelForMidiRel(rel, 'mp3');
}

export default { mirrorRelForMidiRel, mp3RelForMidiRel };
