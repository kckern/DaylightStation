import { useRef, useState } from 'react';
import { ActionIcon } from '@mantine/core';
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
 * state. The footer's single global instance omits both props and keeps its
 * original generic label/behavior.
 */
export function VoiceCapture({ onCapture, busy, bucket, mealLabel }) {
  const recRef = useRef(null);
  const [recording, setRecording] = useState(false);

  const toggle = async () => {
    if (recording) { recRef.current?.stop(); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        const reader = new FileReader();
        reader.onload = () => onCapture(reader.result, bucket);
        reader.readAsDataURL(new Blob(chunks, { type: rec.mimeType }));
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
      logger.info('voice.start', { bucket: bucket || undefined });
    } catch (err) {
      logger.warn('voice.mic_unavailable', { error: err?.message });
    }
  };

  const idleLabel = mealLabel ? `Log by voice to ${mealLabel}` : 'Voice log';
  const activeLabel = mealLabel ? `Stop recording — ${mealLabel}` : 'Stop recording';

  return (
    <ActionIcon aria-label={recording ? activeLabel : idleLabel} loading={busy}
      className={mealLabel ? 'health-meal__capture-btn' : undefined}
      color={recording ? 'red' : undefined} onClick={toggle}>
      <MicIcon active={recording} />
    </ActionIcon>
  );
}
export default VoiceCapture;
