/**
 * pianoAudioPaths — pure path math for the piano MIDI→MP3 mirror.
 * Layer: DOMAIN (2_domains/pianoaudio). No I/O.
 * @module domains/pianoaudio/pianoAudioPaths
 */

/**
 * Mirror a MIDI relative path to its MP3 relative path: swap a trailing `.mid`
 * (case-insensitive) for `.mp3`, preserving all leading subdirectories.
 * @param {string} rel - relative path ending in `.mid`
 * @returns {string} the same path with a `.mp3` extension
 * @throws {Error} if `rel` is not a string ending in `.mid`
 */
export function mp3RelForMidiRel(rel) {
  if (typeof rel !== 'string' || !/\.mid$/i.test(rel)) {
    throw new Error(`mp3RelForMidiRel: not a .mid path: ${rel}`);
  }
  return rel.replace(/\.mid$/i, '.mp3');
}

export default { mp3RelForMidiRel };
