import React, { useRef, useEffect, useState, useCallback, useMemo } from 'react';
import PropTypes from 'prop-types';
import { useLocation } from 'react-router-dom';
import { useFitnessContext } from '@/context/FitnessContext.jsx';
import { useRenderProfiler } from '@/hooks/fitness/useRenderProfiler.js';
import { ChallengeOverlay, useChallengeOverlays } from './overlays/ChallengeOverlay.jsx';
import { CycleChallengeOverlay } from './overlays/CycleChallengeOverlay.jsx';
import { useCycleSuccessHold } from './overlays/useCycleSuccessHold.js';
import { ChallengeOverlayDeck } from './overlays/ChallengeOverlayDeck.jsx';
import CycleRiderSwapModal from './overlays/CycleRiderSwapModal.jsx';
import GovernanceStateOverlay from './overlays/GovernanceStateOverlay.jsx';
import GovernanceAudioPlayer from './overlays/GovernanceAudioPlayer.jsx';
import { resolveLockScreen } from './overlays/resolveLockScreen.js';
import './overlays/CycleLockScreen.scss';
import { useGovernanceDisplay } from '@/modules/Fitness/hooks/useGovernanceDisplay.js';
import FullscreenVitalsOverlay from './overlays/FullscreenVitalsOverlay.jsx';
import FitnessModuleContainer from './FitnessModuleContainer.jsx';
import CycleChallengeDemo from '@/modules/Fitness/widgets/CycleChallengeDemo/CycleChallengeDemo.jsx';
import getLogger from '@/lib/logging/Logger.js';
import './overlays/FitnessAppOverlay.scss';

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
  const location = useLocation();
  const showCycleDemo = useMemo(
    () => new URLSearchParams(location.search || '').has('cycle-demo'),
    [location.search]
  );

  const voiceMemoOverlayState = fitnessCtx?.voiceMemoOverlayState;
  const voiceMemoOverlayOpen = Boolean(voiceMemoOverlayState?.open);
  const governanceState = fitnessCtx?.governanceState || null;
  const sessionInstance = fitnessCtx?.fitnessSessionInstance || null;
  const participantDisplayMap = fitnessCtx?.participantDisplayMap;
  const ctxZoneMetadata = fitnessCtx?.zoneMetadata;
  const preferGroupLabels = fitnessCtx?.activeHeartRateParticipants?.length > 1;
  const governanceDisplay = useGovernanceDisplay(governanceState, participantDisplayMap, ctxZoneMetadata, { preferGroupLabels });
  const { current: currentChallengeOverlay, upcoming: upcomingChallengeOverlay } = useChallengeOverlays(
    governanceState,
    fitnessCtx?.zones
  );
  const isGovernanceLocked = governanceDisplay?.status === 'locked';
  const activeChallenge = governanceState?.challenge || null;
  const isCycleChallenge = activeChallenge?.type === 'cycle';
  const lockScreen = resolveLockScreen({ activeChallenge, governanceDisplay });
  const challengeEventRef = useRef({ id: null, status: null });
  const wasPlayingBeforeOverlayRef = useRef(false);

  // Task 26: Local swap modal open state + engine-backed confirm handler.
  // Engine is reached via fitnessSessionInstance (session).governanceEngine —
  // same pattern used by triggerChallengeNow in FitnessContext.
  const [isSwapModalOpen, setSwapModalOpen] = useState(false);
  const cycleLogger = useMemo(
    () => getLogger().child({ component: 'fitness-player-overlay.cycle' }),
    []
  );

  const handleRequestSwap = useCallback(() => {
    cycleLogger.info('swap-modal-open-request', {
      riderId: activeChallenge?.rider?.id || null
    });
    setSwapModalOpen(true);
  }, [activeChallenge, cycleLogger]);

  const handleCloseSwap = useCallback(() => {
    setSwapModalOpen(false);
  }, []);

  const handleConfirmSwap = useCallback((riderId) => {
    const engine = sessionInstance?.governanceEngine;
    if (engine && typeof engine.swapCycleRider === 'function') {
      const result = engine.swapCycleRider(riderId);
      cycleLogger.info('swap-confirm', {
        riderId,
        success: Boolean(result?.success),
        reason: result?.reason || null
      });
    } else {
      cycleLogger.warn('swap-confirm-no-engine', { riderId });
    }
    // Close modal regardless — the snapshot will re-render with the new rider
    // (or keep the current one if the engine rejected the swap).
    setSwapModalOpen(false);
  }, [sessionInstance, cycleLogger]);

  // Close the swap modal if the cycle challenge ends or the swap window closes.
  useEffect(() => {
    if (!isSwapModalOpen) return;
    if (!isCycleChallenge || !activeChallenge?.swapAllowed) {
      setSwapModalOpen(false);
    }
  }, [isSwapModalOpen, isCycleChallenge, activeChallenge?.swapAllowed]);

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

  // Zone challenge overlays are suppressed for cycle-type challenges — the
  // cycle UI owns the challenge affordance (ring, gauge, swap). Without this
  // gate, ChallengeOverlay would attempt to render zone-shaped fields
  // (zoneLabel, requiredCount, metUsers) against a cycle snapshot.
  const challengeOverlay = currentChallengeOverlay?.show && !isGovernanceLocked && !isCycleChallenge
    ? <ChallengeOverlay overlay={currentChallengeOverlay} />
    : null;
  const nextChallengeOverlay = upcomingChallengeOverlay?.show && !isGovernanceLocked && !isCycleChallenge
    ? <ChallengeOverlay overlay={upcomingChallengeOverlay} />
    : null;

  // Cycle overlay shows for any active cycle challenge except terminal states
  // (success/failed) and non-health locks. A health-lock keeps the overlay
  // visible so the rider sees the empty health meter and "pedal back to green"
  // signal while the video is paused — health-locks are NOT owned by
  // GovernanceStateOverlay (the generic panel is suppressed for this case in
  // useGovernanceDisplay).
  // Cycle overlay shows for any active, non-terminal cycle challenge. When the
  // resolver promotes it (cycle health-lock), it renders as a centered, scaled,
  // dimmed lock screen instead of inside the deck (see promotedCycleLock below).
  const cycleOverlayActive = isCycleChallenge
    && activeChallenge?.status !== 'success'
    && activeChallenge?.status !== 'failed'
    && (activeChallenge?.cycleState !== 'locked' || lockScreen.variety === 'cycle-health');
  const cycleOverlayNode = cycleOverlayActive ? (
    <CycleChallengeOverlay
      challenge={activeChallenge}
      onRequestSwap={handleRequestSwap}
    />
  ) : null;
  // In-deck cycle overlay only when NOT promoted.
  const cycleOverlay = (cycleOverlayActive && !lockScreen.promoteCycle) ? cycleOverlayNode : null;

  // §5A: on a cycle challenge success, hold a brief completion celebration
  // (full green ring + ✓ + pulse) instead of vanishing — mirrors the HR overlay.
  // useCycleSuccessHold captures the success snapshot so it survives the engine
  // clearing the live challenge during the hold window.
  const cycleSuccess = useCycleSuccessHold(isCycleChallenge ? activeChallenge : null);
  const cycleDoneOverlay = (cycleSuccess.done && cycleSuccess.challenge && !lockScreen.promoteCycle) ? (
    <CycleChallengeOverlay challenge={cycleSuccess.challenge} done />
  ) : null;

  const primaryOverlay = lockScreen.showGovernanceOverlay ? (
    <GovernanceStateOverlay
      voiceMemoOpen={voiceMemoOverlayOpen}
      display={governanceDisplay}
    />
  ) : null;

  // Promoted cycle health-lock: the cycle overlay becomes a centered, ~2x, dimmed
  // lock screen covering everything else. Single owner via resolveLockScreen.
  const promotedCycleLock = (lockScreen.promoteCycle && cycleOverlayNode) ? (
    <div className="cycle-lock-screen" role="dialog" aria-label="Cycle challenge locked">
      <div className="cycle-lock-screen__scrim" />
      <div className="cycle-lock-screen__stage">
        {cycleOverlayNode}
      </div>
      {lockScreen.audioTrack ? (
        <GovernanceAudioPlayer trackKey={lockScreen.audioTrack} paused={voiceMemoOverlayOpen} />
      ) : null}
    </div>
  ) : null;

  useEffect(() => {
    if (lockScreen.variety === 'cycle-health') {
      cycleLogger.info('health-lock-shown', {
        challengeId: activeChallenge?.id || null,
        audioTrack: lockScreen.audioTrack
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockScreen.variety]);

  const hasAnyOverlay = Boolean(
    primaryOverlay ||
    voiceMemoOverlayOpen ||
    challengeOverlay ||
    (!challengeOverlay && nextChallengeOverlay) ||
    cycleOverlay ||
    cycleDoneOverlay ||
    promotedCycleLock ||
    isSwapModalOpen ||
    showFullscreenVitals ||
    showCycleDemo
  );

  if (!hasAnyOverlay) {
    return null;
  }

  // Wrap any visible challenge overlay in the shared deck so position is
  // unified across both variants (zone-based ChallengeOverlay and
  // CycleChallengeOverlay). The deck owns the top/middle/bottom slot and
  // tap-to-cycle; the overlays inside are pure presentation.
  const visibleChallengeContent = challengeOverlay
    || (!challengeOverlay && nextChallengeOverlay)
    || cycleOverlay
    || cycleDoneOverlay;
  const challengeDeck = visibleChallengeContent ? (
    <ChallengeOverlayDeck>
      {visibleChallengeContent}
    </ChallengeOverlayDeck>
  ) : null;

  return (
    <>
      {challengeDeck}
      {primaryOverlay}
      {promotedCycleLock}
      {showFullscreenVitals ? (
        <FullscreenVitalsOverlay visible={showFullscreenVitals} />
      ) : null}
      <CycleRiderSwapModal
        isOpen={isSwapModalOpen}
        currentRider={activeChallenge?.rider || null}
        eligibleUsers={
          Array.isArray(activeChallenge?.swapEligibleUsers)
            ? activeChallenge.swapEligibleUsers
            : []
        }
        resolveUser={(uid) => ({
          // getDisplayName returns { displayName, source, preferredGroupLabel } — extract the string.
          name: fitnessCtx?.getDisplayName?.(uid)?.displayName || uid,
          avatarUrl: uid
            ? `/api/v1/static/img/users/${uid}`
            : '/api/v1/static/img/users/user'
        })}
        onConfirm={handleConfirmSwap}
        onClose={handleCloseSwap}
      />
      {showCycleDemo ? <CycleChallengeDemo /> : null}
      {fitnessCtx.overlayApp && (
        <div className="fitness-app-overlay-wrapper">
          <FitnessModuleContainer
            moduleId={fitnessCtx.overlayApp.id}
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
