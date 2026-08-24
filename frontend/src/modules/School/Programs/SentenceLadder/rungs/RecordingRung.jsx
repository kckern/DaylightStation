import { useCallback, useEffect, useRef, useState } from 'react';
import { useSentenceAudio, clipsFor } from '../useSentenceAudio.js';
import { languageLog } from '../languageLog.js';

/**
 * Recording — say it yourself (design §1).
 *
 * Hear the target, then record. The result is never scored: the 2016 app
 * didn't score it either, and a recording is evidence for the learner's own
 * review, not a graded artifact. Speech scoring is a named deferral (§7).
 *
 * The learner reviews their take before accepting, so a cough or a false start
 * doesn't become the permanent record. Re-record replaces it.
 *
 * This rung only exists when a microphone was detected. It is never rendered
 * as a dead control — the queue simply omits it on a device without one.
 */
export default function RecordingRung({ entry, audioUrl, onComplete, saving, onDisableMicrophone }) {
  const [phase, setPhase] = useState('idle'); // idle | prompting | recording | review
  const [error, setError] = useState(null);
  const [takeUrl, setTakeUrl] = useState(null);

  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const blobRef = useRef(null);

  const beginCapture = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];

      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        blobRef.current = blob;
        setTakeUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return URL.createObjectURL(blob);
        });
        setPhase('review');
        // Release the mic between takes rather than holding it for the whole
        // session — on a shared kiosk another app may need it.
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        languageLog.capture('stop', { seq: entry.seq, bytes: blob.size });
      };

      recorder.start();
      setPhase('recording');
      languageLog.capture('start', { seq: entry.seq });
    } catch (err) {
      languageLog.captureError('denied', { seq: entry.seq, error: err?.message });
      // The old copy told the learner to "skip this one" — and no skip existed
      // anywhere in this component, so a denied mic stranded the recording
      // badge forever pointing at a control that was never built. The real
      // escape hatch is the ladder's own: drop the rung from this device and
      // sentences graduate across the gap.
      setError('The microphone is unavailable on this device.');
      setPhase('idle');
    }
  }, [entry.seq]);

  // The prompt plays first, then recording begins automatically — the learner
  // shouldn't have to hunt for a second button between hearing and speaking.
  const { playSequence, stop, blocked } = useSentenceAudio({ onSequenceEnd: beginCapture });

  useEffect(() => {
    setPhase('idle');
    setError(null);
    blobRef.current = null;
    languageLog.rung('enter', { rung: 'recording', seq: entry.seq });
    return () => {
      stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      setTakeUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    };
  }, [entry.seq, stop]);

  const start = useCallback(() => {
    setPhase('prompting');
    playSequence(clipsFor(entry, audioUrl));
  }, [entry, audioUrl, playSequence]);

  const stopRecording = useCallback(() => {
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop();
  }, []);

  const accept = useCallback(() => {
    if (!blobRef.current || saving) return;
    languageLog.rung('complete', { rung: 'recording', seq: entry.seq });
    onComplete({ seq: entry.seq, rung: 'recording', blob: blobRef.current });
  }, [entry.seq, onComplete, saving]);

  const targetLang = entry.prompt?.[0]?.language;

  return (
    <div className="lang-rung lang-rung--recording">
      <p className="lang-rung__target">{entry.text?.[targetLang]}</p>

      {blocked && (
        <p className="lang-rung__notice" role="alert">Audio was blocked — tap Play again.</p>
      )}
      {error && (
        <div className="lang-rung__notice" role="alert">
          <p>{error}</p>
          {onDisableMicrophone && (
            <button type="button" className="lang-btn" onClick={onDisableMicrophone}>
              Skip recording on this device
            </button>
          )}
        </div>
      )}

      <div className="lang-rung__controls">
        {phase === 'idle' && (
          <button type="button" className="lang-btn lang-btn--primary" onClick={start}>
            Listen, then record
          </button>
        )}
        {phase === 'prompting' && <span className="lang-rung__status">Listen…</span>}
        {phase === 'recording' && (
          <button type="button" className="lang-btn lang-btn--recording" onClick={stopRecording}>
            ● Stop
          </button>
        )}
        {phase === 'review' && (
          <>
            {takeUrl && <audio className="lang-rung__playback" src={takeUrl} controls />}
            <button type="button" className="lang-btn" onClick={beginCapture}>
              Re-record
            </button>
            <button
              type="button"
              className="lang-btn lang-btn--primary"
              onClick={accept}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Accept'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
