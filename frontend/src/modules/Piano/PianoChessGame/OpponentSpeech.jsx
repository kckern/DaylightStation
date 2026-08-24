import { useEffect, useState } from 'react';

const CHARACTER_MS = 14;

export function useTypewriter(text, eventId, characterMs = CHARACTER_MS) {
  const [visible, setVisible] = useState('');

  useEffect(() => {
    const copy = String(text || '').slice(0, 96);
    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!copy || reduced) {
      setVisible(copy);
      return undefined;
    }
    setVisible('');
    let index = 0;
    const timer = setInterval(() => {
      index += 1;
      setVisible(copy.slice(0, index));
      if (index >= copy.length) clearInterval(timer);
    }, characterMs);
    return () => clearInterval(timer);
  }, [characterMs, eventId, text]);

  return visible;
}

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
