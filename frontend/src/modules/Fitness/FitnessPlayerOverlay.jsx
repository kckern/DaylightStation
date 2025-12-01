import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import { DaylightMediaPath } from '../../lib/api.mjs';
import { COOL_ZONE_PROGRESS_MARGIN, calculateZoneProgressTowardsTarget } from '../../hooks/useFitnessSession.js';
import { ChallengeOverlay, useChallengeOverlays } from './FitnessPlayerOverlay/ChallengeOverlay.jsx';
import GovernanceStateOverlay from './FitnessPlayerOverlay/GovernanceStateOverlay.jsx';
import VoiceMemoOverlay from './FitnessPlayerOverlay/VoiceMemoOverlay.jsx';
import FullscreenVitalsOverlay from './FitnessPlayerOverlay/FullscreenVitalsOverlay.jsx';

const slugifyId = (value, fallback = 'user') => {
  if (!value) return fallback;
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback;
};


export const useGovernanceOverlay = (governanceState) => useMemo(() => {
  if (!governanceState?.isGoverned) {
    return {
      category: null,
      status: null,
      show: false,
      filterClass: '',
      title: '',
      descriptions: [],
      requirements: [],
      highlightUsers: [],
      countdown: null,
      countdownTotal: null
    };
  }

  const rawStatus = typeof governanceState.status === 'string' ? governanceState.status.toLowerCase() : '';
  const normalizedStatus = rawStatus === 'green' ? 'green' : rawStatus === 'yellow' ? 'yellow' : rawStatus === 'red' ? 'red' : 'grey';
  const requirementSummaries = Array.isArray(governanceState.requirements) ? governanceState.requirements : [];
  const watchers = Array.isArray(governanceState.watchers) ? governanceState.watchers : [];
  const challengeLocked = Boolean(governanceState.videoLocked);
  const challenge = governanceState.challenge;
  const challengeZoneLabel = challenge?.zoneLabel || challenge?.zone || 'Target zone';
  const challengeSelectionLabel = challenge?.selectionLabel || '';
  const challengeRequiredCount = Number.isFinite(challenge?.requiredCount) ? Math.max(0, challenge.requiredCount) : null;
  const challengeActualCount = Number.isFinite(challenge?.actualCount) ? Math.max(0, challenge.actualCount) : null;
  const challengeMissingUsers = Array.isArray(challenge?.missingUsers)
    ? challenge.missingUsers.filter(Boolean)
    : [];
  const challengeMetUsers = Array.isArray(challenge?.metUsers)
    ? challenge.metUsers.filter(Boolean)
    : [];
  const challengeRequirement = (() => {
    if (!challenge || challenge.status === 'success' || challenge.status === 'failed') return null;
    const baseZone = challengeZoneLabel || 'Target zone';
    let requirementText = '';
    if (challengeRequiredCount != null) {
      const noun = challengeRequiredCount === 1 ? 'person' : 'people';
      requirementText = `Need ${challengeRequiredCount} ${noun} ${baseZone.toLowerCase()}`;
    } else {
      requirementText = `Reach ${baseZone}`;
    }
    if (challengeSelectionLabel) {
      requirementText += ` • ${challengeSelectionLabel}`;
    }
    if (challengeRequiredCount != null && challengeActualCount != null) {
      requirementText += ` (${Math.min(challengeActualCount, challengeRequiredCount)}/${challengeRequiredCount})`;
    }
    return {
      zone: baseZone,
      zoneLabel: baseZone,
      rule: requirementText,
      ruleLabel: requirementText,
      satisfied: challengeActualCount != null && challengeRequiredCount != null
        ? challengeActualCount >= challengeRequiredCount
        : false,
      missingUsers: challengeMissingUsers,
      metUsers: challengeMetUsers,
      requiredCount: challengeRequiredCount,
      actualCount: challengeActualCount,
      selectionLabel: challengeSelectionLabel || ''
    };
  })();

  const cloneRequirement = (summary) => ({
    zone: summary?.zone || null,
    zoneLabel: summary?.zoneLabel || summary?.zone || 'Zone',
    rule: summary?.rule ?? null,
    ruleLabel: summary?.ruleLabel || String(summary?.rule ?? ''),
    satisfied: Boolean(summary?.satisfied),
    missingUsers: Array.isArray(summary?.missingUsers) ? summary.missingUsers.filter(Boolean) : [],
    metUsers: Array.isArray(summary?.metUsers) ? summary.metUsers.filter(Boolean) : [],
    requiredCount: Number.isFinite(summary?.requiredCount) ? summary.requiredCount : null,
    actualCount: Number.isFinite(summary?.actualCount) ? summary.actualCount : null
  });

  const unsatisfiedRaw = requirementSummaries.filter((rule) => rule && !rule.satisfied);
  const unsatisfied = unsatisfiedRaw.map(cloneRequirement);
  const missingUsers = Array.from(new Set(
    unsatisfied
      .flatMap((rule) => rule.missingUsers)
      .filter(Boolean)
  ));

  if (challengeLocked) {
    const zoneLabel = challengeZoneLabel;
    const requiredCount = challengeRequiredCount;
    const actualCount = challengeActualCount;
    const requirementLabel = requiredCount != null ? `${requiredCount} participant${requiredCount === 1 ? '' : 's'}` : 'Challenge requirement';
    const missingChallengeUsers = challengeMissingUsers.length ? challengeMissingUsers : missingUsers;
    const baseRequirementItems = unsatisfied;
    const challengeRequirementItem = zoneLabel
      ? {
        zone: challenge?.zone ? String(challenge.zone).toLowerCase() : zoneLabel,
        zoneLabel,
        rule: challenge?.rule ?? null,
        ruleLabel: requirementLabel,
        satisfied: false,
        missingUsers: missingChallengeUsers,
        metUsers: [],
        requiredCount,
        actualCount,
        selectionLabel: challengeSelectionLabel || ''
      }
      : null;
    const combinedRequirements = [
      ...(challengeRequirementItem ? [challengeRequirementItem] : []),
      ...baseRequirementItems
    ];
    const combinedMissingUsers = Array.from(new Set([...(missingChallengeUsers || []), ...missingUsers]));

    return {
      category: 'governance',
      status: 'red',
      show: true,
      filterClass: 'governance-filter-critical',
      title: 'Challenge Failed',
      descriptions: [
        'The last challenge was not completed in time.',
        zoneLabel ? `Goal: ${zoneLabel}${requiredCount != null ? ` (${requirementLabel})` : ''}` : null,
        actualCount != null && requiredCount != null ? `Achieved ${actualCount}/${requiredCount}` : null
      ].filter(Boolean),
      requirements: combinedRequirements,
      highlightUsers: combinedMissingUsers,
      countdown: null,
      countdownTotal: null
    };
  }

  if (normalizedStatus === 'green') {
    return {
      category: 'governance',
      status: 'green',
      show: false,
      filterClass: '',
      title: '',
      descriptions: [],
      requirements: [],
      highlightUsers: [],
      countdown: null,
      countdownTotal: null
    };
  }

  if (normalizedStatus === 'yellow') {
    const countdown = Number.isFinite(governanceState.countdownSecondsRemaining)
      ? governanceState.countdownSecondsRemaining
      : null;
    const countdownTotal = Number.isFinite(governanceState.gracePeriodTotal)
      ? Math.max(1, governanceState.gracePeriodTotal)
      : Number.isFinite(governanceState.countdownSecondsTotal)
        ? Math.max(1, governanceState.countdownSecondsTotal)
        : 30;
    const warningHighlights = Array.from(new Set([
      ...challengeMissingUsers,
      ...missingUsers
    ]));
    return {
      category: 'governance-warning-progress',
      status: 'yellow',
      show: true,
      filterClass: 'governance-filter-warning',
      title: '',
      descriptions: [],
      requirements: [],
      highlightUsers: warningHighlights,
      countdown,
      countdownTotal
    };
  }

  if (normalizedStatus === 'red') {
    return {
      category: 'governance',
      status: 'red',
      show: true,
      filterClass: 'governance-filter-critical',
      title: 'Video Locked',
      descriptions: [
        'Increase fitness effort to continue the video.',
        missingUsers.length || challengeMissingUsers.length ? 'Needs movement from highlighted participants.' : null,
        challengeRequirement
          ? `Goal: ${challengeRequirement.zone}${challengeRequiredCount != null ? ` (${challengeRequiredCount} ${challengeRequiredCount === 1 ? 'person' : 'people'})` : ''}`
          : null
      ].filter(Boolean),
      requirements: [
        ...(challengeRequirement ? [cloneRequirement(challengeRequirement)] : []),
        ...unsatisfied
      ],
      highlightUsers: Array.from(new Set([
        ...challengeMissingUsers,
        ...missingUsers
      ])),
      countdown: null,
      countdownTotal: null
    };
  }

  const greyDescriptions = [
    watchers.length ? null : 'Waiting for heart-rate participants to connect.',
    requirementSummaries.length ? 'Meet these conditions to unlock playback.' : 'Loading unlock rules...'
  ].filter(Boolean);

  const greyHighlightUsers = missingUsers;

  return {
    category: 'governance',
    status: 'grey',
    show: true,
    filterClass: '',
    title: 'Video Locked',
    descriptions: greyDescriptions,
    requirements: unsatisfied,
    highlightUsers: greyHighlightUsers,
    countdown: null,
    countdownTotal: null
  };
}, [governanceState]);

