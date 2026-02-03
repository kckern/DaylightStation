import React, { useMemo, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import { DaylightMediaPath } from '../../lib/api.mjs';
import { useRenderProfiler } from '../../hooks/fitness/useRenderProfiler.js';
import { COOL_ZONE_PROGRESS_MARGIN, calculateZoneProgressTowardsTarget, normalizeZoneId as normalizeZoneIdForOverlay } from '../../hooks/useFitnessSession.js';
import { ChallengeOverlay, useChallengeOverlays } from './FitnessPlayerOverlay/ChallengeOverlay.jsx';
import GovernanceStateOverlay from './FitnessPlayerOverlay/GovernanceStateOverlay.jsx';
import { normalizeRequirements, compareSeverity } from '../../hooks/fitness/GovernanceEngine.js';
import FullscreenVitalsOverlay from './FitnessPlayerOverlay/FullscreenVitalsOverlay.jsx';
import FitnessPluginContainer from './FitnessPlugins/FitnessPluginContainer.jsx';
import './FitnessPlayerOverlay/FitnessAppOverlay.scss';

// Note: slugifyId has been removed - we now use explicit IDs from config

const normalizeChallengeStatusForLogging = (status) => {
  const normalized = typeof status === 'string' ? status.trim().toLowerCase() : '';
  if (normalized === 'success') return 'success';
  if (normalized === 'failed' || normalized === 'fail') return 'failed';
  if (normalized === 'pending' || normalized === 'active' || normalized === 'running') return 'pending';
  return normalized || 'pending';
};

const resolveChallengeIdentity = (challenge) => {
  if (!challenge) return null;
  return challenge.id || challenge.selectionLabel || challenge.zone || challenge.zoneLabel || null;
};

const buildChallengeEventPayload = (challenge, statusOverride = null) => {
  if (!challenge) return null;
  return {
    challengeId: resolveChallengeIdentity(challenge),
    status: statusOverride || normalizeChallengeStatusForLogging(challenge.status),
    title: challenge.zoneLabel || challenge.zone || challenge.title || '',
    zoneId: challenge.zone || null,
    zoneLabel: challenge.zoneLabel || null,
    selectionLabel: challenge.selectionLabel || null,
    requiredCount: Number.isFinite(challenge.requiredCount) ? challenge.requiredCount : null,
    actualCount: Number.isFinite(challenge.actualCount) ? challenge.actualCount : null,
    missingUsers: Array.isArray(challenge.missingUsers) ? challenge.missingUsers.filter(Boolean) : [],
    metUsers: Array.isArray(challenge.metUsers) ? challenge.metUsers.filter(Boolean) : [],
    totalSeconds: Number.isFinite(challenge.totalSeconds)
      ? Math.max(0, Math.round(challenge.totalSeconds))
      : (Number.isFinite(challenge.timeLimitSeconds) ? Math.max(0, Math.round(challenge.timeLimitSeconds)) : null)
  };
};


export const useGovernanceOverlay = (governanceState, participantRoster = []) => useMemo(() => {
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
      deadline: null,
      countdownTotal: null,
      allowGenericAny: false
    };
  }

  const rawStatus = typeof governanceState.status === 'string' ? governanceState.status.toLowerCase() : '';
  const normalizedStatus = rawStatus === 'unlocked' ? 'unlocked' : rawStatus === 'warning' ? 'warning' : rawStatus === 'locked' ? 'locked' : 'pending';
  const requirementSummaries = Array.isArray(governanceState.requirements) ? governanceState.requirements : [];
  const normalizedLockRows = Array.isArray(governanceState.lockRows) ? governanceState.lockRows : null;
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
  const metUsers = Array.from(new Set([
    ...challengeMetUsers,
    ...unsatisfied.flatMap((rule) => rule.metUsers || []).filter(Boolean)
  ]));

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
    const combinedRequirements = normalizeRequirements(
      [
        ...(challengeRequirementItem ? [challengeRequirementItem] : []),
        ...baseRequirementItems
      ],
      (a, b) => compareSeverity(a, b, { zoneRankMap: governanceState?.zoneRankMap || {} }),
      { zoneRankMap: governanceState?.zoneRankMap || {} }
    );
    const combinedMissingUsers = Array.from(new Set([...(missingChallengeUsers || []), ...missingUsers]));

    return {
      category: 'governance',
      status: 'locked',
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
      deadline: null,
      countdownTotal: null,
      allowGenericAny: challengeRequiredCount === 1
    };
  }

  if (normalizedStatus === 'unlocked') {
    return {
      category: 'governance',
      status: 'unlocked',
      show: false,
      filterClass: '',
      title: '',
      descriptions: [],
      requirements: [],
      highlightUsers: [],
      deadline: null,
      countdownTotal: null,
      allowGenericAny: false
    };
  }

  if (normalizedStatus === 'warning') {
    // Pass deadline timestamp instead of computed countdown - consumer uses useDeadlineCountdown
    const deadline = governanceState.deadline || null;
    const countdownTotal = Number.isFinite(governanceState.gracePeriodTotal)
      ? Math.max(1, governanceState.gracePeriodTotal)
      : Number.isFinite(governanceState.countdownSecondsTotal)
        ? Math.max(1, governanceState.countdownSecondsTotal)
        : 30;
    const warningHighlights = Array.from(new Set([
      ...challengeMissingUsers,
      ...missingUsers
    ])).filter((user) => !metUsers.includes(user));

    // Bug 04 fix: Don't show phantom warnings without offenders
    // Only display warning overlay if there are actual users to highlight
    if (warningHighlights.length === 0) {
      return {
        category: 'governance',
        status: 'warning',
        show: false,
        filterClass: 'governance-filter-warning',
        title: '',
        descriptions: [],
        requirements: [],
        highlightUsers: [],
        deadline,
        countdownTotal,
        allowGenericAny: false
      };
    }

    return {
      category: 'governance-warning-progress',
      status: 'warning',
      show: true,
      filterClass: 'governance-filter-warning',
      title: '',
      descriptions: [],
      requirements: [],
      highlightUsers: warningHighlights,
      deadline,
      countdownTotal,
      allowGenericAny: false
    };
  }

  if (normalizedStatus === 'locked') {
    return {
      category: 'governance',
      status: 'locked',
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
      requirements: normalizeRequirements(
        [
          ...(challengeRequirement ? [cloneRequirement(challengeRequirement)] : []),
          ...unsatisfied
        ],
        (a, b) => compareSeverity(a, b, { zoneRankMap: governanceState?.zoneRankMap || {} }),
        { zoneRankMap: governanceState?.zoneRankMap || {} }
      ),
      highlightUsers: Array.from(new Set([
        ...challengeMissingUsers,
        ...missingUsers
      ])),
      deadline: null,
      countdownTotal: null,
      allowGenericAny: false
    };
  }

  const pendingDescriptions = [
    (watchers.length || participantRoster.length) ? null : 'Waiting for heart-rate participants to connect.',
    requirementSummaries.length ? 'Meet these conditions to unlock playback.' : 'Loading unlock rules...'
  ].filter(Boolean);

  const pendingHighlightUsers = missingUsers;

  return {
    category: 'governance',
    status: 'pending',
    show: true,
    filterClass: '',
    title: 'Video Locked',
    descriptions: pendingDescriptions,
    requirements: normalizedLockRows || normalizeRequirements(
      unsatisfied,
      (a, b) => compareSeverity(a, b, { zoneRankMap: governanceState?.zoneRankMap || {} }),
      { zoneRankMap: governanceState?.zoneRankMap || {} }
    ),
    highlightUsers: pendingHighlightUsers,
    countdown: null,
    countdownTotal: null,
    allowGenericAny: false
  };
}, [governanceState, participantRoster]);

