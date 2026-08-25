import { createElement, useEffect, useState } from 'react';
import { wsService } from '../services/WebSocketService.js';

const cacheKey = (target) => `daylight.shutdown.${target}`;
const activeCached = (target) => {
  try { const v = JSON.parse(localStorage.getItem(cacheKey(target)) || 'null'); return v?.lockedUntil && Date.parse(v.lockedUntil) > Date.now() ? v : null; } catch { return null; }
};
function stopMedia() { document.querySelectorAll('audio,video').forEach((el) => { try { el.pause(); } catch { /* noop */ } }); }

/** Live + polling read-model for the central shutdown service. */
export function useShutdownLock(target, { onLock = null } = {}) {
  const [state, setState] = useState(() => activeCached(target) || { locked: false, lockedUntil: null });
  useEffect(() => {
    if (!target) return undefined;
    let alive = true;
    const apply = (next) => {
      if (!alive) return;
      const locked = !!next?.locked;
      const value = { locked, lockedUntil: next?.lockedUntil ?? null };
      setState(value);
      try { locked ? localStorage.setItem(cacheKey(target), JSON.stringify(value)) : localStorage.removeItem(cacheKey(target)); } catch { /* noop */ }
    };
    const refresh = async () => {
      try {
        const res = await fetch(`/api/v1/shutdown/status?target=${encodeURIComponent(target)}`, { cache: 'no-store' });
        if (res.ok) apply(await res.json());
      } catch { /* cached lock is deliberately left intact */ }
    };
    refresh();
    const unsub = wsService.subscribe('shutdown.state', (message) => {
      if (!message || (!message.targets?.includes(target) && message.type !== 'released')) return;
      refresh();
    });
    const timer = setInterval(refresh, 5000);
    return () => { alive = false; clearInterval(timer); unsub?.(); };
  }, [target]);
  useEffect(() => { if (state.locked) { stopMedia(); onLock?.(); } }, [state.locked, onLock]);
  return state;
}

export function ShutdownBlackout() {
  return createElement('div', {
    'data-testid': 'shutdown-blackout',
    'aria-hidden': 'true',
    style: { position: 'fixed', inset: 0, zIndex: 2147483647, background: '#000', touchAction: 'none' },
  });
}
