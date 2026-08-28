import { useTypewriter } from './useTypewriter.js';

export function OpponentSpeech({ speech }) {
  const text = String(speech?.quip || '').slice(0, 96);
  const visible = useTypewriter(text, speech?.eventId);
  if (!text) return <span className="chess-opponent__speech chess-opponent__speech--empty" aria-hidden="true" />;
  return (
    <span className="chess-opponent__speech">
      <span className="chess-opponent__speech-typed" aria-hidden="true">{visible}</span>
      <span className="chess-opponent__speech-live" role="status" aria-live="polite">{text}</span>
    </span>
  );
}

export default OpponentSpeech;
