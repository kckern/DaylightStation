import { useEffect, useRef, useState } from 'react';
import { ActionIcon, Button } from '@mantine/core';
import { useCaptureTask } from './useCaptureTask.js';
import { createAppLogger } from '../../../lib/ui/createAppLogger.js';

const logger = createAppLogger('health').child('voice-capture');
const MicIcon = ({ active }) => (
  <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
    <rect x="6.5" y="2" width="5" height="9" rx="2.5" stroke="currentColor" strokeWidth="1.5"
      fill={active ? 'currentColor' : 'none'} />
    <path d="M4 9a5 5 0 0010 0M9 14v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

/**
 * Tap to record, tap to stop → data URL → the voice pipeline.
 *
 * `bucket` is a per-meal targeting id (e.g. `morning`), optional — when a
 * caller (LogTable's per-meal header) supplies it, this both (a) names the
 * meal in the button's accessible name so a screen-reader user hitting four
 * otherwise-identical "Voice log" buttons can tell them apart, and (b)
 * forwards it back through `onCapture(dataUrl, bucket)` so the caller knows
 * which meal to submit against without needing its own per-instance closure
 * state.
 *
 * `labelPrefix` (Task 4.3) lets a second caller with its OWN meal-targeted
 * instance — QuickCaptureBar's global mic — read differently from a
 * per-meal header's ("Log by voice to Lunch") even though both target the
 * exact same bucket: e.g. "Quick voice log to Lunch". Without this, two
 * buttons on the page would carry the identical accessible name while doing
 * conceptually different things (one lives on the meal row, the other is
 * reachable from anywhere). `className` similarly lets QuickCaptureBar apply
 * its own sizing class instead of the meal-row default.
 */
export function VoiceCapture({ active = true, onCapture, busy, bucket, mealLabel, labelPrefix, className }) {
  const recRef = useRef(null);
  const [recording, setRecording] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const acquiring = useRef(false);
  const live = useRef(true);
  const activeRef = useRef(active);
  activeRef.current = active;
  const task = useCaptureTask();

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      const rec = recRef.current;
      if (rec) {
        rec.onstop = null;
        if (rec.state !== 'inactive') rec.stop();
        rec.stream?.getTracks().forEach(track => track.stop());
      }
    };
  }, []);

  // Leaving Today completes the current recording; no hidden microphone is
  // left running. The captured submit closure still owns its original date.
  useEffect(() => {
    if (!active && recRef.current?.state === 'recording') recRef.current.stop();
  }, [active]);

  const toggle = async () => {
    if (recording) { if (recRef.current?.state !== 'inactive') recRef.current?.stop(); return; }
    if (!active || acquiring.current || pending || task.pending) return;
    acquiring.current = true; setError(null);
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!live.current || !activeRef.current) { stream.getTracks().forEach(track => track.stop()); return; }
      const rec = new MediaRecorder(stream);
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onerror = () => {
        rec.onstop = null;
        stream.getTracks().forEach(track => track.stop());
        if (live.current) { setRecording(false); setError('Recording interrupted. Check microphone permission.'); }
      };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const reader = new FileReader();
        setPending(true);
        reader.onerror = () => { setPending(false); setError('Recording could not be read.'); };
        reader.onload = async () => {
          try { await task.run(() => onCapture(reader.result, bucket)); }
          finally { if (live.current) setPending(false); }
        };
        reader.readAsDataURL(new Blob(chunks, { type: rec.mimeType }));
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
      logger.info('voice.start', { bucket: bucket || undefined });
    } catch (err) {
      stream?.getTracks().forEach(track => track.stop());
      if (live.current) setError('Microphone unavailable. Check permission or type your food.');
      logger.warn('voice.mic_unavailable', { error: err?.message });
    } finally { acquiring.current = false; }
  };

  const idleLabel = labelPrefix
    ? `${labelPrefix} to ${mealLabel}`
    : (mealLabel ? `Log by voice to ${mealLabel}` : 'Voice log');
  const activeLabel = mealLabel ? `Stop recording — ${mealLabel}` : 'Stop recording';

  return (
    <><ActionIcon aria-label={recording ? activeLabel : idleLabel} loading={pending || task.pending}
      className={className || (mealLabel ? 'health-meal__capture-btn' : undefined)}
      color={recording ? 'red' : undefined} onClick={toggle}>
      <MicIcon active={recording} />
    </ActionIcon>{error || task.error ? <span role="alert" className="health-capture-error">{error || task.error}</span> : null}
      {task.retry ? <Button size="compact-xs" disabled={task.pending} onClick={task.retry}>Retry recording</Button> : null}</>
  );
}
export default VoiceCapture;
