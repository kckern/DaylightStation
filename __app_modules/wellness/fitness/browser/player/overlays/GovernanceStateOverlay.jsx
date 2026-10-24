import React, { useMemo, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import { DaylightMediaPath } from '@/lib/api.mjs';
import { getLogger } from '@/lib/logging/Logger.js';
import { useDeadlineCountdown } from "../../shared/index.js";
import GovernanceAudioPlayer from "./GovernanceAudioPlayer.jsx";
import CompletionAvatars from "./CompletionAvatars.jsx";
import LockIcon from "./LockIcon.jsx";
import "./GovernanceStateOverlay.scss";
import { checkOverlayPaint, describeCompositing } from "./overlayPaintCheck.js";
import { warningScrimStep } from "./warningScrimStep.js";
import { createFrameTimingProbe } from "./frameTimingProbe.js";

const TOTAL_NOTCHES = 56;

// The crank icon keeps the pedal OR zone instruction in the existing row.
function PedalFeedback({ pedal }) {
  const instruction = pedal?.orZoneLabel ? `Pedal or reach ${pedal.orZoneLabel}` : 'Start pedaling';
  const rpm = Number.isFinite(pedal?.rpm) ? Math.max(0, Math.round(pedal.rpm)) : null;
  return <span className="governance-pedal-feedback">
    <span className="governance-pedal-icon" role="img" aria-label={instruction}>
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="3" /><path d="m10 14-5 5m9-9 5-5M2 19h6M16 5h6" strokeLinecap="round" />
      </svg>
    </span>
    {rpm != null ? <span aria-label={`${rpm} of ${pedal.targetRpm ?? 0} rotations per minute`}>{rpm}{Number.isFinite(pedal.targetRpm) ? ` / ${Math.round(pedal.targetRpm)}` : ''}</span> : null}
  </span>;
}

function HoldProgress({ row }) {
  const hold = row.holdProgress;
  if (!hold || !Number.isFinite(hold.totalMs) || hold.totalMs <= 0) return null;
  const elapsedMs = Math.max(0, Math.min(hold.totalMs, hold.elapsedMs || 0));
  return <div className="governance-hold-progress" role="progressbar"
    aria-label={`${row.displayName || row.name || row.userId} zone hold`}
    aria-valuemin={0} aria-valuemax={hold.totalMs} aria-valuenow={elapsedMs}
    aria-valuetext={`${Math.ceil(Math.max(0, hold.totalMs - elapsedMs) / 1000)} seconds remaining`}>
    <span style={{ transform: `scaleX(${elapsedMs / hold.totalMs})`, background: row.targetZone?.color || undefined }} />
  </div>;
}

let _warningLogger;
const warningLogger = () => {
  if (!_warningLogger) _warningLogger = getLogger().child({ component: 'governance-warning-overlay' });
  return _warningLogger;
};
const PAINT_CHECK_MS = 2000;
const FRAME_STATS_MS = 5000;
const SCRIM_STEP_SETTLE_MS = 700;

/**
 * Observability for the warning UI as the household SEES it — the engine's
 * phase log cannot tell you the chips emptied while the phase held, or that
 * the scrim's darken landed on the meter instead of under it.
 * - `shown` / `hidden` (with visibleMs): a run of short pairs IS the flicker.
 * - `rows_changed`: who the chips name, as it changes.
 * - `paint_check` once per showing, then `dimmed` (warn) / `undimmed` on change:
 *   whether the scrim paints above the meter/chips or a filter/opacity applies.
 *   It carries the compositing picture computed styles cannot otherwise show
 *   in the log: scrim step + darkness, the video's live filter, device scale,
 *   chip/meter rects in device px, and EVERY element on the page with a filter
 *   or backdrop-filter (and whether it overlaps the chips).
 * - `scrim_step`: each of the (at most four) ramp steps, with the same picture.
 * - `frame_stats` every 5s while shown (sampled) and once at hide: rAF frame
 *   intervals + event-loop lag. Long frames with low loop lag = the compositor
 *   or GPU is struggling, not our JS — the signature of a paint-path thrash
 *   that no DOM listener can see (ops:docs/_wip/bugs/2026-10-23-fitness-governance-chip-layer-blur-thrash.md).
 */
function useWarningOverlayObservability(containerRef, rowKeys, scrimStep) {
  const rowKeysRef = useRef(rowKeys);
  rowKeysRef.current = rowKeys;

  const compositing = () => {
    const root = containerRef.current;
    if (!root) return null;
    const host = root.closest('.fitness-player-content') || root.parentElement || root;
    return describeCompositing({
      root,
      targets: {
        meter: root.querySelector('.governance-life-meter__frame'),
        chip: root.querySelector('.governance-progress-overlay__chip'),
      },
      scrim: host.querySelector('.governance-warning-scrim'),
      video: host.querySelector('video, dash-video'),
    });
  };

  useEffect(() => {
    const shownAt = Date.now();
    warningLogger().info('governance.warning_overlay.shown', { rows: rowKeysRef.current });
    let lastDimmed = null;
    const check = () => {
      const root = containerRef.current;
      if (!root) return;
      const host = root.closest('.fitness-player-content') || root.ownerDocument;
      const result = checkOverlayPaint({
        meter: root.querySelector('.governance-life-meter__frame'),
        chip: root.querySelector('.governance-progress-overlay__chip'),
      }, host.querySelector('.governance-warning-scrim'));
      const payload = { ...result, rows: rowKeysRef.current, shownForMs: Date.now() - shownAt };
      if (lastDimmed === null) {
        warningLogger().info('governance.warning_overlay.paint_check', { ...payload, compositing: compositing() });
      }
      if (result.dimmed && lastDimmed !== true) {
        warningLogger().warn('governance.warning_overlay.dimmed', { ...payload, compositing: compositing() });
      } else if (!result.dimmed && lastDimmed === true) {
        warningLogger().info('governance.warning_overlay.undimmed', payload);
      }
      lastDimmed = result.dimmed;
    };
    // After the first paint, then on a slow clock while the warning stands.
    const frame = requestAnimationFrame(check);
    const timer = setInterval(check, PAINT_CHECK_MS);

    const probe = createFrameTimingProbe();
    probe.start();
    const statsTimer = setInterval(() => {
      const stats = probe.read();
      if (stats) {
        warningLogger().sampled('governance.warning_overlay.frame_stats',
          { ...stats, rows: rowKeysRef.current, shownForMs: Date.now() - shownAt },
          { maxPerMinute: 12 });
      }
    }, FRAME_STATS_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
      clearInterval(statsTimer);
      const finalStats = probe.read();
      probe.stop();
      if (finalStats) {
        warningLogger().info('governance.warning_overlay.frame_stats', { ...finalStats, final: true, rows: rowKeysRef.current });
      }
      warningLogger().info('governance.warning_overlay.hidden', {
        rows: rowKeysRef.current, visibleMs: Date.now() - shownAt,
      });
    };
  }, [containerRef]);

  const previousKeys = useRef(rowKeys);
  useEffect(() => {
    if (previousKeys.current === rowKeys) return;
    warningLogger().info('governance.warning_overlay.rows_changed', { rows: rowKeys, previous: previousKeys.current });
    previousKeys.current = rowKeys;
  }, [rowKeys]);

  const previousStep = useRef(null);
  useEffect(() => {
    if (previousStep.current === scrimStep) return;
    const from = previousStep.current;
    previousStep.current = scrimStep;
    if (from === null) return; // the first step rides on paint_check
    // Once the darkness transition (600ms) has settled, so the logged styles
    // are the step's real values rather than a frame mid-ease.
    const timer = setTimeout(() => {
      warningLogger().info('governance.warning_overlay.scrim_step', {
        step: scrimStep, from, rows: rowKeysRef.current, compositing: compositing(),
      });
    }, SCRIM_STEP_SETTLE_MS);
    return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrimStep]);
}

const GovernanceWarningOverlay = React.memo(function GovernanceWarningOverlay({ countdown, countdownTotal, notches, rows, offenders }) {
  // Use notches directly from the per-notch interval timer when available,
  // fall back to deriving from countdown for backward compatibility
  // No countdown yet = the warning began this frame (the hook learns the
  // deadline in an effect), so the meter is full — not an empty-bar flash.
  const visibleNotches = Number.isFinite(notches)
    ? Math.max(0, Math.min(TOTAL_NOTCHES, notches))
    : (Number.isFinite(countdown)
      ? Math.round(Math.max(0, Math.min(1, Math.max(countdown, 0) / Math.max(countdownTotal || 1, 1))) * TOTAL_NOTCHES)
      : TOTAL_NOTCHES);

  // Support both new (rows) and legacy (offenders) format
  const items = Array.isArray(rows) && rows.length > 0 ? rows : (Array.isArray(offenders) ? offenders : []);

  // Fixed ramp steps (warningScrimStep.js) — the scrim's DOM changes four
  // times per warning, not every notch.
  const total = Number.isFinite(countdownTotal) && countdownTotal > 0 ? countdownTotal : 30;
  const remainingSeconds = Number.isFinite(notches) ? (notches / TOTAL_NOTCHES) * total : countdown;
  const scrimStep = warningScrimStep(remainingSeconds, total);

  const containerRef = useRef(null);
  const rowKeys = items.map((item) => item.key).join(',');
  useWarningOverlayObservability(containerRef, rowKeys, scrimStep);

  // The overlay owns its scrim, so the darkening and the chips mount and
  // unmount in the same commit (they used to come from two owners, 40-270ms
  // apart). The scrim is a sibling, not a child: at z 5 it stays below the
  // challenge deck and player layers, and the CSS desaturates the video
  // through `.governance-warning-scrim ~ .fitness-video-mirror-wrap`.
  return (
    <>
    <div className="governance-warning-scrim" data-step={scrimStep} aria-hidden="true" />
    <div className="governance-progress-overlay" ref={containerRef}>
      {items.length > 0 ? (
        <div className="governance-progress-overlay__offenders">
          {items.map((item) => {
            // New format: item.progress (0-1), item.currentZone?.color, item.targetZone?.color
            // Legacy format: item.progressPercent (0-1), item.zoneColor, item.targetZoneColor
            const rawProgress = item.progress ?? item.progressPercent ?? null;
            const clamped = Number.isFinite(rawProgress)
              ? Math.max(0, Math.min(1, rawProgress))
              : null;
            const percentValue = clamped != null ? Math.round(clamped * 100) : null;
            const borderColor = item.currentZone?.color || item.zoneColor || null;
            const borderStyle = borderColor ? { borderColor } : undefined;
            const progressColor = item.currentZone?.color || item.zoneColor || borderColor || 'rgba(56, 189, 248, 0.95)';
            const pedal = item.pedal;
            return (
              <div
                className={`governance-progress-overlay__chip${item.status === 'holding' ? ' governance-progress-overlay__chip--holding' : ''}`}
                key={item.key}
                style={borderStyle}
              >
                <div className="governance-progress-overlay__chip-main">
                  <div className="governance-progress-overlay__chip-avatar" style={borderStyle}>
                    <img
                      src={item.avatarSrc}
                      alt=""
                      onError={(event) => {
                        const img = event.currentTarget;
                        if (img.dataset.fallback) return;
                        img.dataset.fallback = '1';
                        img.src = DaylightMediaPath('/static/img/users/user');
                      }}
                    />
                  </div>
                  <div className="governance-progress-overlay__chip-text">
                    <span className="governance-progress-overlay__chip-name">
                      {item.displayName || item.displayLabel || item.name}
                    </span>
                    <span className="governance-progress-overlay__chip-meta">
                      {pedal
                        ? <PedalFeedback pedal={pedal} />
                        : (Number.isFinite(item.heartRate) ? item.heartRate : 'No HR data')}
                    </span>
                  </div>
                </div>
                {percentValue != null ? (
                  <div className="governance-progress-overlay__chip-progress" aria-hidden="true">
                    <div
                      className="governance-progress-overlay__chip-progress-fill"
                      style={{
                        transform: `scaleX(${clamped})`,
                        background: progressColor
                      }}
                    />
                  </div>
                ) : null}
                <HoldProgress row={item} />
              </div>
            );
          })}
        </div>
      ) : null}
      <div className="governance-life-meter" aria-hidden="true">
        <div className="governance-life-meter__frame">
          {Array.from({ length: TOTAL_NOTCHES }, (_, i) => (
            <div
              key={i}
              className={`governance-life-meter__notch${i < visibleNotches ? ' governance-life-meter__notch--active' : ''}`}
            />
          ))}
        </div>
      </div>
    </div>
    </>
  );
}, (prevProps, nextProps) => {
  // Skip re-render if countdown delta < 0.3s and rows/offenders reference unchanged
  const countdownDelta = Math.abs((prevProps.countdown || 0) - (nextProps.countdown || 0));
  // `notches` steps every ~0.5s while `countdown` (whole seconds) steps every
  // 1s — ignoring it dropped every other notch, so the meter fell two at a time.
  if (countdownDelta < 0.3 && prevProps.notches === nextProps.notches
    && prevProps.rows === nextProps.rows && prevProps.offenders === nextProps.offenders) {
    return true; // props are equal, skip re-render
  }
  return false;
});

GovernanceWarningOverlay.propTypes = {
  countdown: PropTypes.number,
  countdownTotal: PropTypes.number,
  rows: PropTypes.array,
  offenders: PropTypes.array
};

function normalizeRequiredCountFromRule(rule, totalCount) {
  if (!Number.isFinite(totalCount) || totalCount < 0) return null;
  const normalizedTotal = Math.max(0, Math.round(totalCount));
  if (normalizedTotal === 0) return 0;
  if (typeof rule === 'number' && Number.isFinite(rule)) {
    return Math.min(normalizedTotal, Math.max(0, Math.round(rule)));
  }
  if (typeof rule !== 'string') return null;
  const normalizedRule = rule.trim().toLowerCase();
  if (normalizedRule === 'all') return normalizedTotal;
  if (normalizedRule === 'majority' || normalizedRule === 'most') {
    return Math.max(1, Math.ceil(normalizedTotal * 0.5));
  }
  if (normalizedRule === 'some') {
    return Math.max(1, Math.ceil(normalizedTotal * 0.3));
  }
  if (normalizedRule === 'any') return normalizedTotal > 0 ? 1 : 0;
  return null;
}

// A stable default: a fresh `[]` per render changed the `rows` memo every
// render, and with two or more rows the sorted copy re-fired the row-animation
// effect, which re-rendered, forever — a render loop on every multi-rider lock.
const NO_LOCK_ROWS = [];

const GovernancePanelOverlay = React.memo(function GovernancePanelOverlay({ display, overlay, lockRows = NO_LOCK_ROWS, onUnlock = null, embedded = false }) {
  // Support both new (display) and legacy (overlay + lockRows) format
  const status = display?.status || overlay?.status || 'unknown';
  const requirements = useMemo(() => (
    Array.isArray(display?.requirements)
      ? display.requirements
      : (Array.isArray(overlay?.requirements) ? overlay.requirements : [])
  ), [display?.requirements, overlay?.requirements]);
  const foreground = display?.obligations?.[0] || null;
  const challenge = foreground ? foreground.challenge : (display?.challenge || null);
  const activeUserCount = Number.isFinite(display?.activeUserCount)
    ? Math.max(0, Math.round(display.activeUserCount))
    : null;
  // Sort by progress descending — closest to meeting target bubbles to top
  const rows = useMemo(() => {
    const unsortedRows = (display ? display.rows : lockRows) || [];
    if (unsortedRows.length <= 1) return unsortedRows;
    return [...unsortedRows].sort((a, b) => {
      const pa = a.progress ?? -1;
      const pb = b.progress ?? -1;
      return pb - pa; // highest progress first
    });
  }, [display, lockRows]);
  const hasRows = rows.length > 0;

  const isInitPoolEmpty = !hasRows && (!Number.isFinite(activeUserCount) || activeUserCount <= 0);

  const activeRequirement = useMemo(() => {
    if (!requirements.length) return null;
    return requirements.find((req) => req && !req.satisfied) || requirements[0] || null;
  }, [requirements]);

  const activeActivityRequirement = useMemo(() => {
    const activityRequirements = Array.isArray(display?.activityRequirements)
      ? display.activityRequirements
      : requirements.filter((requirement) => requirement?.type === 'activity_rate');
    return activityRequirements.find((requirement) => requirement && !requirement.satisfied)
      || activityRequirements[0]
      || null;
  }, [display?.activityRequirements, requirements]);
  const hasActivityRequirement = Boolean(activeActivityRequirement);
  const isFailedStepChallenge = challenge?.type === 'step' && challenge?.status === 'failed';
  const stepChallengeTarget = Math.max(0, Math.round(
    Number(challenge?.target ?? challenge?.requiredCount) || 0
  ));
  const stepChallengeActual = Math.min(
    stepChallengeTarget,
    Math.max(0, Math.round(Number(challenge?.actualCount) || 0))
  );
  const stepChallengeUnit = challenge?.metric === 'stomps' ? 'stomps' : 'steps';

  const targetZoneName = foreground?.zoneLabel
    || challenge?.zoneLabel
    || challenge?.zone
    || activeRequirement?.zoneLabel
    || activeRequirement?.zone
    || 'target';

  const targetCount = useMemo(() => {
    if (Number.isFinite(foreground?.requiredCount)) return foreground.requiredCount;
    if (Number.isFinite(challenge?.requiredCount)) {
      return Math.max(0, Math.round(challenge.requiredCount));
    }
    if (Number.isFinite(activeRequirement?.requiredCount)) {
      return Math.max(0, Math.round(activeRequirement.requiredCount));
    }
    if (Number.isFinite(activeUserCount)) {
      return normalizeRequiredCountFromRule(activeRequirement?.rule, activeUserCount);
    }
    return null;
  }, [foreground, challenge, activeRequirement, activeUserCount]);

  const actualCount = useMemo(() => {
    const challengeActual = Number.isFinite(challenge?.actualCount)
      ? Math.max(0, Math.round(challenge.actualCount))
      : null;
    const requirementActual = Number.isFinite(activeRequirement?.actualCount)
      ? Math.max(0, Math.round(activeRequirement.actualCount))
      : null;
    const resolved = foreground?.actualCount ?? challengeActual ?? requirementActual ?? 0;
    if (Number.isFinite(targetCount)) {
      return Math.min(targetCount, resolved);
    }
    return resolved;
  }, [foreground, challenge, activeRequirement, targetCount]);

  // Participants who have already satisfied, joined to their avatar/zone by
  // resolveGovernanceDisplay. `rows` is missing-only, so these riders exist
  // nowhere else on the panel.
  const metRows = useMemo(
    () => (Array.isArray(display?.metRows) ? display.metRows.filter(Boolean) : []),
    [display]
  );

  const hasTargetCount = Number.isFinite(targetCount) && targetCount > 0;
  const showCountBlocks = !hasActivityRequirement && !isFailedStepChallenge && !isInitPoolEmpty && hasTargetCount;

  const summaryMain = useMemo(() => {
    if (hasActivityRequirement) {
      if (activeActivityRequirement.suspended) return 'Step mat sensor unavailable';
      const actual = Math.max(0, Math.round(activeActivityRequirement.currentRate || 0));
      const target = Math.max(0, Math.round(activeActivityRequirement.targetRate || 0));
      return `Keep stepping: ${actual} / ${target} SPM`;
    }
    if (isFailedStepChallenge) {
      return `Keep going: ${stepChallengeActual} / ${stepChallengeTarget} ${stepChallengeUnit}`;
    }
    if (isInitPoolEmpty) {
      return 'No participants connected';
    }
    if (hasTargetCount) {
      return `${actualCount} of ${targetCount} in ${targetZoneName}`;
    }
    if (Number.isFinite(activeUserCount) && activeUserCount > 0) {
      return `${activeUserCount} participant${activeUserCount === 1 ? '' : 's'} in pool`;
    }
    return 'Waiting for participant data...';
  }, [hasActivityRequirement, activeActivityRequirement, isFailedStepChallenge, stepChallengeActual, stepChallengeTarget, stepChallengeUnit, isInitPoolEmpty, hasTargetCount, targetCount, actualCount, targetZoneName, activeUserCount]);

  // Log when "Waiting for participant data" renders (rate-limited)
  const lastWaitingLogRef = useRef(0);
  useEffect(() => {
    if (!hasRows && status === 'pending') {
      const now = Date.now();
      if (now - lastWaitingLogRef.current > 5000) {
        lastWaitingLogRef.current = now;
        getLogger().sampled('governance.overlay.waiting_for_participants', {
          status,
          displayRowCount: display?.rows?.length ?? -1,
          lockRowCount: lockRows?.length ?? -1,
          requirementCount: requirements.length,
          hasDisplay: !!display
        }, { maxPerMinute: 6 });
      }
    }
  }, [hasRows, status, display, lockRows, requirements]);

  const renderProgressBlock = (row) => {
    // Support both formats: progress (new) and progressPercent (legacy)
    const rawProgress = row.progress ?? row.progressPercent ?? null;
    if (rawProgress == null) return null;
    const clamped = Math.max(0, Math.min(1, rawProgress));
    const percentValue = Math.round(clamped * 100);
    const widthPercent = Number.isFinite(percentValue) ? Math.max(0, percentValue) : 0;
    const progressClass = 'governance-lock__progress governance-lock__progress--inline';
    const intermediateZones = Array.isArray(row.intermediateZones) ? row.intermediateZones : [];
    const currentColor = row.currentZone?.color || 'rgba(148, 163, 184, 0.6)';
    const targetColor = row.targetZone?.color || 'rgba(34, 197, 94, 0.85)';
    let fillBackground;
    if (intermediateZones.length > 0) {
      const stops = [`${currentColor} 0%`];
      intermediateZones.forEach((zone) => {
        stops.push(`${zone.color || currentColor} ${Math.round((zone.position || 0) * 100)}%`);
      });
      stops.push(`${targetColor} 100%`);
      fillBackground = `linear-gradient(90deg, ${stops.join(', ')})`;
    } else {
      fillBackground = row.progressGradient || `linear-gradient(90deg, ${currentColor}, ${targetColor})`;
    }
    return (
      <div className={progressClass}>
        {/* One input, `--p`, drives both the fill (scaleX) and the knob's
            wrapper (translateX) with the same transition, so the percentage
            rides the bar tip instead of snapping ahead of it. */}
        <div className="governance-lock__progress-track" aria-hidden="true" style={{ '--p': clamped }}>
          <div
            className="governance-lock__progress-fill"
            style={{ background: fillBackground }}
          />
          {intermediateZones.map((zone) => {
            const markerPosition = Math.round((zone.position || 0) * 100);
            const isPassed = widthPercent >= markerPosition;
            return (
              <div
                key={zone.id}
                className={`governance-lock__zone-marker${isPassed ? ' governance-lock__zone-marker--passed' : ''}`}
                style={{
                  left: `${markerPosition}%`,
                  borderColor: zone.color || undefined
                }}
                title={zone.name || zone.id}
              />
            );
          })}
          <div className="governance-lock__progress-tip">
            <span className="governance-lock__progress-indicator"
              style={{ '--tip-color': currentColor /* data-color */ }}>{percentValue}%</span>
          </div>
        </div>
        <HoldProgress row={row} />
      </div>
    );
  };

  const renderChipMeta = (row) => {
    const base = (() => {
      if (row.pedal) {
        return <PedalFeedback pedal={row.pedal} />;
      }
      const currentHr = Number.isFinite(row.heartRate) ? Math.max(0, Math.round(row.heartRate)) : null;
      const targetHr = Number.isFinite(row.targetHeartRate) ? Math.max(0, Math.round(row.targetHeartRate)) : null;
      if (currentHr != null) {
        if (targetHr != null) {
          return `${currentHr} / ${targetHr}`;
        }
        return String(currentHr);
      }
      return row.groupLabel || 'No HR data';
    })();
    return base;
  };

  return (
    <div className={embedded ? 'governance-lock__section' : `governance-overlay governance-overlay--${status}`}>
      <div className={`${embedded ? '' : 'governance-overlay__panel '}governance-lock governance-lock--wide`}>
        {/* One chrome line owns all the standing state: who has earned it, the
            count, and the unlock affordance. The former stacked title
            ("Video Locked") and instruction line were static copy the paused
            video already communicated, and they pushed the rows — the only part
            that answers "what do I do?" — down the panel. */}
        <div className={`governance-lock__header${showCountBlocks ? '' : ' governance-lock__header--summary-only'}`}>
          {showCountBlocks ? (
            <CompletionAvatars
              targetCount={targetCount}
              actualCount={actualCount}
              metRows={metRows}
              containerClassName="governance-lock__credits"
              ariaLabel={`Exit criteria progress ${actualCount} of ${targetCount}`}
            />
          ) : null}
          <p className="governance-lock__summary-main">{summaryMain}</p>
          {onUnlock ? (
            <button
              type="button"
              className="governance-lock__unlock"
              onPointerDown={onUnlock}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  onUnlock(event);
                }
              }}
              aria-label="Skip or unlock governed playback with fingerprint"
            >
              <LockIcon size="1.4em" />
            </button>
          ) : null}
        </div>

        <div
          className={`governance-lock__table${isInitPoolEmpty && !hasActivityRequirement && !isFailedStepChallenge ? ' governance-lock__table--init' : ''}`}
          role="table"
          aria-label="Unlock requirements"
        >
            {isFailedStepChallenge ? (
              <div className="governance-lock__activity" role="row">
                <div className="governance-lock__activity-icon" aria-hidden="true">
                  {challenge.metric === 'stomps' ? '💥' : '👟'}
                </div>
                <div className="governance-lock__activity-copy" role="cell">
                  <strong>Finish the {stepChallengeUnit} challenge</strong>
                  <span>Catch up to resume playback.</span>
                </div>
                <div className="governance-lock__activity-rate" role="cell">
                  <strong>{stepChallengeActual}/{stepChallengeTarget}</strong>
                  <span>{stepChallengeUnit}</span>
                </div>
              </div>
            ) : hasActivityRequirement ? (
              <div className="governance-lock__activity" role="row">
                <div className="governance-lock__activity-icon" aria-hidden="true">
                  {activeActivityRequirement.suspended ? '⚠' : '👟'}
                </div>
                <div className="governance-lock__activity-copy" role="cell">
                  <strong>{activeActivityRequirement.suspended ? 'Mat unavailable' : 'Stay on the step mat'}</strong>
                  <span>
                    {activeActivityRequirement.suspended
                      ? 'Playback is not penalized while the sensor is offline.'
                      : `Reach ${Math.round(activeActivityRequirement.targetRate || 0)} steps per minute to continue.`}
                  </span>
                </div>
                {!activeActivityRequirement.suspended ? (
                  <div className="governance-lock__activity-rate" role="cell">
                    <strong>{Math.round(activeActivityRequirement.currentRate || 0)}</strong>
                    <span>SPM</span>
                  </div>
                ) : null}
              </div>
            ) : hasRows ? rows.map((row) => {
            const currentLabel = row.currentZone?.name || row.currentLabel || 'No signal';
            const currentClass = row.currentZone?.id ? `zone-${row.currentZone.id}` : 'zone-none';
            const targetClass = row.targetZone?.id ? `zone-${row.targetZone.id}` : 'zone-none';
            const chip = (
              <div className="governance-lock__chip">
                <div className={`governance-lock__avatar ${currentClass}`}>
                  <img
                    src={row.avatarSrc}
                    alt=""
                    onError={(event) => {
                      const img = event.currentTarget;
                      if (img.dataset.fallback) return;
                      img.dataset.fallback = '1';
                      img.src = DaylightMediaPath('/static/img/users/user');
                    }}
                  />
                </div>
                <div className="governance-lock__chip-text">
                  <span className="governance-lock__chip-name">{row.displayName || row.displayLabel || row.name}</span>
                  <span className="governance-lock__chip-meta">{renderChipMeta(row)}</span>
                </div>
              </div>
            );

              return (
              <div
                className="governance-lock__row"
                role="row"
                key={row.key}
              >
                <div className="governance-lock__identity" role="cell">
                  {chip}
                </div>
                <div className="governance-lock__metric" role="cell">
                  <span className={`governance-lock__pill ${currentClass}`}>
                    {currentLabel}
                  </span>
                </div>
                <div className="governance-lock__metric governance-lock__metric--progress" role="cell">
                  {renderProgressBlock(row)}
                </div>
                <div className="governance-lock__metric" role="cell">
                  <span className={`governance-lock__pill governance-lock__pill--target ${targetClass}`}>
                    {row.targetZone?.name || row.targetLabel || 'Target'}
                  </span>
                </div>
              </div>
            );
            }) : isInitPoolEmpty ? (
              <div className="governance-lock__init" role="note" aria-live="polite">
                <p className="governance-lock__init-title">Waiting for first participant</p>
                <p className="governance-lock__init-text">
                  Start a participant or connect a heart rate sensor to continue.
                </p>
              </div>
            ) : (
              <div className="governance-lock__row governance-lock__row--empty" role="row">
                <div className="governance-lock__metric governance-lock__metric--empty" role="cell">
                  Collecting participant vitals...
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

GovernancePanelOverlay.propTypes = {
  display: PropTypes.shape({
    status: PropTypes.string,
    rows: PropTypes.array,
    metRows: PropTypes.array,
    requirements: PropTypes.array,
    activeUserCount: PropTypes.number,
    activityRequirements: PropTypes.array
  }),
  overlay: PropTypes.shape({
    status: PropTypes.string,
    title: PropTypes.string,
    descriptions: PropTypes.arrayOf(PropTypes.string),
    requirements: PropTypes.array
  }),
  lockRows: PropTypes.array,
  onUnlock: PropTypes.func
};

function GovernancePanels({ display, onUnlock }) {
  if ((display?.obligations?.length || 0) <= 1) return <GovernancePanelOverlay display={display} onUnlock={onUnlock} />;
  return <div className={`governance-overlay governance-overlay--${display.status}`}>
    <div className="governance-overlay__panel governance-overlay__panel--sections">
      {display.obligations.map((obligation, index) => <GovernancePanelOverlay key={obligation.key} embedded
        onUnlock={index === 0 ? onUnlock : null}
        display={{ ...display, ...obligation, obligations: [obligation],
          requirements: obligation.requirement ? [obligation.requirement] : [],
          activityRequirements: obligation.requirement?.type === 'activity_rate' ? [obligation.requirement] : [],
        }} />)}
    </div>
  </div>;
}

const GenericOverlay = React.memo(function GenericOverlay({ overlay }) {
  return (
    <div className="fitness-player-overlay">
      <div className="fitness-player-overlay__panel">
        {overlay.title ? (
          <div className="fitness-player-overlay__title">{overlay.title}</div>
        ) : null}
        {Array.isArray(overlay.descriptions) && overlay.descriptions.length > 0
          ? overlay.descriptions.map((line, idx) => (
              <p className="fitness-player-overlay__line" key={`generic-desc-${idx}`}>
                {line}
              </p>
            ))
          : null}
      </div>
    </div>
  );
});

GenericOverlay.propTypes = {
  overlay: PropTypes.shape({
    title: PropTypes.string,
    descriptions: PropTypes.arrayOf(PropTypes.string)
  }).isRequired
};

const GovernanceStateOverlay = ({
  display,
  overlay = null,
  lockRows = [],
  warningOffenders = [],
  voiceMemoOpen = false,
  onUnlock = null
}) => {
  // New path: display prop from useGovernanceDisplay
  // Legacy path: overlay + lockRows + warningOffenders
  const useNewPath = display != null;

  const effectiveStatus = useNewPath
    ? (display.status || '')
    : (typeof overlay?.status === 'string' ? overlay.status : '');
  const normalizedStatus = String(effectiveStatus || '').toLowerCase();
  const effectiveShow = useNewPath ? display.show : Boolean(overlay?.show);
  const effectiveCategory = useNewPath ? null : (overlay?.category || null);

  // Self-updating countdown from deadline
  const { remaining: countdown, notches: countdownNotches } = useDeadlineCountdown(
    useNewPath ? display.deadline : overlay?.deadline,
    useNewPath ? (display.gracePeriodTotal || 30) : (overlay?.countdownTotal || 30),
    TOTAL_NOTCHES
  );

  // Determine which audio track to play (or null for none)
  const audioTrackKey = useMemo(() => {
    if (!effectiveShow) return null;
    const isGovernanceOverlay = useNewPath
      ? Boolean(display?.videoLocked) || normalizedStatus === 'pending' || normalizedStatus === 'warning' || normalizedStatus === 'locked' || normalizedStatus === 'challenge-failed'
      : effectiveCategory === 'governance' || effectiveCategory === 'governance-warning-progress';
    if (!isGovernanceOverlay) return null;
    if (normalizedStatus === 'warning') return null;
    if (normalizedStatus === 'pending') return 'init';
    if (normalizedStatus === 'locked' || normalizedStatus === 'challenge-failed') return 'locked';
    // Fallback: if governance is actively locking video but status string is missing/unexpected.
    if (useNewPath && display?.videoLocked) return 'locked';
    return null;
  }, [effectiveShow, useNewPath, effectiveCategory, normalizedStatus, display?.videoLocked]);

  if (!effectiveShow) {
    return null;
  }

  // New path: dispatch on status
  if (useNewPath) {
    if (normalizedStatus === 'warning') {
      return (
        <>
          <GovernanceAudioPlayer trackKey={audioTrackKey} paused={voiceMemoOpen} />
          <GovernanceWarningOverlay
            countdown={countdown}
            countdownTotal={display.gracePeriodTotal}
            notches={countdownNotches}
            rows={display.obligations?.length > 1 ? display.obligations.flatMap((obligation) => obligation.rows.map((row) => ({ ...row, key: `${obligation.key}:${row.key}` }))) : display.rows}
          />
        </>
      );
    }

    // pending, locked, challenge-failed
    return (
      <>
        <GovernanceAudioPlayer trackKey={audioTrackKey} paused={voiceMemoOpen} />
        <GovernancePanels display={display} onUnlock={onUnlock} />
      </>
    );
  }

  // Legacy path: dispatch on category
  if (overlay.category === 'governance-warning-progress') {
    return (
      <>
        <GovernanceAudioPlayer trackKey={audioTrackKey} paused={voiceMemoOpen} />
        <GovernanceWarningOverlay
          countdown={countdown}
          countdownTotal={overlay.countdownTotal}
          notches={countdownNotches}
          offenders={warningOffenders}
        />
      </>
    );
  }

  if (overlay.category === 'governance') {
    return (
      <>
        <GovernanceAudioPlayer trackKey={audioTrackKey} paused={voiceMemoOpen} />
        <GovernancePanelOverlay
          overlay={overlay}
          lockRows={lockRows}
          onUnlock={onUnlock}
        />
      </>
    );
  }

  return (
    <>
      <GovernanceAudioPlayer trackKey={audioTrackKey} paused={voiceMemoOpen} />
      <GenericOverlay overlay={overlay} />
    </>
  );
};

GovernanceStateOverlay.propTypes = {
  display: PropTypes.shape({
    show: PropTypes.bool,
    status: PropTypes.string,
    deadline: PropTypes.number,
    gracePeriodTotal: PropTypes.number,
    rows: PropTypes.array,
    metRows: PropTypes.array,
    requirements: PropTypes.array,
    activeUserCount: PropTypes.number,
    challenge: PropTypes.object,
    videoLocked: PropTypes.bool
  }),
  overlay: PropTypes.shape({
    show: PropTypes.bool,
    category: PropTypes.string,
    deadline: PropTypes.number,
    countdownTotal: PropTypes.number,
    status: PropTypes.string,
    title: PropTypes.string,
    descriptions: PropTypes.arrayOf(PropTypes.string),
    requirements: PropTypes.array
  }),
  lockRows: PropTypes.array,
  warningOffenders: PropTypes.array,
  voiceMemoOpen: PropTypes.bool,
  onUnlock: PropTypes.func
};

export default GovernanceStateOverlay;
