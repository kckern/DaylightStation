import { useMemo } from 'react';

const FALLBACK_AVATAR = '/static/img/users/user';
const normalize = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

/**
 * Pure function: resolve governance decisions + display map → display rows.
 * Exported for testability. Used via useGovernanceDisplay hook.
 */
export function resolveGovernanceDisplay(govState, displayMap, zoneMeta, options) {
  const preferGroupLabels = options?.preferGroupLabels ?? false;
  if (!govState?.isGoverned) return null;

  const { status, requirements, challenge, deadline, gracePeriodTotal, videoLocked } = govState;

  if (status === 'unlocked') {
    return { show: false, status, rows: [] };
  }

  // Collect all (userId, targetZoneId) pairs from unsatisfied requirements + active challenge
  const userTargets = new Map(); // userId → targetZoneId (highest severity wins)
  const zoneMap = zoneMeta?.map || {};
  const rankOf = (zoneId) => zoneMap[zoneId]?.rank ?? -1;

  // Base requirements
  (requirements || []).forEach((req) => {
    if (req.satisfied) return;
    const targetZoneId = req.zone || null;
    (req.missingUsers || []).forEach((userId) => {
      const key = normalize(userId);
      const existing = userTargets.get(key);
      if (!existing || rankOf(targetZoneId) > rankOf(existing.targetZoneId)) {
        userTargets.set(key, { userId, targetZoneId });
      }
    });
  });

  // Challenge requirements (if active and has missing users)
  if (challenge && challenge.status === 'active' && Array.isArray(challenge.missingUsers)) {
    const targetZoneId = challenge.zone || null;
    challenge.missingUsers.forEach((userId) => {
      const key = normalize(userId);
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
      zoneSequence: display?.zoneSequence || [],
      progress: display?.progress ?? null,
      targetHeartRate: display?.targetHeartRate ?? null,
      groupLabel: display?.groupLabel || null
    });
  }

  // Sort by severity (highest target zone first)
  rows.sort((a, b) => rankOf(b.targetZone?.id) - rankOf(a.targetZone?.id));

  const show = rows.length > 0 || status === 'locked' || status === 'pending';

  return {
    show,
    status,
    deadline: deadline || null,
    gracePeriodTotal: gracePeriodTotal || null,
    videoLocked: videoLocked || false,
    challenge: challenge || null,
    rows
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
