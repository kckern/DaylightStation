import { useState, useEffect } from 'react';
import { DaylightAPI } from '../../../lib/api.mjs';

const DEFAULT = { preempt_seconds: 15, displace_to_queue: false };

let _cached = null;

export function usePlayerConfig() {
  const [onDeck, setOnDeck] = useState(_cached?.on_deck || DEFAULT);

  useEffect(() => {
    if (_cached) return;
    let cancelled = false;
    DaylightAPI('api/v1/config/player')
      .then((data) => {
        if (cancelled) return;
        _cached = data;
        setOnDeck(data?.on_deck || DEFAULT);
      })
      .catch(() => {
        if (cancelled) return;
        _cached = { on_deck: DEFAULT };
        setOnDeck(DEFAULT);
      });
    return () => { cancelled = true; };
  }, []);

  return { onDeck };
}
