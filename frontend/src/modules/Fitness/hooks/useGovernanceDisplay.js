import { useMemo } from 'react';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import { calculateZoneProgressTowardsTarget } from '../../../hooks/fitness/types.js';

const FALLBACK_AVATAR = DaylightMediaPath('/static/img/users/user');
const normalize = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/**
 * Pure function: resolve governance decisions + display map → display rows.
 * Exported for testability. Used via useGovernanceDisplay hook.
 */
export function resolveGovernanceDisplay(govState, displayMap, zoneMeta, options) {
  const preferGroupLabels = options?.preferGroupLabels ?? false;
  if (!govState?.isGoverned) return null;

  const {
    status,
    requirements,
    challenge,
    deadline,
    gracePeriodTotal,
    videoLocked,
    hrInactiveUsers,
    activeUserCount
  } = govState;
  const normalizedRequirements = Array.isArray(requirements) ? requirements : [];

  if (status === 'unlocked') {
    // Cycle challenges can enter `cycleState: 'locked'` independently of
    // parent governance — the rider dropped below loRpm even though HR-based
    // base requirements are still satisfied.
    //
    // Health-lock (lockReason === 'health'): the inline CycleChallengeOverlay
    // stays visible showing the empty health meter; videoLocked pauses
    // playback. The generic GovernanceStateOverlay must NOT render — return
    // show:false so the host skips it. The cycle overlay is kept by
    // FitnessPlayerOverlay's health-lock guard.
    //
    // Non-health locks (init/ramp): keep existing show:true so GovernanceStateOverlay
    // renders (the inline overlay is already suppressed for those by FitnessPlayerOverlay).
    if (challenge && challenge.type === 'cycle' && challenge.cycleState === 'locked') {
      if (challenge.lockReason === 'health') {
        return {
          show: false,
          status,
          rows: [],
          requirements: [],
          deadline: null,
          gracePeriodTotal: null,
          videoLocked: true,
          metRows: [],
          challenge,
          activeUserCount: Number.isFinite(activeUserCount) ? Math.max(0, Math.round(activeUserCount)) : null
        };
      }
      // Non-health cycle lock (init/ramp) — surface through GovernanceStateOverlay.
      return {
        show: true,
        status,
        rows: [],
        requirements: [],
        deadline: null,
        gracePeriodTotal: null,
        videoLocked: false,
        metRows: [],
        challenge,
        activeUserCount: Number.isFinite(activeUserCount) ? Math.max(0, Math.round(activeUserCount)) : null
      };
    }
    return { show: false, status, rows: [], metRows: [] };
  }

  // Collect all (userId, targetZoneId) pairs from unsatisfied requirements + active challenge
  const userTargets = new Map(); // userId → targetZoneId (highest severity wins)
  const zoneMap = zoneMeta?.map || {};
  const rankOf = (zoneId) => zoneMap[zoneId]?.rank ?? -1;
  const hrInactiveSet = new Set((hrInactiveUsers || []).map(normalize));

  // Hard rule: a user whose display entry shows no current HR signal
  // (heartRate null or 0) is never a candidate for the lock screen, regardless
  // of which list governance put them on. Belt-and-braces with the
  // hrInactiveSet filter below — if the engine's pulse/snapshot paths ever
  // disagree about hrInactiveUsers, this still guarantees zero-HR users
  // don't appear.
  //
  // Note: when displayMap has NO entry for the key at all (e.g. init race
  // where governance has emitted a requirement before the display map has
  // populated), we leave the user in so the fallback name path keeps working.
  // Only an explicit zero/null in the entry triggers the exclusion.
  const isZeroHrInDisplay = (key) => {
    const d = displayMap.get(key);
    if (!d) return false;
    if (d.heartRate == null) return true;
    return Number.isFinite(d.heartRate) && d.heartRate <= 0;
  };

  // Base requirements
  normalizedRequirements.forEach((req) => {
    if (req.satisfied) return;
    const targetZoneId = req.zone || null;
    (req.missingUsers || []).forEach((userId) => {
      const key = normalize(userId);
      if (hrInactiveSet.has(key)) return;
      if (isZeroHrInDisplay(key)) return;
      const existing = userTargets.get(key);
      if (!existing || rankOf(targetZoneId) > rankOf(existing.targetZoneId)) {
        userTargets.set(key, { userId, targetZoneId });
      }
    });
  });

  // Challenge requirements (if active, NOT paused, and has missing users)
  if (challenge && !challenge.paused && (challenge.status === 'pending' || challenge.status === 'failed') && Array.isArray(challenge.missingUsers)) {
    const targetZoneId = challenge.zone || null;
    challenge.missingUsers.forEach((userId) => {
      const key = normalize(userId);
      if (hrInactiveSet.has(key)) return;
      if (isZeroHrInDisplay(key)) return;
      const existing = userTargets.get(key);
      if (!existing || rankOf(targetZoneId) > rankOf(existing.targetZoneId)) {
        userTargets.set(key, { userId, targetZoneId });
      }
    });
  }

  // Resolve each user against the display map
  const rows = [];
  for (const [key, { userId, targetZoneId }] of userTargets) {
    const display = displayMap.get(key);
    const targetZone = targetZoneId ? (zoneMap[targetZoneId] || null) : null;
    const currentZoneId = display?.zoneId || null;
    const currentZone = currentZoneId ? (zoneMap[currentZoneId] || null) : null;

    // Compute target-aware progress (full span to governance target)
    const zoneSequence = display?.zoneSequence || [];
    const currentZoneIndex = zoneSequence.findIndex(z => z.id === currentZoneId);
    const targetResult = (zoneSequence.length > 0 && currentZoneIndex >= 0)
      ? calculateZoneProgressTowardsTarget({
          snapshot: {
            zoneSequence,
            currentZoneIndex,
            heartRate: display?.heartRate ?? 0
          },
          targetZoneId
        })
      : null;

    // Use target-aware progress if available, otherwise fall back to display map progress
    const resolvedProgress = (targetResult && targetResult.progress != null)
      ? targetResult.progress
      : (display?.progress ?? null);
    const intermediateZones = targetResult?.intermediateZones || [];

    const resolvedName = (preferGroupLabels && display?.groupLabel)
      ? display.groupLabel
      : (display?.displayName || userId);
    rows.push({
      key: key,
      userId,
      displayName: resolvedName,
      avatarSrc: display?.avatarSrc || FALLBACK_AVATAR,
      heartRate: display?.heartRate ?? null,
      currentZone,
      targetZone,
      zoneSequence,
      progress: resolvedProgress,
      intermediateZones,
      targetHeartRate: display?.targetHeartRate ?? null,
      groupLabel: display?.groupLabel || null
    });
  }

  // Sort by severity (highest target zone first)
  rows.sort((a, b) => rankOf(b.targetZone?.id) - rankOf(a.targetZone?.id));

  // Participants who HAVE satisfied their requirement. `rows` above is
  // missing-only by construction, so without this a rider drops off the lock
  // screen the instant they reach their target — the header count is the only
  // trace they were ever there. Collected from the same requirement/challenge
  // pair that feeds userTargets so the credit and the count agree.
  const metUserIds = new Map(); // normalized key → raw userId
  const collectMet = (list) => {
    (Array.isArray(list) ? list : []).forEach((userId) => {
      const key = normalize(userId);
      if (!key || metUserIds.has(key)) return;
      metUserIds.set(key, userId);
    });
  };
  normalizedRequirements.forEach((req) => {
    if (req.satisfied) return;
    collectMet(req.metUsers);
  });
  if (challenge && !challenge.paused && (challenge.status === 'pending' || challenge.status === 'failed')) {
    collectMet(challenge.metUsers);
  }

  const metRows = [];
  for (const [key, userId] of metUserIds) {
    // A participant can't simultaneously block and credit. If governance has
    // them on both lists (conflicting requirements), the blocking row wins —
    // otherwise their face would say "done" while their row says "not yet".
    if (userTargets.has(key)) continue;
    const display = displayMap.get(key);
    const currentZoneId = display?.zoneId || null;
    metRows.push({
      key,
      userId,
      displayName: (preferGroupLabels && display?.groupLabel)
        ? display.groupLabel
        : (display?.displayName || userId),
      avatarSrc: display?.avatarSrc || FALLBACK_AVATAR,
      heartRate: display?.heartRate ?? null,
      currentZone: currentZoneId ? (zoneMap[currentZoneId] || null) : null,
      groupLabel: display?.groupLabel || null
    });
  }

  const show = rows.length > 0 || status === 'locked' || status === 'pending';

  return {
    show,
    status,
    deadline: deadline || null,
    gracePeriodTotal: gracePeriodTotal || null,
    videoLocked: videoLocked || false,
    challenge: challenge || null,
    requirements: normalizedRequirements,
    activeUserCount: Number.isFinite(activeUserCount) ? Math.max(0, Math.round(activeUserCount)) : null,
    rows,
    metRows
  };
}

/**
 * React hook: joins governance decisions with participant display data.
 * Replaces useGovernanceOverlay + warningOffenders + lockRows.
 */
export function useGovernanceDisplay(govState, displayMap, zoneMeta, options) {
  const preferGroupLabels = options?.preferGroupLabels ?? false;
  return useMemo(
    () => resolveGovernanceDisplay(govState, displayMap, zoneMeta, { preferGroupLabels }),
    [govState, displayMap, zoneMeta, preferGroupLabels]
  );
}
