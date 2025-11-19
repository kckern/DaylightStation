import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import { DaylightMediaPath } from '../../lib/api.mjs';
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
    return {
      category: 'governance-warning-progress',
      status: 'yellow',
      show: true,
      filterClass: 'governance-filter-warning',
      title: '',
      descriptions: [],
      requirements: [],
      highlightUsers: [],
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

  const voiceMemoOverlayState = fitnessCtx?.voiceMemoOverlay;
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
        color: zone.color || null
      };
      rank[id] = index;
    });
    return { map, rank };
  }, [fitnessCtx?.zones]);

  const lockRows = useMemo(() => {
    if (!overlay || overlay.category !== 'governance' || !overlay.show) {
      return [];
    }
    const requirementList = Array.isArray(overlay.requirements) ? overlay.requirements.filter(Boolean) : [];
    if (requirementList.length === 0) {
      return [];
    }
    const normalize = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
    const participants = Array.isArray(fitnessCtx?.participantRoster) ? fitnessCtx.participantRoster : [];
    const participantMap = new Map();
    participants.forEach((participant) => {
      const key = normalize(participant?.name);
      if (!key) return;
      participantMap.set(key, participant);
    });

    const groupLabelMap = new Map();
    const collectGroupLabels = (list, fallbackLabel) => {
      if (!Array.isArray(list)) return;
      list.forEach((entry) => {
        if (!entry?.name) return;
        const key = normalize(entry.name);
        if (!key || groupLabelMap.has(key)) return;
        const label = entry.group_label || fallbackLabel || entry.source || entry.category || null;
        if (label) {
          groupLabelMap.set(key, label);
        }
      });
    };
    const usersConfigRaw = fitnessCtx?.usersConfigRaw || {};
    collectGroupLabels(usersConfigRaw?.primary, 'Primary');
    collectGroupLabels(usersConfigRaw?.secondary, 'Secondary');
    collectGroupLabels(usersConfigRaw?.family, 'Family');
    collectGroupLabels(usersConfigRaw?.friends, 'Friend');
    collectGroupLabels(usersConfigRaw?.guests, 'Guest');

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

    const findZoneByLabel = (label) => {
      if (!label) return null;
      const normalized = label.trim().toLowerCase();
      const match = Object.values(zoneMetadata.map).find((entry) =>
        entry?.name?.trim().toLowerCase() === normalized
      );
      return match || null;
    };

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
            color: null
          };
      }
      const label = requirement?.zoneLabel
        || zoneInfo?.name
        || requirement?.ruleLabel
        || 'Target';
      return {
        zoneInfo,
        label
      };
    };

    const getCurrentZone = (participant) => {
      const zoneIdRaw = participant?.zoneId ? String(participant.zoneId) : null;
      const zoneId = zoneIdRaw
        ? zoneIdRaw
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
        : null;
      if (zoneId && zoneMetadata.map[zoneId]) {
        return zoneMetadata.map[zoneId];
      }
      if (participant?.zoneLabel) {
        return findZoneByLabel(participant.zoneLabel)
          || {
            id: zoneId || slugifyId(participant.zoneLabel),
            name: participant.zoneLabel,
            color: null
          };
      }
      return null;
    };

    const ensureAvatarSrc = (name, participant) => {
      if (participant?.avatarUrl) return participant.avatarUrl;
      if (participant?.profileId) {
        return DaylightMediaPath(`/media/img/users/${participant.profileId}`);
      }
      const slug = slugifyId(name);
      return DaylightMediaPath(`/media/img/users/${slug}`);
    };

    const addRow = ({ name, groupLabel, participant, target, isGeneric = false }) => {
      if (!target) return;
      const keyBase = isGeneric ? `anyone-${target.label}` : normalize(name);
      const cacheKey = `${keyBase || 'unknown'}-${target.label}`;
      if (seen.has(cacheKey)) return;
      seen.add(cacheKey);
      autoIndex += 1;
      const displayName = isGeneric ? (name || 'Anyone') : (name || 'Unknown');
      const resolvedParticipant = participant || (participantMap.get(normalize(name)) || null);
      const resolvedGroup = isGeneric
        ? (groupLabel || 'Any participant')
        : (groupLabel
          || groupLabelMap.get(normalize(name))
          || resolvedParticipant?.source
          || null);
      const currentZone = isGeneric ? (aggregateZone || null) : getCurrentZone(resolvedParticipant);
      rows.push({
        key: `${cacheKey}-${autoIndex}`,
        name: displayName,
        groupLabel: resolvedGroup,
        avatarSrc: isGeneric ? DaylightMediaPath('/media/img/users/user') : ensureAvatarSrc(displayName, resolvedParticipant),
        isGeneric,
        currentZone,
        targetZone: target.zoneInfo || null,
        targetLabel: target.label || 'Target',
        currentLabel: currentZone?.name || 'No signal'
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
        addRow({ name: 'Anyone', target, isGeneric: true });
        return;
      }
      if (!missing.length) {
        return;
      }
      missing.forEach((userName) => {
        const participant = participantMap.get(normalize(userName));
        addRow({
          name: userName,
          participant,
          target
        });
      });
    });

    return rows;
  }, [overlay, fitnessCtx?.participantRoster, fitnessCtx?.usersConfigRaw, zoneMetadata]);

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
