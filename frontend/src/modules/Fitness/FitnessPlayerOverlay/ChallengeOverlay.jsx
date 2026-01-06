import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import './ChallengeOverlay.scss';

const CHALLENGE_VIEWBOX_SIZE = 220;
const CHALLENGE_RING_RADIUS = 95;
const CHALLENGE_RING_CIRCUMFERENCE = 2 * Math.PI * CHALLENGE_RING_RADIUS;
const CHALLENGE_RING_CENTER = CHALLENGE_VIEWBOX_SIZE / 2;
const CHALLENGE_SUCCESS_HOLD_MS = 2000;
const CHALLENGE_POSITION_KEY = 'fitness.challengeOverlay.position';
const CHALLENGE_POSITION_ORDER = ['top', 'middle', 'bottom'];
const DEFAULT_RING_COLOR = '#38bdf8';
const SUCCESS_RING_COLOR = '#22c55e';
const FAILURE_RING_COLOR = '#ef4444';
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

const readStoredOverlayPosition = () => {
	if (typeof window === 'undefined' || !window?.localStorage) {
		return CHALLENGE_POSITION_ORDER[0];
	}
	try {
		const stored = window.localStorage.getItem(CHALLENGE_POSITION_KEY);
		return CHALLENGE_POSITION_ORDER.includes(stored) ? stored : CHALLENGE_POSITION_ORDER[0];
	} catch (_) {
		return CHALLENGE_POSITION_ORDER[0];
	}
};

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
		const zoneLabel = challenge.zoneLabel || challenge.zone || 'Target zone';
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
			ringColor: isDonePhase ? SUCCESS_RING_COLOR : zoneInfo.color
		});
	} else {
		resetPauseSnapshot();
	}

	// Next challenge countdown remains invisible per governance spec.
	upcoming.show = false;

	return { current, upcoming };
	}, [challengeMachine, governanceState, zoneColorLookup]);
};

