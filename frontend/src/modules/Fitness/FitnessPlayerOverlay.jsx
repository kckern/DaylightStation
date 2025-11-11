import React, { useMemo } from 'react';
import PropTypes from 'prop-types';

export const useGovernanceOverlay = (governanceState) => useMemo(() => {
  if (!governanceState?.isGoverned) {
    return {
      category: null,
      status: null,
      show: false,
      filterClass: '',
      title: '',
      descriptions: [],
      requirements: [],
      highlightUsers: [],
      countdown: null
    };
  }

  const rawStatus = typeof governanceState.status === 'string' ? governanceState.status.toLowerCase() : '';
  const normalizedStatus = rawStatus === 'green' ? 'green' : rawStatus === 'yellow' ? 'yellow' : rawStatus === 'red' ? 'red' : 'grey';
  const requirements = Array.isArray(governanceState.requirements) ? governanceState.requirements : [];
  const watchers = Array.isArray(governanceState.watchers) ? governanceState.watchers : [];

  const formattedRequirements = requirements.map((rule) => ({
    zone: rule?.zoneLabel || rule?.zone || 'Zone',
    rule: rule?.ruleLabel || String(rule?.rule ?? ''),
    satisfied: Boolean(rule?.satisfied)
  }));
  const sortedRequirements = formattedRequirements.slice().sort((a, b) => Number(a.satisfied) - Number(b.satisfied));
  const unsatisfied = requirements.filter((rule) => rule && !rule.satisfied);
  const missingUsers = Array.from(new Set(
    unsatisfied
      .flatMap((rule) => Array.isArray(rule?.missingUsers) ? rule.missingUsers : [])
      .filter(Boolean)
  ));

  if (normalizedStatus === 'green') {
    return {
      category: 'governance',
      status: 'green',
      show: false,
      filterClass: '',
      title: '',
      descriptions: [],
      requirements: [],
      highlightUsers: [],
      countdown: null
    };
  }

  if (normalizedStatus === 'yellow') {
    const countdown = Number.isFinite(governanceState.countdownSecondsRemaining)
      ? governanceState.countdownSecondsRemaining
      : null;
    const allRuleMissing = Array.from(new Set(
      requirements
        .filter((rule) => String(rule?.rule).toLowerCase() === 'all' && !rule?.satisfied)
        .flatMap((rule) => Array.isArray(rule?.missingUsers) ? rule.missingUsers : [])
        .filter(Boolean)
    ));
    return {
      category: 'governance',
      status: 'yellow',
      show: true,
      filterClass: 'governance-filter-warning',
      title: 'Governance grace period',
      descriptions: [
        countdown != null ? `Grace period ends in ${countdown}s` : 'Grace period active.',
        unsatisfied.length ? 'Maintain the highlighted zones to stay in green.' : null,
        allRuleMissing.length ? 'Needs movement from highlighted participants.' : null
      ].filter(Boolean),
      requirements: sortedRequirements,
      highlightUsers: allRuleMissing,
      countdown
    };
  }

  if (normalizedStatus === 'red') {
    return {
      category: 'governance',
      status: 'red',
      show: true,
      filterClass: 'governance-filter-critical',
      title: 'Governance lockout',
      descriptions: [
        'Playback paused by governance.',
        'Increase fitness effort to continue the video.',
        missingUsers.length ? 'Needs movement from highlighted participants.' : null
      ].filter(Boolean),
      requirements: unsatisfied.map((rule) => ({
        zone: rule?.zoneLabel || rule?.zone || 'Zone',
        rule: rule?.ruleLabel || String(rule?.rule ?? ''),
        satisfied: false
      })),
      highlightUsers: missingUsers,
      countdown: null
    };
  }

  return {
    category: 'governance',
    status: 'grey',
    show: true,
    filterClass: '',
    title: 'Video Locked',
    descriptions: [
      watchers.length ? null : 'Waiting for heart-rate participants to connect.',
      formattedRequirements.length ? 'Meet these conditions to unlock playback.' : 'Loading unlock rules...'
    ].filter(Boolean),
    requirements: sortedRequirements,
    highlightUsers: [],
    countdown: null
  };
}, [governanceState]);

const FitnessPlayerOverlay = ({ overlay }) => {
  if (!overlay || !overlay.show) return null;

  const { category } = overlay;

  if (category === 'governance') {
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
              <p className="governance-overlay__line" key={`gov-desc-${idx}`}>{line}</p>
            ))
            : null}
          {Array.isArray(overlay.highlightUsers) && overlay.highlightUsers.length > 0 ? (
            <div className="governance-overlay__people">
              {overlay.highlightUsers.map((name) => (
                <span className="governance-overlay__chip" key={`gov-user-${name}`}>{name}</span>
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
  }

  // Generic fallback container for future overlay categories.
  return (
    <div className="fitness-player-overlay">
      <div className="fitness-player-overlay__panel">
        {overlay.title ? (
          <div className="fitness-player-overlay__title">{overlay.title}</div>
        ) : null}
        {Array.isArray(overlay.descriptions) && overlay.descriptions.length > 0 ? (
          overlay.descriptions.map((line, idx) => (
            <p className="fitness-player-overlay__line" key={`generic-desc-${idx}`}>{line}</p>
          ))
        ) : null}
      </div>
    </div>
  );
};

FitnessPlayerOverlay.propTypes = {
  overlay: PropTypes.shape({
    category: PropTypes.string,
    status: PropTypes.string,
    show: PropTypes.bool,
    filterClass: PropTypes.string,
    title: PropTypes.string,
    descriptions: PropTypes.arrayOf(PropTypes.string),
    requirements: PropTypes.arrayOf(PropTypes.shape({
      zone: PropTypes.string,
      rule: PropTypes.string,
      satisfied: PropTypes.bool
    })),
    highlightUsers: PropTypes.arrayOf(PropTypes.string),
    countdown: PropTypes.number
  })
};

export default FitnessPlayerOverlay;
