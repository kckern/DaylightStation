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

const finiteOrNull = (value) => (Number.isFinite(value) ? value : null);

/**
 * One rule's standing for the lock header: how many more riders it needs, and
 * whether it asks for everyone it counts ('all') or only some of them ('any').
 */
function summarizeObligation(obligation) {
  const requiredCount = finiteOrNull(obligation.requiredCount);
  const actualCount = finiteOrNull(obligation.actualCount) ?? 0;
  return {
    key: obligation.key, zone: obligation.zone, zoneLabel: obligation.zoneLabel, zoneColor: obligation.zoneColor,
    // 'zone', 'cadence_floor', 'activity_rate', or a challenge's type: hosts
    // keep step-mat rules out of zone chips and zone wording.
    type: (obligation.requirement || obligation.challenge)?.type || 'zone',
    requiredCount, actualCount,
    needed: Math.max(0, (requiredCount ?? 0) - actualCount),
    scope: requiredCount != null && requiredCount > 0 && requiredCount === obligation.eligibleCount ? 'all' : 'any',
  };
}

/**
 * The per-rule rows regrouped per rider: a rider missing two rules is one
 * entry with two goals, each a BPM target in that rule's zone. Riders are
 * ordered by their highest unmet zone, then name; goals by target BPM.
 */
export function groupRidersByGoal(obligations, rankOf = () => -1) {
  const byKey = new Map();
  for (const obligation of obligations) {
    for (const row of obligation.rows) {
      let rider = byKey.get(row.key);
      if (!rider) {
        rider = {
          key: row.key, userId: row.userId, displayName: row.displayName, avatarSrc: row.avatarSrc,
          heartRate: row.heartRate, currentZone: row.currentZone, zoneSequence: row.zoneSequence,
          groupLabel: row.groupLabel, goals: [],
        };
        byKey.set(row.key, rider);
      }
      const targetHeartRate = finiteOrNull(row.targetHeartRate);
      rider.goals.push({
        obligationKey: obligation.key,
        zone: row.targetZone?.id || obligation.zone || null,
        zoneLabel: obligation.zoneLabel || row.targetZone?.name || null,
        zoneColor: row.targetZone?.color || obligation.zoneColor || null,
        targetZone: row.targetZone, targetHeartRate,
        bpmToGo: targetHeartRate != null && Number.isFinite(row.heartRate) ? Math.max(0, Math.round(targetHeartRate - row.heartRate)) : null,
        holdProgress: row.holdProgress, holdPaused: row.holdPaused, status: row.status, pedal: row.pedal,
      });
    }
  }
  const topRank = (rider) => Math.max(-1, ...rider.goals.map((goal) => rankOf(goal.zone)));
  const riders = [...byKey.values()];
  riders.forEach((rider) => rider.goals.sort((a, b) => (a.targetHeartRate ?? Infinity) - (b.targetHeartRate ?? Infinity)));
  return riders.sort((a, b) => (topRank(b) - topRank(a))
    || String(a.displayName || '').localeCompare(String(b.displayName || '')));
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
  // A chip's zone colour and progress follow the BPM it prints — the display
  // record (lib/displayZone.js) — so it matches the rider's card. WHO is listed
  // as missing or met stays the engine's decision on the committed zone.
  const currentZoneOf = (display) => {
    if (display?.display) return zoneMap[display.display.zoneId] || null;
    return display?.zoneTrusted === false ? null : (zoneMap[display?.zoneId] || null);
  };

  // Subjects a rule is waiting on who have no heart-rate reading: they cannot
  // be given a target, but they must not vanish from the lock screen either.
  const noSignalById = new Map();
  const noteNoSignal = (key, userId, display) => {
    if (noSignalById.has(key)) return;
    noSignalById.set(key, { userId, displayName: nameOf(display, userId), avatarSrc: display?.avatarSrc || FALLBACK_AVATAR });
  };

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
      if (credited.has(key)) continue;
      const display = displayMap.get(key);
      if (hrInactiveSet.has(key)) { noteNoSignal(key, userId, display); continue; }
      // Preserve the existing signal-loss filter while allowing roster startup
      // fallback names when the display map has not populated yet.
      if (display && (display.heartRate == null || display.heartRate <= 0)) { noteNoSignal(key, userId, display); continue; }
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
        // The engine freezes holds while the challenge is paused; the bar must too.
        holdPaused: source === 'challenge' ? Boolean(requirement.paused) : false,
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
    // Everyone the rule counts: the subjects still missing plus those credited.
    const eligibleCount = new Set([...missing, ...credited]).size;
    return {
      key: `${source}:${requirement.id || index}`, source, zone: targetId || null,
      zoneColor: targetZone?.color || null, eligibleCount,
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
  const riders = groupRidersByGoal(obligations, rankOf);
  const noSignal = [...noSignalById.entries()]
    .filter(([key]) => !riders.some((r) => r.key === key))
    .map(([, entry]) => entry);
  const summary = obligations.map(summarizeObligation);
  const activityRequirements = floors.filter((req) => req.type === 'activity_rate');
  const cycleLocked = lockingChallenge?.type === 'cycle';
  const cycleHealthLock = cycleLocked && lockingChallenge.lockReason === 'health';
  const show = cycleHealthLock ? false : Boolean(selected?.rows.length || activityRequirements.length
    || cycleLocked || govState.status === 'locked' || govState.status === 'pending');
  // `unlocked` with an unmet floor only happens inside warning_cooldown_seconds.
  const quiet = show && govState.status === 'unlocked' && !lockingChallenge && obligations.length > 0;
  return {
    show, quiet, status: govState.status,
    obligations, riders, noSignal, summary,
    zone: selected?.zone || null, zoneLabel: selected?.zoneLabel || null,
    requiredCount: selected?.requiredCount ?? null, actualCount: selected?.actualCount ?? null,
    rows: selected?.rows || [], metRows: selected?.metRows || [],
    requirements: selected?.requirement ? [selected.requirement] : [],
    // Every unmet step-mat floor, wherever it sorts among the obligations.
    activityRequirements,
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
