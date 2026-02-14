import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import { useDeadlineCountdown } from '../shared';
import GovernanceAudioPlayer from './GovernanceAudioPlayer.jsx';
import './GovernanceStateOverlay.scss';

const TOTAL_NOTCHES = 56;

const GovernanceWarningOverlay = React.memo(function GovernanceWarningOverlay({ countdown, countdownTotal, rows, offenders }) {
  const remaining = Number.isFinite(countdown) ? Math.max(countdown, 0) : 0;
  const total = Number.isFinite(countdownTotal) ? Math.max(countdownTotal, 1) : 1;
  const progress = Math.max(0, Math.min(1, remaining / total));
  const visibleNotches = Math.round(progress * TOTAL_NOTCHES);

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

const GovernancePanelOverlay = React.memo(function GovernancePanelOverlay({ display, overlay, lockRows = [] }) {
  // Support both new (display) and legacy (overlay + lockRows) format
  const status = display?.status || overlay?.status || 'unknown';
  const title = overlay?.title || 'Video Locked';
  const primaryMessage = Array.isArray(overlay?.descriptions) && overlay.descriptions.length > 0
    ? overlay.descriptions[0]
    : 'Meet these conditions to unlock playback.';
  const rows = (display ? display.rows : lockRows) || [];
  const hasRows = rows.length > 0;
  const isCompact = rows.length > 6;
  const showTableHeader = !isCompact;

  const renderProgressBlock = (row, variant = 'default') => {
    // Support both formats: progress (new) and progressPercent (legacy)
    const rawProgress = row.progress ?? row.progressPercent ?? null;
    if (rawProgress == null) return null;
    const clamped = Math.max(0, Math.min(1, rawProgress));
    const percentValue = Math.round(clamped * 100);
    const widthPercent = Number.isFinite(percentValue) ? Math.max(0, percentValue) : 0;
    const showIndicator = widthPercent > 0;
    const progressClass = `governance-lock__progress${variant === 'compact' ? ' governance-lock__progress--compact' : ''}`;
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
      <div className={`governance-overlay__panel governance-lock${isCompact ? ' governance-lock--compact' : ''}`}>
        <div className="governance-lock__title">{title}</div>
        {primaryMessage ? (
          <p className="governance-lock__message">{primaryMessage}</p>
        ) : null}
        <div className="governance-lock__table" role="table" aria-label="Unlock requirements">
          {showTableHeader ? (
            <div className="governance-lock__row governance-lock__row--header" role="row">
              <div className="governance-lock__cell governance-lock__cell--head" role="columnheader">Participant</div>
              <div className="governance-lock__cell governance-lock__cell--head" role="columnheader">Current</div>
              <div className="governance-lock__cell governance-lock__cell--head" role="columnheader">Target</div>
            </div>
          ) : null}
          {hasRows ? rows.map((row) => {
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

            if (isCompact) {
              return (
                <div className="governance-lock__row governance-lock__row--compact" role="row" key={row.key}>
                  <div className="governance-lock__compact-chip" role="cell">
                    {chip}
                  </div>
                  {renderProgressBlock(row, 'compact')}
                </div>
              );
            }

            return (
              <div className="governance-lock__row" role="row" key={row.key}>
                <div className="governance-lock__cell governance-lock__cell--chip" role="cell">
                  {chip}
                </div>
                <div className="governance-lock__cell" role="cell">
                  <span className={`governance-lock__pill ${currentClass}`}>
                    {row.currentZone?.name || row.currentLabel || 'No signal'}
                  </span>
                </div>
                <div className="governance-lock__cell" role="cell">
                  <span className={`governance-lock__pill governance-lock__pill--target ${targetClass}`}>
                    {row.targetZone?.name || row.targetLabel || 'Target'}
                  </span>
                </div>
                {renderProgressBlock(row)}
              </div>
            );
          }) : (
            <div className="governance-lock__row governance-lock__row--empty" role="row">
              <div className="governance-lock__cell governance-lock__cell--empty" role="cell">
                Waiting for participant data...
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
    rows: PropTypes.array
  }),
  overlay: PropTypes.shape({
    status: PropTypes.string,
    title: PropTypes.string,
    descriptions: PropTypes.arrayOf(PropTypes.string)
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
  const { remaining: countdown } = useDeadlineCountdown(
    useNewPath ? display.deadline : overlay?.deadline,
    useNewPath ? (display.gracePeriodTotal || 30) : (overlay?.countdownTotal || 30)
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
            rows={display.rows}
          />
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
