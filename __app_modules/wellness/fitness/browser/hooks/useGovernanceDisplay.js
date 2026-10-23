import { useMemo } from 'react';
import { DaylightMediaPath } from "../../../../../frontend/src/lib/api.mjs";
import { calculateZoneProgressTowardsTarget } from "./fitness/types.js";

const FALLBACK_AVATAR = DaylightMediaPath('/static/img/users/user');
const normalize = (v) => (typeof v === 'string' ? v.trim().toLowerCase() : '');

// A floor suspension backgrounds a challenge. A playback pause only freezes
// its clock: the challenge still owns its lock and its rows.
const isBackgrounded = (challenge) => challenge?.pauseReason === 'floor_unmet';

const isLiveZoneChallenge = (challenge) => Boolean(challenge
  && challenge.type !== 'cycle'
  && !isBackgrounded(challenge)
  && (challenge.status === 'pending' || challenge.status === 'failed'));

/**
 * Per-participant governance status beyond met/missing, keyed by normalized id:
 * - 'reach-start' / 'start-overdue': an unattended child who has not yet reached
 *   the startup zone once (D3), inside or past the 120s window.
 * - 'holding': a rider in the challenge zone whose hold has not completed (D5).
 * The start state wins over holding: it is the standing instruction.
 * Pure; exported for the roster surfaces that do not consume the full display.
 */
export function resolveParticipantGovernanceStatuses(govState) {
  const statuses = {};
  if (!govState?.isGoverned) return statuses;
  const challenge = govState?.challenge;
  if (isLiveZoneChallenge(challenge) && Array.isArray(challenge.holding)) {
    const zoneLabel = challenge.zoneLabel || challenge.zone || null;
    challenge.holding.forEach((userId) => {
      const key = normalize(userId);
      if (!key) return;
      statuses[key] = {
        status: 'holding',
        zoneLabel,
        remainingMs: challenge.holdProgressByUser?.[userId]?.remainingMs ?? null
      };
    });
  }
  const start = govState?.unattendedStart;
  if (start && start.children && typeof start.children === 'object') {
    const zoneLabel = start.zoneLabel || start.zone || null;
    Object.entries(start.children).forEach(([userId, child]) => {
      const key = normalize(userId);
      if (!key || !child || child.started) return;
      statuses[key] = {
        status: child.overdue ? 'start-overdue' : 'reach-start',
        zoneLabel,
        remainingMs: Number.isFinite(child.remainingMs) ? child.remainingMs : 0
      };
    });
  }
  return statuses;
}

/**
 * Pure function: resolve governance decisions + display map → display rows.
 * Exported for testability. Used via useGovernanceDisplay hook.
 */
