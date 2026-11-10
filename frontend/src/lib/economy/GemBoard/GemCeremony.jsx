/**
 * GemCeremony — a gem just landed: one card per award, the child's face, the
 * gem in its colour, what it was for, and whether it is earned, won, or a lead
 * just taken. The shape of the coin ceremonies (WorkoutCoinCeremony, School's
 * CoinCeremony). Tap, Enter/Escape (the garage pads send those), or the clock
 * dismisses it — exactly once. `contained` draws it over its parent (School's
 * board pane, never the keypad) instead of the whole screen.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import GemIcon from '@/lib/icons/GemIcon.jsx';
import getLogger from '@/lib/logging/Logger.js';
import './GemCeremony.scss';

const MAX_CARDS = 4;

export function gemCeremonyDurationMs(cards) {
  return Math.min(10000, 5000 + 1500 * Math.max(0, (cards || 1) - 1));
}

const KIND_TEXT = { earned: 'Gem earned!', won: 'Won it!', leading: 'Took the lead!' };

function Face({ id, name }) {
  const [failed, setFailed] = useState(false);
  const initials = (name || '?').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  if (failed || !id) return <span className="gem-ceremony__face gem-ceremony__face--fallback">{initials}</span>;
  return <img className="gem-ceremony__face" src={`/api/v1/static/img/users/${id}`} alt="" onError={() => setFailed(true)} />;
}

export default function GemCeremony({ awards = [], surface, contained = false, onShow = null, onDone }) {
  const log = useMemo(() => getLogger().child({ component: 'gem-ceremony' }), []);
  const doneRef = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const shown = awards.slice(0, MAX_CARDS);
  const finish = (reason) => {
    if (doneRef.current) return;
    doneRef.current = true;
    log.info('gem-ceremony.dismissed', { surface, reason });
    onDoneRef.current?.(reason);
  };

  useEffect(() => {
    log.info('gem-ceremony.shown', { surface, awards: awards.map((a) => `${a.learnerId}:${a.ruleId ?? a.categoryId}:${a.kind}`) });
    try { onShow?.(awards); } catch { /* a sound that cannot play is not a failed ceremony */ }
    const timer = setTimeout(() => finish('timeout'), gemCeremonyDurationMs(shown.length));
    // Capture phase, consumed: the screen underneath also listens.
    const onKey = (e) => {
      if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); finish('key'); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => { clearTimeout(timer); window.removeEventListener('keydown', onKey, true); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={`gem-ceremony${contained ? ' gem-ceremony--contained' : ''}`}
      role="status"
      aria-live="polite"
      onPointerDown={() => finish('tap')}
      data-testid="gem-ceremony"
    >
      <div className="gem-ceremony__cards">
        {shown.map((a) => (
          <div key={`${a.learnerId}:${a.categoryId}:${a.ruleId ?? ''}`} className={`gem-ceremony__card is-${a.kind}`}>
            <Face id={a.learnerId} name={a.name} />
            <GemIcon className="gem-ceremony__gem" color={a.color} size="5.5rem" label={`${a.label} gem`} />
            <span className="gem-ceremony__name">{a.name}</span>
            <span className="gem-ceremony__label">{a.label}</span>
            <span className="gem-ceremony__kind">
              {KIND_TEXT[a.kind] ?? ''}{a.kind !== 'leading' && a.count > 1 ? ` ×${a.count}` : ''}
            </span>
          </div>
        ))}
      </div>
      {awards.length > MAX_CARDS && <div className="gem-ceremony__more">+{awards.length - MAX_CARDS} more on the gem board</div>}
    </div>
  );
}
