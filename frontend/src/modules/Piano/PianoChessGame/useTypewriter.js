// useTypewriter.js — character-by-character reveal hook for
// OpponentSpeech.jsx, split out so Fast Refresh can hot-reload the speech
// component on its own.
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