export const ChallengeOverlay = ({ overlay }) => {
	if (!overlay?.show) {
		return null;
	}

	const {
		phase,
		variant,
		status,
		title,
		requiredCount,
		actualCount,
		statusLabel,
		timeLabel,
		countdownPaused,
		ringColor,
		timeLeftSeconds
	} = overlay;
	const [position, setPosition] = useState(() => readStoredOverlayPosition());

	useEffect(() => {
		setPosition(readStoredOverlayPosition());
	}, []);

	const cyclePosition = useCallback(() => {
		setPosition((current) => {
			const currentIndex = CHALLENGE_POSITION_ORDER.indexOf(current);
			const nextIndex = (currentIndex + 1) % CHALLENGE_POSITION_ORDER.length;
			const nextPosition = CHALLENGE_POSITION_ORDER[nextIndex];
			if (typeof window !== 'undefined' && window?.localStorage) {
				try {
					window.localStorage.setItem(CHALLENGE_POSITION_KEY, nextPosition);
				} catch (_) {}
			}
			return nextPosition;
		});
	}, []);

	const handleClick = useCallback((event) => {
		event.stopPropagation();
		cyclePosition();
	}, [cyclePosition]);

	const handlePointerDown = useCallback((event) => {
		event.stopPropagation();
	}, []);

	const handleKeyDown = useCallback((event) => {
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			event.stopPropagation();
			cyclePosition();
		}
	}, [cyclePosition]);
	const clampedProgress = Math.max(0, Math.min(1, overlay.progress ?? 0));
	const isSuccess = status === 'success';
	const strokeOffset = variant === 'upcoming'
		? CHALLENGE_RING_CIRCUMFERENCE
		: isSuccess
			? 0
			: CHALLENGE_RING_CIRCUMFERENCE * clampedProgress;
	const fallbackRingColor = variant === 'upcoming'
		? 'rgba(148, 163, 184, 0.55)'
		: status === 'failed'
			? FAILURE_RING_COLOR
			: isSuccess
				? SUCCESS_RING_COLOR
				: DEFAULT_RING_COLOR;
	const resolvedRingColor = ringColor || fallbackRingColor;
	const ringStyle = useMemo(() => ({
		strokeDasharray: `${CHALLENGE_RING_CIRCUMFERENCE}px`,
		strokeDashoffset: `${strokeOffset}px`,
		stroke: resolvedRingColor,
		'--challenge-ring-circumference': `${CHALLENGE_RING_CIRCUMFERENCE}px`
	}), [strokeOffset, resolvedRingColor]);

	const classNames = ['challenge-overlay'];
	if (phase) {
		classNames.push(`challenge-overlay--phase-${phase}`);
	}
	if (variant === 'upcoming') {
		classNames.push('challenge-overlay--upcoming');
	} else if (status) {
		classNames.push(`challenge-overlay--${status}`);
	}
	if (countdownPaused) {
		classNames.push('challenge-overlay--paused');
	}
	if (position && CHALLENGE_POSITION_ORDER.includes(position)) {
		classNames.push(`challenge-overlay--pos-${position}`);
	}

	const hideTime = Number.isFinite(timeLeftSeconds) && timeLeftSeconds <= 0;
	const normalizedTime = hideTime ? '' : (timeLabel || '—');
	const normalizedTitle = title || 'Challenge';
	const normalizedTarget = Number.isFinite(requiredCount) ? Math.max(0, requiredCount) : 0;
	const normalizedActual = Number.isFinite(actualCount) ? Math.max(0, actualCount) : 0;
	const clampedActual = normalizedTarget > 0 ? Math.min(normalizedTarget, normalizedActual) : normalizedActual;
	const countBlocks = normalizedTarget > 0
		? Array.from({ length: normalizedTarget }, (_, index) => ({
			id: index + 1,
			complete: index < clampedActual
		}))
		: [];
	const showCountBlocks = variant !== 'upcoming' && countBlocks.length > 0;
	const countAriaLabel = showCountBlocks
		? `Challenge completion ${clampedActual} of ${normalizedTarget}`
		: undefined;
	const timeAriaLabel = hideTime
		? statusLabel ? `${statusLabel}: timer complete` : 'Timer complete'
		: statusLabel ? `${statusLabel}: ${normalizedTime} seconds` : `Time remaining ${normalizedTime} seconds`;
	const positionLabel = position === 'middle'
		? 'middle'
		: position === 'bottom'
			? 'bottom'
			: 'top';

	return (
		<div
			className={classNames.join(' ')}
			onClick={handleClick}
			onPointerDown={handlePointerDown}
			onKeyDown={handleKeyDown}
			role="button"
			tabIndex={0}
			aria-label={`${normalizedTitle} challenge overlay, positioned ${positionLabel}. Tap to move.`}
		>
			<svg
				className="challenge-overlay__ring"
				viewBox={`0 0 ${CHALLENGE_VIEWBOX_SIZE} ${CHALLENGE_VIEWBOX_SIZE}`}
				aria-hidden="true"
			>
				<circle
					className="challenge-overlay__ring-track"
					cx={CHALLENGE_RING_CENTER}
					cy={CHALLENGE_RING_CENTER}
					r={CHALLENGE_RING_RADIUS}
				/>
				<circle
					className="challenge-overlay__ring-progress"
					cx={CHALLENGE_RING_CENTER}
					cy={CHALLENGE_RING_CENTER}
					r={CHALLENGE_RING_RADIUS}
					style={ringStyle}
				/>
			</svg>
			<div className="challenge-overlay__content">
				<div className="challenge-overlay__meta">
					<div className="challenge-overlay__title">{normalizedTitle}</div>
					{showCountBlocks && (
						<div
							className="challenge-overlay__count-blocks"
							role="meter"
							aria-label={countAriaLabel}
							aria-valuemin={0}
							aria-valuemax={normalizedTarget}
							aria-valuenow={clampedActual}
						>
							{countBlocks.map((block) => (
								<span
									key={block.id}
									className={[
										'challenge-overlay__count-block',
										block.complete ? 'challenge-overlay__count-block--complete' : null
									].filter(Boolean).join(' ')}
									aria-hidden="true"
								/>
							))}
						</div>
					)}
				</div>
				<div className="challenge-overlay__time-block" aria-label={timeAriaLabel} role="timer">
					<div className="challenge-overlay__time">{isSuccess ? '✅' : normalizedTime}</div>
				</div>
			</div>
		</div>
	);
};

ChallengeOverlay.propTypes = {
	overlay: PropTypes.shape({
		show: PropTypes.bool,
		variant: PropTypes.string,
		status: PropTypes.string,
		title: PropTypes.string,
		requiredCount: PropTypes.number,
		actualCount: PropTypes.number,
		progress: PropTypes.number,
		statusLabel: PropTypes.string,
		timeLabel: PropTypes.string,
		countdownPaused: PropTypes.bool,
		ringColor: PropTypes.string,
		zoneLabel: PropTypes.string,
		zoneId: PropTypes.string,
		phase: PropTypes.string,
		satisfied: PropTypes.bool,
		done: PropTypes.bool,
		timeLeftSeconds: PropTypes.number
	})
};

export default ChallengeOverlay;
