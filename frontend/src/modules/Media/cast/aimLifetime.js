export const AIM_IDLE_MS = 2 * 60 * 60 * 1000;

const DEFAULT_MODE = 'transfer';

function validTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function normalizeMode(mode) {
  return mode === 'fork' ? 'fork' : DEFAULT_MODE;
}

function normalizeTargetIds(targetIds) {
  if (!Array.isArray(targetIds)) return [];
  return [...new Set(targetIds.filter((id) => typeof id === 'string' && id.length > 0))];
}

function defaultState(now) {
  return {
    mode: DEFAULT_MODE,
    targetIds: [],
    activityAt: now,
    exemptionStartedAt: null,
  };
}

/**
 * Reads the persisted aim shape without assigning meaning to unavailable
 * fleet state. Legacy records did not include activityAt; give each one a
 * single conservative two-hour lease instead of making it immortal.
 */
export function restoreAimState(raw, { now = Date.now() } = {}) {
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { parsed = null; }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { state: defaultState(now), migrated: false, restored: false };
  }

  const hasActivityAt = validTimestamp(parsed.activityAt);
  return {
    state: {
      mode: normalizeMode(parsed.mode),
      targetIds: normalizeTargetIds(parsed.targetIds),
      activityAt: hasActivityAt ? parsed.activityAt : now,
      // A persisted exemption was true only at the last observed moment. A
      // reload cannot credit the unobserved interval after that moment, so a
      // fresh fleet observation must begin a new runtime exemption.
      exemptionStartedAt: null,
    },
    migrated: !hasActivityAt,
    restored: true,
  };
}

/**
 * `exemption` is tri-state: true is a current, verified exemption; false is
 * a current, verified non-exemption; null means fleet state is unavailable.
 * Unknown receiver state is not called idle, but it also cannot indefinitely
 * pause this browser's own inactivity clock: only positive proof pauses it.
 */
export function advanceAimLifetime(state, { now = Date.now(), exemption = null } = {}) {
  if (state.targetIds.length === 0) return { state, expired: false, exemptionChanged: false };

  if (exemption === true) {
    if (state.exemptionStartedAt != null) return { state, expired: false, exemptionChanged: false };
    return {
      state: { ...state, exemptionStartedAt: now },
      expired: false,
      exemptionChanged: true,
    };
  }

  const resumed = state.exemptionStartedAt == null
    ? state
    : {
      ...state,
      activityAt: state.activityAt + Math.max(0, now - state.exemptionStartedAt),
      exemptionStartedAt: null,
    };
  const expired = now - resumed.activityAt >= AIM_IDLE_MS;
  return {
    state: expired
      ? { ...resumed, targetIds: [], activityAt: now, exemptionStartedAt: null }
      : resumed,
    expired,
    exemptionChanged: resumed !== state,
  };
}

export function renewAimActivity(state, { now = Date.now() } = {}) {
  return {
    ...state,
    activityAt: now,
    // The renewed activity time becomes the new baseline for the active
    // exemption too. Otherwise ending it would credit time before renewal.
    exemptionStartedAt: state.exemptionStartedAt == null ? null : now,
  };
}
