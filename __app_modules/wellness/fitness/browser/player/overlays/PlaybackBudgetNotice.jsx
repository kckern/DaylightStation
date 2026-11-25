import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import getLogger from '@/lib/logging/Logger.js';
import "./PresenceGateNotice.scss";
import "./PlaybackBudgetNotice.scss";

// A "checking" request is normally sub-second, so its card waits this long.
// The backdrop (and the hold on the video) is there from the start.
export const CHECKING_REVEAL_MS = 1500;

const svg = (children) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{children}</svg>
);
const ICONS = {
  checking: svg(<>
    <circle cx="12" cy="12" r="9" opacity="0.25" />
    <path className="playback-budget-spinner" d="M21 12a9 9 0 0 0-9-9" />
  </>),
  unavailable: svg(<>
    <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4" /><path d="M12 17h.01" />
  </>),
  exhausted: svg(<>
    <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
  </>),
};

// What the cover says for each blocking status, in words a child reads. Every
// status says what is happening and what moves it forward, never a bare "waiting".
const COPY = {
  checking: {
    title: 'Getting your video time…',
    body: 'This only takes a moment.',
  },
  unavailable: {
    title: "Couldn't check video time",
    body: 'Trying again. A grown-up can unlock this video.',
  },
  exhausted: {
    title: 'Video time is used up for today',
    body: 'It starts again tomorrow. A grown-up can join the workout, or unlock this video.',
  },
};

// "grown-up" never splits across two lines.
const keepGrownUp = (text) => text.split(/(grown-up)/).map((part, i) => (
  part === 'grown-up' ? <span key={i} className="gate-card__nowrap">grown-up</span> : part
));

/**
 * Cover shown over a video the unattended playback budget is holding: a card
 * with an icon, a title and a sentence per status, plus "Grown-up unlock" (the
 * presence gate's admin fingerprint) and "Back". Touch (pointerdown),
 * Enter/Space and a gamepad's A all reach the buttons. For "checking" only the
 * backdrop is drawn for the first CHECKING_REVEAL_MS; any other status, or a
 * check that has run that long, shows the card.
 */
export default function PlaybackBudgetNotice({ status, onUnlock, onBack }) {
  const s = COPY[status] ? status : 'checking';
  const copy = COPY[s];
  const logger = useMemo(() => getLogger().child({ component: 'playback-budget-notice' }), []);
  const [checkElapsed, setCheckElapsed] = useState(false);
  const visible = s !== 'checking' || checkElapsed;
  const loggedRef = useRef(new Set());

  // Leaving "checking" ends that check: the next one gets its own grace
  // instead of showing its card at once.
  useEffect(() => {
    if (s !== 'checking') setCheckElapsed(false);
  }, [s]);

  useEffect(() => {
    if (visible) return undefined;
    const timer = setTimeout(() => setCheckElapsed(true), CHECKING_REVEAL_MS);
    return () => clearTimeout(timer);
  }, [visible]);

  useEffect(() => {
    if (!visible || loggedRef.current.has(s)) return;
    loggedRef.current.add(s);
    logger.info('fitness.playback_budget.cover_shown', { status: s, delayed: s === 'checking' });
  }, [visible, s, logger]);

  const activate = (fn) => ({
    onPointerDown: (e) => { e.preventDefault(); fn?.(); },
    onKeyDown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn?.(); } },
  });
  return (
    <div className={`presence-gate-notice playback-budget-overlay playback-budget-card--${s}`}
      data-testid="playback-budget-overlay" data-status={s}>
      {visible ? (
        <div className="gate-card" role="status" aria-label={copy.title}>
          <div className="gate-card__icon">{ICONS[s]}</div>
          <h2 className="gate-card__title">{copy.title}</h2>
          <p className="gate-card__body">{keepGrownUp(copy.body)}</p>
          <div className="presence-gate-notice__actions">
            {onUnlock ? (
              <button type="button" className="presence-gate-notice__btn" data-testid="playback-budget-unlock" {...activate(onUnlock)}>Grown-up unlock</button>
            ) : null}
            {onBack ? (
              <button type="button" className="presence-gate-notice__btn presence-gate-notice__btn--secondary" data-testid="playback-budget-back" {...activate(onBack)}>Back</button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

PlaybackBudgetNotice.propTypes = {
  status: PropTypes.string,
  onUnlock: PropTypes.func,
  onBack: PropTypes.func,
};
