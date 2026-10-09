// frontend/src/screen-framework/publishers/useRegistryPlaybackState.js
//
// useRegistryPlaybackState — reactive view of the playerSessionRegistry for
// presence gating: is a player registered on this screen, and is it actually
// playing? Subscribes to register/unregister and polls (1s) for play/pause
// flips, updating state only on real changes so consumers don't re-render on
// every tick.
import { useEffect, useState } from 'react';
import { getPlayerSessionRegistry } from './playerSessionRegistry.js';

const IDLE = Object.freeze({ registered: false, playing: false });

function read(registry) {
  try {
    const reg = registry.getCurrent();
    if (!reg?.player) return IDLE;
    let state = null;
    try { state = reg.player.getState?.(); } catch { state = null; }
    return { registered: true, playing: state === 'playing' || state === 'play' };
  } catch {
    return IDLE;
  }
}

/**
 * @param {object} [opts]
 * @param {object} [opts.registry] — override registry (tests).
 * @param {number} [opts.pollMs]
 * @returns {{registered: boolean, playing: boolean}}
 */
export function useRegistryPlaybackState({ registry, pollMs = 1000 } = {}) {
  const reg = registry ?? getPlayerSessionRegistry();
  const [state, setState] = useState(() => read(reg));

  useEffect(() => {
    const update = () => {
      setState((prev) => {
        const next = read(reg);
        return (prev.registered === next.registered && prev.playing === next.playing)
          ? prev
          : next;
      });
    };
    update();
    const unsub = reg.subscribe(update);
    const timer = setInterval(update, pollMs);
    return () => {
      try { unsub?.(); } catch { /* ignore */ }
      clearInterval(timer);
    };
  }, [reg, pollMs]);

  return state;
}

export default useRegistryPlaybackState;
