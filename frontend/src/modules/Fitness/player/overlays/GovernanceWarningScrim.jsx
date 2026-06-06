import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import useDeadlineCountdown from '@/modules/Fitness/shared/hooks/useDeadlineCountdown.js';
import { computeWarningScrimStyle } from './warningScrimStyle.js';

// Per-notch resolution for the ramp. ~60 steps over the grace period keeps the
// darken/blur visibly continuous (the SCSS transition smooths between steps).
const SCRIM_NOTCHES = 60;

/**
 * The governance "warning" scrim: darkens / blurs / desaturates the workout
 * video during the grace period and ramps that intensity up as the countdown
 * depletes toward lock, so the screen visibly closes in.
 *
 * Runs its own countdown so only this element re-renders per tick — not the
 * whole FitnessPlayer. Falls back to a static scrim when no deadline is known.
 */
export function GovernanceWarningScrim({ deadline, totalSeconds }) {
  const total = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 30;
  const { remaining } = useDeadlineCountdown(deadline ?? null, total, SCRIM_NOTCHES);
  const style = useMemo(
    () => computeWarningScrimStyle(remaining, total),
    [remaining, total]
  );

  return <div className="governance-warning-scrim" style={style} aria-hidden="true" />;
}

GovernanceWarningScrim.propTypes = {
  deadline: PropTypes.number,
  totalSeconds: PropTypes.number
};

export default GovernanceWarningScrim;
