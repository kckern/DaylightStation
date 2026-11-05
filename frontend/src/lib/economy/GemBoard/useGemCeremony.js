/**
 * useGemCeremony — watches the Gem Board for gems that are new since this
 * surface last looked (`gemCeremonyModel.js`) and holds them for the ceremony.
 *
 * When it looks:
 *   - on mount (and each time it is re-enabled). With `learnOnMount` it only
 *     learns the board — the garage screen celebrates what happens in front of
 *     it, not the school day it missed. Without, it compares with its last
 *     look, so a child back at the Portal from a worksheet sees that sheet's
 *     gem. Either way a surface that has not looked this week learns silently
 *     (a first load is not an achievement), and a reload never replays one;
 *   - on any of `events` (window CustomEvents a surface fires when something
 *     just landed: a race saved, a flight saved, a workout's coin ceremony
 *     done), after `settleMs`, with a FRESH read (the server's minute-shared
 *     copy would miss what just happened);
 *   - every `pollMs`, from the shared copy (a gem earned elsewhere — a
 *     worksheet graded, a book logged — reaches this screen within a minute or two).
 *
 * The last look is kept per surface in localStorage, so a celebration happens
 * once per screen. A batch found while one is showing waits its turn.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { fetchGemBoard } from './GemBoard.jsx';
import { gemAwards, gemSnapshot } from './gemCeremonyModel.js';

const keyFor = (surface) => `daylight.gemCeremony.${surface}`;

function readSnapshot(surface) {
  try { return JSON.parse(localStorage.getItem(keyFor(surface)) || 'null'); } catch { return null; }
}
function writeSnapshot(surface, snapshot) {
  try { localStorage.setItem(keyFor(surface), JSON.stringify(snapshot)); } catch { /* storage off: a repeat is the worst case */ }
}

export function useGemCeremony({
  surface, enabled = true, events = [], settleMs = 1500, pollMs = 0, learnOnMount = false, load = fetchGemBoard,
} = {}) {
  const log = useMemo(() => getLogger().child({ component: 'gem-ceremony' }), []);
  const [queue, setQueue] = useState([]);
  const busy = useRef(false);
  const loadRef = useRef(load);
  loadRef.current = load;

  const look = useCallback(async ({ fresh, silent, reason }) => {
    if (busy.current) return;
    busy.current = true;
    try {
      const board = await loadRef.current(null, { fresh });
      if (!board || board.mode === 'off') return;
      if (silent) {
        // Learn without celebrating — but keep a same-week snapshot's memory
        // of gems already shown, so nothing is lost or replayed.
        writeSnapshot(surface, gemSnapshot(board));
        return;
      }
      const { awards, snapshot } = gemAwards(readSnapshot(surface), board);
      writeSnapshot(surface, snapshot);
      if (awards.length) {
        log.info('gem-ceremony.found', { surface, reason, awards: awards.map((a) => `${a.learnerId}:${a.categoryId}:${a.kind}`) });
        setQueue((q) => [...q, { id: `${Date.now()}-${q.length}`, awards }]);
      } else {
        log.debug('gem-ceremony.none', { surface, reason });
      }
    } catch (err) {
      log.warn('gem-ceremony.look-failed', { surface, reason, error: err?.message ?? String(err) });
    } finally {
      busy.current = false;
    }
  }, [log, surface]);

  useEffect(() => {
    if (!enabled) return undefined;
    look({ fresh: false, silent: learnOnMount, reason: 'mount' });
    const timers = new Set();
    const onEvent = (e) => {
      const t = setTimeout(() => { timers.delete(t); look({ fresh: true, silent: false, reason: e?.type ?? 'event' }); }, settleMs);
      timers.add(t);
    };
    for (const name of events) window.addEventListener(name, onEvent);
    const poll = pollMs > 0 ? setInterval(() => look({ fresh: false, silent: false, reason: 'poll' }), pollMs) : null;
    return () => {
      for (const name of events) window.removeEventListener(name, onEvent);
      for (const t of timers) clearTimeout(t);
      if (poll) clearInterval(poll);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, look, settleMs, pollMs, learnOnMount, events.join('|')]);

  const done = useCallback(() => setQueue((q) => q.slice(1)), []);
  return { ceremony: queue[0] ?? null, done };
}

export default useGemCeremony;
