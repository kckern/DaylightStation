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

/** Tap to record, tap to stop → data URL → the voice pipeline. */
export function VoiceCapture({ onCapture, busy }) {
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
        reader.onload = () => onCapture(reader.result);
        reader.readAsDataURL(new Blob(chunks, { type: rec.mimeType }));
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
      logger.info('voice.start', {});
    } catch (err) {
      logger.warn('voice.mic_unavailable', { error: err?.message });
    }
  };

  return (
    <ActionIcon aria-label={recording ? 'Stop recording' : 'Voice log'} loading={busy}
      color={recording ? 'red' : undefined} onClick={toggle}>
      <MicIcon active={recording} />
    </ActionIcon>
  );
}
export default VoiceCapture;
