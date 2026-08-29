import { useTypewriter } from './useTypewriter.js';

export default function OpponentSpeech({ speech }) {
  const text = String(speech?.quip || '').slice(0, 96);
  const visible = useTypewriter(text, speech?.eventId);
  if (!text) return <span className="pg-opponent__speech pg-opponent__speech--empty" aria-hidden="true" />;
  return (
    <span className="pg-opponent__speech">
      <span aria-hidden="true">{visible}</span>
      <span className="pg-opponent__speech-live" role="status" aria-live="polite">{text}</span>
    </span>
  );
}
