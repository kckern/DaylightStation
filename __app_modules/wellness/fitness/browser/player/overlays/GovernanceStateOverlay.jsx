import React, { useMemo, useRef, useEffect } from 'react';
import PropTypes from 'prop-types';
import { DaylightMediaPath } from '@/lib/api.mjs';
import { getLogger } from '@/lib/logging/Logger.js';
// Direct import: the shared/ barrel drags every widget (recharts, flip-move…)
// into this overlay and its tests.
import useDeadlineCountdown from "../../shared/hooks/useDeadlineCountdown.js";
import GovernanceAudioPlayer from "./GovernanceAudioPlayer.jsx";
import CompletionAvatars from "./CompletionAvatars.jsx";
import LockIcon from "./LockIcon.jsx";
import HoldProgress from "./HoldProgress.jsx";
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
function useWarningOverlayObservability(containerRef, rowKeys, scrimStep, quiet = false) {
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
    warningLogger().info('governance.warning_overlay.shown', { rows: rowKeysRef.current, quiet });
    let lastDimmed = null;
    const check = () => {
      const root = containerRef.current;
      if (!root) return;
      const host = root.closest('.fitness-player-content') || root.ownerDocument;
      const result = checkOverlayPaint({
        meter: root.querySelector('.governance-life-meter__frame'),
        chip: root.querySelector('.governance-progress-overlay__chip'),
      }, host.querySelector('.governance-warning-scrim'));
      const payload = { ...result, rows: rowKeysRef.current, shownForMs: Date.now() - shownAt, quiet };
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
          { ...stats, rows: rowKeysRef.current, shownForMs: Date.now() - shownAt, quiet },
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
        warningLogger().info('governance.warning_overlay.frame_stats', { ...finalStats, final: true, rows: rowKeysRef.current, quiet });
      }
      warningLogger().info('governance.warning_overlay.hidden', {
        rows: rowKeysRef.current, visibleMs: Date.now() - shownAt, quiet,
      });
    };
  // `quiet` is fixed for an instance's lifetime: the dispatch below remounts
  // the overlay on a mode change (quiet <-> warning), so the mount-only effect
  // never sees it change.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef]);

  const previousKeys = useRef(rowKeys);
  useEffect(() => {
    if (previousKeys.current === rowKeys) return;
    warningLogger().info('governance.warning_overlay.rows_changed', { rows: rowKeys, previous: previousKeys.current });
    previousKeys.current = rowKeys;
  }, [rowKeys]);

  const previousStep = useRef(null);
  useEffect(() => {
    if (quiet || previousStep.current === scrimStep) return;
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

const GovernanceWarningOverlay = React.memo(function GovernanceWarningOverlay({ countdown, countdownTotal, notches, rows, offenders, quiet = false }) {
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
  useWarningOverlayObservability(containerRef, rowKeys, quiet ? null : scrimStep, quiet);

  // The overlay owns its scrim, so the darkening and the chips mount and
  // unmount in the same commit (they used to come from two owners, 40-270ms
  // apart). The scrim is a sibling, not a child: at z 5 it stays below the
  // challenge deck and player layers, and the CSS desaturates the video
  // through `.governance-warning-scrim ~ .fitness-video-mirror-wrap`.
  return (
    <>
    {quiet ? null : <div className="governance-warning-scrim" data-step={scrimStep} aria-hidden="true" />}
    <div className={`governance-progress-overlay${quiet ? ' governance-progress-overlay--quiet' : ''}`} ref={containerRef}>
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
      {quiet ? null : <div className="governance-life-meter" aria-hidden="true">
        <div className="governance-life-meter__frame">
          {Array.from({ length: TOTAL_NOTCHES }, (_, i) => (
            <div
              key={i}
              className={`governance-life-meter__notch${i < visibleNotches ? ' governance-life-meter__notch--active' : ''}`}
            />
          ))}
        </div>
      </div>}
    </div>
    </>
  );
}, (prevProps, nextProps) => {
  // Skip re-render if countdown delta < 0.3s and rows/offenders reference unchanged
  const countdownDelta = Math.abs((prevProps.countdown || 0) - (nextProps.countdown || 0));
  // `notches` steps every ~0.5s while `countdown` (whole seconds) steps every
  // 1s — ignoring it dropped every other notch, so the meter fell two at a time.
  if (countdownDelta < 0.3 && prevProps.notches === nextProps.notches
    && prevProps.rows === nextProps.rows && prevProps.offenders === nextProps.offenders
    && prevProps.quiet === nextProps.quiet) {
    return true; // props are equal, skip re-render
  }
  return false;
});

GovernanceWarningOverlay.propTypes = {
  countdown: PropTypes.number,
  countdownTotal: PropTypes.number,
  rows: PropTypes.array,
  offenders: PropTypes.array,
  quiet: PropTypes.bool
};

let _lockLogger;
const lockLogger = () => {
  if (!_lockLogger) _lockLogger = getLogger().child({ component: 'governance-lock-modal' });
  return _lockLogger;
};

const FALLBACK_AVATAR_PATH = '/static/img/users/user';
const avatarFallback = (event) => {
  const img = event.currentTarget;
  if (img.dataset.fallback) return;
  img.dataset.fallback = '1';
  img.src = DaylightMediaPath(FALLBACK_AVATAR_PATH);
};
const NEUTRAL_ZONE_COLOR = '#94a3b8';
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * One clause per unmet rule, from display.summary: "1 rider to Hot",
 * "both riders to Active". Every rule must pass, so the clauses join with "and".
 */
export function describeUnlockInstruction(summary, obligations = []) {
  const parts = (Array.isArray(summary) ? summary : []).filter((rule) => rule && rule.needed > 0).map((rule) => {
    const zone = rule.zoneLabel || rule.zone || 'the target zone';
    const pedal = obligations.find((o) => o.key === rule.key)?.requirement?.type === 'cadence_floor';
    const where = pedal ? `pedaling or in ${zone}` : `to ${zone}`;
    // "both riders" only while nobody counts yet; after that it would ask for
    // work already done.
    if (rule.scope === 'all' && rule.requiredCount > 1 && rule.actualCount === 0) {
      return `${rule.requiredCount === 2 ? 'both riders' : `all ${rule.requiredCount} riders`} ${where}`;
    }
    return `${rule.needed}${rule.actualCount > 0 ? ' more' : ''} ${rule.needed === 1 ? 'rider' : 'riders'} ${where}`;
  });
  if (!parts.length) return null;
  return `Get ${parts.join(' and ')} to keep watching.`;
}

const HeartGlyph = ({ color }) => (
  <svg className="governance-lock__heart" viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" style={{ color }}>
    <path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.5 1.1 4.2 2.3h2c.7-1.2 2.1-2.3 4.2-2.3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z" />
  </svg>
);

// A goal label ("Active 110", 18px) spans about this share of the narrowest
// bar (half the row at 1280x720); labels whose spans come closer than the gap
// move above the bar instead.
const MARKER_LABEL_SPAN = 0.2;
const MARKER_LABEL_GAP = 0.03;
const markerAlign = (pos) => (pos > 0.88 ? 'end' : (pos < 0.12 ? 'start' : 'center'));
const markerSpan = (pos, align) => (align === 'end' ? [pos - MARKER_LABEL_SPAN, pos]
  : align === 'start' ? [pos, pos + MARKER_LABEL_SPAN]
    : [pos - MARKER_LABEL_SPAN / 2, pos + MARKER_LABEL_SPAN / 2]);

/**
 * The rider's BPM on one scale with every goal they still owe marked on it:
 * from their lowest zone threshold to 10 above the highest goal.
 */
function RiderScale({ rider }) {
  const targets = rider.goals.filter((goal) => Number.isFinite(goal.targetHeartRate));
  if (!targets.length) return null;
  const thresholds = (rider.zoneSequence || []).map((zone) => zone?.threshold).filter(Number.isFinite);
  const heartRate = Number.isFinite(rider.heartRate) ? rider.heartRate : null;
  const top = Math.max(...targets.map((goal) => goal.targetHeartRate)) + 10;
  const floor = thresholds.length ? Math.min(...thresholds)
    : Math.max(0, Math.min(heartRate ?? Infinity, ...targets.map((goal) => goal.targetHeartRate)) - 20);
  const span = Math.max(1, top - floor);
  const at = (bpm) => Math.max(0, Math.min(1, (bpm - floor) / span));
  const p = heartRate != null ? at(heartRate) : 0;
  const fillColor = rider.currentZone?.color || NEUTRAL_ZONE_COLOR;
  // Goals arrive sorted by target BPM, so positions ascend.
  const markers = [];
  const laneEnd = { below: -Infinity, above: -Infinity };
  targets.forEach((goal) => {
    const pos = at(goal.targetHeartRate);
    const align = markerAlign(pos);
    const [left, right] = markerSpan(pos, align);
    const fits = (lane) => left - laneEnd[lane] >= MARKER_LABEL_GAP;
    const lane = fits('below') || !fits('above') ? 'below' : 'above';
    laneEnd[lane] = right;
    markers.push({ goal, pos, align, lane });
  });
  const stacked = markers.some((m) => m.lane === 'above');
  return (
    <div className={`governance-lock__scale${stacked ? ' governance-lock__scale--stacked' : ''}`} aria-hidden="true">
      <div className="governance-lock__track" style={{ '--p': Math.round(p * 1000) / 1000 }}>
        <div className="governance-lock__fill" style={{ background: fillColor }} />
      </div>
      <div className="governance-lock__markers">
        {markers.map(({ goal, pos, align, lane }) => {
          return (
            <div key={goal.obligationKey} className={`governance-lock__marker governance-lock__marker--${align} governance-lock__marker--${lane}`}
              style={{ left: `${Math.round(pos * 1000) / 10}%`, '--marker-color': goal.zoneColor || NEUTRAL_ZONE_COLOR }}>
              {`${goal.zoneLabel} ${Math.round(goal.targetHeartRate)}`}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function RiderGap({ rider }) {
  const pedalGoal = rider.goals.find((goal) => goal.pedal);
  if (pedalGoal) return <PedalFeedback pedal={pedalGoal.pedal} />;
  const next = rider.goals.find((goal) => Number.isFinite(goal.bpmToGo) && goal.bpmToGo > 0);
  if (next) {
    return <>
      <span className="governance-lock__gap-num" style={{ color: next.zoneColor || undefined }}>+{next.bpmToGo}</span>{' '}
      <span className="governance-lock__gap-zone">to {next.zoneLabel}</span>
    </>;
  }
  // At or past every target but still listed: the engine has not credited it
  // yet (a hold, or the BPM is ahead of the committed zone). Ask to hold the top one.
  const reached = rider.goals.filter((goal) => Number.isFinite(goal.targetHeartRate));
  const top = reached[reached.length - 1];
  return top ? <span className="governance-lock__gap-zone">Hold {top.zoneLabel}</span> : null;
}

function RiderRow({ rider }) {
  const zoneColor = rider.currentZone?.color || NEUTRAL_ZONE_COLOR;
  const heartRate = Number.isFinite(rider.heartRate) ? Math.max(0, Math.round(rider.heartRate)) : null;
  const hasTarget = rider.goals.some((goal) => Number.isFinite(goal.targetHeartRate));
  const pedal = rider.goals.some((goal) => goal.pedal);
  return (
    <div className="governance-lock__rider" role="row" data-testid="lock-rider-row">
      <div className="governance-lock__who" role="cell">
        <span className="governance-lock__face" style={{ borderColor: zoneColor }}>
          <img src={rider.avatarSrc} alt="" onError={avatarFallback} />
        </span>
        <span className="governance-lock__name">{rider.displayName}</span>
      </div>
      <div className="governance-lock__bpm" role="cell" aria-label={heartRate != null ? `${heartRate} beats per minute` : 'No heart rate'}>
        <HeartGlyph color={zoneColor} />
        <span className="governance-lock__bpm-num">{heartRate ?? '--'}</span>
      </div>
      <div className="governance-lock__progress" role="cell">
        {hasTarget ? <RiderScale rider={rider} /> : (pedal ? null
          : <span className="governance-lock__waiting">Waiting for heart rate</span>)}
        {rider.goals.map((goal) => (
          <HoldProgress key={goal.obligationKey} row={{
            userId: rider.userId, displayName: rider.displayName, zoneSequence: rider.zoneSequence,
            currentZone: rider.currentZone, targetZone: goal.targetZone,
            holdProgress: goal.holdProgress, holdPaused: goal.holdPaused, status: goal.status,
          }} />
        ))}
      </div>
      <div className="governance-lock__gap" role="cell"><RiderGap rider={rider} /></div>
    </div>
  );
}

const NO_ITEMS = [];

const GovernanceLockPanel = React.memo(function GovernanceLockPanel({ display, onUnlock = null }) {
  const status = display?.status || 'unknown';
  const riders = Array.isArray(display?.riders) ? display.riders : NO_ITEMS;
  const noSignal = Array.isArray(display?.noSignal) ? display.noSignal : NO_ITEMS;
  const summary = Array.isArray(display?.summary) ? display.summary : NO_ITEMS;
  const obligations = Array.isArray(display?.obligations) ? display.obligations : NO_ITEMS;
  const challenge = obligations[0] ? obligations[0].challenge : (display?.challenge || null);
  const activeUserCount = Number.isFinite(display?.activeUserCount) ? Math.max(0, Math.round(display.activeUserCount)) : null;

  const activity = (Array.isArray(display?.activityRequirements) ? display.activityRequirements : NO_ITEMS)
    .find((requirement) => requirement && !requirement.satisfied)
    || display?.activityRequirements?.[0] || null;
  const isFailedStepChallenge = challenge?.type === 'step' && challenge?.status === 'failed';
  const stepTarget = Math.max(0, Math.round(Number(challenge?.target ?? challenge?.requiredCount) || 0));
  const stepActual = Math.min(stepTarget, Math.max(0, Math.round(Number(challenge?.actualCount) || 0)));
  const stepUnit = challenge?.metric === 'stomps' ? 'stomps' : 'steps';
  const isInitPoolEmpty = !riders.length && !noSignal.length && (!Number.isFinite(activeUserCount) || activeUserCount <= 0);
  const zoneRules = activity || isFailedStepChallenge ? NO_ITEMS : summary.filter((rule) => Number.isFinite(rule.requiredCount) && rule.requiredCount > 0);

  const instruction = useMemo(() => {
    if (activity) {
      if (activity.suspended) return 'Step mat sensor unavailable';
      return `Keep stepping: ${Math.max(0, Math.round(activity.currentRate || 0))} / ${Math.max(0, Math.round(activity.targetRate || 0))} SPM`;
    }
    if (isFailedStepChallenge) return `Keep going: ${stepActual} / ${stepTarget} ${stepUnit}`;
    if (isInitPoolEmpty) return 'No participants connected';
    const sentence = describeUnlockInstruction(summary, obligations);
    if (sentence) return sentence;
    if (Number.isFinite(activeUserCount) && activeUserCount > 0) return `${plural(activeUserCount, 'participant')} in pool`;
    return 'Waiting for participant data...';
  }, [activity, isFailedStepChallenge, stepActual, stepTarget, stepUnit, isInitPoolEmpty, summary, obligations, activeUserCount]);

  useEffect(() => {
    lockLogger().sampled('governance.lock_modal.render', {
      status, riders: riders.length, rules: zoneRules.length, noSignal: noSignal.length,
    }, { maxPerMinute: 6, level: 'debug' });
  }, [status, riders.length, zoneRules.length, noSignal.length]);

  // Rate-limited breadcrumb for a lock that has no one to show yet.
  useEffect(() => {
    if (riders.length || status !== 'pending') return;
    getLogger().sampled('governance.overlay.waiting_for_participants', {
      status, riderCount: riders.length, noSignalCount: noSignal.length, ruleCount: summary.length,
    }, { maxPerMinute: 6 });
  }, [riders.length, status, noSignal.length, summary.length]);

  const body = isFailedStepChallenge ? (
    <div className="governance-lock__activity" role="row">
      <div className="governance-lock__activity-icon" aria-hidden="true">{challenge.metric === 'stomps' ? '💥' : '👟'}</div>
      <div className="governance-lock__activity-copy" role="cell">
        <strong>Finish the {stepUnit} challenge</strong>
        <span>Catch up to resume playback.</span>
      </div>
      <div className="governance-lock__activity-rate" role="cell">
        <strong>{stepActual}/{stepTarget}</strong>
        <span>{stepUnit}</span>
      </div>
    </div>
  ) : activity ? (
    <div className="governance-lock__activity" role="row">
      <div className="governance-lock__activity-icon" aria-hidden="true">{activity.suspended ? '⚠' : '👟'}</div>
      <div className="governance-lock__activity-copy" role="cell">
        <strong>{activity.suspended ? 'Mat unavailable' : 'Stay on the step mat'}</strong>
        <span>{activity.suspended
          ? 'Playback is not penalized while the sensor is offline.'
          : `Reach ${Math.round(activity.targetRate || 0)} steps per minute to continue.`}</span>
      </div>
      {!activity.suspended ? (
        <div className="governance-lock__activity-rate" role="cell">
          <strong>{Math.round(activity.currentRate || 0)}</strong>
          <span>SPM</span>
        </div>
      ) : null}
    </div>
  ) : riders.length ? riders.map((rider) => <RiderRow key={rider.key} rider={rider} />)
    : isInitPoolEmpty ? (
      <div className="governance-lock__init" role="note" aria-live="polite">
        <p className="governance-lock__init-title">Waiting for first participant</p>
        <p className="governance-lock__init-text">Start a participant or connect a heart rate sensor to continue.</p>
      </div>
    ) : noSignal.length ? null : (
      <div className="governance-lock__empty" role="row">Collecting participant vitals...</div>
    );

  return (
    <div className={`governance-overlay governance-overlay--${status}`}>
      <div className="governance-overlay__panel governance-lock governance-lock--wide" role="dialog" aria-label="Video paused">
        <div className="governance-lock__header">
          <div className="governance-lock__heading">
            <h2 className="governance-lock__title">Video paused</h2>
            <p className="governance-lock__instruction">{instruction}</p>
          </div>
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
        {zoneRules.length ? (
          <div className="governance-lock__rules">
            {zoneRules.map((rule) => {
              const metRows = obligations.find((o) => o.key === rule.key)?.metRows || NO_ITEMS;
              const shown = Math.min(rule.actualCount, rule.requiredCount);
              return (
                <div key={rule.key} className="governance-lock__rule" style={{ '--zone-color': rule.zoneColor || NEUTRAL_ZONE_COLOR }}>
                  <span className="governance-lock__rule-label">{`${rule.zoneLabel} ${shown}/${rule.requiredCount}`}</span>
                  <CompletionAvatars targetCount={rule.requiredCount} actualCount={rule.actualCount} metRows={metRows}
                    showOpen={false} ariaLabel={`${rule.zoneLabel}: ${shown} of ${rule.requiredCount} riders`} />
                </div>
              );
            })}
          </div>
        ) : null}
        {body ? (
          <div className={`governance-lock__table${isInitPoolEmpty && !activity && !isFailedStepChallenge ? ' governance-lock__table--init' : ''}`}
            role="table" aria-label="Unlock requirements">
            {body}
          </div>
        ) : null}
        {noSignal.length ? (
          <div className="governance-lock__no-signal">
            <span className="governance-lock__no-signal-faces" aria-hidden="true">
              {noSignal.map((rider) => <img key={rider.userId} src={rider.avatarSrc} alt="" onError={avatarFallback} />)}
            </span>
            <span>{`No heart-rate signal: ${noSignal.map((rider) => rider.displayName).join(', ')}`}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
});

GovernanceLockPanel.propTypes = {
  display: PropTypes.shape({
    status: PropTypes.string,
    riders: PropTypes.array,
    noSignal: PropTypes.array,
    summary: PropTypes.array,
    obligations: PropTypes.array,
    activeUserCount: PropTypes.number,
    activityRequirements: PropTypes.array,
    challenge: PropTypes.object,
  }),
  onUnlock: PropTypes.func,
};

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
  warningOffenders = [],
  voiceMemoOpen = false,
  onUnlock = null
}) => {
  // New path: display prop from useGovernanceDisplay
  // Legacy path: overlay + warningOffenders (warning chips and generic copy)
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
    const warningRows = display.obligations?.length > 1 ? display.obligations.flatMap((obligation) => obligation.rows.map((row) => ({ ...row, key: `${obligation.key}:${row.key}` }))) : display.rows;

    // Cooldown: the engine is unlocked but a floor is unmet. Chips only; no
    // scrim, no meter, no panel, no audio over the playing video.
    if (display.quiet) {
      return warningRows.length ? <GovernanceWarningOverlay quiet rows={warningRows} /> : null;
    }

    if (normalizedStatus === 'warning') {
      return (
        <>
          <GovernanceAudioPlayer trackKey={audioTrackKey} paused={voiceMemoOpen} />
          <GovernanceWarningOverlay
            countdown={countdown}
            countdownTotal={display.gracePeriodTotal}
            notches={countdownNotches}
            rows={warningRows}
          />
        </>
      );
    }

    // pending, locked, challenge-failed, cycle locks
    return (
      <>
        <GovernanceAudioPlayer trackKey={audioTrackKey} paused={voiceMemoOpen} />
        <GovernanceLockPanel display={display} onUnlock={onUnlock} />
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
  warningOffenders: PropTypes.array,
  voiceMemoOpen: PropTypes.bool,
  onUnlock: PropTypes.func
};

export default GovernanceStateOverlay;
