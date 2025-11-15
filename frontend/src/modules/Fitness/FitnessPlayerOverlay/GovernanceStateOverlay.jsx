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

const GovernancePanelOverlay = ({ overlay, challengeMeta, highlightEntries }) => {
  const {
    challenge,
    statusLabel,
    status,
    remaining,
    total,
    progress,
    zoneLabel,
    selectionLabel,
    actualCount,
    requiredCount,
    missingUsers,
    metUsers
  } = challengeMeta || {};

  const hasChallenge = Boolean(challenge);

  return (
    <div className={`governance-overlay governance-overlay--${overlay.status || 'unknown'}`}>
      <div className="governance-overlay__panel">
        {overlay.title ? (
          <div className="governance-overlay__title">{overlay.title}</div>
        ) : null}
        {overlay.countdown != null ? (
          <div className="governance-overlay__countdown">{overlay.countdown}s</div>
        ) : null}
        {Array.isArray(overlay.descriptions) && overlay.descriptions.length > 0
          ? overlay.descriptions.map((line, idx) => (
              <p className="governance-overlay__line" key={`gov-desc-${idx}`}>
                {line}
              </p>
            ))
          : null}
        {hasChallenge ? (
          <div className={`governance-overlay__challenge governance-overlay__challenge--${status || 'pending'}`}>
            <div className="governance-overlay__challenge-header">
              <div className="governance-overlay__challenge-title">{zoneLabel}</div>
              <div className="governance-overlay__challenge-meta" aria-label="Challenge status">
                <span className={`governance-overlay__challenge-status governance-overlay__challenge-status--${status || 'pending'}`}>
                  {statusLabel || 'Active'}
                </span>
                {Number.isFinite(remaining) && Number.isFinite(total) ? (
                  <span className="governance-overlay__challenge-time">
                    {`${remaining}s / ${total}s`}
                  </span>
                ) : null}
                {selectionLabel ? (
                  <span className="governance-overlay__challenge-tag">{selectionLabel}</span>
                ) : null}
              </div>
            </div>
            <div className="governance-overlay__challenge-counts" aria-label="Challenge participant counts">
              <span className="governance-overlay__challenge-count">{actualCount ?? 0}</span>
              <span className="governance-overlay__challenge-divider">/</span>
              <span className="governance-overlay__challenge-count governance-overlay__challenge-count--target">{requiredCount ?? 0}</span>
            </div>
            <div
              className="governance-overlay__challenge-progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round((progress ?? 0) * 100)}
            >
              <div
                className="governance-overlay__challenge-progress-fill"
                style={{ width: `${Math.round((progress ?? 0) * 100)}%` }}
              />
            </div>
            {Array.isArray(missingUsers) && missingUsers.length ? (
              <div className="governance-overlay__challenge-hint">
                Need: {missingUsers.join(', ')}
              </div>
            ) : Array.isArray(metUsers) && metUsers.length ? (
              <div className="governance-overlay__challenge-hint governance-overlay__challenge-hint--met">
                Met: {metUsers.join(', ')}
              </div>
            ) : null}
          </div>
        ) : null}
        {highlightEntries.length > 0 ? (
          <div className="governance-overlay__people">
            {highlightEntries.map(({ name, avatarSrc, key }) => (
              <span className="governance-overlay__chip" key={`gov-user-${key}`}>
                <img
                  src={avatarSrc}
                  alt=""
                  className="governance-overlay__avatar"
                  onError={(event) => {
                    const img = event.currentTarget;
                    if (img.dataset.fallback) {
                      img.style.display = 'none';
                      return;
                    }
                    img.dataset.fallback = '1';
                    img.src = DaylightMediaPath('/media/img/users/user');
                  }}
                />
                <span className="governance-overlay__chip-label">{name}</span>
              </span>
            ))}
          </div>
        ) : null}
        {Array.isArray(overlay.requirements) && overlay.requirements.length > 0 ? (
          <ul className="governance-overlay__rules">
            {overlay.requirements.map((rule, idx) => (
              <li
                className={`governance-overlay__rule ${rule.satisfied ? 'is-met' : 'is-pending'}`}
                key={`gov-rule-${idx}-${rule.zone}`}
              >
                <span className="governance-overlay__rule-zone">{rule.zone}</span>
                <span className="governance-overlay__rule-desc">{rule.rule}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
};

GovernancePanelOverlay.propTypes = {
  overlay: PropTypes.shape({
    status: PropTypes.string,
    title: PropTypes.string,
    countdown: PropTypes.number,
    descriptions: PropTypes.arrayOf(PropTypes.string),
    requirements: PropTypes.arrayOf(PropTypes.shape({
      zone: PropTypes.string,
      rule: PropTypes.string,
      satisfied: PropTypes.bool
    }))
  }).isRequired,
  challengeMeta: PropTypes.shape({
    challenge: PropTypes.object,
    status: PropTypes.string,
    statusLabel: PropTypes.string,
    remaining: PropTypes.number,
    total: PropTypes.number,
    progress: PropTypes.number,
    zoneLabel: PropTypes.string,
    selectionLabel: PropTypes.string,
    actualCount: PropTypes.number,
    requiredCount: PropTypes.number,
    missingUsers: PropTypes.arrayOf(PropTypes.string),
    metUsers: PropTypes.arrayOf(PropTypes.string)
  }),
  highlightEntries: PropTypes.arrayOf(PropTypes.shape({
    name: PropTypes.string,
    avatarSrc: PropTypes.string,
    key: PropTypes.string
  }))
};

GovernancePanelOverlay.defaultProps = {
  challengeMeta: null,
  highlightEntries: []
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

const GovernanceStateOverlay = ({ overlay, challengeMeta, highlightEntries }) => {
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
        challengeMeta={challengeMeta}
        highlightEntries={highlightEntries}
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
    requirements: PropTypes.arrayOf(PropTypes.shape({
      zone: PropTypes.string,
      rule: PropTypes.string,
      satisfied: PropTypes.bool
    }))
  }),
  challengeMeta: PropTypes.shape({
    challenge: PropTypes.object,
    status: PropTypes.string,
    statusLabel: PropTypes.string,
    remaining: PropTypes.number,
    total: PropTypes.number,
    progress: PropTypes.number,
    zoneLabel: PropTypes.string,
    selectionLabel: PropTypes.string,
    actualCount: PropTypes.number,
    requiredCount: PropTypes.number,
    missingUsers: PropTypes.arrayOf(PropTypes.string),
    metUsers: PropTypes.arrayOf(PropTypes.string)
  }),
  highlightEntries: PropTypes.arrayOf(PropTypes.shape({
    name: PropTypes.string,
    avatarSrc: PropTypes.string,
    key: PropTypes.string
  }))
};

GovernanceStateOverlay.defaultProps = {
  overlay: null,
  challengeMeta: null,
  highlightEntries: []
};

export default GovernanceStateOverlay;
