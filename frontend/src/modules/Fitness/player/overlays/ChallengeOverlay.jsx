import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import CompletionCountBlocks from './CompletionCountBlocks.jsx';
import './ChallengeOverlay.scss';

const CHALLENGE_VIEWBOX_SIZE = 220;
const CHALLENGE_RING_RADIUS = 95;
const CHALLENGE_RING_CIRCUMFERENCE = 2 * Math.PI * CHALLENGE_RING_RADIUS;
const CHALLENGE_RING_CENTER = CHALLENGE_VIEWBOX_SIZE / 2;
export const CHALLENGE_SUCCESS_HOLD_MS = 2000;
const DEFAULT_RING_COLOR = '#38bdf8';
const SUCCESS_RING_COLOR = '#22c55e';
const FAILURE_RING_COLOR = '#ef4444';

export const ChallengeOverlay = ({ overlay }) => {
	// Hooks must run unconditionally, so these are derived with optional
	// chaining ahead of the `!overlay?.show` early return below, rather than
	// after destructuring `overlay` (which only happens once `show` is known
	// true). The computed value is simply unused/discarded when hidden.
	const clampedProgress = Math.max(0, Math.min(1, overlay?.progress ?? 0));
	const isSuccess = overlay?.status === 'success';
	const strokeOffset = overlay?.variant === 'upcoming'
		? CHALLENGE_RING_CIRCUMFERENCE
		: isSuccess
			? 0
			: CHALLENGE_RING_CIRCUMFERENCE * clampedProgress;
	const fallbackRingColor = overlay?.variant === 'upcoming'
		? 'rgba(148, 163, 184, 0.55)'
		: overlay?.status === 'failed'
			? FAILURE_RING_COLOR
			: isSuccess
				? SUCCESS_RING_COLOR
				: DEFAULT_RING_COLOR;
	const resolvedRingColor = overlay?.ringColor || fallbackRingColor;
	const ringStyle = useMemo(() => ({
		strokeDasharray: `${CHALLENGE_RING_CIRCUMFERENCE}px`,
		strokeDashoffset: `${strokeOffset}px`,
		stroke: resolvedRingColor,
		'--challenge-ring-circumference': `${CHALLENGE_RING_CIRCUMFERENCE}px`
	}), [strokeOffset, resolvedRingColor]);

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
		metUsers,
		statusLabel,
		timeLabel,
		countdownPaused,
		timeLeftSeconds
	} = overlay;

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

	const hideTime = Number.isFinite(timeLeftSeconds) && timeLeftSeconds <= 0;
	const normalizedTime = hideTime ? '' : (timeLabel || '—');
	const normalizedTitle = title || 'Challenge';
	const normalizedTarget = Number.isFinite(requiredCount) ? Math.max(0, requiredCount) : 0;
	const normalizedActual = Number.isFinite(actualCount) ? Math.max(0, actualCount) : 0;
	const clampedActual = normalizedTarget > 0 ? Math.min(normalizedTarget, normalizedActual) : normalizedActual;
	const showCountBlocks = variant !== 'upcoming' && normalizedTarget > 0;
	const countAriaLabel = showCountBlocks
		? `Challenge completion ${clampedActual} of ${normalizedTarget}`
		: undefined;
	const timeAriaLabel = hideTime
		? statusLabel ? `${statusLabel}: timer complete` : 'Timer complete'
		: statusLabel ? `${statusLabel}: ${normalizedTime} seconds` : `Time remaining ${normalizedTime} seconds`;

	return (
		<div
			className={classNames.join(' ')}
			aria-label={`${normalizedTitle} challenge overlay`}
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
						<CompletionCountBlocks
							targetCount={normalizedTarget}
							actualCount={normalizedActual}
							metUsers={Array.isArray(metUsers) ? metUsers : []}
							containerClassName="challenge-overlay__count-blocks"
							blockClassName="challenge-overlay__count-block"
							completeBlockClassName="challenge-overlay__count-block--complete"
							ariaLabel={countAriaLabel}
						/>
					)}
				</div>
				<div className="challenge-overlay__time-block" aria-label={timeAriaLabel} role="timer">
					{isSuccess ? (
						<span className="challenge-overlay__done-check" aria-hidden="true">✓</span>
					) : (
						<div className="challenge-overlay__time">{normalizedTime}</div>
					)}
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
		metUsers: PropTypes.array,
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
