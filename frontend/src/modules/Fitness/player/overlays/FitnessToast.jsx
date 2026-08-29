import React, { useEffect, useMemo, useState, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import getLogger from '@/lib/logging/Logger.js';
import { DEFAULT_TOAST_DURATION_MS } from './fitnessToastSlot.js';
import { describeRingEntry, describeSameThresholdPeople } from './buildRingCelebrationToast.js';
import RingIcon from '@/lib/icons/RingIcon.jsx';
import './FitnessToast.scss';

// Fade + collapse exit duration. Keep in sync with FitnessToast.scss transition.
export const TOAST_EXIT_MS = 320;

/**
 * A single contributor chip: avatar (with initials fallback on image error) + name.
 * Used by the challenge success toast to show who earned the challenge (§5B).
 */
function ContributorChip({ name, avatarUrl }) {
  const [failed, setFailed] = useState(false);
  const initial = (name || '?').trim().slice(0, 1).toUpperCase();
  return (
    <div className="fitness-toast__contributor">
      {avatarUrl && !failed ? (
        <img
          className="fitness-toast__contributor-avatar"
          src={avatarUrl}
          alt=""
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="fitness-toast__contributor-avatar fitness-toast__contributor-avatar--fallback">
          {initial}
        </div>
      )}
      <span className="fitness-toast__contributor-name">{name}</span>
    </div>
  );
}

ContributorChip.propTypes = {
  name: PropTypes.string,
  avatarUrl: PropTypes.string,
};

function RingContributorFaces({ contributors, maxVisible }) {
  const visible = contributors.slice(0, maxVisible);
  const extra = Math.max(0, contributors.length - visible.length);
  return (
    <div className="fitness-toast__ring-faces" aria-label={contributors.map((person) => person.name).join(', ')}>
      {visible.map((person) => <ContributorChip key={person.id} {...person} />)}
      {extra ? <div className="fitness-toast__ring-more">+{extra}</div> : null}
    </div>
  );
}

RingContributorFaces.propTypes = {
  contributors: PropTypes.array.isRequired,
  maxVisible: PropTypes.number.isRequired,
};

function RingCelebrationToast({ celebration, refreshKey }) {
  const [iconFailed, setIconFailed] = useState(false);
  const entries = Array.isArray(celebration?.entries) ? celebration.entries : [];
  const contributors = Array.isArray(celebration?.contributors) ? celebration.contributors : [];
  const groupEntries = entries.filter((entry) => entry.scope === 'group');
  const individualEntries = entries.filter((entry) => entry.scope === 'individual');
  const group = groupEntries[groupEntries.length - 1] || null;
  const shared = describeSameThresholdPeople(individualEntries);
  const maxVisible = Math.max(1, celebration?.maxVisibleContributors || 3);

  return (
    <>
      <div className="fitness-toast__ring-stage">
        {celebration?.iconUrl && !iconFailed ? (
          <img
            key={refreshKey}
            className="fitness-toast__ring-icon"
            src={celebration.iconUrl}
            alt=""
            onError={() => setIconFailed(true)}
          />
        ) : (
          <RingIcon className="fitness-toast__ring-icon" size="100%" spin label="Fitness ring" />
        )}
      </div>
      {group ? (
        <>
          <div className="fitness-toast__ring-total">{group.threshold.toLocaleString()} RINGS</div>
          <div className="fitness-toast__ring-message">Together, you earned them.</div>
        </>
      ) : shared ? (
        <>
          <div className="fitness-toast__ring-total">{shared.threshold.toLocaleString()} RINGS EACH</div>
          <div className="fitness-toast__ring-message">{shared.names} reached them together!</div>
        </>
      ) : individualEntries.length === 1 ? (
        <>
          <div className="fitness-toast__ring-total">{individualEntries[0].threshold.toLocaleString()} RINGS</div>
          <div className="fitness-toast__ring-message">{individualEntries[0].name} has {individualEntries[0].threshold.toLocaleString()} rings!</div>
        </>
      ) : <div className="fitness-toast__ring-total">RINGS!</div>}
      {contributors.length ? <RingContributorFaces contributors={contributors} maxVisible={maxVisible} /> : null}
      {individualEntries.length > 1 && !shared ? (
        <div className="fitness-toast__ring-lines">
          {individualEntries.map((entry) => (
            <div className="fitness-toast__ring-line" key={`${entry.userId}:${entry.threshold}`}>
              <img src={entry.avatarUrl} alt="" onError={(event) => { event.currentTarget.style.display = 'none'; }} />
              <span>{describeRingEntry(entry)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}

RingCelebrationToast.propTypes = {
  celebration: PropTypes.shape({
    iconUrl: PropTypes.string,
    entries: PropTypes.array,
    contributors: PropTypes.array,
    maxVisibleContributors: PropTypes.number,
  }),
  refreshKey: PropTypes.string,
};

/**
 * Ephemeral, centered, self-dismissing notification for the video view.
 * Single-slot: the parent passes the current toast (or null). A new `toast.id`
 * restarts the countdown + animation; on completion the toast fades/collapses
 * and calls onDone(id). Non-blocking — never pauses video or gates governance.
 */
export default function FitnessToast({ toast, onDone }) {
  const logger = useMemo(() => getLogger().child({ component: 'fitness-toast' }), []);
  const [exiting, setExiting] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const id = toast?.id ?? null;
  const revision = toast?.revision ?? 0;
  const timerKey = `${id}:${revision}`;
  const timersRef = useRef({ hide: null, done: null });

  useEffect(() => {
    if (id == null) return undefined;
    setExiting(false);
    setImgFailed(false);
    const durationMs = Number.isFinite(toast?.durationMs) ? toast.durationMs : DEFAULT_TOAST_DURATION_MS;
    logger.info('fitness.toast.shown', { id, variant: toast?.variant, durationMs });
    const timers = timersRef.current;
    timers.hide = setTimeout(() => setExiting(true), durationMs);
    timers.done = setTimeout(() => {
      logger.info('fitness.toast.dismissed', { id, reason: 'timeout' });
      if (typeof onDone === 'function') onDone(id);
    }, durationMs + TOAST_EXIT_MS);
    return () => {
      clearTimeout(timers.hide);
      clearTimeout(timers.done);
    };
    // Usually ids are monotonic (see normalizeToast). Ring celebrations are the
    // one exception: they retain the visible card's id but increment revision
    // as another person joins, deliberately restarting this lifetime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timerKey]);

  const handleDismiss = useCallback(() => {
    if (id == null) return;
    clearTimeout(timersRef.current.hide);
    clearTimeout(timersRef.current.done);
    setExiting(true);
    timersRef.current.done = setTimeout(() => {
      logger.info('fitness.toast.dismissed', { id, reason: 'tap' });
      if (typeof onDone === 'function') onDone(id);
    }, TOAST_EXIT_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, onDone]);

  if (!toast) return null;

  const { avatarUrl, icon, title, subtitle, contributors, zone, achievement = false, variant = 'info', durationMs = DEFAULT_TOAST_DURATION_MS, kind, ringCelebration } = toast;
  const hasContributors = Array.isArray(contributors) && contributors.length > 0;
  const className = [
    'fitness-toast',
    `fitness-toast--${variant}`,
    // An achievement is a different KIND of message from a notice: the people
    // lead, their faces are the anchor, and the layout stacks rather than sits
    // in a row beside an icon.
    achievement && hasContributors ? 'fitness-toast--achievement' : '',
    exiting ? 'fitness-toast--exiting' : 'fitness-toast--entered',
  ].filter(Boolean).join(' ');

  if (kind === 'ring-celebration' && ringCelebration) {
    return (
      <div className={`${className} fitness-toast--ring-celebration`} role="status" aria-live="polite" onClick={handleDismiss}>
        <RingCelebrationToast celebration={ringCelebration} refreshKey={timerKey} />
        <div className="fitness-toast__countdown">
          <div key={timerKey} className="fitness-toast__countdown-bar" style={{ animationDuration: `${durationMs}ms` }} />
        </div>
      </div>
    );
  }

  if (achievement && hasContributors) {
    return (
      <div className={className} role="status" aria-live="polite" onClick={handleDismiss}>
        <div className="fitness-toast__faces">
          {contributors.map((c) => (
            <ContributorChip key={c.id} name={c.name} avatarUrl={c.avatarUrl} />
          ))}
        </div>
        <div className="fitness-toast__headline">{title}</div>
        {zone ? (
          <span
            className={`fitness-toast__zone-pill zone-${zone.id}`}
            style={{ borderColor: zone.color, color: zone.color }}
          >
            {zone.label}
          </span>
        ) : null}
        {subtitle ? <div className="fitness-toast__achieved">{subtitle}</div> : null}
        <div className="fitness-toast__countdown">
          <div
            key={id}
            className="fitness-toast__countdown-bar"
            style={{ animationDuration: `${durationMs}ms` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className={className} role="status" aria-live="polite" onClick={handleDismiss}>
      <div className="fitness-toast__body">
        {avatarUrl && !imgFailed ? (
          <img
            className="fitness-toast__avatar"
            src={avatarUrl}
            alt=""
            onError={() => setImgFailed(true)}
          />
        ) : icon ? (
          <div className="fitness-toast__icon">{icon}</div>
        ) : null}
        <div className="fitness-toast__text">
          <div className="fitness-toast__title">{title}</div>
          {zone ? (
            <span
              className={`fitness-toast__zone-pill zone-${zone.id}`}
              style={{ borderColor: zone.color, color: zone.color }}
            >
              {zone.label}
            </span>
          ) : null}
          {subtitle ? <div className="fitness-toast__subtitle">{subtitle}</div> : null}
          {hasContributors ? (
            <div className="fitness-toast__contributors">
              {contributors.map((c) => (
                <ContributorChip key={c.id} name={c.name} avatarUrl={c.avatarUrl} />
              ))}
            </div>
          ) : null}
        </div>
      </div>
      <div className="fitness-toast__countdown">
        {/* key forces a DOM remount on each new toast → restarts the CSS countdown animation */}
        <div
          key={id}
          className="fitness-toast__countdown-bar"
          style={{ animationDuration: `${durationMs}ms` }}
        />
      </div>
    </div>
  );
}

FitnessToast.propTypes = {
  toast: PropTypes.shape({
    id: PropTypes.number,
    avatarUrl: PropTypes.string,
    icon: PropTypes.node,
    title: PropTypes.node,
    subtitle: PropTypes.node,
    achievement: PropTypes.bool,
    contributors: PropTypes.arrayOf(PropTypes.shape({
      id: PropTypes.string,
      name: PropTypes.string,
      avatarUrl: PropTypes.string,
    })),
    zone: PropTypes.shape({
      id: PropTypes.string,
      label: PropTypes.string,
      color: PropTypes.string,
    }),
    variant: PropTypes.string,
    durationMs: PropTypes.number,
    revision: PropTypes.number,
    kind: PropTypes.string,
    ringCelebration: PropTypes.object,
  }),
  onDone: PropTypes.func,
};
