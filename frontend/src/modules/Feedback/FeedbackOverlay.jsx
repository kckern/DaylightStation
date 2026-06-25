import { useCallback, useEffect, useRef, useState } from 'react';
import { useMediaRecorderCapture } from '../VoiceCapture/useMediaRecorderCapture.js';
import { VoiceCaptureOverlay } from '../VoiceCapture/VoiceCaptureOverlay.jsx';
import { submitFeedback, pollFeedbackTranscript, deleteFeedback } from './feedbackApi.js';
import getLogger from '../../lib/logging/Logger.js';

const log = () => getLogger().child({ component: 'feedback-overlay' });

/**
 * Modal feedback capture: record → submit → poll transcript → review (Keep/Redo).
 * No audio playback. Host injects `app`, optional `context`, and optional
 * onPauseMusic/onResumeMusic (fired on record-start / close). Built on the
 * neutral VoiceCapture core.
 *
 * @param {boolean} open
 * @param {string}  app
 * @param {object}  [context]
 * @param {string}  [prompt]
 * @param {() => void} onClose
 * @param {() => void} [onPauseMusic]
 * @param {() => void} [onResumeMusic]
 */
export default function FeedbackOverlay({
  open, app, context = {}, prompt = 'Found a bug or rough edge? Record a quick note.',
  onClose, onPauseMusic, onResumeMusic,
}) {
  const { isRecording, durationMs, levelRef, error: recError, start, stop } = useMediaRecorderCapture();
  // 'idle' | 'recording' | 'submitting' | 'transcribing' | 'review' | 'error'
  const [machine, setMachine] = useState('idle');
  const [item, setItem] = useState(null); // { id, transcript, transcriptStatus }
  const [saveError, setSaveError] = useState(null);
  const musicPausedRef = useRef(false);

  const pauseMusic = useCallback(() => {
    if (!musicPausedRef.current) { musicPausedRef.current = true; onPauseMusic?.(); }
  }, [onPauseMusic]);
  const resumeMusic = useCallback(() => {
    if (musicPausedRef.current) { musicPausedRef.current = false; onResumeMusic?.(); }
  }, [onResumeMusic]);

  // Resume music if the overlay unmounts mid-recording.
  useEffect(() => () => { resumeMusic(); }, [resumeMusic]);

  const runSubmit = useCallback(async (blob, dur) => {
    setMachine('submitting');
    setSaveError(null);
    try {
      const created = await submitFeedback({ app, blob, durationMs: dur, context });
      setItem(created);
      setMachine('transcribing');
      const finished = await pollFeedbackTranscript({ app, id: created.id });
      setItem(finished);
      setMachine('review');
      log().info('feedback.transcript-ready', { id: created.id, status: finished.transcriptStatus });
    } catch (err) {
      setSaveError(err.message || 'Save failed');
      setMachine('error');
      log().error('feedback.submit-failed', { error: err.message });
    }
  }, [app, context]);

  const onRecordToggle = useCallback(async () => {
    if (isRecording) {
      const take = await stop();
      if (take?.blob?.size) { runSubmit(take.blob, take.durationMs); }
      else { setMachine('idle'); }
    } else {
      setSaveError(null);
      pauseMusic();
      setMachine('recording');
      await start();
    }
  }, [isRecording, start, stop, runSubmit, pauseMusic]);

  const handleClose = useCallback(() => {
    if (isRecording) { stop().catch(() => {}); }
    resumeMusic();
    setMachine('idle');
    setItem(null);
    onClose?.();
  }, [isRecording, stop, resumeMusic, onClose]);

  const onKeep = useCallback(() => { handleClose(); }, [handleClose]);

  const onRedo = useCallback(async () => {
    if (item?.id) { deleteFeedback({ app, id: item.id }).catch((err) => log().warn('feedback.redo-delete-failed', { error: err.message })); }
    setItem(null);
    setSaveError(null);
    setMachine('recording');
    await start();
  }, [item, app, start]);

  // Map the machine to the presentational phase.
  const phase = machine === 'submitting' || machine === 'transcribing' ? 'processing'
    : machine === 'review' || machine === 'error' ? 'review'
    : isRecording ? 'recording' : 'idle';

  return (
    <VoiceCaptureOverlay
      open={open}
      title="Feedback"
      prompt={prompt}
      phase={phase}
      durationMs={durationMs}
      levelRef={levelRef}
      transcript={item?.transcript || ''}
      transcriptStatus={item?.transcriptStatus || null}
      error={saveError || recError || null}
      onRecordToggle={onRecordToggle}
      onKeep={onKeep}
      onRedo={onRedo}
      onClose={handleClose}
    />
  );
}
