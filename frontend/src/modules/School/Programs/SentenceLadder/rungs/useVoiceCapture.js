import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * One microphone take: open the mic, record, hand back a blob, let the mic go.
 *
 * Extracted from `RecordingRung` when a second rung needed the same thing —
 * interpretation can now be answered by speaking, and the transcript is sent
 * for recognition rather than kept as evidence. What the two rungs do with a
 * take could hardly be more different (one plays it back, measures it against
 * a loudness floor and banks it; the other throws the audio away the moment a
 * transcript comes back), but everything up to the blob is identical, and a
 * second copy of it is a second place for a leaked microphone to hide.
 *
 * SO THIS OWNS EXACTLY THE PART THAT IS THE SAME, and no more. It does not
 * know about phases, cues, verdicts, voice bands or transcripts. It does not
 * log: its two callers name the same events differently on purpose (`capture`
 * on the recording rung is evidence being made; on the typing rung it is an
 * input method), and a hook that logged would either force one vocabulary on
 * both or invent a third.
 *
 * THE MIC IS RELEASED AFTER EVERY TAKE, not held for the session. The Portal
 * is a shared kiosk and something else may need it; a held mic also leaves the
 * OS recording indicator on, which on a panel in a child's room is its own
 * kind of wrong.
 */
export default function useVoiceCapture({ onTake, onDenied } = {}) {
  // Rendered state, because the recording rung draws the live stream.
  const [stream, setStream] = useState(null);

  const recorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  /**
   * The callbacks, read at fire time rather than captured.
   *
   * `start` must be stable — the recording rung passes it through a
   * `useSentenceAudio({ onSequenceEnd })`, so an identity that changed on
   * every render would re-arm that sequence mid-play. Reading the handlers off
   * a ref keeps them current without putting them in the dependency list.
   */
  const handlers = useRef({ onTake, onDenied });
  handlers.current = { onTake, onDenied };

  const release = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
    setStream(null);
  }, []);

  /**
   * Open the mic and start recording. Resolves true once the recorder is
   * running, false if it could not be started — `onDenied` has already been
   * called by then, so a caller that only needs the boolean can ignore it.
   */
  const start = useCallback(async () => {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = mic;
      chunksRef.current = [];

      const recorder = new MediaRecorder(mic);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        const durationMs = Date.now() - startedAtRef.current;
        // Let the mic go BEFORE the caller sees the take: whatever it does next
        // may be slow (a model call, a decode, a playback) and none of it is a
        // reason to keep holding the microphone.
        release();
        handlers.current.onTake?.({ blob, durationMs });
      };

      recorder.start();
      startedAtRef.current = Date.now();
      setStream(mic);
      return true;
    } catch (err) {
      // MediaRecorder construction or start can fail AFTER getUserMedia
      // succeeded, so the already-open stream is released on every failure
      // path rather than only on a denied permission.
      release();
      handlers.current.onDenied?.(err);
      return false;
    }
  }, [release]);

  const stop = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  /** Is the recorder running right now? A function, not state: callers that
   *  need to render on it already track their own phase. */
  const isRecording = useCallback(
    () => recorderRef.current?.state === 'recording',
    [],
  );

  // A rung unmounted mid-take must not leave the mic open behind it.
  useEffect(() => () => release(), [release]);

  return { start, stop, release, isRecording, stream };
}
