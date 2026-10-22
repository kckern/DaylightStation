import React, { useMemo, useRef, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { DaylightMediaPath } from '@/lib/api.mjs';
import { getLogger } from '@/lib/logging/Logger.js';
import { useDeadlineCountdown } from "../../shared/index.js";
import GovernanceAudioPlayer from "./GovernanceAudioPlayer.jsx";
import CompletionAvatars from "./CompletionAvatars.jsx";
import LockIcon from "./LockIcon.jsx";
import GovernanceStartBadge from "../../components/GovernanceStartBadge.jsx";
import "./GovernanceStateOverlay.scss";
import { checkOverlayPaint } from "./overlayPaintCheck.js";

const TOTAL_NOTCHES = 56;
const ROW_GROW_ANIMATION_MS = 220;

// A cadence_floor row is about the pedal (or the zone that excuses it), never
// the rider's heart rate — that number answers a question the rule isn't asking.
// The rpm is the engine's 10s window of counted turns, so a single nudge of the
// pedal doesn't flash a number the rule then ignores.
// Split into the reading and the instruction, stacked on two lines on both the
// lock row and the warning chip so neither truncates the instruction.
const pedalParts = (pedal) => {
  const instruction = pedal?.orZoneLabel ? `Pedal or reach ${pedal.orZoneLabel}` : 'Start pedaling';
  const rpm = Number.isFinite(pedal?.rpm) ? Math.max(0, Math.round(pedal.rpm)) : null;
  if (rpm == null) return { reading: null, instruction };
  const target = Number.isFinite(pedal?.targetRpm) ? ` / ${Math.round(pedal.targetRpm)}` : '';
  return { reading: `${rpm}${target} RPM`, instruction };
};


let _warningLogger;
const warningLogger = () => {
  if (!_warningLogger) _warningLogger = getLogger().child({ component: 'governance-warning-overlay' });
  return _warningLogger;
};
const PAINT_CHECK_MS = 2000;

/**
 * Observability for the warning UI as the household SEES it — the engine's
 * phase log cannot tell you the chips emptied while the phase held, or that
 * the scrim's darken/blur landed on the meter instead of under it.
 * - `shown` / `hidden` (with visibleMs): a run of short pairs IS the flicker.
 * - `rows_changed`: who the chips name, as it changes.
 * - `paint_check` once per showing, then `dimmed` (warn) / `undimmed` on change:
 *   whether the scrim paints above the meter/chips or a filter/opacity applies.
 */
function useWarningOverlayObservability(containerRef, rowKeys) {
  const rowKeysRef = useRef(rowKeys);
  rowKeysRef.current = rowKeys;

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
      if (lastDimmed === null) warningLogger().info('governance.warning_overlay.paint_check', payload);
      if (result.dimmed && lastDimmed !== true) {
        warningLogger().warn('governance.warning_overlay.dimmed', payload);
      } else if (!result.dimmed && lastDimmed === true) {
        warningLogger().info('governance.warning_overlay.undimmed', payload);
      }
      lastDimmed = result.dimmed;
    };
    // After the first paint, then on a slow clock while the warning stands.
    const frame = requestAnimationFrame(check);
    const timer = setInterval(check, PAINT_CHECK_MS);
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(timer);
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

  const containerRef = useRef(null);
  const rowKeys = items.map((item) => item.key).join(',');
  useWarningOverlayObservability(containerRef, rowKeys);

  return (
    <div className="governance-progress-overlay" aria-hidden="true" ref={containerRef}>
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
            const pedal = item.pedal ? pedalParts(item.pedal) : null;
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
                        ? (pedal.reading || pedal.instruction)
                        : (Number.isFinite(item.heartRate) ? item.heartRate : 'No HR data')}
                      {item.status === 'holding' ? ' · Holding' : null}
                    </span>
                    {pedal?.reading ? (
                      <span className="governance-progress-overlay__chip-hint">{pedal.instruction}</span>
                    ) : null}
                    <GovernanceStartBadge statusBadge={{ status: item.status, zoneLabel: item.statusZoneLabel }} />
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

const GovernancePanelOverlay = React.memo(function GovernancePanelOverlay({ display, overlay, lockRows = NO_LOCK_ROWS, onUnlock = null }) {
  // Support both new (display) and legacy (overlay + lockRows) format
  const status = display?.status || overlay?.status || 'unknown';
  const requirements = useMemo(() => (
    Array.isArray(display?.requirements)
      ? display.requirements
      : (Array.isArray(overlay?.requirements) ? overlay.requirements : [])
  ), [display?.requirements, overlay?.requirements]);
  const challenge = display?.challenge || null;
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

  const [animatedRows, setAnimatedRows] = useState(() =>
    rows.map((row) => ({ row, phase: 'stable' }))
  );

  // Keep removed rows around briefly so they can animate out.
  useEffect(() => {
    setAnimatedRows((prev) => {
      const prevByKey = new Map(prev.map((entry) => [entry.row.key, entry]));
      const nextKeys = new Set(rows.map((row) => row.key));

      const nextEntries = rows.map((row) => {
        const previous = prevByKey.get(row.key);
        if (!previous || previous.phase === 'exit') {
          return { row, phase: 'enter' };
        }
        return { row, phase: previous.phase === 'enter' ? 'enter' : 'stable' };
      });

      const existingExitEntries = prev.filter(
        (entry) => entry.phase === 'exit' && !nextKeys.has(entry.row.key)
      );

      const newExitEntries = prev
        .filter((entry) => !nextKeys.has(entry.row.key) && entry.phase !== 'exit')
        .map((entry) => ({ row: entry.row, phase: 'exit' }));

      return [...nextEntries, ...existingExitEntries, ...newExitEntries];
    });
  }, [rows]);

  useEffect(() => {
    if (!animatedRows.some((entry) => entry.phase === 'enter')) return undefined;
    const timer = setTimeout(() => {
      setAnimatedRows((prev) =>
        prev.map((entry) => (entry.phase === 'enter' ? { ...entry, phase: 'stable' } : entry))
      );
    }, ROW_GROW_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [animatedRows]);

  useEffect(() => {
    if (!animatedRows.some((entry) => entry.phase === 'exit')) return undefined;
    const timer = setTimeout(() => {
      setAnimatedRows((prev) => prev.filter((entry) => entry.phase !== 'exit'));
    }, ROW_GROW_ANIMATION_MS);
    return () => clearTimeout(timer);
  }, [animatedRows]);

  const hasAnimatedRows = animatedRows.length > 0;
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

  const targetZoneName = challenge?.zoneLabel
    || challenge?.zone
    || activeRequirement?.zoneLabel
    || activeRequirement?.zone
    || 'target';

  const targetCount = useMemo(() => {
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
  }, [challenge, activeRequirement, activeUserCount]);

  const actualCount = useMemo(() => {
    const challengeActual = Number.isFinite(challenge?.actualCount)
      ? Math.max(0, Math.round(challenge.actualCount))
      : null;
    const requirementActual = Number.isFinite(activeRequirement?.actualCount)
      ? Math.max(0, Math.round(activeRequirement.actualCount))
      : null;
    const resolved = challengeActual ?? requirementActual ?? 0;
    if (Number.isFinite(targetCount)) {
      return Math.min(targetCount, resolved);
    }
    return resolved;
  }, [challenge, activeRequirement, targetCount]);

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

  const frozenCurrentByRowRef = useRef(new Map());
  const frozenSnapshotKeyRef = useRef(null);
  const freezeSnapshotKey = `${status}|${challenge?.id || display?.deadline || overlay?.deadline || 'none'}`;

  useEffect(() => {
    const freezeActive = status === 'pending' || status === 'locked';
    if (!freezeActive) {
      frozenCurrentByRowRef.current.clear();
      frozenSnapshotKeyRef.current = null;
      return;
    }

    if (frozenSnapshotKeyRef.current !== freezeSnapshotKey) {
      frozenCurrentByRowRef.current.clear();
      frozenSnapshotKeyRef.current = freezeSnapshotKey;
    }

    rows.forEach((row) => {
      if (!row?.key || frozenCurrentByRowRef.current.has(row.key)) return;
      frozenCurrentByRowRef.current.set(row.key, {
        zoneId: row.currentZone?.id || null,
        label: row.currentZone?.name || row.currentLabel || 'No signal'
      });
    });
  }, [status, freezeSnapshotKey, rows]);

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
      <div className={progressClass} aria-hidden="true">
        <div className="governance-lock__progress-track">
          <div
            className="governance-lock__progress-fill"
            style={{
              transform: `scaleX(${clamped})`,
              background: fillBackground
            }}
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
        </div>
      </div>
    );
  };

  const renderChipMeta = (row) => {
    const base = (() => {
      if (row.pedal) {
        const { reading, instruction } = pedalParts(row.pedal);
        return reading || instruction;
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
    // D5: in the zone, hold still running — not missing.
    return row.status === 'holding' ? `${base} · Holding` : base;
  };

  return (
    <div className={`governance-overlay governance-overlay--${status}`}>
      <div className="governance-overlay__panel governance-lock governance-lock--wide">
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
            ) : hasAnimatedRows ? animatedRows.map((entry) => {
            const row = entry.row;
            const frozenCurrent = frozenCurrentByRowRef.current.get(row.key) || null;
            const frozenCurrentZoneId = frozenCurrent?.zoneId || row.currentZone?.id || null;
            const frozenCurrentLabel = frozenCurrent?.label || row.currentZone?.name || row.currentLabel || 'No signal';
            const currentClass = frozenCurrentZoneId ? `zone-${frozenCurrentZoneId}` : 'zone-none';
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
                  {row.pedal && pedalParts(row.pedal).reading ? (
                    <span className="governance-lock__chip-hint">{pedalParts(row.pedal).instruction}</span>
                  ) : null}
                  <GovernanceStartBadge statusBadge={{ status: row.status, zoneLabel: row.statusZoneLabel }} />
                </div>
              </div>
            );

              return (
              <div
                className={`governance-lock__row${entry.phase === 'enter' ? ' governance-lock__row--grow-in' : ''}${entry.phase === 'exit' ? ' governance-lock__row--grow-out' : ''}`}
                role="row"
                key={row.key}
              >
                <div className="governance-lock__identity" role="cell">
                  {chip}
                </div>
                <div className="governance-lock__metric" role="cell">
                  <span className={`governance-lock__pill ${currentClass}`}>
                    {frozenCurrentLabel}
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
            rows={display.rows}
          />
        </>
      );
    }

    // pending, locked, challenge-failed
    return (
      <>
        <GovernanceAudioPlayer trackKey={audioTrackKey} paused={voiceMemoOpen} />
        <GovernancePanelOverlay display={display} onUnlock={onUnlock} />
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
