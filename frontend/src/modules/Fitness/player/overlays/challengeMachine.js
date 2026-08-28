// challengeMachine.js — pure challenge state derivation (phase machine +
// overlay view-model) for ChallengeOverlay.jsx, split out so Fast Refresh can
// hot-reload the overlay component on its own.
import { useEffect, useMemo, useRef, useState } from 'react';
import { CHALLENGE_SUCCESS_HOLD_MS } from './ChallengeOverlay.jsx';

export const CHALLENGE_PHASES = Object.freeze({
	off: 'off',
	on: 'on',
	done: 'done'
});
const DEFAULT_ZONE_COLORS = {
  cool: '#38bdf8',
  active: '#22c55e',
  warm: '#facc15',
  hot: '#f97316',
  fire: '#ef4444'
};

const clearTimerRef = (timerRef) => {
	if (timerRef.current?.timeoutId) {
		clearTimeout(timerRef.current.timeoutId);
	}
	timerRef.current = null;
};

const normalizeChallengeStatus = (status) => {
	if (status === 'success') return 'success';
	if (status === 'failed') return 'failed';
	if (status === 'pending') return 'pending';
	return 'pending';
};

const getChallengeKey = (challenge) => {
	if (!challenge) return null;
	return (
		challenge.id ||
		challenge.selectionLabel ||
		challenge.zone ||
		challenge.zoneLabel ||
		'__challenge__'
	);
};

const normalizeZoneKey = (value) => {
	if (!value) return '';
	const normalized = String(value).trim().toLowerCase();
	if (!normalized) return '';
	const canonical = ['cool', 'active', 'warm', 'hot', 'fire'];
	for (const key of canonical) {
		if (normalized === key) return key;
		if (normalized.includes(key)) return key;
	}
	return normalized.replace(/zone$/g, '').replace(/[^a-z0-9]+/g, '').trim();
};

const toSecondsLabel = (value) => (Number.isFinite(value) ? `${Math.max(0, Math.round(value))}` : '—');

export const useChallengeMachine = (challenge) => {
	const [dismissedChallengeId, setDismissedChallengeId] = useState(null);
	const successHideTimerRef = useRef(null);

	useEffect(() => {
		const hasChallenge = Boolean(challenge);
		const status = hasChallenge ? normalizeChallengeStatus(challenge.status) : 'off';
		const challengeKey = getChallengeKey(challenge);

		if (!hasChallenge || status === 'pending' || status === 'failed') {
			if (dismissedChallengeId !== null) {
				setDismissedChallengeId(null);
			}
		}

		if (!hasChallenge || status !== 'success') {
			clearTimerRef(successHideTimerRef);
			return;
		}

		if (!challengeKey || (dismissedChallengeId && dismissedChallengeId === challengeKey)) {
			return;
		}

		const timerMeta = successHideTimerRef.current;
		if (!timerMeta || timerMeta.key !== challengeKey) {
			clearTimerRef(successHideTimerRef);
			const timeoutId = setTimeout(() => {
				setDismissedChallengeId(challengeKey);
				successHideTimerRef.current = null;
			}, CHALLENGE_SUCCESS_HOLD_MS);
			successHideTimerRef.current = { key: challengeKey, timeoutId };
		}
	}, [challenge, dismissedChallengeId]);

	useEffect(() => () => {
		clearTimerRef(successHideTimerRef);
	}, []);

	return useMemo(() => {
		const hasChallenge = Boolean(challenge);
		const status = hasChallenge ? normalizeChallengeStatus(challenge.status) : 'off';
		const challengeKey = getChallengeKey(challenge);
		const challengeDismissed = challengeKey && dismissedChallengeId === challengeKey;
		let phase = CHALLENGE_PHASES.off;
		if (hasChallenge && status === 'pending') {
			phase = CHALLENGE_PHASES.on;
		} else if (hasChallenge && status === 'success' && !challengeDismissed) {
			phase = CHALLENGE_PHASES.done;
		}
		return {
			phase,
			show: phase !== CHALLENGE_PHASES.off,
			status,
			challengeDismissed
		};
	}, [challenge, dismissedChallengeId]);
};

