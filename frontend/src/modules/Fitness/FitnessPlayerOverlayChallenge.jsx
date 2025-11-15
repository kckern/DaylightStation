import React, { useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import './FitnessPlayerOverlayChallenge.scss';

const CHALLENGE_VIEWBOX_SIZE = 220;
const CHALLENGE_RING_RADIUS = 95;
const CHALLENGE_RING_CIRCUMFERENCE = 2 * Math.PI * CHALLENGE_RING_RADIUS;
const CHALLENGE_RING_CENTER = CHALLENGE_VIEWBOX_SIZE / 2;
const DEFAULT_RING_COLOR = '#38bdf8';
const SUCCESS_RING_COLOR = '#22c55e';
const FAILURE_RING_COLOR = '#ef4444';
const DEFAULT_ZONE_COLORS = {
  cool: '#38bdf8',
  active: '#22c55e',
  warm: '#facc15',
  hot: '#f97316',
  fire: '#ef4444'
};

const normalizeChallengeStatus = (status) => {
	if (status === 'success') return 'success';
	if (status === 'failed') return 'failed';
	return 'pending';
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

const toSecondsLabel = (value) => (Number.isFinite(value) ? `${Math.max(0, Math.round(value))}s` : '—');

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
		ringColor: null
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
		ringColor: null
	};

	const challenge = governanceState?.challenge;
	const countdownPaused = Boolean(
		(governanceState?.status === 'yellow') ||
		governanceState?.challengePaused ||
		challenge?.paused
	);

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
		let statusLabel = '';
		if (status === 'success') {
			statusLabel = 'Done';
		} else if (countdownPaused) {
			statusLabel = 'Paused';
		}

		Object.assign(current, {
			status,
			show: status === 'pending' || status === 'success',
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
			ringColor: status === 'success' ? SUCCESS_RING_COLOR : zoneInfo.color
		});
	} else {
		resetPauseSnapshot();
	}

	const nextChallenge = governanceState?.nextChallenge;
	if (nextChallenge) {
		const remainingSeconds = Number.isFinite(nextChallenge.remainingSeconds)
			? Math.max(0, Math.round(nextChallenge.remainingSeconds))
			: null;
		const timeLimit = Number.isFinite(nextChallenge.timeLimitSeconds)
			? Math.max(1, nextChallenge.timeLimitSeconds)
			: null;
		const requiredCount = Number.isFinite(nextChallenge.requiredCount)
			? Math.max(0, nextChallenge.requiredCount)
			: 0;
		const zoneLabel = nextChallenge.selectionLabel || nextChallenge.zoneLabel || nextChallenge.zone || 'Next challenge';
		const targetZone = nextChallenge.zone || nextChallenge.zoneLabel || '';
		const zoneInfo = resolveZoneDetails(targetZone);
		const timeLabel = toSecondsLabel(remainingSeconds);

		Object.assign(upcoming, {
			show: true,
			title: zoneLabel,
			zoneLabel,
			zoneId: zoneInfo.id,
			selectionLabel: nextChallenge.selectionLabel || '',
			remainingSeconds,
			totalSeconds: timeLimit,
			requiredCount,
			actualCount: 0,
			statusLabel: 'Next',
			timeLabel,
			countdownPaused: false,
			ringColor: zoneInfo.color
		});
	}

	return { current, upcoming };
	}, [governanceState, zoneColorLookup]);
};

export const ChallengeOverlay = ({ overlay }) => {
	if (!overlay?.show) {
		return null;
	}

	const {
		variant,
		status,
		title,
		requiredCount,
		actualCount,
		statusLabel,
		timeLabel,
		countdownPaused,
		ringColor
	} = overlay;
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

	const classNames = ['challenge-overlay'];
	if (variant === 'upcoming') {
		classNames.push('challenge-overlay--upcoming');
	} else if (status) {
		classNames.push(`challenge-overlay--${status}`);
	}
	if (countdownPaused) {
		classNames.push('challenge-overlay--paused');
	}

	const normalizedTime = timeLabel || '—';
	const normalizedTitle = title || 'Challenge';
	const normalizedActual = Number.isFinite(actualCount) ? actualCount : 0;
	const normalizedTarget = Number.isFinite(requiredCount) ? requiredCount : 0;
	const showSplitCounts = variant !== 'upcoming';

	return (
		<div className={classNames.join(' ')}>
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
					style={{
						strokeDasharray: `${CHALLENGE_RING_CIRCUMFERENCE}px`,
						strokeDashoffset: `${strokeOffset}px`,
						stroke: resolvedRingColor
					}}
				/>
			</svg>
			<div className="challenge-overlay__content">
				<div className="challenge-overlay__top">
					<div className="challenge-overlay__title">{normalizedTitle}</div>
					<div className="challenge-overlay__counts" aria-label="Challenge progress">
						{showSplitCounts ? (
							<>
								<span className="challenge-overlay__count">{normalizedActual}</span>
								<span className="challenge-overlay__divider">/</span>
								<span className="challenge-overlay__count challenge-overlay__count--target">{normalizedTarget}</span>
							</>
						) : (
							<span className="challenge-overlay__count challenge-overlay__count--target">{normalizedTarget}</span>
						)}
					</div>
					{statusLabel ? (
						<div className="challenge-overlay__status">{statusLabel}</div>
					) : null}
				</div>
				<div className="challenge-overlay__bottom">
					<div className="challenge-overlay__time" aria-label="Time remaining">{normalizedTime}</div>
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
		zoneId: PropTypes.string
	})
};

export default ChallengeOverlay;
