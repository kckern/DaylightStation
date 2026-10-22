/**
 * The coin ceremony's pure parts: its config, how a "coins just added" is
 * told from a refresh, and the queue that shows one pop at a time.
 *
 * WHAT IS CELEBRATED is the board's coin column: this week's silver (the
 * earnings preview), the figure the household calls "coins". It is NOT the
 * bank balance (owner ruling, 2026-10-21). A rise is the same learner's
 * silver going up between two NETWORK reads of the same week.
 *
 * Not celebrated: the cache seed and the first read after mount (both are
 * baselines), a change of week, a drop, no change, and anyone off the roster.
 *
 * Modelled on the fitness ring celebrations (`ringCelebrations.js`): a burst
 * window lets a payout run's several reads become one pop, and a pop already
 * on screen for that learner is updated in place.
 */

export const COIN_CEREMONY_DEFAULTS = Object.freeze({
  enabled: true,
  // On the media mount beside the other School UI cues (`school/_ux/`).
  // Override per screen: `school.coinCeremony.sound` in the screen YAML.
  sound: 'school/_ux/coin.mp3',
  volume: 0.8,
  durationMs: 3500,
  coalesceWindowMs: 1500,
});

const bounded = (value, fallback, min, max) => {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
};

/** The screen config's optional `school.coinCeremony` block, normalized. */
export function normalizeCoinCeremonyConfig(raw) {
  const v = raw && typeof raw === 'object' ? raw : {};
  let sound = COIN_CEREMONY_DEFAULTS.sound;
  if (typeof v.sound === 'string') {
    const s = v.sound.trim().replace(/^\/+/, '');
    sound = s && s.toLowerCase() !== 'none' ? s : null;
  }
  return {
    enabled: v.enabled !== false,
    sound,
    volume: bounded(v.volume, COIN_CEREMONY_DEFAULTS.volume, 0, 1),
    durationMs: Math.round(bounded(v.durationMs ?? v.duration_ms, COIN_CEREMONY_DEFAULTS.durationMs, 1000, 15000)),
    coalesceWindowMs: Math.round(bounded(v.coalesceWindowMs ?? v.coalesce_window_ms, COIN_CEREMONY_DEFAULTS.coalesceWindowMs, 0, 10000)),
  };
}

/**
 * Compare a fresh `earningsByLearner` read with the last one seen.
 * `seen` is `{ [learnerId]: { silver, from, to } }`, the last NETWORK read
 * per learner. A learner absent from this read keeps their entry.
 */
export function observeEarnings(seen, byLearner, rosterIds = null) {
  const next = { ...(seen ?? {}) };
  const rises = [];
  for (const [learnerId, figure] of Object.entries(byLearner ?? {})) {
    if (rosterIds && !rosterIds.has(learnerId)) continue;
    if (!Number.isFinite(figure?.silver)) continue;
    const before = next[learnerId];
    const now = { silver: figure.silver, from: figure.from ?? null, to: figure.to ?? null };
    next[learnerId] = now;
    if (!before) continue;
    if (before.from !== now.from || before.to !== now.to) continue;
    const gained = now.silver - before.silver;
    if (gained > 0) rises.push({ learnerId, gained, total: now.silver });
  }
  return { seen: next, rises };
}

export function emptyQueue() {
  return { showing: null, pending: [], nextId: 1 };
}

/** Add a rise: into the pop on screen (same learner), a waiting one, or the back of the line. */
export function enqueueRise(q, rise, nowMs) {
  if (q.showing && q.showing.learnerId === rise.learnerId) {
    return { ...q, showing: { ...q.showing, gained: q.showing.gained + rise.gained, total: rise.total, revision: q.showing.revision + 1 } };
  }
  const i = q.pending.findIndex((p) => p.learnerId === rise.learnerId);
  if (i >= 0) {
    const pending = q.pending.slice();
    pending[i] = { ...pending[i], gained: pending[i].gained + rise.gained, total: rise.total };
    return { ...q, pending };
  }
  return { ...q, pending: [...q.pending, { learnerId: rise.learnerId, gained: rise.gained, total: rise.total, firstAt: nowMs }] };
}

/** The head of the line goes on screen once nothing is showing and it has waited out the window. */
export function promote(q, nowMs, windowMs) {
  if (q.showing || !q.pending.length) return q;
  const [head, ...rest] = q.pending;
  if (nowMs - head.firstAt < windowMs) return q;
  return {
    showing: { id: q.nextId, learnerId: head.learnerId, gained: head.gained, total: head.total, revision: 0 },
    pending: rest,
    nextId: q.nextId + 1,
  };
}

/** The pop `id` is done (timed out or tapped). */
export function finish(q, id) {
  return q.showing && q.showing.id === id ? { ...q, showing: null } : q;
}

/** How long until `promote` could act, or null when it cannot. */
export function nextPromoteIn(q, nowMs, windowMs) {
  if (q.showing || !q.pending.length) return null;
  return Math.max(0, q.pending[0].firstAt + windowMs - nowMs);
}
