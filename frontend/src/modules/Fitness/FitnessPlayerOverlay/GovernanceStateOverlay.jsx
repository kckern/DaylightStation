import React from 'react';
import PropTypes from 'prop-types';
import { DaylightMediaPath } from '../../../lib/api.mjs';
import './GovernanceStateOverlay.scss';

const GovernanceWarningOverlay = ({ countdown, countdownTotal }) => {
  const remaining = Number.isFinite(countdown) ? Math.max(countdown, 0) : 0;
  const total = Number.isFinite(countdownTotal) ? Math.max(countdownTotal, 1) : 1;
  const progress = Math.max(0, Math.min(1, remaining / total));

  return (
    <div className="governance-progress-overlay" aria-hidden="true">
      <div className="governance-progress-overlay__track">
        <div
          className="governance-progress-overlay__fill"
          style={{ width: `${progress * 100}%` }}
        />
      </div>
    </div>
  );
};

GovernanceWarningOverlay.propTypes = {
  countdown: PropTypes.number,
  countdownTotal: PropTypes.number
};

const GovernancePanelOverlay = ({ overlay, lockRows }) => {
  const title = overlay.title || 'Video Locked';
  const primaryMessage = Array.isArray(overlay.descriptions) && overlay.descriptions.length > 0
    ? overlay.descriptions[0]
    : 'Meet these conditions to unlock playback.';
  const rows = Array.isArray(lockRows) ? lockRows : [];
  const hasRows = rows.length > 0;

  return (
    <div className={`governance-overlay governance-overlay--${overlay.status || 'unknown'}`}>
      <div className="governance-overlay__panel governance-lock">
        <div className="governance-lock__title">{title}</div>
        {primaryMessage ? (
          <p className="governance-lock__message">{primaryMessage}</p>
        ) : null}
        <div className="governance-lock__table" role="table" aria-label="Unlock requirements">
          <div className="governance-lock__row governance-lock__row--header" role="row">
            <div className="governance-lock__cell governance-lock__cell--head" role="columnheader">Participant</div>
            <div className="governance-lock__cell governance-lock__cell--head" role="columnheader">Current</div>
            <div className="governance-lock__cell governance-lock__cell--head" role="columnheader">Target</div>
          </div>
          {hasRows ? rows.map((row) => {
            const currentClass = row.currentZone?.id ? `zone-${row.currentZone.id}` : 'zone-none';
            const targetClass = row.targetZone?.id ? `zone-${row.targetZone.id}` : 'zone-none';
            return (
              <div className="governance-lock__row" role="row" key={row.key}>
                <div className="governance-lock__cell governance-lock__cell--chip" role="cell">
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
                      <span className="governance-lock__chip-name">{row.name}</span>
                      {row.groupLabel && row.groupLabel.toLowerCase() !== 'primary' ? (
                        <span className="governance-lock__chip-group">{row.groupLabel}</span>
                      ) : null}
                    </div>
                  </div>
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
};

GovernancePanelOverlay.propTypes = {
  overlay: PropTypes.shape({
    status: PropTypes.string,
    title: PropTypes.string,
    descriptions: PropTypes.arrayOf(PropTypes.string)
  }).isRequired,
  lockRows: PropTypes.arrayOf(PropTypes.shape({
    key: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
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
    targetLabel: PropTypes.string
  }))
};

GovernancePanelOverlay.defaultProps = {
  lockRows: []
};

const GenericOverlay = ({ overlay }) => (
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

GenericOverlay.propTypes = {
  overlay: PropTypes.shape({
    title: PropTypes.string,
    descriptions: PropTypes.arrayOf(PropTypes.string)
  }).isRequired
};

const GovernanceStateOverlay = ({ overlay, lockRows }) => {
  if (!overlay?.show) {
    return null;
  }

  if (overlay.category === 'governance-warning-progress') {
    return (
      <GovernanceWarningOverlay
        countdown={overlay.countdown}
        countdownTotal={overlay.countdownTotal}
      />
    );
  }

  if (overlay.category === 'governance') {
    return (
      <GovernancePanelOverlay
        overlay={overlay}
        lockRows={lockRows}
      />
    );
  }

  return <GenericOverlay overlay={overlay} />;
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
  }))
};

GovernanceStateOverlay.defaultProps = {
  overlay: null,
  lockRows: []
};

export default GovernanceStateOverlay;
