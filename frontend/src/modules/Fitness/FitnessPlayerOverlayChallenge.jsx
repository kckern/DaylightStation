import React, { useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import './FitnessPlayerOverlayChallenge.scss';

const CHALLENGE_RING_RADIUS = 32;
const CHALLENGE_RING_CIRCUMFERENCE = 2 * Math.PI * CHALLENGE_RING_RADIUS;

const normalizeChallengeStatus = (status) => {
	if (status === 'success') return 'success';
	if (status === 'failed') return 'failed';
	return 'pending';
};

const toSecondsLabel = (value) => (Number.isFinite(value) ? `${Math.max(0, Math.round(value))}s` : '—');

export const useChallengeOverlays = (governanceState) => {
	const pauseSnapshotRef = useRef({
		id: null,
		remainingSeconds: null,
		progress: 0
	});

	return useMemo(() => {
	const current = {
		category: 'challenge',
		variant: 'current',
		status: null,
		show: false,
		title: '',
		zoneLabel: '',
		selectionLabel: '',
		remainingSeconds: null,
		totalSeconds: null,
		requiredCount: 0,
		actualCount: 0,
		progress: 0,
		metaLabel: '',
		hint: '',
		hintVariant: null,
		missingUsers: [],
		metUsers: [],
		remainingSecondsLabel: '—',
		statusLabel: '',
		timeLabel: '—'
	};

	const upcoming = {
		category: 'challenge',
		variant: 'upcoming',
		status: 'upcoming',
		show: false,
		title: '',
		zoneLabel: '',
		selectionLabel: '',
		remainingSeconds: null,
		totalSeconds: null,
		requiredCount: 0,
		actualCount: 0,
		progress: 0,
		metaLabel: 'Upcoming',
		hint: '',
		hintVariant: null,
		missingUsers: [],
		metUsers: [],
		remainingSecondsLabel: '—',
		statusLabel: '',
		timeLabel: '—'
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

		let hint = '';
		let hintVariant = null;
		if (missingUsers.length) {
			hint = `Need: ${missingUsers.join(', ')}`;
			hintVariant = 'need';
		} else if (metUsers.length) {
			hint = `Met: ${metUsers.join(', ')}`;
			hintVariant = 'met';
		}

		const baseMetaLabel =
			status === 'pending'
				? 'Challenge active'
				: status === 'success'
					? 'Challenge completed'
					: 'Challenge failed';

		Object.assign(current, {
			status,
			show: status === 'pending' || status === 'success',
			title: zoneLabel,
			zoneLabel,
			selectionLabel,
			remainingSeconds: finalRemainingSeconds,
			totalSeconds,
			requiredCount,
			actualCount,
			progress,
			metaLabel: countdownPaused ? 'Challenge paused' : baseMetaLabel,
			hint,
			hintVariant,
			missingUsers,
			metUsers,
			remainingSecondsLabel: timeLabel,
			statusLabel,
			timeLabel,
			countdownPaused
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
		const timeLabel = toSecondsLabel(remainingSeconds);

		Object.assign(upcoming, {
			show: true,
			title: zoneLabel,
			zoneLabel,
			selectionLabel: nextChallenge.selectionLabel || '',
			remainingSeconds,
			totalSeconds: timeLimit,
			requiredCount,
			metaLabel: timeLimit != null ? `${timeLimit}s limit` : 'Upcoming',
			hint: targetZone ? `Target: ${targetZone}` : '',
			remainingSecondsLabel: timeLabel,
			statusLabel: 'Next',
			timeLabel
		});
	}

	return { current, upcoming };
	}, [governanceState]);
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
		metaLabel,
		hint,
		hintVariant,
		remainingSecondsLabel,
		countdownPaused
	} = overlay;
	const clampedProgress = Math.max(0, Math.min(1, overlay.progress ?? 0));
	const strokeOffset = variant === 'upcoming'
		? CHALLENGE_RING_CIRCUMFERENCE
		: CHALLENGE_RING_CIRCUMFERENCE * (1 - clampedProgress);

	const classNames = ['challenge-overlay'];
	if (variant === 'upcoming') {
		classNames.push('challenge-overlay--upcoming');
	} else if (status) {
		classNames.push(`challenge-overlay--${status}`);
	}
	if (countdownPaused) {
		classNames.push('challenge-overlay--paused');
	}

	return (
		<div className={classNames.join(' ')}>
			<div className="challenge-overlay__timer">
				<svg viewBox="0 0 80 80" aria-hidden="true">
					<circle className="challenge-overlay__timer-bg" cx="40" cy="40" r={CHALLENGE_RING_RADIUS} />
					<circle
						className="challenge-overlay__timer-progress"
						cx="40"
						cy="40"
						r={CHALLENGE_RING_RADIUS}
						style={{
							strokeDasharray: `${CHALLENGE_RING_CIRCUMFERENCE}px`,
							strokeDashoffset: `${strokeOffset}px`
						}}
					/>
				</svg>
				<div className="challenge-overlay__timer-label">
					{remainingSecondsLabel}
				</div>
			</div>
			<div className="challenge-overlay__body">
				<div className="challenge-overlay__title">{title || 'Challenge'}</div>
				{variant === 'upcoming' ? (
					<>
						<div className="challenge-overlay__counts">
							<span className="challenge-overlay__count">{requiredCount ?? 0}</span>
							<span className="challenge-overlay__divider">req</span>
						</div>
						<div className="challenge-overlay__meta">{metaLabel}</div>
						{hint ? (
							<div className="challenge-overlay__hint">{hint}</div>
						) : null}
					</>
				) : (
					<>
						<div className="challenge-overlay__counts">
							<span className="challenge-overlay__count">{actualCount ?? 0}</span>
							<span className="challenge-overlay__divider">/</span>
							<span className="challenge-overlay__count challenge-overlay__count--target">{requiredCount ?? 0}</span>
						</div>
						<div className="challenge-overlay__meta">{metaLabel}</div>
						{hint ? (
							<div className={`challenge-overlay__hint${hintVariant === 'met' ? ' challenge-overlay__hint--met' : ''}`}>{hint}</div>
						) : null}
					</>
				)}
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
		metaLabel: PropTypes.string,
		hint: PropTypes.string,
		hintVariant: PropTypes.string,
		progress: PropTypes.number,
		remainingSecondsLabel: PropTypes.string,
		countdownPaused: PropTypes.bool
	})
};

export default ChallengeOverlay;
