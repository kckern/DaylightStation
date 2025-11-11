import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { useFitnessContext } from '../../context/FitnessContext.jsx';
import { DaylightMediaPath } from '../../lib/api.mjs';

const slugifyId = (value, fallback = 'user') => {
  if (!value) return fallback;
  const slug = String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return slug || fallback;
};

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
      countdown: null,
      countdownTotal: null
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
      countdown: null,
      countdownTotal: null
    };
  }

  if (normalizedStatus === 'yellow') {
    const countdown = Number.isFinite(governanceState.countdownSecondsRemaining)
      ? governanceState.countdownSecondsRemaining
      : null;
    const countdownTotal = Number.isFinite(governanceState.gracePeriodTotal)
      ? Math.max(1, governanceState.gracePeriodTotal)
      : Number.isFinite(governanceState.countdownSecondsTotal)
        ? Math.max(1, governanceState.countdownSecondsTotal)
        : 30;
    return {
      category: 'governance-warning-progress',
      status: 'yellow',
      show: true,
      filterClass: 'governance-filter-warning',
      title: '',
      descriptions: [],
      requirements: [],
      highlightUsers: [],
      countdown,
      countdownTotal
    };
  }

  if (normalizedStatus === 'red') {
    return {
      category: 'governance',
      status: 'red',
      show: true,
      filterClass: 'governance-filter-critical',
      title: 'Video Locked',
      descriptions: [
        'Increase fitness effort to continue the video.',
        missingUsers.length ? 'Needs movement from highlighted participants.' : null
      ].filter(Boolean),
      requirements: unsatisfied.map((rule) => ({
        zone: rule?.zoneLabel || rule?.zone || 'Zone',
        rule: rule?.ruleLabel || String(rule?.rule ?? ''),
        satisfied: false
      })),
      highlightUsers: missingUsers,
      countdown: null,
      countdownTotal: null
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
    countdown: null,
    countdownTotal: null
  };
}, [governanceState]);

const FitnessPlayerOverlay = ({ overlay }) => {
  const fitnessCtx = useFitnessContext();

  const highlightEntries = useMemo(() => {
    if (!overlay || !Array.isArray(overlay.highlightUsers) || overlay.highlightUsers.length === 0) {
      return [];
    }
    const normalize = (name) => (typeof name === 'string' ? name.trim().toLowerCase() : '');
    const lookup = new Map();
    const users = Array.isArray(fitnessCtx?.users) ? fitnessCtx.users : [];
    users.forEach((user) => {
      if (!user?.name) return;
      const key = normalize(user.name);
      if (!key) return;
      const profileSlug = user.id || slugifyId(user.name);
      lookup.set(key, {
        displayName: user.name,
        profileSlug
      });
    });
    const guestAssignments = fitnessCtx?.guestAssignments || {};
    Object.values(guestAssignments).forEach((assignment) => {
      if (!assignment?.name) return;
      const key = normalize(assignment.name);
      if (!key) return;
      const profileSlug = assignment.profileId || slugifyId(assignment.name);
      lookup.set(key, {
        displayName: assignment.name,
        profileSlug
      });
    });

    return overlay.highlightUsers
      .map((rawName, index) => {
        const key = normalize(rawName);
        if (!key) return null;
        const record = lookup.get(key);
        const displayName = record?.displayName || rawName;
        const profileSlug = record?.profileSlug || slugifyId(displayName);
        const avatarSrc = DaylightMediaPath(`/media/img/users/${profileSlug}`);
        return {
          name: displayName,
          avatarSrc,
          key: `${profileSlug || key}-${index}`
        };
      })
      .filter(Boolean);
  }, [fitnessCtx?.guestAssignments, fitnessCtx?.users, overlay]);

  if (!overlay || !overlay.show) return null;

  const { category } = overlay;

  if (category === 'governance-warning-progress') {
    const remaining = Number.isFinite(overlay.countdown) ? Math.max(overlay.countdown, 0) : 0;
    const total = Number.isFinite(overlay.countdownTotal) ? Math.max(overlay.countdownTotal, 1) : 1;
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
  }

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
          {highlightEntries.length > 0 ? (
            <div className="governance-overlay__people">
              {highlightEntries.map(({ name, avatarSrc, key: entryKey }) => (
                <span className="governance-overlay__chip" key={`gov-user-${entryKey}`}>
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
    countdown: PropTypes.number,
    countdownTotal: PropTypes.number
  })
};

export default FitnessPlayerOverlay;
