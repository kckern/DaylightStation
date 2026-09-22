/**
 * The formats a learner's recording can be stored in, in the order a reader
 * tries them. ONE LIST for the writer and the reader: a take written in a
 * format the reader never tries is never served, and the writer deletes a
 * sentence's recording in every OTHER listed format when it writes a new one
 * — so a format missing here, or present only on one side, loses a recording.
 *
 * WebM is a take said in one go (MediaRecorder); WAV is a take joined from
 * pieces on the tablet.
 */
export const RECORDING_FORMATS = Object.freeze(['webm', 'mp3', 'ogg', 'm4a', 'wav']);

/** Is `ext` (any case) a format a recording may be stored in? */
export function isRecordingFormat(ext) {
  return RECORDING_FORMATS.includes(String(ext ?? '').toLowerCase());
}
