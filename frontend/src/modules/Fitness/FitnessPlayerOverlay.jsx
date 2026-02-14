import React, { useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import { useRenderProfiler } from '../../hooks/fitness/useRenderProfiler.js';
import { ChallengeOverlay, useChallengeOverlays } from './FitnessPlayerOverlay/ChallengeOverlay.jsx';
import GovernanceStateOverlay from './FitnessPlayerOverlay/GovernanceStateOverlay.jsx';
import { useGovernanceDisplay } from './hooks/useGovernanceDisplay.js';
import FullscreenVitalsOverlay from './FitnessPlayerOverlay/FullscreenVitalsOverlay.jsx';
import FitnessPluginContainer from './FitnessPlugins/FitnessPluginContainer.jsx';
import './FitnessPlayerOverlay/FitnessAppOverlay.scss';

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

const FitnessPlayerOverlay = ({ playerRef, showFullscreenVitals }) => {
  useRenderProfiler('FitnessPlayerOverlay');
  const fitnessCtx = useFitnessContext();

  const voiceMemoOverlayState = fitnessCtx?.voiceMemoOverlayState;
  const voiceMemoOverlayOpen = Boolean(voiceMemoOverlayState?.open);
  const governanceState = fitnessCtx?.governanceState || null;
  const sessionInstance = fitnessCtx?.fitnessSessionInstance || null;
  const participantDisplayMap = fitnessCtx?.participantDisplayMap;
  const ctxZoneMetadata = fitnessCtx?.zoneMetadata;
  const governanceDisplay = useGovernanceDisplay(governanceState, participantDisplayMap, ctxZoneMetadata);
  const { current: currentChallengeOverlay, upcoming: upcomingChallengeOverlay } = useChallengeOverlays(
    governanceState,
    fitnessCtx?.zones
  );
  const isGovernanceLocked = governanceDisplay?.status === 'locked';
  const activeChallenge = governanceState?.challenge || null;
  const challengeEventRef = useRef({ id: null, status: null });
  const wasPlayingBeforeOverlayRef = useRef(false);

  // Pause video when voice memo overlay opens
  useEffect(() => {
    if (voiceMemoOverlayOpen && playerRef?.current) {
      const video = playerRef.current.getMediaElement?.() || playerRef.current;
      if (video && typeof video.pause === 'function') {
        wasPlayingBeforeOverlayRef.current = !video.paused;
        if (!video.paused) {
          video.pause();
        }
      }
      fitnessCtx?.pauseMusicPlayer?.();
    }
  }, [voiceMemoOverlayOpen, playerRef, fitnessCtx]);

  useEffect(() => {
    if (!sessionInstance || typeof sessionInstance.logEvent !== 'function') {
      return;
    }
    const tracker = challengeEventRef.current;
    if (!activeChallenge) {
      if (tracker.id && tracker.status !== 'success' && tracker.status !== 'failed') {
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
      challengeEventRef.current = { id: challengeId, status };
      return;
    }
    challengeEventRef.current = { id: challengeId, status };
  }, [sessionInstance, activeChallenge]);

  const challengeOverlay = currentChallengeOverlay?.show && !isGovernanceLocked
    ? <ChallengeOverlay overlay={currentChallengeOverlay} />
    : null;
  const nextChallengeOverlay = upcomingChallengeOverlay?.show && !isGovernanceLocked
    ? <ChallengeOverlay overlay={upcomingChallengeOverlay} />
    : null;
  const primaryOverlay = governanceDisplay?.show ? (
    <GovernanceStateOverlay display={governanceDisplay} />
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
  playerRef: PropTypes.shape({
    current: PropTypes.any
  }),
  showFullscreenVitals: PropTypes.bool
};

export default FitnessPlayerOverlay;
