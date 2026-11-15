/** Shared ordering guarantee: a failed transcriber never discards saved audio. */
export async function captureProgramTake({ learnerId, studyDay, buffer, mimeType = 'audio/webm', saveAudio, savedAudioRef = null, onSaved, transcribe, prompt, logger = {} }) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 1000) throw new Error('Recording too short');
  const audioRef = savedAudioRef ?? await saveAudio({ learnerId, studyDay, buffer, mimeType });
  await onSaved?.({audioRef});
  let text = null;
  try { text = transcribe ? String(await transcribe(buffer, { prompt }) ?? '').trim() || null : null; }
  catch (error) { logger.warn?.('school.take.transcribe-failed', { learnerId, error: error.message }); }
  return { audioRef, text };
}
