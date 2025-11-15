import React, { useMemo, useState, useEffect, useCallback } from 'react';
import PropTypes from 'prop-types';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import { DaylightMediaPath } from '../../lib/api.mjs';
import useVoiceMemoRecorder from './FitnessSidebar/useVoiceMemoRecorder.js';
import { ChallengeOverlay, useChallengeOverlays } from './FitnessPlayerOverlayChallenge.jsx';

// Helper function to format time in MM:SS or HH:MM:SS format
const formatTime = (seconds) => {
  if (!seconds || isNaN(seconds)) return '00:00';
  
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  if (hrs > 0) {
    return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
};

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

const VOICE_MEMO_AUTO_ACCEPT_MS = 4000;

const formatMemoTimestamp = (memo) => {
  if (!memo) return '';
  if (memo.sessionElapsedSeconds != null) {
    return `T+${formatTime(Math.max(0, Math.round(memo.sessionElapsedSeconds)))}`;
  }
  if (memo.createdAt) {
    try {
      const dt = new Date(memo.createdAt);
      return dt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (_) {
      return '';
    }
  }
  return '';
};

const VoiceMemoOverlay = ({
  overlayState,
  voiceMemos,
  onClose,
  onOpenReview,
  onOpenList,
  onOpenRedo,
  onRemoveMemo,
  onReplaceMemo,
  sessionId,
  playerRef,
  preferredMicrophoneId
}) => {
  const sortedMemos = useMemo(() => {
    return voiceMemos.slice().sort((a, b) => {
      const aValue = a?.createdAt ?? (a?.sessionElapsedSeconds != null ? a.sessionElapsedSeconds * 1000 : 0);
      const bValue = b?.createdAt ?? (b?.sessionElapsedSeconds != null ? b.sessionElapsedSeconds * 1000 : 0);
      return Number(bValue) - Number(aValue);
    });
  }, [voiceMemos]);

  const currentMemo = useMemo(() => {
    if (!overlayState?.memoId) return null;
    const targetId = String(overlayState.memoId);
    return voiceMemos.find((memo) => memo && String(memo.memoId) === targetId) || null;
  }, [overlayState?.memoId, voiceMemos]);

  const [autoAcceptProgress, setAutoAcceptProgress] = useState(0);

  const handleClose = useCallback(() => {
    onClose?.();
  }, [onClose]);

  const handleAccept = useCallback(() => {
    onClose?.();
  }, [onClose]);

  const handleReviewSelect = useCallback((memoRef) => {
    if (!memoRef) return;
    onOpenReview?.(memoRef, { autoAccept: false });
  }, [onOpenReview]);

  const handleRedo = useCallback((memoId) => {
    if (!memoId) return;
    onOpenRedo?.(memoId);
  }, [onOpenRedo]);

  const handleDelete = useCallback(() => {
    const memoId = overlayState?.memoId;
    if (!memoId) return;
    onRemoveMemo?.(memoId);
    const remaining = voiceMemos.filter((memo) => memo && String(memo.memoId) !== String(memoId)).length;
    if (remaining <= 0) {
      onClose?.();
    } else if (overlayState.mode !== 'list') {
      onOpenList?.();
    }
  }, [overlayState?.memoId, overlayState?.mode, voiceMemos, onRemoveMemo, onClose, onOpenList]);

  const handleDeleteFromList = useCallback((memoId) => {
    if (!memoId) return;
    onRemoveMemo?.(memoId);
    const remaining = voiceMemos.filter((memo) => memo && String(memo.memoId) !== String(memoId)).length;
    if (remaining <= 0) {
      onClose?.();
    }
  }, [onRemoveMemo, voiceMemos, onClose]);

  const handleRedoCaptured = useCallback((memo) => {
    if (!memo) {
      onClose?.();
      return;
    }
    const targetId = overlayState?.memoId;
    const stored = targetId ? (onReplaceMemo?.(targetId, memo) || memo) : memo;
    const nextTarget = stored || memo;
    if (nextTarget) {
      onOpenReview?.(nextTarget, { autoAccept: false });
    } else {
      onClose?.();
    }
  }, [overlayState?.memoId, onReplaceMemo, onOpenReview, onClose]);

  const {
    isRecording,
    recordingDuration,
    uploading,
    error: recorderError,
    setError: setRecorderError,
    startRecording,
    stopRecording
  } = useVoiceMemoRecorder({
    sessionId,
    playerRef,
    preferredMicrophoneId,
    onMemoCaptured: handleRedoCaptured
  });

  const handleStartRedoRecording = useCallback(() => {
    setRecorderError(null);
    startRecording();
  }, [setRecorderError, startRecording]);

  useEffect(() => {
    if (!overlayState?.open || overlayState.mode !== 'review' || !overlayState.autoAccept) {
      setAutoAcceptProgress(0);
      return undefined;
    }
    const startedAt = overlayState.startedAt || Date.now();
    let cancelled = false;
    const update = () => {
      if (cancelled) return;
      const elapsed = Date.now() - startedAt;
      const progress = Math.max(0, Math.min(1, elapsed / VOICE_MEMO_AUTO_ACCEPT_MS));
      setAutoAcceptProgress(progress);
      if (progress >= 1 && !cancelled) {
        cancelled = true;
        handleAccept();
      }
    };
    update();
    const interval = setInterval(update, 100);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [overlayState?.open, overlayState?.mode, overlayState?.autoAccept, overlayState?.startedAt, handleAccept]);

  useEffect(() => {
    if (!overlayState?.open) {
      setAutoAcceptProgress(0);
    }
  }, [overlayState?.open]);

  useEffect(() => {
    if (overlayState?.mode !== 'redo' && isRecording) {
      stopRecording();
    }
  }, [overlayState?.mode, isRecording, stopRecording]);

  useEffect(() => {
    if (overlayState?.mode !== 'redo') {
      setRecorderError(null);
    }
  }, [overlayState?.mode, setRecorderError]);

  useEffect(() => {
    if (!overlayState?.open) return;
    if ((overlayState.mode === 'review' || overlayState.mode === 'redo') && !currentMemo) {
      if (voiceMemos.length > 0) {
        onOpenList?.();
      } else {
        onClose?.();
      }
    }
  }, [overlayState?.open, overlayState?.mode, currentMemo, voiceMemos, onOpenList, onClose]);

  const transcript = currentMemo?.transcriptClean || currentMemo?.transcriptRaw || 'Transcription in progress…';
  const memoTimestamp = formatMemoTimestamp(currentMemo);
  const memoVideoTimestamp = currentMemo?.videoTimeSeconds != null
    ? formatTime(Math.max(0, Math.round(currentMemo.videoTimeSeconds)))
    : '';
  const recordingTimeLabel = formatTime(Math.max(0, Math.floor(recordingDuration / 1000)));

  if (!overlayState?.open) {
    return null;
  }

  const mode = overlayState.mode || 'list';
  const showList = mode === 'list';
  const showReview = mode === 'review';
  const showRedo = mode === 'redo';

  return (
    <div className={`voice-memo-overlay voice-memo-overlay--${mode}`}>
      <div className="voice-memo-overlay__panel">
        <div className="voice-memo-overlay__header">
          <div className="voice-memo-overlay__title">
            {showList ? 'Voice Memos' : showRedo ? 'Redo Voice Memo' : 'Voice Memo Review'}
          </div>
          <button type="button" className="voice-memo-overlay__close" onClick={handleClose} aria-label="Close voice memo overlay">×</button>
        </div>

        {showList ? (
          <div className="voice-memo-overlay__content">
            {sortedMemos.length === 0 ? (
              <div className="voice-memo-overlay__empty">No memos yet.</div>
            ) : (
              <ul className="voice-memo-overlay__list">
                {sortedMemos.map((memo) => {
                  const memoId = memo?.memoId;
                  if (!memoId) return null;
                  const timeLabel = formatMemoTimestamp(memo);
                  const memoTranscript = memo.transcriptClean || memo.transcriptRaw || 'Transcription in progress…';
                  return (
                    <li className="voice-memo-overlay__list-item" key={memoId}>
                      <div className="voice-memo-overlay__list-body">
                        <div className="voice-memo-overlay__meta">{timeLabel || 'Recorded memo'}</div>
                        <div className="voice-memo-overlay__transcript">{memoTranscript}</div>
                      </div>
                      <div className="voice-memo-overlay__list-actions">
                        <button type="button" onClick={() => handleReviewSelect(memo)}>Review</button>
                        <button type="button" onClick={() => handleRedo(memoId)}>Redo</button>
                        <button type="button" onClick={() => handleDeleteFromList(memoId)}>Delete</button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        ) : null}

        {showReview && currentMemo ? (
          <div className="voice-memo-overlay__content">
            <div className="voice-memo-overlay__meta">
              {memoTimestamp && <span className="voice-memo-overlay__tag">{memoTimestamp}</span>}
              {memoVideoTimestamp && <span className="voice-memo-overlay__tag">Video {memoVideoTimestamp}</span>}
            </div>
            <div className="voice-memo-overlay__transcript voice-memo-overlay__transcript--large">{transcript}</div>
            {overlayState.autoAccept ? (
              <div className="voice-memo-overlay__progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(autoAcceptProgress * 100)}>
                <div className="voice-memo-overlay__progress-fill" style={{ transform: `scaleX(${autoAcceptProgress})` }} />
                <span className="voice-memo-overlay__progress-label">Auto saving…</span>
              </div>
            ) : null}
            <div className="voice-memo-overlay__actions">
              <button type="button" className="voice-memo-overlay__btn voice-memo-overlay__btn--primary" onClick={handleAccept}>Keep</button>
              <button type="button" className="voice-memo-overlay__btn" onClick={() => handleRedo(currentMemo.memoId)}>Redo</button>
              <button type="button" className="voice-memo-overlay__btn voice-memo-overlay__btn--danger" onClick={handleDelete}>Delete</button>
            </div>
          </div>
        ) : null}

        {showRedo && currentMemo ? (
          <div className="voice-memo-overlay__content">
            <div className="voice-memo-overlay__meta">
              {memoTimestamp && <span className="voice-memo-overlay__tag">{memoTimestamp}</span>}
              {memoVideoTimestamp && <span className="voice-memo-overlay__tag">Video {memoVideoTimestamp}</span>}
            </div>
            <div className="voice-memo-overlay__transcript voice-memo-overlay__transcript--faded">{transcript}</div>
            <div className="voice-memo-overlay__hint">Record a new memo to replace this one.</div>
            {recorderError ? <div className="voice-memo-overlay__error">{recorderError}</div> : null}
            <div className="voice-memo-overlay__redo-controls">
              {!isRecording && !uploading ? (
                <button type="button" className="voice-memo-overlay__btn voice-memo-overlay__btn--primary" onClick={handleStartRedoRecording}>Record Again</button>
              ) : null}
              {isRecording ? (
                <button type="button" className="voice-memo-overlay__btn" onClick={stopRecording}>Stop ({recordingTimeLabel})</button>
              ) : null}
              {(isRecording || uploading) ? (
                <span className="voice-memo-overlay__status">{isRecording ? `Recording… ${recordingTimeLabel}` : 'Uploading…'}</span>
              ) : null}
            </div>
            <div className="voice-memo-overlay__actions">
              <button
                type="button"
                className="voice-memo-overlay__btn"
                onClick={() => handleReviewSelect(currentMemo)}
                disabled={isRecording || uploading}
              >
                Back to review
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};

VoiceMemoOverlay.propTypes = {
  overlayState: PropTypes.shape({
    open: PropTypes.bool,
    mode: PropTypes.string,
    memoId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    autoAccept: PropTypes.bool,
    startedAt: PropTypes.number
  }),
  voiceMemos: PropTypes.arrayOf(PropTypes.shape({
    memoId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    transcriptClean: PropTypes.string,
    transcriptRaw: PropTypes.string,
    createdAt: PropTypes.number,
    sessionElapsedSeconds: PropTypes.number,
    videoTimeSeconds: PropTypes.number
  })),
  onClose: PropTypes.func,
  onOpenReview: PropTypes.func,
  onOpenList: PropTypes.func,
  onOpenRedo: PropTypes.func,
  onRemoveMemo: PropTypes.func,
  onReplaceMemo: PropTypes.func,
  sessionId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  playerRef: PropTypes.shape({
    current: PropTypes.any
  }),
  preferredMicrophoneId: PropTypes.string
};

const FitnessPlayerOverlay = ({ overlay, stallStatus, onReload, currentTime, lastKnownTimeRef, playerRef }) => {
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

  const challengeStatusLabel = governanceChallengeStatus === 'success'
    ? 'Completed'
    : governanceChallengeStatus === 'failed'
      ? 'Failed'
      : 'Active';
  const challengeOverlay = currentChallengeOverlay?.show && !isGovernanceRed
    ? <ChallengeOverlay overlay={currentChallengeOverlay} />
    : null;
  const nextChallengeOverlay = upcomingChallengeOverlay?.show && !isGovernanceRed
    ? <ChallengeOverlay overlay={upcomingChallengeOverlay} />
    : null;

  // Handle stall reload overlay as priority overlay
  if (stallStatus?.isStalled && onReload) {
    const reloadTime = Math.max(0, lastKnownTimeRef?.current || currentTime || 0);
    return (
      <>
        <div
          className="stall-reload-overlay"
          data-stalled="1"
        >
          <button
            type="button"
            className="stall-reload-button"
            onClick={(e) => {
              e.stopPropagation();
              onReload(e);
            }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onReload(e);
            }}
          >
            Reload at {formatTime(reloadTime)}
          </button>
        </div>
        {challengeOverlay}
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
      </>
    );
  }

  let primaryOverlay = null;

  if (overlay?.show) {
    const { category } = overlay;
    if (category === 'governance-warning-progress') {
      const remaining = Number.isFinite(overlay.countdown) ? Math.max(overlay.countdown, 0) : 0;
      const total = Number.isFinite(overlay.countdownTotal) ? Math.max(overlay.countdownTotal, 1) : 1;
      const progress = Math.max(0, Math.min(1, remaining / total));
      primaryOverlay = (
        <div className="governance-progress-overlay" aria-hidden="true">
          <div className="governance-progress-overlay__track">
            <div
              className="governance-progress-overlay__fill"
              style={{ width: `${progress * 100}%` }}
            />
          </div>
        </div>
      );
    } else if (category === 'governance') {
      primaryOverlay = (
        <div className={`governance-overlay governance-overlay--${overlay.status || 'unknown'}`}>
          <div className="governance-overlay__panel">
            {overlay.title ? (
              <div className="governance-overlay__title">{overlay.title}</div>
            ) : null}
            {overlay.countdown != null ? (
              <div className="governance-overlay__countdown">{overlay.countdown}s</div>
            ) : null}
            {Array.isArray(overlay.descriptions) && overlay.descriptions.length > 0
              ? overlay.descriptions.map((line, idx) => (
                <p className="governance-overlay__line" key={`gov-desc-${idx}`}>{line}</p>
              ))
              : null}
            {governanceChallenge ? (
              <div className={`governance-overlay__challenge governance-overlay__challenge--${governanceChallengeStatus || 'pending'}`}>
                <div className="governance-overlay__challenge-header">
                  <div className="governance-overlay__challenge-title">{challengeZoneLabel}</div>
                  <div className="governance-overlay__challenge-meta" aria-label="Challenge status">
                    <span className={`governance-overlay__challenge-status governance-overlay__challenge-status--${governanceChallengeStatus || 'pending'}`}>
                      {challengeStatusLabel}
                    </span>
                    {challengeRemaining != null && challengeTotal ? (
                      <span className="governance-overlay__challenge-time">
                        {`${challengeRemaining}s / ${challengeTotal}s`}
                      </span>
                    ) : null}
                    {governanceChallenge?.selectionLabel ? (
                      <span className="governance-overlay__challenge-tag">{governanceChallenge.selectionLabel}</span>
                    ) : null}
                  </div>
                </div>
                <div className="governance-overlay__challenge-counts" aria-label="Challenge participant counts">
                  <span className="governance-overlay__challenge-count">{governanceChallenge?.actualCount ?? 0}</span>
                  <span className="governance-overlay__challenge-divider">/</span>
                  <span className="governance-overlay__challenge-count governance-overlay__challenge-count--target">{governanceChallenge?.requiredCount ?? 0}</span>
                </div>
                <div className="governance-overlay__challenge-progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(challengeProgress * 100)}>
                  <div className="governance-overlay__challenge-progress-fill" style={{ width: `${Math.round(challengeProgress * 100)}%` }} />
                </div>
                {challengeMissingUsers.length ? (
                  <div className="governance-overlay__challenge-hint">
                    Need: {challengeMissingUsers.join(', ')}
                  </div>
                ) : challengeMetUsers.length ? (
                  <div className="governance-overlay__challenge-hint governance-overlay__challenge-hint--met">
                    Met: {challengeMetUsers.join(', ')}
                  </div>
                ) : null}
              </div>
            ) : null}
            {highlightEntries.length > 0 ? (
              <div className="governance-overlay__people">
                {highlightEntries.map(({ name, avatarSrc, key: entryKey }) => (
                  <span className="governance-overlay__chip" key={`gov-user-${entryKey}`}>
                    <img
                      src={avatarSrc}
                      alt=""
                      className="governance-overlay__avatar"
                      onError={(event) => {
                        const img = event.currentTarget;
                        if (img.dataset.fallback) {
                          img.style.display = 'none';
                          return;
                        }
                        img.dataset.fallback = '1';
                        img.src = DaylightMediaPath('/media/img/users/user');
                      }}
                    />
                    <span className="governance-overlay__chip-label">{name}</span>
                  </span>
                ))}
              </div>
            ) : null}
            {Array.isArray(overlay.requirements) && overlay.requirements.length > 0 ? (
              <ul className="governance-overlay__rules">
                {overlay.requirements.map((rule, idx) => (
                  <li
                    className={`governance-overlay__rule ${rule.satisfied ? 'is-met' : 'is-pending'}`}
                    key={`gov-rule-${idx}-${rule.zone}`}
                  >
                    <span className="governance-overlay__rule-zone">{rule.zone}</span>
                    <span className="governance-overlay__rule-desc">{rule.rule}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
      );
    } else {
      primaryOverlay = (
        <div className="fitness-player-overlay">
          <div className="fitness-player-overlay__panel">
            {overlay.title ? (
              <div className="fitness-player-overlay__title">{overlay.title}</div>
            ) : null}
            {Array.isArray(overlay.descriptions) && overlay.descriptions.length > 0 ? (
              overlay.descriptions.map((line, idx) => (
                <p className="fitness-player-overlay__line" key={`generic-desc-${idx}`}>{line}</p>
              ))
            ) : null}
          </div>
        </div>
      );
    }
  }

  if (!primaryOverlay && !voiceMemoOverlayOpen && !challengeOverlay) {
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
  stallStatus: PropTypes.shape({
    isStalled: PropTypes.bool,
    since: PropTypes.number,
    attempts: PropTypes.number,
    lastStrategy: PropTypes.string
  }),
  onReload: PropTypes.func,
  currentTime: PropTypes.number,
  lastKnownTimeRef: PropTypes.shape({
    current: PropTypes.number
  }),
  playerRef: PropTypes.shape({
    current: PropTypes.any
  })
};

export default FitnessPlayerOverlay;
