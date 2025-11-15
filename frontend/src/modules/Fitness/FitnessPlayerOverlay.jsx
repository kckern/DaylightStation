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
  const requirements = Array.isArray(governanceState.requirements) ? governanceState.requirements : [];
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
      rule: requirementText,
      satisfied: challengeActualCount != null && challengeRequiredCount != null
        ? challengeActualCount >= challengeRequiredCount
        : false
    };
  })();

  const formattedRequirements = requirements.map((rule) => ({
    zone: rule?.zoneLabel || rule?.zone || 'Zone',
    rule: rule?.ruleLabel || String(rule?.rule ?? ''),
    satisfied: Boolean(rule?.satisfied)
  }));
  const sortedRequirements = formattedRequirements.slice().sort((a, b) => Number(a.satisfied) - Number(b.satisfied));
  const unsatisfied = requirements.filter((rule) => rule && !rule.satisfied);
  const missingUsers = Array.from(new Set(
    unsatisfied
      .flatMap((rule) => Array.isArray(rule?.missingUsers) ? rule.missingUsers : [])
      .filter(Boolean)
  ));

  if (challengeLocked) {
    const zoneLabel = challengeZoneLabel;
    const requiredCount = challengeRequiredCount;
    const actualCount = challengeActualCount;
    const requirementLabel = requiredCount != null ? `${requiredCount} participant${requiredCount === 1 ? '' : 's'}` : 'Challenge requirement';
    const missingChallengeUsers = challengeMissingUsers.length ? challengeMissingUsers : missingUsers;
    const baseRequirementItems = unsatisfied.map((rule) => ({
      zone: rule?.zoneLabel || rule?.zone || 'Zone',
      rule: rule?.ruleLabel || String(rule?.rule ?? ''),
      satisfied: false
    }));
    const challengeRequirementItem = zoneLabel
      ? {
        zone: zoneLabel,
        rule: requirementLabel,
        satisfied: false
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
        ...(challengeRequirement ? [challengeRequirement] : []),
        ...unsatisfied.map((rule) => ({
          zone: rule?.zoneLabel || rule?.zone || 'Zone',
          rule: rule?.ruleLabel || String(rule?.rule ?? ''),
          satisfied: false
        }))
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
    formattedRequirements.length ? 'Meet these conditions to unlock playback.' : 'Loading unlock rules...'
  ].filter(Boolean);

  const greyRequirements = sortedRequirements;
  const greyHighlightUsers = missingUsers;

  return {
    category: 'governance',
    status: 'grey',
    show: true,
    filterClass: '',
    title: 'Video Locked',
    descriptions: greyDescriptions,
    requirements: greyRequirements,
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
  const governanceChallenge = governanceState?.challenge || null;
  const governanceChallengeStatus = currentChallengeOverlay?.status;
  const challengeRemaining = currentChallengeOverlay?.remainingSeconds ?? null;
  const challengeTotal = currentChallengeOverlay?.totalSeconds ?? null;
  const challengeProgress = currentChallengeOverlay?.progress ?? 0;
  const challengeZoneLabel = currentChallengeOverlay?.title || currentChallengeOverlay?.zoneLabel || 'Target zone';
  const challengeMissingUsers = currentChallengeOverlay?.missingUsers || [];
  const challengeMetUsers = currentChallengeOverlay?.metUsers || [];
  const isGovernanceRed = overlay?.category === 'governance' && overlay.status === 'red';

  const challengeMeta = governanceChallenge ? {
    challenge: governanceChallenge,
    status: governanceChallengeStatus,
    statusLabel: governanceChallengeStatus === 'success'
      ? 'Completed'
      : governanceChallengeStatus === 'failed'
        ? 'Failed'
        : 'Active',
    remaining: challengeRemaining,
    total: challengeTotal,
    progress: challengeProgress,
    zoneLabel: challengeZoneLabel,
    selectionLabel: governanceChallenge?.selectionLabel || '',
    actualCount: governanceChallenge?.actualCount ?? 0,
    requiredCount: governanceChallenge?.requiredCount ?? 0,
    missingUsers: challengeMissingUsers,
    metUsers: challengeMetUsers
  } : null;

  const highlightEntries = useMemo(() => {
    if (!overlay || !Array.isArray(overlay.highlightUsers) || overlay.highlightUsers.length === 0) {
      return [];
    }
    const normalize = (name) => (typeof name === 'string' ? name.trim().toLowerCase() : '');
    const lookup = new Map();
    const participants = Array.isArray(fitnessCtx?.participantRoster) ? fitnessCtx.participantRoster : [];
    participants.forEach((participant) => {
      if (!participant?.name) return;
      const key = normalize(participant.name);
      if (!key) return;
      const profileSlug = participant.profileId || slugifyId(participant.name);
      lookup.set(key, {
        displayName: participant.name,
        profileSlug
      });
    });

    return overlay.highlightUsers
      .map((rawName, index) => {
        const key = normalize(rawName);
        if (!key) return null;
        const record = lookup.get(key);
        const displayName = record?.displayName || rawName;
        const profileSlug = record?.profileSlug || slugifyId(displayName);
        const avatarSrc = DaylightMediaPath(`/media/img/users/${profileSlug}`);
        return {
          name: displayName,
          avatarSrc,
          key: `${profileSlug || key}-${index}`
        };
      })
    .filter(Boolean);
  }, [fitnessCtx?.participantRoster, overlay]);

  const challengeOverlay = currentChallengeOverlay?.show && !isGovernanceRed
    ? <ChallengeOverlay overlay={currentChallengeOverlay} />
    : null;
  const nextChallengeOverlay = upcomingChallengeOverlay?.show && !isGovernanceRed
    ? <ChallengeOverlay overlay={upcomingChallengeOverlay} />
    : null;
  const primaryOverlay = overlay?.show ? (
    <GovernanceStateOverlay
      overlay={overlay}
      challengeMeta={challengeMeta}
      highlightEntries={highlightEntries}
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
      rule: PropTypes.string,
      satisfied: PropTypes.bool
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