const FitnessPlayerOverlay = ({ overlay, playerRef, showFullscreenVitals }) => {
  const fitnessCtx = useFitnessContext();

  const voiceMemoOverlayState = fitnessCtx?.voiceMemoOverlayState;
  const voiceMemos = fitnessCtx?.voiceMemos || [];
  const voiceMemoOverlayOpen = Boolean(voiceMemoOverlayState?.open);
  const closeVoiceMemoOverlay = fitnessCtx?.closeVoiceMemoOverlay;
  const openVoiceMemoReview = fitnessCtx?.openVoiceMemoReview;
  const openVoiceMemoList = fitnessCtx?.openVoiceMemoList;
  const openVoiceMemoRedo = fitnessCtx?.openVoiceMemoRedo;
  const removeVoiceMemo = fitnessCtx?.removeVoiceMemoFromSession;
  const replaceVoiceMemo = fitnessCtx?.replaceVoiceMemoInSession;
  const preferredMicrophoneId = fitnessCtx?.preferredMicrophoneId || '';
  const sessionId = fitnessCtx?.fitnessSession?.sessionId
    || fitnessCtx?.fitnessSessionInstance?.sessionId
    || null;
  const governanceState = fitnessCtx?.governanceState || null;
  const { current: currentChallengeOverlay, upcoming: upcomingChallengeOverlay } = useChallengeOverlays(
    governanceState,
    fitnessCtx?.zones
  );
  const isGovernanceRed = overlay?.category === 'governance' && overlay.status === 'red';

  const zoneMetadata = useMemo(() => {
    const zoneList = Array.isArray(fitnessCtx?.zones) ? fitnessCtx.zones.filter(Boolean) : [];
    const ordered = zoneList.slice().sort((a, b) => (a?.min ?? 0) - (b?.min ?? 0));
    const map = {};
    const rank = {};
    ordered.forEach((zone, index) => {
      const id = zone?.id
        ? String(zone.id)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
        : null;
      if (!id) return;
      map[id] = {
        id,
        name: zone.name || zone.id || `Zone ${index + 1}`,
        color: zone.color || null,
        min: typeof zone.min === 'number' ? zone.min : null
      };
      rank[id] = index;
    });
    return { map, rank };
  }, [fitnessCtx?.zones]);

  const userZoneProgress = fitnessCtx?.userZoneProgress || null;
  const normalizeName = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
  const participants = Array.isArray(fitnessCtx?.participantRoster) ? fitnessCtx.participantRoster : [];
  const getUserVitals = fitnessCtx?.getUserVitals;
  const clamp01 = (value) => Math.max(0, Math.min(1, value));
  const normalizeZoneId = (value) => {
    if (!value) return null;
    return String(value)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-');
  };
  const resolveParticipantVitals = React.useCallback((candidateName, participant) => {
    const preferredName = candidateName || participant?.name || null;
    let canonicalVitals = null;
    if (preferredName && typeof getUserVitals === 'function') {
      canonicalVitals = getUserVitals(preferredName) || null;
    }
    const heartRate = Number.isFinite(canonicalVitals?.heartRate)
      ? Math.round(canonicalVitals.heartRate)
      : (Number.isFinite(participant?.heartRate) && participant.heartRate > 0
        ? Math.round(participant.heartRate)
        : null);
    const zoneId = normalizeZoneId(canonicalVitals?.zoneId) || normalizeZoneId(participant?.zoneId) || null;
    const zoneColor = canonicalVitals?.zoneColor || participant?.zoneColor || null;
    const zoneName = canonicalVitals?.zoneName || participant?.zoneLabel || null;
    const profileId = canonicalVitals?.profileId || participant?.profileId || (preferredName ? slugifyId(preferredName) : null);
    const displayLabel = canonicalVitals?.displayLabel
      || participant?.displayLabel
      || preferredName
      || 'Participant';
    return {
      name: preferredName,
      displayLabel,
      heartRate,
      zoneId,
      zoneColor,
      zoneName,
      profileId,
      canonical: canonicalVitals
    };
  }, [getUserVitals]);
  
  const progressLookup = userZoneProgress instanceof Map ? userZoneProgress : null;
  const getProgressEntry = (name) => {
    if (!name) return null;
    if (progressLookup) {
      return progressLookup.get(name) || null;
    }
    if (userZoneProgress && typeof userZoneProgress === 'object') {
      return userZoneProgress[name] || null;
    }
    return null;
  };

  const participantMap = useMemo(() => {
    const map = new Map();
    participants.forEach((participant) => {
      const key = normalizeName(participant?.name);
      if (!key || map.has(key)) return;
      map.set(key, participant);
    });
    return map;
  }, [participants]);

  const findZoneByLabel = (label) => {
    if (!label) return null;
    const normalized = label.trim().toLowerCase();
    const match = Object.values(zoneMetadata.map || {}).find((entry) =>
      entry?.name?.trim().toLowerCase() === normalized
    );
    return match || null;
  };

  const getParticipantZone = (participant, resolvedVitals = null) => {
    if (!participant && !resolvedVitals) return null;
    const zoneId = normalizeZoneId(resolvedVitals?.zoneId) || normalizeZoneId(participant?.zoneId);
    if (zoneId && zoneMetadata.map[zoneId]) {
      const base = zoneMetadata.map[zoneId];
      if (resolvedVitals?.zoneColor && !base.color) {
        return { ...base, color: resolvedVitals.zoneColor };
      }
      return base;
    }
    const zoneLabel = resolvedVitals?.zoneName || participant?.zoneLabel;
    if (zoneLabel) {
      const fallback = findZoneByLabel(zoneLabel) || {
        id: zoneId || slugifyId(zoneLabel),
        name: zoneLabel,
        color: resolvedVitals?.zoneColor || null,
        min: null
      };
      if (resolvedVitals?.zoneColor && fallback && !fallback.color) {
        return { ...fallback, color: resolvedVitals.zoneColor };
      }
      return fallback;
    }
    if (resolvedVitals?.zoneColor || resolvedVitals?.zoneId) {
      return {
        id: zoneId || null,
        name: zoneId || 'Zone',
        color: resolvedVitals?.zoneColor || null,
        min: null
      };
    }
    return null;
  };

  const warningOffenders = useMemo(() => {
    if (!overlay || overlay.category !== 'governance-warning-progress') {
      return [];
    }
    const highlightList = Array.isArray(overlay.highlightUsers)
      ? overlay.highlightUsers.filter(Boolean)
      : [];
    if (!highlightList.length) {
      return [];
    }
    const offenders = [];
    const seen = new Set();
    highlightList.forEach((rawName, idx) => {
      const normalized = normalizeName(rawName || String(idx));
      if (!normalized || seen.has(normalized)) return;
      seen.add(normalized);
      const participant = participantMap.get(normalized);
      const canonicalName = participant?.name || rawName || 'Participant';
      const vitals = resolveParticipantVitals(canonicalName, participant);
      const avatarSrc = participant?.avatarUrl
        ? participant.avatarUrl
        : vitals?.profileId
          ? DaylightMediaPath(`/media/img/users/${vitals.profileId}`)
          : participant?.profileId
            ? DaylightMediaPath(`/media/img/users/${participant.profileId}`)
            : DaylightMediaPath(`/media/img/users/${slugifyId(canonicalName)}`);
      const heartRate = vitals?.heartRate ?? null;
      const zoneInfo = getParticipantZone(participant, vitals);
      const displayLabel = vitals?.displayLabel || participant?.displayLabel || canonicalName;
      const progressEntry = (vitals?.name || participant?.name)
        ? getProgressEntry(vitals?.name || participant?.name)
        : null;
      const progressPercent = progressEntry && progressEntry.showBar && Number.isFinite(progressEntry.progress)
        ? clamp01(progressEntry.progress)
        : null;
      offenders.push({
        key: normalized,
        name: canonicalName,
        displayLabel,
        heartRate,
        avatarSrc,
        zoneId: zoneInfo?.id || null,
        zoneColor: zoneInfo?.color || null,
        progressPercent
      });
    });
    return offenders;
  }, [overlay, participantMap, zoneMetadata, userZoneProgress, resolveParticipantVitals]);

  const lockRows = useMemo(() => {
    if (!overlay || overlay.category !== 'governance' || !overlay.show) {
      return [];
    }
    const requirementList = Array.isArray(overlay.requirements) ? overlay.requirements.filter(Boolean) : [];
    if (requirementList.length === 0) {
      return [];
    }

    const buildProgressGradient = (currentZone, targetZone) => {
      const start = currentZone?.color || 'rgba(148, 163, 184, 0.6)';
      const end = targetZone?.color || 'rgba(34, 197, 94, 0.85)';
      return `linear-gradient(90deg, ${start}, ${end})`;
    };

    const computeProgressPercent = ({ heartRate, targetHeartRate, progressEntry, targetZoneId }) => {
      const clamp = (value) => Math.max(0, Math.min(1, value));
      if (progressEntry) {
        const progressSnapshot = {
          zoneSequence: Array.isArray(progressEntry.zoneSequence)
            ? progressEntry.zoneSequence
            : Array.isArray(progressEntry.orderedZones)
              ? progressEntry.orderedZones
              : null,
          currentZoneIndex: Number.isFinite(progressEntry.currentZoneIndex)
            ? progressEntry.currentZoneIndex
            : (Number.isFinite(progressEntry.zoneIndex) ? progressEntry.zoneIndex : null),
          currentHR: Number.isFinite(progressEntry.currentHR)
            ? progressEntry.currentHR
            : (Number.isFinite(heartRate) ? heartRate : null),
          heartRate: Number.isFinite(heartRate)
            ? heartRate
            : (Number.isFinite(progressEntry.currentHR) ? progressEntry.currentHR : null),
          rangeMin: progressEntry.rangeMin ?? null,
          rangeMax: progressEntry.rangeMax ?? null,
          progress: Number.isFinite(progressEntry.progress) ? progressEntry.progress : null,
          showBar: progressEntry.showBar ?? false,
          targetHeartRate: Number.isFinite(progressEntry.targetHeartRate)
            ? progressEntry.targetHeartRate
            : (Number.isFinite(targetHeartRate) ? targetHeartRate : null),
          currentZoneThreshold: progressEntry.currentZoneThreshold ?? null,
          nextZoneThreshold: progressEntry.nextZoneThreshold ?? null
        };
        const progressResult = calculateZoneProgressTowardsTarget({
          snapshot: progressSnapshot,
          targetZoneId,
          coolZoneMargin: COOL_ZONE_PROGRESS_MARGIN
        });
        if (progressResult && progressResult.progress != null) {
          return clamp(progressResult.progress);
        }
      }
      if (Number.isFinite(targetHeartRate) && targetHeartRate > 0) {
        const hrValue = Number.isFinite(heartRate)
          ? heartRate
          : Number.isFinite(progressEntry?.currentHR)
            ? progressEntry.currentHR
            : null;
        if (!Number.isFinite(hrValue)) {
          return null;
        }
        if (hrValue >= targetHeartRate) {
          return 1;
        }
        const floor = Math.max(0, targetHeartRate - COOL_ZONE_PROGRESS_MARGIN);
        const span = targetHeartRate - floor;
        if (span <= 0) {
          return hrValue >= targetHeartRate ? 1 : 0;
        }
        return clamp((hrValue - floor) / span);
      }
      if (progressEntry?.showBar && Number.isFinite(progressEntry?.progress)) {
        return clamp(progressEntry.progress);
      }
      return null;
    };

    const groupLabelMap = new Map();
    const resolveUserTargetThreshold = typeof fitnessCtx?.getUserZoneThreshold === 'function'
      ? fitnessCtx.getUserZoneThreshold
      : null;
    
    // Build groupLabel lookup from participantRoster (centralized source)
    participants.forEach((participant) => {
      if (!participant?.name) return;
      const key = normalizeName(participant.name);
      if (!key) return;
      if (participant.groupLabel) {
        groupLabelMap.set(key, participant.groupLabel);
      }
    });

    const topZoneId = participants.reduce((top, participant) => {
      const zoneId = participant?.zoneId
        ? String(participant.zoneId)
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
        : null;
      if (!zoneId || !(zoneId in zoneMetadata.rank)) return top;
      if (!top || zoneMetadata.rank[zoneId] > zoneMetadata.rank[top]) {
        return zoneId;
      }
      return top;
    }, null);
    const aggregateZone = topZoneId ? zoneMetadata.map[topZoneId] : null;

    const rows = [];
    const seen = new Set();
    let autoIndex = 0;

    const buildTargetInfo = (requirement) => {
      const zoneIdRaw = requirement?.zone ? String(requirement.zone) : null;
      const zoneId = zoneIdRaw
        ? zoneIdRaw
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
        : null;
      let zoneInfo = zoneId && zoneMetadata.map[zoneId]
        ? zoneMetadata.map[zoneId]
        : null;
      if (!zoneInfo && requirement?.zoneLabel) {
        zoneInfo = findZoneByLabel(requirement.zoneLabel)
          || {
            id: zoneId || slugifyId(requirement.zoneLabel),
            name: requirement.zoneLabel,
            color: null,
            min: null
          };
      }
      if (zoneInfo?.id) {
        const normalizedId = String(zoneInfo.id).toLowerCase();
        if (zoneInfo.id !== normalizedId) {
          zoneInfo = { ...zoneInfo, id: normalizedId };
        }
      }
      const label = requirement?.zoneLabel
        || zoneInfo?.name
        || requirement?.ruleLabel
        || 'Target';
      const targetBpm = Number.isFinite(requirement?.threshold)
        ? requirement.threshold
        : (Number.isFinite(zoneInfo?.min) ? zoneInfo.min : null);
      return {
        zoneInfo,
        label,
        targetBpm
      };
    };

    const ensureAvatarSrc = (name, participant, vitals) => {
      if (participant?.avatarUrl) return participant.avatarUrl;
      const profileId = vitals?.profileId || participant?.profileId || (name ? slugifyId(name) : 'user');
      return DaylightMediaPath(`/media/img/users/${profileId}`);
    };

    const addRow = ({ name, groupLabel, participant, target, isGeneric = false, overrides = {} }) => {
      if (!target) return;
      const keyBase = isGeneric ? `anyone-${target.label}` : normalizeName(name);
      const cacheKey = `${keyBase || 'unknown'}-${target.label}`;
      if (seen.has(cacheKey)) return;
      seen.add(cacheKey);
      autoIndex += 1;
      const canonicalName = name || (isGeneric ? 'Anyone' : 'Unknown');
      const resolvedParticipant = participant || (participantMap.get(normalizeName(name)) || null);
      const resolvedVitals = (!isGeneric && (canonicalName || resolvedParticipant))
        ? resolveParticipantVitals(canonicalName, resolvedParticipant)
        : null;
      const resolvedGroup = isGeneric
        ? (groupLabel || 'Any participant')
        : (groupLabel
          || groupLabelMap.get(normalizeName(name))
          || resolvedParticipant?.source
          || null);
      const currentZone = overrides.currentZone !== undefined
        ? overrides.currentZone
        : (isGeneric ? (aggregateZone || null) : getParticipantZone(resolvedParticipant, resolvedVitals));
      const heartRate = overrides.heartRate !== undefined
        ? overrides.heartRate
        : (resolvedVitals?.heartRate ?? null);
      const progressEntry = overrides.progressEntry !== undefined
        ? overrides.progressEntry
        : (!isGeneric
          ? (() => {
            const progressLookupName = resolvedVitals?.canonical?.name
              || resolvedVitals?.name
              || resolvedParticipant?.name
              || canonicalName
              || null;
            return progressLookupName ? getProgressEntry(progressLookupName) : null;
          })()
          : null);
      const targetZoneId = target?.zoneInfo?.id ? String(target.zoneInfo.id).toLowerCase() : null;
      const userTargetOverride = (!isGeneric && targetZoneId && resolveUserTargetThreshold)
        ? resolveUserTargetThreshold(canonicalName, targetZoneId)
        : null;
      const targetHeartRate = (() => {
        if (overrides.targetBpm !== undefined && overrides.targetBpm != null && Number.isFinite(overrides.targetBpm)) {
          return Math.round(overrides.targetBpm);
        }
        if (Number.isFinite(userTargetOverride)) {
          return Math.round(userTargetOverride);
        }
        if (Number.isFinite(target?.targetBpm)) {
          return Math.round(target.targetBpm);
        }
        if (Number.isFinite(target?.zoneInfo?.min)) {
          return Math.round(target.zoneInfo.min);
        }
        if (Number.isFinite(progressEntry?.targetHeartRate)) {
          return Math.round(progressEntry.targetHeartRate);
        }
        if (Number.isFinite(progressEntry?.rangeMax) && progressEntry.rangeMax > 0) {
          return Math.round(progressEntry.rangeMax);
        }
        return null;
      })();
      const progressPercent = overrides.progressPercent !== undefined
        ? overrides.progressPercent
        : computeProgressPercent({
          heartRate,
          targetHeartRate,
          progressEntry,
          targetZoneId
        });
      const rowDisplayLabel = overrides.displayLabel
        || resolvedVitals?.displayLabel
        || resolvedParticipant?.displayLabel
        || canonicalName;
      rows.push({
        key: `${cacheKey}-${autoIndex}`,
        name: canonicalName,
        displayLabel: rowDisplayLabel,
        groupLabel: resolvedGroup,
        avatarSrc: isGeneric
          ? DaylightMediaPath('/media/img/users/user')
          : ensureAvatarSrc(canonicalName, resolvedParticipant, resolvedVitals),
        isGeneric,
        currentZone,
        targetZone: target.zoneInfo || null,
        targetLabel: target.label || 'Target',
        currentLabel: currentZone?.name || 'No signal',
        heartRate,
        targetHeartRate,
        progressPercent,
        progressGradient: overrides.progressGradient !== undefined
          ? overrides.progressGradient
          : (progressPercent != null ? buildProgressGradient(currentZone, target.zoneInfo || null) : null)
      });
    };

    requirementList.forEach((requirement) => {
      const target = buildTargetInfo(requirement);
      if (!target) return;
      const missing = Array.isArray(requirement?.missingUsers)
        ? requirement.missingUsers.filter(Boolean)
        : [];
      const requiresAny = Number.isFinite(requirement?.requiredCount) && Number(requirement.requiredCount) === 1;
      if (requiresAny) {
        const namedParticipants = participants.filter((participant) => participant?.name);
        if (namedParticipants.length === 1) {
          addRow({ name: namedParticipants[0].name, participant: namedParticipants[0], target });
          return;
        }

        const candidateNames = missing.length ? missing : namedParticipants.map((p) => p.name).filter(Boolean);
        const candidateParticipants = candidateNames
          .map((name) => participantMap.get(normalizeName(name)))
          .filter(Boolean);
        const fallbacks = candidateParticipants.length ? candidateParticipants : namedParticipants;

        let highestHrValue = null;
        fallbacks.forEach((participant) => {
          const vitals = resolveParticipantVitals(participant?.name, participant);
          const hr = vitals?.heartRate ?? null;
          if (hr == null) return;
          if (highestHrValue == null || hr > highestHrValue) {
            highestHrValue = hr;
          }
        });

        let bestProgressPercent = null;
        let bestProgressZone = null;
        fallbacks.forEach((participant) => {
          if (!participant?.name) return;
          const vitals = resolveParticipantVitals(participant.name, participant);
          const entry = getProgressEntry(participant.name);
          const percent = computeProgressPercent({
            heartRate: vitals?.heartRate ?? null,
            targetHeartRate: Number.isFinite(target?.targetBpm) ? target.targetBpm : null,
            progressEntry: entry,
            targetZoneId: target?.zoneInfo?.id || null
          });
          if (percent == null) return;
          if (bestProgressPercent == null || percent > bestProgressPercent) {
            bestProgressPercent = percent;
            bestProgressZone = getParticipantZone(participant, vitals);
          }
        });

        addRow({
          name: 'Anyone',
          target,
          isGeneric: true,
          overrides: {
            heartRate: highestHrValue != null ? highestHrValue : undefined,
            currentZone: bestProgressZone || undefined,
            progressPercent: bestProgressPercent,
            progressGradient: bestProgressPercent != null
              ? buildProgressGradient(bestProgressZone || aggregateZone || null, target.zoneInfo || null)
              : undefined,
            targetBpm: Number.isFinite(target?.targetBpm) ? target.targetBpm : undefined
          }
        });
        return;
      }
      if (!missing.length) {
        return;
      }
      missing.forEach((userName) => {
        const participant = participantMap.get(normalizeName(userName));
        addRow({
          name: userName,
          participant,
          target
        });
      });
    });

    return rows;
  }, [overlay, participants, fitnessCtx?.usersConfigRaw, zoneMetadata, userZoneProgress, participantMap, resolveParticipantVitals, fitnessCtx?.getUserZoneThreshold]);

  const challengeOverlay = currentChallengeOverlay?.show && !isGovernanceRed
    ? <ChallengeOverlay overlay={currentChallengeOverlay} />
    : null;
  const nextChallengeOverlay = upcomingChallengeOverlay?.show && !isGovernanceRed
    ? <ChallengeOverlay overlay={upcomingChallengeOverlay} />
    : null;
  const primaryOverlay = overlay?.show ? (
    <GovernanceStateOverlay
      overlay={overlay}
      lockRows={lockRows}
      warningOffenders={warningOffenders}
    />
  ) : null;

  const hasAnyOverlay = Boolean(
    primaryOverlay ||
    voiceMemoOverlayOpen ||
    challengeOverlay ||
    (!challengeOverlay && nextChallengeOverlay) ||
    showFullscreenVitals
  );

  if (!hasAnyOverlay) {
    return null;
  }

  return (
    <>
      {challengeOverlay}
      {!challengeOverlay && nextChallengeOverlay}
      {primaryOverlay}
      {voiceMemoOverlayOpen ? (
        <VoiceMemoOverlay
          overlayState={voiceMemoOverlayState}
          voiceMemos={voiceMemos}
          onClose={closeVoiceMemoOverlay}
          onOpenReview={openVoiceMemoReview}
          onOpenList={openVoiceMemoList}
          onOpenRedo={openVoiceMemoRedo}
          onRemoveMemo={removeVoiceMemo}
          onReplaceMemo={replaceVoiceMemo}
          sessionId={sessionId}
          playerRef={playerRef}
          preferredMicrophoneId={preferredMicrophoneId}
        />
      ) : null}
      {showFullscreenVitals ? (
        <FullscreenVitalsOverlay visible={showFullscreenVitals} />
      ) : null}
    </>
  );
};

FitnessPlayerOverlay.propTypes = {
  overlay: PropTypes.shape({
    category: PropTypes.string,
    status: PropTypes.string,
    show: PropTypes.bool,
    filterClass: PropTypes.string,
    title: PropTypes.string,
    descriptions: PropTypes.arrayOf(PropTypes.string),
    requirements: PropTypes.arrayOf(PropTypes.shape({
      zone: PropTypes.string,
      zoneLabel: PropTypes.string,
      rule: PropTypes.string,
      ruleLabel: PropTypes.string,
      satisfied: PropTypes.bool,
      missingUsers: PropTypes.arrayOf(PropTypes.string),
      metUsers: PropTypes.arrayOf(PropTypes.string),
      requiredCount: PropTypes.number,
      actualCount: PropTypes.number
    })),
    highlightUsers: PropTypes.arrayOf(PropTypes.string),
    countdown: PropTypes.number,
    countdownTotal: PropTypes.number
  }),
  playerRef: PropTypes.shape({
    current: PropTypes.any
  }),
  showFullscreenVitals: PropTypes.bool
};

export default FitnessPlayerOverlay;