export function resolveGovernanceDisplay(govState, displayMap = new Map(), zoneMeta, options) {
  if (!govState?.isGoverned) return null;
  const preferGroupLabels = options?.preferGroupLabels ?? false;
  const zoneMap = zoneMeta?.map || {};
  const rankOf = (zoneId) => zoneMap[zoneId]?.rank ?? -1;
  const requirements = Array.isArray(govState.requirements) ? govState.requirements : [];
  const floors = requirements.filter((req) => req && !req.satisfied)
    .sort((a, b) => rankOf(b.zone || b.orZone) - rankOf(a.zone || a.orZone));
  const rawChallenge = govState.challenge;
  const availableChallenge = !floors.length && rawChallenge && !isBackgrounded(rawChallenge)
    && !rawChallenge.sensorUnavailable ? rawChallenge : null;
  const lockingChallenge = availableChallenge && (availableChallenge.status === 'failed'
    || (availableChallenge.type === 'cycle' && availableChallenge.cycleState === 'locked'))
    ? availableChallenge : null;
  const participantStatuses = resolveParticipantGovernanceStatuses({
    ...govState, challenge: floors.length ? null : availableChallenge,
  });
  const hrInactiveSet = new Set((govState.hrInactiveUsers || []).map(normalize));
  const nameOf = (display, userId) => (preferGroupLabels && display?.groupLabel)
    ? display.groupLabel : (display?.displayName || userId);
  const currentZoneOf = (display) => display?.zoneTrusted === false ? null : (zoneMap[display?.zoneId] || null);

  const makeObligation = (requirement, source, index) => {
    const targetId = requirement.type === 'cadence_floor' ? requirement.orZone : requirement.zone;
    const targetZone = zoneMap[targetId] || null;
    const credited = new Set((source === 'requirement'
      ? (requirement.eligibleMetUsers || requirement.metUsers || [])
      : (requirement.metUsers || [])).map(normalize));
    const missing = new Set((requirement.missingUsers || []).map(normalize));
    const holding = new Set((source === 'challenge' ? requirement.holding || [] : []).map(normalize));
    const rows = [];
    for (const userId of requirement.missingUsers || []) {
      const key = normalize(userId);
      if (credited.has(key) || hrInactiveSet.has(key)) continue;
      const display = displayMap.get(key);
      // Preserve the existing signal-loss filter while allowing roster startup
      // fallback names when the display map has not populated yet.
      if (display && (display.heartRate == null || display.heartRate <= 0)) continue;
      const currentZone = currentZoneOf(display);
      const zoneSequence = display?.zoneSequence || [];
      const currentZoneIndex = zoneSequence.findIndex((zone) => zone.id === currentZone?.id);
      const targetResult = zoneSequence.length && currentZoneIndex >= 0 && targetId
        ? calculateZoneProgressTowardsTarget({ snapshot: {
          zoneSequence, currentZoneIndex, heartRate: display?.heartRate ?? 0,
        }, targetZoneId: targetId }) : null;
      const personalTarget = zoneSequence.find((zone) => zone.id === targetId)?.threshold;
      const status = holding.has(key) ? 'holding'
        : (participantStatuses[key]?.status === 'start-overdue' ? 'start-overdue' : 'missing');
      rows.push({
        key, userId, status,
        statusZoneLabel: status === 'holding' ? (requirement.zoneLabel || targetId)
          : (status === 'start-overdue' ? participantStatuses[key]?.zoneLabel : null),
        displayName: nameOf(display, userId), avatarSrc: display?.avatarSrc || FALLBACK_AVATAR,
        heartRate: display?.heartRate ?? null, currentZone, targetZone, zoneSequence,
        progress: currentZone ? (targetResult?.progress ?? display?.progress ?? null) : null,
        intermediateZones: targetResult?.intermediateZones || [],
        targetHeartRate: Number.isFinite(personalTarget) ? personalTarget
          : (targetResult?.rangeMax ?? (zoneSequence.length ? null : display?.targetHeartRate ?? null)),
        holdProgress: source === 'challenge' ? (requirement.holdProgressByUser?.[userId] || null) : null,
        groupLabel: display?.groupLabel || null,
        pedal: requirement.type === 'cadence_floor' ? {
          rpm: Math.max(0, Math.round(Number(requirement.currentRate) || 0)),
          targetRpm: Number.isFinite(requirement.targetRate) ? requirement.targetRate : null,
          orZoneLabel: requirement.orZoneLabel || null,
        } : null,
      });
    }
    const metRows = [];
    for (const key of credited) {
      if (missing.has(key)) continue;
      const display = displayMap.get(key);
      metRows.push({ key, userId: key, displayName: nameOf(display, key), avatarSrc: display?.avatarSrc || FALLBACK_AVATAR,
        heartRate: display?.heartRate ?? null, currentZone: currentZoneOf(display), groupLabel: display?.groupLabel || null });
    }
    return {
      key: `${source}:${requirement.id || index}`, source, zone: targetId || null,
      zoneLabel: requirement.zoneLabel || requirement.orZoneLabel || targetZone?.name || targetId || null,
      requiredCount: requirement.requiredCount ?? null, actualCount: requirement.actualCount ?? null,
      rows, metRows,
      // Keep the full scoped rule for activity/sensor presentation and legacy hosts.
      requirement: source === 'requirement' ? requirement : null,
      challenge: source === 'challenge' ? requirement : null,
    };
  };
  const obligations = floors.map((req, index) => makeObligation(req, 'requirement', index));
  if (!floors.length && lockingChallenge) obligations.push(makeObligation(lockingChallenge, 'challenge', 0));
  const selected = obligations[0] || null;
  const activityRequirements = floors.filter((req) => req.type === 'activity_rate');
  const cycleLocked = lockingChallenge?.type === 'cycle';
  const cycleHealthLock = cycleLocked && lockingChallenge.lockReason === 'health';
  const show = cycleHealthLock ? false : Boolean(selected?.rows.length || activityRequirements.length
    || cycleLocked || govState.status === 'locked' || govState.status === 'pending');
  return {
    show, status: govState.status,
    obligations,
    zone: selected?.zone || null, zoneLabel: selected?.zoneLabel || null,
    requiredCount: selected?.requiredCount ?? null, actualCount: selected?.actualCount ?? null,
    rows: selected?.rows || [], metRows: selected?.metRows || [],
    requirements: selected?.requirement ? [selected.requirement] : [],
    activityRequirements: selected?.requirement?.type === 'activity_rate' ? [selected.requirement] : [],
    challenge: lockingChallenge || null,
    deadline: govState.deadline ?? null, gracePeriodTotal: govState.gracePeriodTotal ?? null,
    videoLocked: cycleHealthLock ? true : (cycleLocked ? false : Boolean(govState.videoLocked)),
    activeUserCount: Number.isFinite(govState.activeUserCount) ? Math.max(0, Math.round(govState.activeUserCount)) : null,
    participantStatuses,
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
