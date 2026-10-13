/**
 * A play gate whose authority lives on the SERVER.
 *
 * This supersedes the coin-metered gate, which metered locally and settled
 * against the economy from the browser. That worked only for the surface we own:
 * the console emulator has no client to host a gate, so two surfaces would have
 * meant two books of record keeping their own time and drifting apart. The
 * server now measures both and owns the balance.
 *
 * What remains here is display and a LOCAL SAFETY STOP. It renders whatever the
 * server last said, and if the server says the time is gone it stops reporting
 * playable — so a child does not keep playing through a depleted balance just
 * because a socket hiccuped. It never settles, never charges, and never decides
 * how much time exists.
 *
 * Satisfies the same surface the console consumes:
 *   { isPlayable(), getStatus() -> { state }, onChange(cb) -> unsubscribe }
 *
 * A budget we have not heard about yet is PLAYABLE. Refusing to start because
 * the first update has not arrived would make every launch race the network.
 */

const WARNING_MS = 60_000;

export function createServerMeteredGate({ subscribeBudget, warningMs = WARNING_MS } = {}) {
  let status = { state: 'ok', remainingMs: null, unlimited: true, stale: false };
  const listeners = new Set();

  const publish = (next) => {
    const changed = next.state !== status.state || next.remainingMs !== status.remainingMs;
    status = next;
    if (changed) listeners.forEach((fn) => { try { fn(status); } catch { /* a listener must not break the gate */ } });
  };

  const apply = (budget) => {
    if (!budget || budget.mode === 'idle') {
      publish({ state: 'ok', remainingMs: null, unlimited: true, stale: false });
      return;
    }
    if (budget.mode === 'elapsed') {
      // No budget granted: nothing to run out of, so nothing to gate on.
      publish({ state: 'ok', remainingMs: null, unlimited: true, stale: !!budget.stale });
      return;
    }
    const remainingMs = Math.max(0, Number(budget.ms) || 0);
    const state = remainingMs <= 0 ? 'depleted' : (remainingMs <= warningMs ? 'warning' : 'ok');
    publish({ state, remainingMs, unlimited: false, stale: !!budget.stale });
  };

  const unsubscribe = typeof subscribeBudget === 'function' ? subscribeBudget(apply) : null;

  return {
    /** Playable until the server says the time is gone. */
    isPlayable() { return status.state !== 'depleted'; },
    getStatus() { return { ...status }; },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    /** For tests and for a caller holding a budget it already has. */
    update(budget) { apply(budget); },
    dispose() { listeners.clear(); unsubscribe?.(); },
  };
}

export default createServerMeteredGate;
