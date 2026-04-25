import React, { useMemo, useRef, useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { DaylightMediaPath } from '@/lib/api.mjs';
import { getLogger } from '@/lib/logging/Logger.js';
import { useDeadlineCountdown } from '@/modules/Fitness/shared';
import GovernanceAudioPlayer from './GovernanceAudioPlayer.jsx';
import { computeCycleLockPanelData } from './cycleLockPanelData.js';
import './GovernanceStateOverlay.scss';

const TOTAL_NOTCHES = 56;
const ROW_GROW_ANIMATION_MS = 220;

const GovernanceWarningOverlay = React.memo(function GovernanceWarningOverlay({ countdown, countdownTotal, notches, rows, offenders }) {
  // Use notches directly from the per-notch interval timer when available,
  // fall back to deriving from countdown for backward compatibility
  const visibleNotches = Number.isFinite(notches)
    ? Math.max(0, Math.min(TOTAL_NOTCHES, notches))
    : Math.round(Math.max(0, Math.min(1, (Number.isFinite(countdown) ? Math.max(countdown, 0) : 0) / Math.max(countdownTotal || 1, 1))) * TOTAL_NOTCHES);

  // Support both new (rows) and legacy (offenders) format
  const items = Array.isArray(rows) && rows.length > 0 ? rows : (Array.isArray(offenders) ? offenders : []);

  return (
    <div className="governance-progress-overlay" aria-hidden="true">
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
            return (
              <div
                className="governance-progress-overlay__chip"
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
                      {Number.isFinite(item.heartRate)
                        ? item.heartRate
                        : 'No HR data'}
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
  if (countdownDelta < 0.3 && prevProps.rows === nextProps.rows && prevProps.offenders === nextProps.offenders) {
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

const GovernancePanelOverlay = React.memo(function GovernancePanelOverlay({ display, overlay, lockRows = [] }) {
  // Support both new (display) and legacy (overlay + lockRows) format
  const status = display?.status || overlay?.status || 'unknown';
  const title = overlay?.title || 'Video Locked';
  const overlayPrimaryMessage = Array.isArray(overlay?.descriptions) && overlay.descriptions.length > 0
    ? overlay.descriptions[0]
    : null;
  const requirements = Array.isArray(display?.requirements)
    ? display.requirements
    : (Array.isArray(overlay?.requirements) ? overlay.requirements : []);
  const challenge = display?.challenge || null;
  const activeUserCount = Number.isFinite(display?.activeUserCount)
    ? Math.max(0, Math.round(display.activeUserCount))
    : null;
  const unsortedRows = (display ? display.rows : lockRows) || [];
  // Sort by progress descending — closest to meeting target bubbles to top
  const rows = useMemo(() => {
    if (unsortedRows.length <= 1) return unsortedRows;
    return [...unsortedRows].sort((a, b) => {
      const pa = a.progress ?? -1;
      const pb = b.progress ?? -1;
      return pb - pa; // highest progress first
    });
  }, [unsortedRows]);
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
  const panelTitle = isInitPoolEmpty ? null : title;
  const primaryMessage = isInitPoolEmpty
    ? null
    : (overlayPrimaryMessage || 'Meet these conditions to unlock playback.');

  const activeRequirement = useMemo(() => {
    if (!requirements.length) return null;
    return requirements.find((req) => req && !req.satisfied) || requirements[0] || null;
  }, [requirements]);

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

  const countBlocks = useMemo(() => {
    if (!Number.isFinite(targetCount) || targetCount <= 0) return [];
    const completed = Math.min(targetCount, Math.max(0, actualCount));
    return Array.from({ length: targetCount }, (_, index) => ({
      id: index + 1,
      complete: index < completed
    }));
  }, [targetCount, actualCount]);
  const hasTargetCount = Number.isFinite(targetCount) && targetCount > 0;
  const showCountBlocks = !isInitPoolEmpty && hasTargetCount && countBlocks.length > 0;

  const summaryMain = useMemo(() => {
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
  }, [isInitPoolEmpty, hasTargetCount, targetCount, actualCount, targetZoneName, activeUserCount]);

  const summarySub = useMemo(() => {
    if (isInitPoolEmpty) {
      return 'Start a participant or connect an HR sensor to continue.';
    }
    if (Number.isFinite(activeUserCount) && hasTargetCount) {
      return `${activeUserCount} participant${activeUserCount === 1 ? '' : 's'} in pool`;
    }
    return null;
  }, [isInitPoolEmpty, activeUserCount, hasTargetCount]);

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
    const showIndicator = widthPercent > 0;
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
          <div
            className="governance-lock__progress-indicator"
            style={{
              left: `${widthPercent}%`,
              opacity: showIndicator ? 1 : 0,
              visibility: showIndicator ? 'visible' : 'hidden'
            }}
          >
            {showIndicator ? <span>{percentValue}%</span> : null}
          </div>
        </div>
      </div>
    );
  };

  const renderChipMeta = (row) => {
    const currentHr = Number.isFinite(row.heartRate) ? Math.max(0, Math.round(row.heartRate)) : null;
    const targetHr = Number.isFinite(row.targetHeartRate) ? Math.max(0, Math.round(row.targetHeartRate)) : null;
    if (currentHr != null) {
      if (targetHr != null) {
        return `${currentHr} / ${targetHr}`;
      }
      return String(currentHr);
    }
    return row.groupLabel || 'No HR data';
  };

  return (
    <div className={`governance-overlay governance-overlay--${status}`}>
      <div className="governance-overlay__panel governance-lock governance-lock--wide">
        <div className={`governance-lock__header${showCountBlocks ? '' : ' governance-lock__header--summary-only'}`}>
            {showCountBlocks ? (
            <div
              className="governance-lock__count-blocks"
              role="meter"
              aria-label={`Exit criteria progress ${actualCount} of ${targetCount}`}
              aria-valuemin={0}
              aria-valuemax={targetCount}
              aria-valuenow={actualCount}
            >
              {countBlocks.map((block) => (
                <span
                  key={block.id}
                  className={`governance-lock__count-block${block.complete ? ' governance-lock__count-block--complete' : ''}`}
                  aria-hidden="true"
                />
              ))}
            </div>
          ) : null}
          <div className="governance-lock__summary">
            <p className="governance-lock__summary-main">{summaryMain}</p>
            {summarySub ? <p className="governance-lock__summary-sub">{summarySub}</p> : null}
          </div>
        </div>

          {panelTitle ? <div className="governance-lock__title">{panelTitle}</div> : null}
          {primaryMessage ? (
            <p className="governance-lock__message governance-lock__message--compact">{primaryMessage}</p>
          ) : null}

        <div
          className={`governance-lock__table${isInitPoolEmpty ? ' governance-lock__table--init' : ''}`}
          role="table"
          aria-label="Unlock requirements"
        >
            {hasAnimatedRows ? animatedRows.map((entry) => {
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
                <div className="governance-lock__chip-text governance-lock__chip-text--inline">
                  <span className="governance-lock__chip-name">{row.displayName || row.displayLabel || row.name}</span>
                  <span className="governance-lock__chip-meta">{renderChipMeta(row)}</span>
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
                <p className="governance-lock__init-title">Waiting for first participant...</p>
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
    requirements: PropTypes.array,
    activeUserCount: PropTypes.number
  }),
  overlay: PropTypes.shape({
    status: PropTypes.string,
    title: PropTypes.string,
    descriptions: PropTypes.arrayOf(PropTypes.string),
    requirements: PropTypes.array
  }),
  lockRows: PropTypes.array
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

const GovernanceStateOverlay = ({ display, overlay = null, lockRows = [], warningOffenders = [] }) => {
  // New path: display prop from useGovernanceDisplay
  // Legacy path: overlay + lockRows + warningOffenders
  const useNewPath = display != null;

  const effectiveStatus = useNewPath
    ? (display.status || '')
    : (typeof overlay?.status === 'string' ? overlay.status.toLowerCase() : '');
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
    // Legacy path uses category check; new path just uses status
    if (!useNewPath && effectiveCategory !== 'governance') return null;
    if (effectiveStatus === 'pending') return 'init';
    if (effectiveStatus === 'locked') return 'locked';
    return null;
  }, [effectiveShow, effectiveCategory, effectiveStatus, useNewPath]);

  if (!effectiveShow) {
    return null;
  }

  // New path: dispatch on status
  if (useNewPath) {
    if (effectiveStatus === 'warning') {
      return (
        <>
          <GovernanceAudioPlayer trackKey={audioTrackKey} />
          <GovernanceWarningOverlay
            countdown={countdown}
            countdownTotal={display.gracePeriodTotal}
            notches={countdownNotches}
            rows={display.rows}
          />
        </>
      );
    }

    // Cycle challenge locked: render rider-centric RPM lock panel.
    // The rider's HR zone (used for avatar/pill tinting) is looked up from
    // the display rows by rider id when available, else defaults to 'cool'.
    const cycleChallenge = display?.challenge || null;
    const riderId = cycleChallenge?.rider?.id || null;
    const riderRow = riderId && Array.isArray(display?.rows)
      ? display.rows.find((r) => r?.userId === riderId || r?.key === riderId || r?.id === riderId)
      : null;
    const riderZone = riderRow?.currentZone?.id || null;
    const cycleLockData = computeCycleLockPanelData(cycleChallenge, riderZone);

    if (cycleLockData) {
      const riderDisplayName =
        cycleLockData.rider?.name || cycleLockData.rider?.id || '?';
      const riderInitial =
        (riderDisplayName && riderDisplayName[0]
          ? riderDisplayName[0].toUpperCase()
          : '?');
      const zoneClass = `zone-${cycleLockData.zone}`;

      return (
        <>
          <GovernanceAudioPlayer trackKey={audioTrackKey} />
          <div className="governance-overlay governance-overlay--locked">
            <div className="governance-overlay__panel governance-lock governance-lock--cycle">
              <div className="governance-lock__title">{cycleLockData.title}</div>
              <p className="governance-lock__message">{cycleLockData.instruction}</p>
              <div className="governance-lock__table" role="table" aria-label="Cycle unlock requirements">
                <div className="governance-lock__row governance-lock__row--cycle" role="row">
                  <div className="governance-lock__cell governance-lock__cell--chip" role="cell">
                    <div className="governance-lock__chip">
                      <div className={`governance-lock__avatar ${zoneClass}`}>
                        <span className="governance-lock__avatar-initials">{riderInitial}</span>
                      </div>
                      <div className="governance-lock__chip-text">
                        <span className="governance-lock__chip-name">{riderDisplayName}</span>
                      </div>
                    </div>
                  </div>
                  <div className="governance-lock__cell" role="cell">
                    <span className={`governance-lock__pill governance-lock__pill--rpm ${zoneClass}`}>
                      {cycleLockData.currentRpm} RPM
                    </span>
                  </div>
                  <div className="governance-lock__cell" role="cell">
                    <span className="governance-lock__pill governance-lock__pill--rpm governance-lock__pill--target">
                      {cycleLockData.targetRpm} RPM
                    </span>
                  </div>
                  <div className="governance-lock__progress" aria-hidden="true">
                    <div className="governance-lock__progress-track">
                      <div
                        className="governance-lock__progress-fill"
                        style={{ transform: `scaleX(${cycleLockData.progress})` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      );
    }

    // pending, locked, challenge-failed
    return (
      <>
        <GovernanceAudioPlayer trackKey={audioTrackKey} />
        <GovernancePanelOverlay display={display} />
      </>
    );
  }

  // Legacy path: dispatch on category
  if (overlay.category === 'governance-warning-progress') {
    return (
      <>
        <GovernanceAudioPlayer trackKey={audioTrackKey} />
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
        <GovernanceAudioPlayer trackKey={audioTrackKey} />
        <GovernancePanelOverlay
          overlay={overlay}
          lockRows={lockRows}
        />
      </>
    );
  }

  return (
    <>
      <GovernanceAudioPlayer trackKey={audioTrackKey} />
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
  warningOffenders: PropTypes.array
};

export default GovernanceStateOverlay;
