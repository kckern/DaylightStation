// Hybrid persistence client: the frontend reducer is authoritative during
// play; this module checkpoints snapshots to the backend (debounced,
// retried) so a kiosk reload can resume. Gameplay NEVER blocks on it.
import { DaylightAPI } from '@/lib/api.mjs';
import getLogger from '@/lib/logging/Logger.js';

const log = () => getLogger().child({ component: 'gameshow-session' });

export async function fetchBoot() {
  const [config, setsRes, activeRes] = await Promise.all([
    DaylightAPI('api/v1/gameshow/config'),
    DaylightAPI('api/v1/gameshow/games/jeopardy/sets'),
    DaylightAPI('api/v1/gameshow/sessions/active'),
  ]);
  return { config, sets: setsRes.sets || [], activeSession: activeRes.session || null };
}

export function createSession({ game, setId, teams }) {
  return DaylightAPI('api/v1/gameshow/sessions', { game, setId, teams }, 'POST');
}

export function finishSession(id) {
  return DaylightAPI(`api/v1/gameshow/sessions/${id}/finish`, {}, 'POST');
}

// --- host companion helpers ---
export function fetchSession(id) {
  return DaylightAPI(`api/v1/gameshow/sessions/${id}`);
}

export function fetchSet(game, setId) {
  return DaylightAPI(`api/v1/gameshow/games/${game}/sets/${setId}`);
}

export function sendCommand(sessionId, command) {
  return DaylightAPI(`api/v1/gameshow/sessions/${sessionId}/command`, { command }, 'POST');
}

export function makeCheckpointer({ debounceMs = 800, maxRetries = 3 } = {}) {
  let pending = null;        // { sessionId, state }
  let timer = null;
  let inFlight = false;

  async function send(attempt = 0) {
    if (!pending || inFlight) return;
    const { sessionId, state } = pending;
    pending = null;
    inFlight = true;
    try {
      await DaylightAPI(`api/v1/gameshow/sessions/${sessionId}/checkpoint`, { state }, 'POST');
    } catch (err) {
      log().warn('gameshow.checkpoint.failed', { attempt, error: err.message });
      if (attempt < maxRetries && !pending) {
        // restore the failed snapshot unless a newer one arrived meanwhile
        pending = { sessionId, state };
        timer = setTimeout(() => { timer = null; send(attempt + 1); }, 1000 * 2 ** attempt);
      }
    } finally {
      inFlight = false;
      if (pending && !timer) schedule();
    }
  }

  function schedule() {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; send(0); }, debounceMs);
  }

  return {
    push(sessionId, state) {
      pending = { sessionId, state };
      schedule();
    },
    flush() { if (timer) { clearTimeout(timer); timer = null; } return send(0); },
    pendingCount() { return pending ? 1 : 0; },
  };
}
