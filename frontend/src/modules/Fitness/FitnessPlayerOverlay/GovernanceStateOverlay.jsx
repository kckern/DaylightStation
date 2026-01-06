import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import GovernanceAudioPlayer from './GovernanceAudioPlayer.jsx';
import './GovernanceStateOverlay.scss';

const GovernanceWarningOverlay = React.memo(function GovernanceWarningOverlay({ countdown, countdownTotal, offenders }) {
  const remaining = Number.isFinite(countdown) ? Math.max(countdown, 0) : 0;
  const total = Number.isFinite(countdownTotal) ? Math.max(countdownTotal, 1) : 1;
  const progress = Math.max(0, Math.min(1, remaining / total));

  return (
    <div className="governance-progress-overlay" aria-hidden="true">
      {Array.isArray(offenders) && offenders.length > 0 ? (
        <div className="governance-progress-overlay__offenders">
          {offenders.map((offender) => {
            const clamped = Number.isFinite(offender.progressPercent)
              ? Math.max(0, Math.min(1, offender.progressPercent))
              : null;
            const percentValue = clamped != null ? Math.round(clamped * 100) : null;
            const chipProgress = Number.isFinite(percentValue) ? Math.max(0, percentValue) : 0;
            const borderStyle = offender.zoneColor ? { borderColor: offender.zoneColor } : undefined;
            const progressColor = offender.zoneColor || 'rgba(56, 189, 248, 0.95)';
            return (
              <div
                className="governance-progress-overlay__chip"
                key={offender.key}
                style={borderStyle}
              >
                <div className="governance-progress-overlay__chip-main">
                  <div className="governance-progress-overlay__chip-avatar" style={borderStyle}>
                    <img
                      src={offender.avatarSrc}
                      alt=""
                      onError={(event) => {
                        const img = event.currentTarget;
                        if (img.dataset.fallback) return;
                        img.dataset.fallback = '1';
                        img.src = DaylightMediaPath('/media/img/users/user');
                      }}
                    />
                  </div>
                  <div className="governance-progress-overlay__chip-text">
                    <span className="governance-progress-overlay__chip-name">
                      {offender.displayLabel || offender.name}
                    </span>
                    <span className="governance-progress-overlay__chip-meta">
                      {Number.isFinite(offender.heartRate)
                        ? offender.heartRate
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
      <div className="governance-progress-overlay__track">
        <div
          className="governance-progress-overlay__fill"
          style={{ transform: `scaleX(${progress})` }}
        />
      </div>
    </div>
  );
}, (prevProps, nextProps) => {
  // Skip re-render if countdown delta < 0.3s and offenders reference unchanged
  const countdownDelta = Math.abs((prevProps.countdown || 0) - (nextProps.countdown || 0));
  if (countdownDelta < 0.3 && prevProps.offenders === nextProps.offenders) {
    return true; // props are equal, skip re-render
  }
  return false;
});

GovernanceWarningOverlay.propTypes = {
  countdown: PropTypes.number,
  countdownTotal: PropTypes.number,
  offenders: PropTypes.arrayOf(PropTypes.shape({
    key: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    displayLabel: PropTypes.string,
    heartRate: PropTypes.number,
    avatarSrc: PropTypes.string.isRequired,
    zoneId: PropTypes.string,
    zoneColor: PropTypes.string,
    progressPercent: PropTypes.number
  }))
};

const GovernancePanelOverlay = React.memo(function GovernancePanelOverlay({ overlay, lockRows = [] }) {
  const title = overlay.title || 'Video Locked';
  const primaryMessage = Array.isArray(overlay.descriptions) && overlay.descriptions.length > 0
    ? overlay.descriptions[0]
    : 'Meet these conditions to unlock playback.';
  const rows = Array.isArray(lockRows) ? lockRows : [];
  const hasRows = rows.length > 0;
  const isCompact = rows.length > 6;
  const showTableHeader = !isCompact;

  const renderProgressBlock = (row, variant = 'default') => {
    if (row.progressPercent == null) return null;
    const clamped = Math.max(0, Math.min(1, row.progressPercent));
    const percentValue = Math.round(clamped * 100);
    const widthPercent = Number.isFinite(percentValue) ? Math.max(0, percentValue) : 0;
    const showIndicator = widthPercent > 0;
    const progressClass = `governance-lock__progress${variant === 'compact' ? ' governance-lock__progress--compact' : ''}`;
    const intermediateZones = Array.isArray(row.intermediateZones) ? row.intermediateZones : [];
    return (
      <div className={progressClass} aria-hidden="true">
        <div className="governance-lock__progress-track">
          <div
            className="governance-lock__progress-fill"
            style={{
              transform: `scaleX(${clamped})`,
              background: row.progressGradient || undefined
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
    <div className={`governance-overlay governance-overlay--${overlay.status || 'unknown'}`}>
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
                      img.src = DaylightMediaPath('/media/img/users/user');
                    }}
                  />
                </div>
                <div className="governance-lock__chip-text">
                  <span className="governance-lock__chip-name">{row.displayLabel || row.name}</span>
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
                    {row.currentLabel || 'No signal'}
                  </span>
                </div>
                <div className="governance-lock__cell" role="cell">
                  <span className={`governance-lock__pill governance-lock__pill--target ${targetClass}`}>
                    {row.targetLabel || 'Target'}
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
  overlay: PropTypes.shape({
    status: PropTypes.string,
    title: PropTypes.string,
    descriptions: PropTypes.arrayOf(PropTypes.string)
  }).isRequired,
  lockRows: PropTypes.arrayOf(PropTypes.shape({
    key: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    displayLabel: PropTypes.string,
    groupLabel: PropTypes.string,
    avatarSrc: PropTypes.string.isRequired,
    currentZone: PropTypes.shape({
      id: PropTypes.string,
      name: PropTypes.string
    }),
    targetZone: PropTypes.shape({
      id: PropTypes.string,
      name: PropTypes.string
    }),
    currentLabel: PropTypes.string,
    targetLabel: PropTypes.string,
    heartRate: PropTypes.number,
    targetHeartRate: PropTypes.number,
    progressPercent: PropTypes.number,
    progressGradient: PropTypes.string
  }))
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

const GovernanceStateOverlay = ({ overlay = null, lockRows = [], warningOffenders = [] }) => {
  const overlayShow = Boolean(overlay?.show);
  const overlayCategory = overlay?.category || null;
  const overlayStatus = typeof overlay?.status === 'string' ? overlay.status.toLowerCase() : '';
  
  // Determine which audio track to play (or null for none)
  const audioTrackKey = useMemo(() => {
    if (!overlayShow || overlayCategory !== 'governance') {
      return null;
    }
    if (overlayStatus === 'pending') {
      return 'init';
    }
    if (overlayStatus === 'locked') {
      return 'locked';
    }
    return null;
  }, [overlayShow, overlayCategory, overlayStatus]);

  if (!overlay?.show) {
    return null;
  }

  if (overlay.category === 'governance-warning-progress') {
    return (
      <>
        <GovernanceAudioPlayer trackKey={audioTrackKey} />
        <GovernanceWarningOverlay
          countdown={overlay.countdown}
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
  overlay: PropTypes.shape({
    show: PropTypes.bool,
    category: PropTypes.string,
    countdown: PropTypes.number,
    countdownTotal: PropTypes.number,
    status: PropTypes.string,
    title: PropTypes.string,
    descriptions: PropTypes.arrayOf(PropTypes.string),
    requirements: PropTypes.array
  }),
  lockRows: PropTypes.arrayOf(PropTypes.shape({
    key: PropTypes.string.isRequired
  })),
  warningOffenders: PropTypes.arrayOf(PropTypes.shape({
    key: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    heartRate: PropTypes.number,
    avatarSrc: PropTypes.string.isRequired
  }))
};

export default GovernanceStateOverlay;
