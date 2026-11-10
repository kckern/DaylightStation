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
 * localStorage (entries older than 7 days are ignored and pruned) the moment
 * its ceremony is put on display — never while it is only queued, so a reload
 * (or a dark screen) before it shows leaves it unseen. A ceremony never takes
 * the screen while `hold` is true (a video or a game is on): it stays parked
 * and plays when the hold drops.
 *
 * The very first load in a browser (no seen record at all, or storage that
 * throws) BASELINES: every entry already minted is stamped seen and nothing
 * shows, so a fresh deploy or a new browser does not replay a week of payouts.
 * Every later load plays a payout minted while the screen was off.
 * Two learners paid in one look share one ceremony, a card each.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DaylightAPI } from '@/lib/api.mjs';
import { useWebSocketSubscription } from '@/hooks/useWebSocket.js';
import getLogger from '@/lib/logging/Logger.js';

export function __resetShownForTest() { shownThisPage.clear(); pendingIds.clear(); skippedLogged = false; }

/** True while something live owns the screen: a video queue, a deep-linked game, or any active module (race, Skyline, arcade). */
export function isRunOnScreen({ moduleLive = false, queueLength = 0, pathname = '' } = {}) {
  return Boolean(moduleLive) || queueLength > 0 || /\/fitness\/(play|games|module)\//.test(pathname || '');
}

export const WORKOUT_FINISHED_EVENT = 'fitness-workout-finished';
// v2: v1 baselines recorded nothing for rides listed as groups (looked up by group id), so re-baseline once.
const SEEN_KEY = 'fitness.coinCeremony.seen.v2';
const MAX_LOOK_IDS = 8;
const MAX_AGE_MS = 7 * 86_400_000;
const SETTLE_MS = 1200;

// Entries shown this page life: the fallback when localStorage is unusable.
const shownThisPage = new Set();
// Entries queued for display but not yet shown: dedupes overlapping looks
// without marking them seen.
const pendingIds = new Set();
let skippedLogged = false;

/** Session ids to look up: a merged-ride group expands to its segment ids (payouts are keyed by segment). */
export function expandSessionIds(list) {
  const out = [];
  for (const s of list || []) {
    if (!s) continue;
    if (s.isGroup || Array.isArray(s.segments)) {
      for (const seg of s.segments || []) if (seg?.sessionId) out.push(String(seg.sessionId));
    } else {
      const id = s.sessionId ?? s.id;
      if (id) out.push(String(id));
    }
  }
  return [...new Set(out)].slice(0, MAX_LOOK_IDS);
}

/** True when this browser has never recorded a seen set (or cannot read one). */
function isFirstRun() {
  try { return localStorage.getItem(SEEN_KEY) === null; } catch { return true; }
}

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

function markSeen(txnIds) {
  if (!txnIds?.length) return;
  const stamp = {};
  for (const id of txnIds) { shownThisPage.add(id); pendingIds.delete(id); stamp[id] = Date.now(); }
  writeSeen({ ...readSeen(), ...stamp });
}

/** Baseline: stamp every recent minted entry seen without showing anything. */
function baselineEntries(bodies) {
  // Always record the key (an empty set is fine) so the next load is no longer a first run.
  writeSeen(readSeen());
  const floor = Date.now() - MAX_AGE_MS;
  const txnIds = [];
  for (const body of bodies) {
    if (!body || body.mode === 'off') continue;
    for (const l of body.learners || []) {
      for (const e of l?.entries || []) {
        const at = Date.parse(e?.at);
        if (e?.txnId && Number.isFinite(at) && at >= floor) txnIds.push(e.txnId);
      }
    }
  }
  markSeen(txnIds);
  return txnIds;
}

/** Unseen, recent ring-payout entries (silver and/or gems) from `/paid` bodies, grouped per learner. */
function collectUnseen(bodies, learnerFilter) {
  const seen = readSeen();
  for (const id of shownThisPage) seen[id] = Date.now();
  for (const id of pendingIds) seen[id] = Date.now();
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
        if (!e?.txnId || !(e.silver > 0 || e.gems > 0) || !Number.isFinite(at) || at < floor) continue;
        if (seen[e.txnId] != null || stamps[e.txnId] != null) continue;
        stamps[e.txnId] = at;
        sessionId = sessionId ?? String(body.sessionId);
        const card = byLearner.get(l.learnerId) || { learnerId: l.learnerId, learnerName: l.learnerName || l.learnerId, gained: { silver: 0, gems: 0 }, total: { silver: 0 }, txnIds: [] };
        card.gained.silver += e.silver > 0 ? e.silver : 0;
        card.gained.gems += e.gems > 0 ? e.gems : 0;
        card.txnIds.push(e.txnId);
        card.total.silver = l.wallet?.silver ?? card.total.silver;
        byLearner.set(l.learnerId, card);
      }
    }
  }
  if (!byLearner.size) return null;
  // Queued, not seen: an overlapping look cannot double-queue these, but they
  // are only stamped seen once their ceremony is on display.
  for (const id of Object.keys(stamps)) pendingIds.add(id);
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

export function useWorkoutCoinCeremony({ hold = false } = {}) {
  const log = useMemo(() => getLogger().child({ component: 'workout-coin-ceremony' }), []);
  const [queue, setQueue] = useState([]);
  const chain = useRef(Promise.resolve());

  // One look at a time, so two triggers close together cannot both claim an entry.
  const look = useCallback((reason, { sessionIds = null, since = '2d', limit = 5, learnerIds = null, baseline = false } = {}) => {
    chain.current = chain.current.then(async () => {
      try {
        let ids = sessionIds;
        if (!ids) {
          const list = await DaylightAPI(`/api/v1/fitness/sessions?since=${since}&limit=${limit}`);
          ids = expandSessionIds(list?.sessions);
        }
        const bodies = [];
        for (const id of ids) {
          try { bodies.push(await DaylightAPI(`/api/v1/earnings/workout/${id}/paid`)); }
          catch (err) {
            // First failure per page life is worth an info line; the rest are noise.
            const level = skippedLogged ? 'debug' : 'info';
            skippedLogged = true;
            log[level]('fitness.coin_ceremony.skipped', { sessionId: id, reason: 'fetch-failed', error: err?.message });
          }
        }
        if (baseline) {
          const txnIds = baselineEntries(bodies);
          log.info('fitness.coin_ceremony.baselined', { txnIds });
          return;
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

  // First run per browser baselines; later loads play what was minted while off.
  useEffect(() => { look('mount', { since: '2d', limit: 5, baseline: isFirstRun() }); }, [look]);

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

  // A held screen (video / game on) keeps the queue parked; nothing is stamped.
  const ceremony = hold ? null : (queue[0] ?? null);
  useEffect(() => { if (ceremony) markSeen(ceremony.txnIds); }, [ceremony]);

  const dismiss = useCallback(() => setQueue((q) => q.slice(1)), []);
  return { ceremony, dismiss };
}
