/**
 * useWorkoutCoinCeremony — celebrates silver that is actually IN THE BANK.
 *
 * The "+N" and the new total come only from the ring-payout entries the economy
 * minted for a workout (`GET /api/v1/earnings/workout/:sessionId/paid`) and the
 * wallet it reports — never from a projection. A ride that minted nothing
 * (yet) shows nothing; when the payout lands, the economy's `coins-changed`
 * (fitness topic) brings the ceremony then.
 *
 * It looks at the ledger when:
 *   - the screen loads (recent sessions: a payout minted while it was off plays);
 *   - a workout closes (FitnessPlayer announces it) — that session only;
 *   - `coins-changed` arrives for a learner (that learner's recent sessions).
 *
 * Each minted entry plays once per screen: its txnId is remembered in
 * localStorage (entries older than 7 days are ignored and pruned). A first
 * load is NOT silent — an unseen payout is exactly what this screen is for.
 * Two learners paid in one look share one ceremony, a card each.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import getLogger from '@/lib/logging/Logger.js';

export const WORKOUT_FINISHED_EVENT = 'fitness-workout-finished';
const SEEN_KEY = 'fitness.coinCeremony.seen';
const MAX_AGE_MS = 7 * 86_400_000;
const SETTLE_MS = 1200;

function readSeen() {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  } catch { return {}; }
}
function writeSeen(seen) {
  try {
    const floor = Date.now() - MAX_AGE_MS;
    const kept = Object.fromEntries(Object.entries(seen).filter(([, at]) => Number.isFinite(at) && at >= floor));
    localStorage.setItem(SEEN_KEY, JSON.stringify(kept));
  } catch { /* storage unavailable: a repeat ceremony is the worst case */ }
}

/** Unseen, recent, positive ring-payout entries from `/paid` bodies, grouped per learner. */
function collectUnseen(bodies, learnerFilter) {
  const seen = readSeen();
  const floor = Date.now() - MAX_AGE_MS;
  const byLearner = new Map();
  const stamps = {};
  let sessionId = null;
  for (const body of bodies) {
    if (!body || body.mode === 'off') continue;
    for (const l of body.learners || []) {
      if (!l?.learnerId || (learnerFilter && !learnerFilter.has(l.learnerId))) continue;
      for (const e of l.entries || []) {
        const at = Date.parse(e?.at);
        if (!e?.txnId || !(e.silver > 0) || !Number.isFinite(at) || at < floor) continue;
        if (seen[e.txnId] != null || stamps[e.txnId] != null) continue;
        stamps[e.txnId] = at;
        sessionId = sessionId ?? String(body.sessionId);
        const card = byLearner.get(l.learnerId) || { learnerId: l.learnerId, learnerName: l.learnerName || l.learnerId, rings: 0, gained: { silver: 0, gems: 0 }, total: { silver: 0 }, nextCoinIn: null, txnIds: [] };
        card.gained.silver += e.silver;
        card.txnIds.push(e.txnId);
        card.total.silver = l.wallet?.silver ?? card.total.silver;
        byLearner.set(l.learnerId, card);
      }
    }
  }
  if (!byLearner.size) return null;
  // Remembered before anything awaits: a second look can never replay these.
  writeSeen({ ...seen, ...stamps });
  const learners = [...byLearner.values()];
  return { sessionId, learners, txnIds: learners.flatMap((l) => l.txnIds) };
}

/**
 * Fire WORKOUT_FINISHED_EVENT for a close that lands on the finished session
 * (not a short browse-out back to the show), once the session's last save has
 * settled — whether it resolved or not. Shared by every close path.
 */
export async function announceWorkoutFinished({ sessionId, redirect, session }) {
  if (!sessionId || !redirect || redirect.returnToShow) return;
  try { await session?.whenFinalPersistSettled?.(); } catch { /* announce anyway */ }
  window.dispatchEvent(new CustomEvent(WORKOUT_FINISHED_EVENT, { detail: { sessionId: String(sessionId) } }));
}

export function useWorkoutCoinCeremony() {
  const log = useMemo(() => getLogger().child({ component: 'workout-coin-ceremony' }), []);
  const [queue, setQueue] = useState([]);
  const chain = useRef(Promise.resolve());

  // One look at a time, so two triggers close together cannot both claim an entry.
  const look = useCallback((reason, { sessionIds = null, since = '2d', limit = 5, learnerIds = null } = {}) => {
    chain.current = chain.current.then(async () => {
      try {
        let ids = sessionIds;
        if (!ids) {
          const list = await DaylightAPI(`/api/v1/fitness/sessions?since=${since}&limit=${limit}`);
          ids = (list?.sessions || []).map((s) => s?.sessionId).filter(Boolean).map(String);
        }
        const bodies = [];
        for (const id of ids) {
          try { bodies.push(await DaylightAPI(`/api/v1/earnings/workout/${id}/paid`)); }
          catch (err) { log.info('fitness.coin_ceremony.skipped', { sessionId: id, reason: 'fetch-failed', error: err?.message }); }
        }
        const found = collectUnseen(bodies, learnerIds);
        if (!found) { log.debug('fitness.coin_ceremony.none-minted', { reason, sessions: ids.length }); return; }
        setQueue((q) => [...q, found]);
      } catch (err) {
        log.info('fitness.coin_ceremony.skipped', { reason: 'fetch-failed', trigger: reason, error: err?.message });
      }
    });
    return chain.current;
  }, [log]);

  useEffect(() => { look('mount', { since: '7d', limit: 8 }); }, [look]);

  useEffect(() => {
    const onFinished = (event) => {
      const sessionId = event?.detail?.sessionId ? String(event.detail.sessionId) : null;
      if (sessionId) look('workout-finished', { sessionIds: [sessionId] });
    };
    window.addEventListener(WORKOUT_FINISHED_EVENT, onFinished);
    return () => window.removeEventListener(WORKOUT_FINISHED_EVENT, onFinished);
  }, [look]);

  // coins-changed arrives entry by entry: gather a burst, then look once.
  const burst = useRef({ learners: new Set(), timer: null });
  useEffect(() => () => clearTimeout(burst.current.timer), []);
  useWebSocketSubscription('fitness', (msg) => {
    if (msg?.event !== 'coins-changed' || !msg.userId) return;
    const b = burst.current;
    b.learners.add(String(msg.userId));
    clearTimeout(b.timer);
    b.timer = setTimeout(() => {
      const learnerIds = b.learners;
      b.learners = new Set();
      look('coins-changed', { learnerIds });
    }, SETTLE_MS);
  }, [look]);

  const dismiss = useCallback(() => setQueue((q) => q.slice(1)), []);
  return { ceremony: queue[0] ?? null, dismiss };
}
