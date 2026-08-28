/** Build and merge the mutable payload displayed by the ring celebration toast. */

const avatarFor = (id) => `/api/v1/static/img/users/${id}`;

function entryKey(entry) {
  return entry.scope === 'group'
    ? `group:${entry.threshold}`
    : `individual:${entry.userId}:${entry.threshold}`;
}

function joinNames(names) {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} & ${names[1]}`;
  return `${names.slice(0, -1).join(', ')} & ${names[names.length - 1]}`;
}

function contributorFor(id, resolveUserName) {
  return {
    id,
    name: resolveUserName?.(id) || id,
    avatarUrl: avatarFor(id),
  };
}

function renderableEntries(entries, resolveUserName) {
  return entries.map((entry) => {
    if (entry.scope === 'group') {
      return {
        ...entry,
        contributorIds: [...new Set(entry.contributorIds || [])],
      };
    }
    return {
      ...entry,
      name: resolveUserName?.(entry.userId) || entry.userId,
      avatarUrl: avatarFor(entry.userId),
    };
  });
}

/**
 * Merge freshly crossed thresholds into the ring toast currently being shown.
 * The returned payload intentionally has no id: FitnessContext retains its
 * existing slot id, increments `revision`, and restarts the visible lifetime.
 */
export function mergeRingCelebrationToast(current, freshEntries, {
  resolveUserName,
  iconUrl,
  durationMs,
  maxVisibleContributors = 3,
} = {}) {
  const oldEntries = current?.ringCelebration?.entries || [];
  const merged = new Map();
  [...oldEntries, ...(freshEntries || [])].forEach((entry) => {
    if (!entry) return;
    const key = entryKey(entry);
    const old = merged.get(key);
    // A later group event can include more contributors. Preserve that richer
    // set rather than treating its key as an immutable duplicate.
    if (old?.scope === 'group' && entry.scope === 'group') {
      merged.set(key, { ...old, ...entry, contributorIds: [...new Set([...(old.contributorIds || []), ...(entry.contributorIds || [])])] });
    } else if (!old) {
      merged.set(key, entry);
    }
  });

  const entries = renderableEntries([...merged.values()], resolveUserName);
  const contributorIds = new Set();
  entries.forEach((entry) => {
    if (entry.scope === 'group') (entry.contributorIds || []).forEach((id) => contributorIds.add(id));
    else contributorIds.add(entry.userId);
  });
  const contributors = [...contributorIds].map((id) => contributorFor(id, resolveUserName));

  return {
    kind: 'ring-celebration',
    variant: 'rings',
    durationMs,
    achievement: true,
    ringCelebration: {
      iconUrl,
      entries,
      contributors,
      maxVisibleContributors,
    },
  };
}

export function describeRingEntry(entry) {
  if (entry.scope === 'group') return `${entry.threshold.toLocaleString()} rings together`;
  return `${entry.name} reached ${entry.threshold.toLocaleString()} rings`;
}

export function describeSameThresholdPeople(entries) {
  const individual = entries.filter((entry) => entry.scope === 'individual');
  if (individual.length < 2) return null;
  const threshold = individual[0]?.threshold;
  if (!threshold || individual.some((entry) => entry.threshold !== threshold)) return null;
  return { threshold, names: joinNames(individual.map((entry) => entry.name)) };
}

export default mergeRingCelebrationToast;
