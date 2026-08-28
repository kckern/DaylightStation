/**
 * Pure configuration and threshold tracking for Fitness ring celebrations.
 *
 * The tracker is deliberately driven by TreasureBox's authoritative award
 * events rather than React renders/timeline samples. A render may be skipped;
 * an award must never be celebrated twice (or silently missed).
 */

const DEFAULTS = Object.freeze({
  enabled: false,
  sound: 'fitness/ux/ring.mp3',
  icon: 'fitness/ux/spinning-ring.svg',
  volume: 0.8,
  durationMs: 3500,
  coalesceWindowMs: 1500,
  maxVisibleContributors: 3,
  individualThresholds: [100, 200, 250, 500, 750, 1000, 1500],
  groupThresholds: [500, 1000, 1500, 2000],
  groupMinContributors: 2,
});

function positiveUniqueNumbers(value, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  const values = value
    .map(Number)
    .filter((n) => Number.isFinite(n) && n > 0)
    .map((n) => Math.round(n));
  return [...new Set(values)].sort((a, b) => a - b);
}

function boundedNumber(value, fallback, { min, max }) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/** Normalize the optional `ring_celebrations` household config block. */
export function normalizeRingCelebrationsConfig(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const individual = value.individual && typeof value.individual === 'object' ? value.individual : {};
  const group = value.group && typeof value.group === 'object' ? value.group : {};

  return {
    // This is an opt-in household feature. A missing config block must not
    // create a new reward UI (or request media assets) in other households.
    enabled: value.enabled === true,
    sound: typeof value.sound === 'string' && value.sound.trim() ? value.sound.trim() : DEFAULTS.sound,
    icon: typeof value.icon === 'string' && value.icon.trim() ? value.icon.trim() : DEFAULTS.icon,
    volume: boundedNumber(value.volume, DEFAULTS.volume, { min: 0, max: 1 }),
    durationMs: Math.round(boundedNumber(value.duration_ms ?? value.durationMs, DEFAULTS.durationMs, { min: 1000, max: 15000 })),
    coalesceWindowMs: Math.round(boundedNumber(value.coalesce_window_ms ?? value.coalesceWindowMs, DEFAULTS.coalesceWindowMs, { min: 0, max: 10000 })),
    maxVisibleContributors: Math.round(boundedNumber(value.max_visible_contributors ?? value.maxVisibleContributors, DEFAULTS.maxVisibleContributors, { min: 1, max: 8 })),
    individual: {
      thresholds: positiveUniqueNumbers(individual.thresholds, DEFAULTS.individualThresholds),
    },
    group: {
      thresholds: positiveUniqueNumbers(group.thresholds, DEFAULTS.groupThresholds),
      minContributors: Math.round(boundedNumber(group.min_contributors ?? group.minContributors, DEFAULTS.groupMinContributors, { min: 2, max: 20 })),
    },
  };
}

export function createRingCelebrationTracker() {
  return {
    individualFired: new Map(),
    groupFired: new Set(),
    contributorIds: new Set(),
  };
}

function cloneTracker(tracker) {
  const source = tracker || createRingCelebrationTracker();
  return {
    individualFired: new Map([...source.individualFired.entries()].map(([id, thresholds]) => [id, new Set(thresholds)])),
    groupFired: new Set(source.groupFired),
    contributorIds: new Set(source.contributorIds),
  };
}

/**
 * Mark all already-earned thresholds as observed. Used when attaching to a
 * running/resumed session, so reloads don't replay old celebrations.
 */
export function seedRingCelebrationTracker(tracker, { userTotals, totalRings } = {}, config) {
  const next = cloneTracker(tracker);
  const normalized = normalizeRingCelebrationsConfig(config);
  const totals = userTotals instanceof Map ? userTotals : new Map(Object.entries(userTotals || {}));
  totals.forEach((rawTotal, userId) => {
    const total = Number(rawTotal) || 0;
    if (total <= 0) return;
    next.contributorIds.add(userId);
    next.individualFired.set(userId, new Set(normalized.individual.thresholds.filter((threshold) => threshold <= total)));
  });
  if (next.contributorIds.size >= normalized.group.minContributors) {
    const total = Number(totalRings) || 0;
    normalized.group.thresholds.forEach((threshold) => {
      if (threshold <= total) next.groupFired.add(threshold);
    });
  }
  return next;
}

/**
 * Evaluate one canonical TreasureBox award. Each returned entry represents a
 * newly crossed configured threshold; all are safe to merge into one toast.
 */
export function ringCelebrationsForAward(tracker, award, config) {
  const next = cloneTracker(tracker);
  const normalized = normalizeRingCelebrationsConfig(config);
  if (!normalized.enabled || !award?.userId) return { entries: [], tracker: next };

  const userId = String(award.userId);
  const userTotal = Number(award.userTotal);
  const totalRings = Number(award.totalRings);
  if (!Number.isFinite(userTotal) || !Number.isFinite(totalRings)) return { entries: [], tracker: next };

  next.contributorIds.add(userId);
  const entries = [];
  const firedForUser = new Set(next.individualFired.get(userId) || []);
  normalized.individual.thresholds.forEach((threshold) => {
    if (userTotal >= threshold && !firedForUser.has(threshold)) {
      firedForUser.add(threshold);
      entries.push({ scope: 'individual', userId, threshold, userTotal, totalRings });
    }
  });
  next.individualFired.set(userId, firedForUser);

  if (next.contributorIds.size >= normalized.group.minContributors) {
    normalized.group.thresholds.forEach((threshold) => {
      if (totalRings >= threshold && !next.groupFired.has(threshold)) {
        next.groupFired.add(threshold);
        entries.push({
          scope: 'group',
          threshold,
          totalRings,
          contributorIds: [...next.contributorIds],
        });
      }
    });
  }

  return { entries, tracker: next };
}

export default normalizeRingCelebrationsConfig;
