import { useState, useEffect } from 'react';
import { DaylightAPI } from '../../../../../frontend/src/lib/api.mjs';

const DEFAULT = { preempt_seconds: 15, displace_to_queue: false };

let cachedOnDeck = DEFAULT;
let request;

// A player can unmount while another one is starting. The request and its
// fallback belong to the page so both players use the same answer.
function readOnDeck() {
  request ??= DaylightAPI('api/v1/config/player').then(data => {
    cachedOnDeck = data?.on_deck || DEFAULT;
    return cachedOnDeck;
  }, () => DEFAULT);
  return request;
}

export function usePlayerConfig() {
  const [onDeck, setOnDeck] = useState(cachedOnDeck);

  useEffect(() => {
    let cancelled = false;
    readOnDeck().then(config => {
      if (!cancelled) setOnDeck(config);
    });
    return () => { cancelled = true; };
  }, []);

  return { onDeck };
}