export const useChallengeOverlays = (governanceState, zones) => {
	const zoneColorLookup = useMemo(() => {
		const lookup = {};
		if (Array.isArray(zones)) {
			zones.forEach((zone) => {
				if (!zone) return;
				const key = normalizeZoneKey(zone.id || zone.label || zone.name);
				if (!key) return;
				const color = zone.color || zone.zoneColor || null;
				if (!color) return;
				lookup[key] = color;
			});
		}
		return lookup;
	}, [zones]);

	const pauseSnapshotRef = useRef({
		id: null,
		remainingSeconds: null,
		progress: 0
	});
	const challengeMachine = useChallengeMachine(governanceState?.challenge);

	return useMemo(() => {
	const resolveZoneDetails = (value) => {
		const key = normalizeZoneKey(value);
		if (!key) {
			return { id: null, color: null };
		}
		return {
			id: key,
			color: zoneColorLookup[key] || DEFAULT_ZONE_COLORS[key] || null
		};
	};

	const current = {
		category: 'challenge',
		variant: 'current',
		status: null,
		phase: CHALLENGE_PHASES.off,
		show: false,
		title: '',
		zoneLabel: '',
		zoneId: null,
		selectionLabel: '',
		remainingSeconds: null,
		totalSeconds: null,
		requiredCount: 0,
		actualCount: 0,
		progress: 0,
		missingUsers: [],
		metUsers: [],
		statusLabel: '',
		timeLabel: '—',
		countdownPaused: false,
		ringColor: null,
		satisfied: false,
		done: false,
		timeLeftSeconds: null
	};

	const upcoming = {
		category: 'challenge',
		variant: 'upcoming',
		status: 'upcoming',
		show: false,
		title: '',
		zoneLabel: '',
		zoneId: null,
		selectionLabel: '',
		remainingSeconds: null,
		totalSeconds: null,
		requiredCount: 0,
		actualCount: 0,
		progress: 0,
		statusLabel: 'Next',
		timeLabel: '—',
		countdownPaused: false,
		ringColor: null,
		phase: CHALLENGE_PHASES.off,
		satisfied: false,
		done: false,
		timeLeftSeconds: null
	};

	const challenge = governanceState?.challenge;
	const countdownPaused = Boolean(
		(governanceState?.status === 'warning') ||
		governanceState?.challengePaused ||
		challenge?.paused
	);
	const pausedByGovernance = governanceState?.status === 'warning';
	const challengePhase = challengeMachine.phase;
	const isChallengeVisible = challengeMachine.show;

	const resetPauseSnapshot = () => {
		pauseSnapshotRef.current = {
			id: null,
			remainingSeconds: null,
			progress: 0
		};
	};

	if (challenge) {
		const status = normalizeChallengeStatus(challenge.status);
		const totalSeconds = Number.isFinite(challenge.totalSeconds)
			? Math.max(1, challenge.totalSeconds)
			: Number.isFinite(challenge.timeLimitSeconds)
				? Math.max(1, challenge.timeLimitSeconds)
				: null;
		const remainingSeconds = Number.isFinite(challenge.remainingSeconds)
			? Math.max(0, Math.round(challenge.remainingSeconds))
			: null;
		const requiredCount = Number.isFinite(challenge.requiredCount) ? Math.max(0, challenge.requiredCount) : 0;
		const actualCount = Number.isFinite(challenge.actualCount) ? Math.max(0, challenge.actualCount) : 0;
		const missingUsers = Array.isArray(challenge.missingUsers) ? challenge.missingUsers.filter(Boolean) : [];
		const metUsers = Array.isArray(challenge.metUsers) ? challenge.metUsers.filter(Boolean) : [];
		const zoneLabel = challenge.zoneLabel || challenge.zone || 'Zone';
		const zoneInfo = resolveZoneDetails(challenge.zone || challenge.zoneLabel);
		const selectionLabel = challenge.selectionLabel || '';
		let progress = totalSeconds
			? Math.max(
					0,
					Math.min(
						1,
						(totalSeconds - Math.min(remainingSeconds ?? totalSeconds, totalSeconds)) / totalSeconds
					)
				)
			: 0;

		const challengeId = challenge.id || null;
		let effectiveRemainingSeconds = remainingSeconds;
		let snapshot = pauseSnapshotRef.current;
		const shouldFreeze = status === 'pending' && countdownPaused;

		if (snapshot.id !== challengeId) {
			snapshot = {
				id: challengeId,
				remainingSeconds,
				progress
			};
		}

		if (shouldFreeze) {
			if (snapshot.id !== challengeId || snapshot.remainingSeconds == null) {
				snapshot = {
					id: challengeId,
					remainingSeconds,
					progress
				};
			}
			effectiveRemainingSeconds = snapshot.remainingSeconds ?? remainingSeconds;
			progress = snapshot.progress ?? progress;
		} else {
			snapshot = {
				id: challengeId,
				remainingSeconds,
				progress
			};
		}

		pauseSnapshotRef.current = snapshot;

		const finalRemainingSeconds = shouldFreeze ? effectiveRemainingSeconds : remainingSeconds;
		const timeLabel = Number.isFinite(finalRemainingSeconds) ? toSecondsLabel(finalRemainingSeconds) : '—';
		const satisfied = Number.isFinite(requiredCount) && Number.isFinite(actualCount)
			? actualCount >= requiredCount
			: Array.isArray(missingUsers)
				? missingUsers.length === 0
				: false;
		const isDonePhase = challengePhase === CHALLENGE_PHASES.done;
		let statusLabel = '';
		if (isDonePhase) {
			statusLabel = 'Done';
		} else if (countdownPaused) {
			statusLabel = 'Paused';
		} else {
			statusLabel = 'Active';
		}

		const shouldRenderOverlay = Boolean(
			isChallengeVisible &&
			(status === 'pending' || isDonePhase) &&
			!pausedByGovernance
		);

		Object.assign(current, {
			status: isDonePhase ? 'success' : 'pending',
			phase: challengePhase,
			show: shouldRenderOverlay,
			satisfied,
			done: isDonePhase,
			timeLeftSeconds: finalRemainingSeconds,
			title: zoneLabel,
			zoneLabel,
			zoneId: zoneInfo.id,
			selectionLabel,
			remainingSeconds: finalRemainingSeconds,
			totalSeconds,
			requiredCount,
			actualCount,
			progress,
			missingUsers,
			metUsers,
			statusLabel,
			timeLabel,
			countdownPaused,
			// Issue 1: keep the target zone color on success — a green ring reads as
			// the "active" HR zone. Success is signalled by a green check badge
			// (rendered in the center) while the ring stays the zone hue.
			ringColor: zoneInfo.color
		});
	} else {
		resetPauseSnapshot();
	}

	// Next challenge countdown remains invisible per governance spec.
	upcoming.show = false;

	return { current, upcoming };
	}, [challengeMachine, governanceState, zoneColorLookup]);
};

