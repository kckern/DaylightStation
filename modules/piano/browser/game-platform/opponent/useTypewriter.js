import { useEffect, useState } from 'react';

export function useTypewriter(text, eventId, characterMs = 14) {
  const [visible, setVisible] = useState('');
  useEffect(() => {
    const copy = String(text || '').slice(0, 96);
    const reduced = typeof window !== 'undefined'
      && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!copy || reduced) { setVisible(copy); return undefined; }
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

export default useTypewriter;