const FitnessPlayerOverlay = ({ overlay, playerRef, showFullscreenVitals }) => {
  useRenderProfiler('FitnessPlayerOverlay');
  const fitnessCtx = useFitnessContext();

  const voiceMemoOverlayState = fitnessCtx?.voiceMemoOverlayState;
  const voiceMemos = fitnessCtx?.voiceMemos || [];
  const voiceMemoOverlayOpen = Boolean(voiceMemoOverlayState?.open);
  const closeVoiceMemoOverlay = fitnessCtx?.closeVoiceMemoOverlay;
  const openVoiceMemoReview = fitnessCtx?.openVoiceMemoReview;
  const openVoiceMemoList = fitnessCtx?.openVoiceMemoList;
  const openVoiceMemoCapture = fitnessCtx?.openVoiceMemoCapture;
  const removeVoiceMemo = fitnessCtx?.removeVoiceMemoFromSession;
  const replaceVoiceMemo = fitnessCtx?.replaceVoiceMemoInSession;
  const addVoiceMemo = fitnessCtx?.addVoiceMemoToSession;
  const preferredMicrophoneId = fitnessCtx?.preferredMicrophoneId || '';
  const sessionId = fitnessCtx?.fitnessSession?.sessionId
    || fitnessCtx?.fitnessSessionInstance?.sessionId
    || null;
  const governanceState = fitnessCtx?.governanceState || null;
  const sessionInstance = fitnessCtx?.fitnessSessionInstance || null;
  const { current: currentChallengeOverlay, upcoming: upcomingChallengeOverlay } = useChallengeOverlays(
    governanceState,
    fitnessCtx?.zones
  );
  const isGovernanceLocked = overlay?.category === 'governance' && overlay.status === 'locked';
  const activeChallenge = governanceState?.challenge || null;
  const challengeEventRef = React.useRef({ id: null, status: null });
  const wasPlayingBeforeOverlayRef = React.useRef(false);

  // Pause video when voice memo overlay opens
  React.useEffect(() => {
    if (voiceMemoOverlayOpen && playerRef?.current) {
      const video = playerRef.current.getMediaElement?.() || playerRef.current;
      if (video && typeof video.pause === 'function') {
        wasPlayingBeforeOverlayRef.current = !video.paused;
        if (!video.paused) {
          video.pause();
        }
      }
      // Also pause music
      fitnessCtx?.pauseMusicPlayer?.();
    }
  }, [voiceMemoOverlayOpen, playerRef, fitnessCtx]);

  React.useEffect(() => {
    if (!sessionInstance || typeof sessionInstance.logEvent !== 'function') {
      return;
    }
    const tracker = challengeEventRef.current;
    if (!activeChallenge) {
      if (tracker.id) {
        sessionInstance.logEvent('challenge_end', {
          challengeId: tracker.id,
          result: 'cleared'
        });
      }
      challengeEventRef.current = { id: null, status: null };
      return;
    }
    const status = normalizeChallengeStatusForLogging(activeChallenge.status);
    const challengeId = resolveChallengeIdentity(activeChallenge);
    if (tracker.id && tracker.id !== challengeId) {
      sessionInstance.logEvent('challenge_end', {
        challengeId: tracker.id,
        result: 'replaced'
      });
    }
    if (status === 'pending') {
      if (tracker.id !== challengeId || tracker.status !== 'pending') {
        sessionInstance.logEvent('challenge_start', buildChallengeEventPayload(activeChallenge, 'pending'));
      }
      challengeEventRef.current = { id: challengeId, status };
      return;
    }
    if (status === 'success' || status === 'failed') {
      if (tracker.id !== challengeId || tracker.status !== status) {
        sessionInstance.logEvent('challenge_end', {
          ...buildChallengeEventPayload(activeChallenge, status),
          result: status
        });
      }
      challengeEventRef.current = { id: null, status };
      return;
    }
    challengeEventRef.current = { id: challengeId, status };
  }, [sessionInstance, activeChallenge]);

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
  // Use participantRoster from context (updated on version heartbeat), but also check
  // session roster directly as fallback for immediate data during initial render.
  // This eliminates the brief "Waiting for participants" flash when roster exists but
  // participantRoster hasn't updated yet.
  const contextRoster = Array.isArray(fitnessCtx?.participantRoster) ? fitnessCtx.participantRoster : [];
  const sessionRoster = fitnessCtx?.fitnessSessionInstance?.roster;
  const participants = contextRoster.length > 0 ? contextRoster : (Array.isArray(sessionRoster) ? sessionRoster : []);
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
    const profileId = canonicalVitals?.profileId || participant?.profileId || participant?.id;
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
  
  // Memoize progressLookup reference for stable getProgressEntry
  const progressLookup = useMemo(() => {
    return userZoneProgress instanceof Map ? userZoneProgress : null;
  }, [userZoneProgress]);

  // Stabilize getProgressEntry with useCallback
  const getProgressEntry = React.useCallback((name) => {
    if (!name) return null;
    if (progressLookup) {
      return progressLookup.get(name) || null;
    }
    if (userZoneProgress && typeof userZoneProgress === 'object') {
      return userZoneProgress[name] || null;
    }
    return null;
  }, [progressLookup, userZoneProgress]);

  const participantMap = useMemo(() => {
    const map = new Map();
    participants.forEach((participant) => {
      const key = normalizeName(participant?.name);
      if (!key || map.has(key)) return;
      map.set(key, participant);
    });
    return map;
  }, [participants]);

  // Stabilize findZoneByLabel with useCallback
  const findZoneByLabel = React.useCallback((label) => {
    if (!label) return null;
    const normalized = label.trim().toLowerCase();
    const match = Object.values(zoneMetadata.map || {}).find((entry) =>
      entry?.name?.trim().toLowerCase() === normalized
    );
    return match || null;
  }, [zoneMetadata.map]);

  // Stabilize getParticipantZone with useCallback
  const getParticipantZone = React.useCallback((participant, resolvedVitals = null) => {
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
        id: zoneId || normalizeZoneIdForOverlay(zoneLabel),
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
  }, [zoneMetadata.map, findZoneByLabel]);

  const computeGovernanceProgress = React.useCallback((heartRate, targetThreshold, margin = COOL_ZONE_PROGRESS_MARGIN) => {
    if (!Number.isFinite(targetThreshold) || !Number.isFinite(heartRate)) {
      return null;
    }
    if (heartRate >= targetThreshold) return 1;
    const floor = Math.max(0, targetThreshold - margin);
    const span = targetThreshold - floor;
    if (span <= 0) {
      return heartRate >= targetThreshold ? 1 : 0;
    }
    return Math.max(0, Math.min(1, (heartRate - floor) / span));
  }, []);

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
    const targetRequirement = Array.isArray(overlay.requirements) ? overlay.requirements.find(Boolean) : null;
    const targetThreshold = Number.isFinite(targetRequirement?.threshold) ? targetRequirement.threshold : null;
    const targetZoneId = targetRequirement?.zone || targetRequirement?.zoneLabel || null;
    const targetZoneColor = targetRequirement?.zoneColor || null;
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
          ? DaylightMediaPath(`/static/img/users/${vitals.profileId}`)
          : participant?.profileId
            ? DaylightMediaPath(`/static/img/users/${participant.profileId}`)
            : participant?.id
              ? DaylightMediaPath(`/static/img/users/${participant.id}`)
              : DaylightMediaPath(`/static/img/users/user`);
      const heartRate = vitals?.heartRate ?? null;
      const zoneInfo = getParticipantZone(participant, vitals);
      const displayLabel = vitals?.displayLabel || participant?.displayLabel || canonicalName;
        const progressEntry = (() => {
          const candidateNames = [
            vitals?.name,
            participant?.name,
            vitals?.canonical?.name,
            canonicalName,
            rawName
          ].filter(Boolean);
          for (const name of candidateNames) {
            const entry = getProgressEntry(name);
            if (entry) return entry;
          }
          return null;
        })();
        const progressPercent = (() => {
          // Prefer governance-target progress; fall back to zone progress entry
          const governanceProgress = computeGovernanceProgress(heartRate, targetThreshold);
          if (governanceProgress != null) return governanceProgress;
          if (progressEntry && Number.isFinite(progressEntry.progress)) {
            return clamp01(progressEntry.progress);
          }
          return null;
        })();
      offenders.push({
        key: normalized,
        name: canonicalName,
        displayLabel,
        heartRate,
        avatarSrc,
        zoneId: zoneInfo?.id || null,
          zoneColor: zoneInfo?.color || null,
          progressPercent,
          targetZoneId: targetZoneId || null,
          targetThreshold: targetThreshold,
          targetZoneColor: targetZoneColor || targetRequirement?.color || null
      });
    });
    return offenders;
    }, [overlay, participantMap, resolveParticipantVitals, getParticipantZone, getProgressEntry, computeGovernanceProgress]);

  const lockRows = useMemo(() => {
    if (!overlay || overlay.category !== 'governance' || !overlay.show) {
      return [];
    }
    const requirementList = Array.isArray(overlay.requirements) ? overlay.requirements.filter(Boolean) : [];
    
    // PHASE 6B FIX: When requirements are empty but participants exist,
    // show placeholder rows so UI doesn't display "Waiting for participant data..."
    // This covers the timing gap between participantRoster population and TreasureBox data arrival.
    // Once TreasureBox records HR data, GovernanceEngine will populate proper requirements.
    const hasParticipantsButNoRequirements = requirementList.length === 0 && participants.length > 0;
    
    if (requirementList.length === 0 && !hasParticipantsButNoRequirements) {
      return [];
    }
    const allowGenericAny = Boolean(overlay.allowGenericAny);
    const highlightList = Array.isArray(overlay.highlightUsers)
      ? overlay.highlightUsers.filter(Boolean)
      : [];

    const buildProgressGradient = (currentZone, targetZone, intermediateZones = []) => {
      const startColor = currentZone?.color || 'rgba(148, 163, 184, 0.6)';
      const endColor = targetZone?.color || 'rgba(34, 197, 94, 0.85)';

      // If no intermediate zones, use simple two-color gradient
      if (!intermediateZones || intermediateZones.length === 0) {
        return `linear-gradient(90deg, ${startColor}, ${endColor})`;
      }

      // Build multi-stop gradient with intermediate zone colors
      const stops = [`${startColor} 0%`];

      intermediateZones.forEach((zone) => {
        if (zone.color && Number.isFinite(zone.position)) {
          const positionPercent = Math.round(zone.position * 100);
          stops.push(`${zone.color} ${positionPercent}%`);
        }
      });

      stops.push(`${endColor} 100%`);

      return `linear-gradient(90deg, ${stops.join(', ')})`;
    };

    const computeProgressData = ({ heartRate, targetHeartRate, progressEntry, targetZoneId }) => {
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
          return {
            progress: clamp(progressResult.progress),
            intermediateZones: progressResult.intermediateZones || [],
            currentSegment: progressResult.currentSegment || 0,
            segmentsTotal: progressResult.segmentsTotal || 0
          };
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
          return { progress: 1, intermediateZones: [], currentSegment: 0, segmentsTotal: 0 };
        }
        const floor = Math.max(0, targetHeartRate - COOL_ZONE_PROGRESS_MARGIN);
        const span = targetHeartRate - floor;
        if (span <= 0) {
          const prog = hrValue >= targetHeartRate ? 1 : 0;
          return { progress: prog, intermediateZones: [], currentSegment: 0, segmentsTotal: 0 };
        }
        return { progress: clamp((hrValue - floor) / span), intermediateZones: [], currentSegment: 0, segmentsTotal: 0 };
      }
      if (progressEntry?.showBar && Number.isFinite(progressEntry?.progress)) {
        return { progress: clamp(progressEntry.progress), intermediateZones: [], currentSegment: 0, segmentsTotal: 0 };
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
            id: zoneId || normalizeZoneIdForOverlay(requirement.zoneLabel),
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
      // Defensive fallback chain: try multiple sources before showing generic "Target"
      const targetZoneId = requirement?.zone || requirement?.targetZoneId;
      const zoneFromMetadata = targetZoneId && zoneMetadata?.map?.[normalizeZoneId(targetZoneId)];

      const label = requirement?.zoneLabel
        || zoneInfo?.name
        || zoneFromMetadata?.name
        || requirement?.ruleLabel
        || (targetZoneId ? targetZoneId.charAt(0).toUpperCase() + targetZoneId.slice(1) : null)
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
      const profileId = vitals?.profileId || participant?.profileId || participant?.id || 'user';
      return DaylightMediaPath(`/static/img/users/${profileId}`);
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
          || (resolvedParticipant?.isGuest ? 'Guest' : null)
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
        // If this is an identity-only entry (no vitals yet), don't show zone minimums
        // as they aren't user-specific targets
        const isIdentityOnly = resolvedParticipant?._source === 'identity_only';
        if (isIdentityOnly) {
          return null; // Will show "--" in UI
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
      const progressData = overrides.progressPercent !== undefined
        ? { progress: overrides.progressPercent, intermediateZones: [], currentSegment: 0, segmentsTotal: 0 }
        : computeProgressData({
          heartRate,
          targetHeartRate,
          progressEntry,
          targetZoneId
        });
      const progressPercent = progressData?.progress ?? null;
      const intermediateZones = progressData?.intermediateZones || [];
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
          ? DaylightMediaPath('/static/img/users/user')
          : ensureAvatarSrc(canonicalName, resolvedParticipant, resolvedVitals),
        isGeneric,
        currentZone,
        targetZone: target.zoneInfo || null,
        targetLabel: target.label || 'Target',
        currentLabel: currentZone?.name || 'No signal',
        heartRate,
        targetHeartRate,
        progressPercent,
        intermediateZones,
        progressGradient: overrides.progressGradient !== undefined
          ? overrides.progressGradient
          : (progressPercent != null ? buildProgressGradient(currentZone, target.zoneInfo || null, intermediateZones) : null)
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
        if (!allowGenericAny) {
          const sourceNames = (missing.length ? missing : (highlightList.length ? highlightList : namedParticipants.map((p) => p.name)))
            .map((value) => (typeof value === 'string' ? value.trim() : String(value || '')).trim())
            .filter(Boolean);
          const uniqueNames = Array.from(new Set(sourceNames));
          const list = uniqueNames.length ? uniqueNames : namedParticipants.map((p) => p.name).filter(Boolean);
          const targets = list.length ? list : [];
          if (!targets.length && namedParticipants.length === 1) {
            addRow({ name: namedParticipants[0].name, participant: namedParticipants[0], target });
            return;
          }
          targets.forEach((userName) => {
            if (!userName) return;
            const participant = participantMap.get(normalizeName(userName));
            addRow({ name: userName, participant, target });
          });
          return;
        }
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
        let bestIntermediateZones = [];
        fallbacks.forEach((participant) => {
          if (!participant?.name) return;
          const vitals = resolveParticipantVitals(participant.name, participant);
          const entry = getProgressEntry(participant.name);
          const progressData = computeProgressData({
            heartRate: vitals?.heartRate ?? null,
            targetHeartRate: Number.isFinite(target?.targetBpm) ? target.targetBpm : null,
            progressEntry: entry,
            targetZoneId: target?.zoneInfo?.id || null
          });
          const percent = progressData?.progress ?? null;
          if (percent == null) return;
          if (bestProgressPercent == null || percent > bestProgressPercent) {
            bestProgressPercent = percent;
            bestProgressZone = getParticipantZone(participant, vitals);
            bestIntermediateZones = progressData?.intermediateZones || [];
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
              ? buildProgressGradient(bestProgressZone || aggregateZone || null, target.zoneInfo || null, bestIntermediateZones)
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

    // PHASE 6B FIX: If no rows were built from requirements but participants exist,
    // create placeholder rows showing participants are connected but awaiting HR data.
    // This provides visual feedback while TreasureBox populates.
    if (rows.length === 0 && hasParticipantsButNoRequirements) {
      const namedParticipants = participants.filter((p) => p?.name);
      const fallbackRequirement = overlay?.requirements?.find(Boolean)
        || (Array.isArray(governanceState?.requirements) ? governanceState.requirements.find(Boolean) : null)
        || governanceState?.challenge
        || null;
      const derivedTarget = fallbackRequirement ? buildTargetInfo(fallbackRequirement) : null;

      // When no fallback requirement, try to get zone from governance state's base policy
      const baseZoneId = !derivedTarget && governanceState?.baseZoneId
        ? normalizeZoneId(governanceState.baseZoneId)
        : null;
      const baseZoneInfo = baseZoneId ? zoneMetadata?.map?.[baseZoneId] : null;

      // Safely get first zone from metadata as final fallback
      const zoneMapKeys = zoneMetadata?.map ? Object.keys(zoneMetadata.map) : [];
      const firstZoneInfo = zoneMapKeys.length > 0 ? zoneMetadata.map[zoneMapKeys[0]] : null;

      const defaultTarget = derivedTarget || {
        zoneInfo: baseZoneInfo || aggregateZone || firstZoneInfo || null,
        label: baseZoneInfo?.name
          || fallbackRequirement?.zoneLabel
          || fallbackRequirement?.ruleLabel
          || zoneMetadata?.map?.[normalizeZoneId(fallbackRequirement?.zone)]?.name
          || (fallbackRequirement?.zone ? fallbackRequirement.zone.charAt(0).toUpperCase() + fallbackRequirement.zone.slice(1) : null)
          || aggregateZone?.name
          || 'Target',
        targetBpm: Number.isFinite(fallbackRequirement?.threshold)
          ? fallbackRequirement.threshold
          : null
      };
      namedParticipants.forEach((participant) => {
        const vitals = resolveParticipantVitals(participant.name, participant);
        const currentZone = getParticipantZone(participant, vitals);
        addRow({
          name: participant.name,
          participant,
          target: defaultTarget,
          overrides: {
            currentZone,
            heartRate: vitals?.heartRate ?? null,
            targetHeartRate: null,
            progressPercent: null,
            currentLabel: currentZone?.name || 'Connecting...'
          }
        });
      });
    }

    return rows;
  }, [overlay, participants, fitnessCtx?.usersConfigRaw, zoneMetadata, userZoneProgress, participantMap, resolveParticipantVitals, fitnessCtx?.getUserZoneThreshold, governanceState]);

  // BUG-001 DEBUG: Track changes to blocking users lists for SSOT debugging
  const prevWarningOffendersRef = useRef([]);
  const prevLockRowsRef = useRef([]);

  // Log warning screen blocking user changes
  useEffect(() => {
    const currentNames = warningOffenders.map(o => o.displayLabel || o.name).sort();
    const prevNames = prevWarningOffendersRef.current;
    const currentKey = currentNames.join(',');
    const prevKey = prevNames.join(',');
    
    if (currentKey !== prevKey && sessionInstance?.logEvent) {
      sessionInstance.logEvent('overlay.warning_offenders_changed', {
        previousUsers: prevNames,
        currentUsers: currentNames,
        addedUsers: currentNames.filter(n => !prevNames.includes(n)),
        removedUsers: prevNames.filter(n => !currentNames.includes(n)),
        phase: overlay?.status || null,
        category: overlay?.category || null
      });
    }
    prevWarningOffendersRef.current = currentNames;
  }, [warningOffenders, sessionInstance, overlay?.status, overlay?.category]);

  // Log lock screen blocking user changes
  useEffect(() => {
    const currentNames = lockRows.map(r => r.displayLabel || r.name).sort();
    const prevNames = prevLockRowsRef.current;
    const currentKey = currentNames.join(',');
    const prevKey = prevNames.join(',');
    
    if (currentKey !== prevKey && sessionInstance?.logEvent) {
      sessionInstance.logEvent('overlay.lock_rows_changed', {
        previousUsers: prevNames,
        currentUsers: currentNames,
        addedUsers: currentNames.filter(n => !prevNames.includes(n)),
        removedUsers: prevNames.filter(n => !currentNames.includes(n)),
        phase: overlay?.status || null,
        category: overlay?.category || null
      });
    }
    prevLockRowsRef.current = currentNames;
  }, [lockRows, sessionInstance, overlay?.status, overlay?.category]);

  const challengeOverlay = currentChallengeOverlay?.show && !isGovernanceLocked
    ? <ChallengeOverlay overlay={currentChallengeOverlay} />
    : null;
  const nextChallengeOverlay = upcomingChallengeOverlay?.show && !isGovernanceLocked
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
      {showFullscreenVitals ? (
        <FullscreenVitalsOverlay visible={showFullscreenVitals} />
      ) : null}
      {fitnessCtx.overlayApp && (
        <div className="fitness-app-overlay-wrapper">
          <FitnessPluginContainer
            pluginId={fitnessCtx.overlayApp.id}
            mode="overlay"
            config={fitnessCtx.overlayApp.config}
            onClose={() => fitnessCtx.closeApp(fitnessCtx.overlayApp.id)}
          />
        </div>
      )}
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
    countdownTotal: PropTypes.number,
    allowGenericAny: PropTypes.bool
  }),
  playerRef: PropTypes.shape({
    current: PropTypes.any
  }),
  showFullscreenVitals: PropTypes.bool
};

export default FitnessPlayerOverlay;
