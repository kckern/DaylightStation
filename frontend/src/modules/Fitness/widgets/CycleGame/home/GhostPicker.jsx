import React, { useMemo, useState } from 'react';
import PropTypes from 'prop-types';
import { RaceFlagIcon } from './icons.jsx';
import { FALLBACK_AVATAR } from './constants.js';
import { formatDayHeader, formatDistance } from './formatters.js';

// mm:ss clock (per-rider finish time). '—' for a missing/DNF time.
function fmtClock(s) {
  if (!Number.isFinite(s)) return '—';
  const m = Math.floor(s / 60);
  return `${m}:${String(Math.round(s % 60)).padStart(2, '0')}`;
}

// Each rider's OWN result, by race format: a time race scores distance covered;
// a distance race scores finish time. This is what rides on each avatar.
function riderMetric(candidate, p) {
  return candidate.winCondition === 'time'
    ? formatDistance(p.finalDistanceM || 0)
    : fmtClock(p.finalTimeS);
}
import { useEscapeToClose } from './useEscapeToClose.js';
import { uiLog } from './uiLog.js';
import './picker.scss';
import './GhostPicker.scss';

/**
 * Ghost picker — past races grouped into day columns (most recent 3 days on
 * file). Two-stage selection for remote/kiosk: the first tap scrolls a card
 * into view + focuses it; a second tap on the focused card commits it. The
 * score (what you race against) is the prominent figure; the goal is context.
 */
export function GhostPicker({ candidates = [], currentGhost = null, onSelect, onClear, onClose }) {
  const [focusedId, setFocusedId] = useState(currentGhost?.sourceRaceId || null);
  const [rosterFor, setRosterFor] = useState(null);          // candidate awaiting roster confirm
  const [selected, setSelected] = useState(() => new Set()); // LIVE participant ids chosen to race
  useEscapeToClose(onClose);

  const columns = useMemo(() => {
    const map = new Map();
    [...candidates]
      .sort((a, b) => String(b.raceId).localeCompare(String(a.raceId)))
      .forEach((c) => {
        if (!map.has(c.day)) map.set(c.day, []);
        map.get(c.day).push(c);
      });
    return [...map.entries()].slice(0, 3); // most recent 3 days
  }, [candidates]);

  // Tap-to-scroll pattern (mirrors FitnessSessionsWidget): the first tap focuses
  // the card — the focused card's ref scrolls itself into view (block:center) —
  // and a second tap on the focused card commits the selection.
  const handleTap = (c) => {
    if (focusedId !== c.raceId) {
      uiLog().debug('cycle_game.ui.ghost_focus', { raceId: c.raceId, day: c.day });
      setFocusedId(c.raceId);
      return;
    }
    // Default = every LIVE rider in (the 1-tap "race everyone" path). Ghosts from
    // a past race can't be re-raced, so they never seed the selection.
    const live = (c.participants || []).filter((p) => !p.isGhost);
    setSelected(new Set(live.map((p) => p.id)));
    setRosterFor(c);          // open the roster confirm card
  };

  // Roster-derived view state (only meaningful while rosterFor is set). Live
  // riders are selectable; ghosts are shown locked. The single CTA's label is
  // dynamic: all-in → "Race all N", a subset → "Race N" (or the name if one).
  const rosterLive = rosterFor ? (rosterFor.participants || []).filter((p) => !p.isGhost) : [];
  const rosterGhosts = rosterFor ? (rosterFor.participants || []).filter((p) => p.isGhost) : [];
  const rosterChosen = rosterLive.filter((p) => selected.has(p.id));
  const rosterCount = rosterChosen.length;
  const rosterAllIn = rosterCount === rosterLive.length && rosterLive.length > 0;
  const rosterCta = rosterLive.length === 0 ? 'No live riders'
    : rosterCount === 0 ? 'Pick a rider'
      : rosterAllIn ? (rosterLive.length === 2 ? 'Race both' : `Race all ${rosterLive.length}`)
        : rosterCount === 1 ? `Race ${rosterChosen[0].displayName}`
          : `Race ${rosterCount}`;
  const toggleRider = (id) => setSelected((s) => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  return (
    <div className="cgh-picker cgh-picker--ghost" role="dialog" aria-modal="true" data-testid="ghost-picker">
      <div className="cgh-picker__backdrop" onClick={onClose} />
      <div className="cgh-picker__sheet">
        <div className="cgh-picker__head">
          <div className="cgh-picker__heading">
            <div className="cgh-section-label cgh-section-label--sub">Race a ghost</div>
            <div className="cgh-picker__bike">Chase a past race · tap to focus, tap again to choose</div>
          </div>
          <button type="button" className="cgh-picker__close" aria-label="close" onClick={onClose}>×</button>
        </div>

        {columns.length === 0 ? (
          <div className="cgh-empty">No past races yet — finish a race to create a ghost.</div>
        ) : (
          <div className="cgh-ghost-cols">
            {columns.map(([day, races]) => (
              <div className="cgh-ghost-col" key={day}>
                <div className="cgh-ghost-col__date">{formatDayHeader(day)}</div>
                <div className="cgh-ghost-col__list">
                  {races.map((c) => {
                    const isCurrent = currentGhost && currentGhost.sourceRaceId === c.raceId;
                    const isFocused = focusedId === c.raceId;
                    const riders = c.participants || [];
                    return (
                      <button
                        key={c.raceId}
                        ref={isFocused ? (el) => { if (el && el.scrollIntoView) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } : undefined}
                        type="button"
                        className={`cgh-ghost-card${isFocused ? ' is-focused' : ''}${isCurrent ? ' is-current' : ''}`}
                        data-testid={`ghost-${c.raceId}`}
                        onClick={() => handleTap(c)}
                      >
                        <span className="cgh-ghost-card__time">{c.timeOfDay}</span>
                        <span className="cgh-ghost-card__riders">
                          {riders.slice(0, 6).map((p, idx) => (
                            <span
                              key={p.id}
                              className="cgh-ghost-card__rider"
                              style={{ zIndex: riders.length - idx }}
                              title={p.displayName}
                            >
                              {idx === 0 && <span className="cgh-ghost-card__crown" aria-hidden="true">🥇</span>}
                              <span className={`cgh-ghost-card__avatar-wrap${p.isGhost ? ' cg-ghost' : ''}`}>
                                <img
                                  className="cgh-ghost-card__avatar"
                                  src={p.avatarSrc}
                                  alt={p.displayName}
                                  onError={(e) => { e.currentTarget.src = FALLBACK_AVATAR; }}
                                />
                                <span className="cgh-ghost-card__metric">{riderMetric(c, p)}</span>
                              </span>
                            </span>
                          ))}
                          {riders.length > 6 && (
                            <span className="cgh-ghost-card__more">+{riders.length - 6}</span>
                          )}
                        </span>
                        <span className={`cgh-ghost-card__type cgh-ghost-card__type--${c.winCondition === 'time' ? 'time' : 'dist'}`}>
                          <span className="cgh-ghost-card__type-icon" aria-hidden="true">{c.winCondition === 'time' ? '⏱' : '🏁'}</span>
                          {c.goalLabel}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {currentGhost && (
          <button
            type="button"
            className="cgh-ghost-clear"
            data-testid="ghost-clear"
            onClick={() => { onClear?.(); onClose?.(); }}
          >
            Remove ghost
          </button>
        )}

      </div>

      {rosterFor && (
        <div className="cgh-roster" role="dialog" aria-modal="true" data-testid="ghost-roster">
          <div className="cgh-roster__backdrop" onClick={() => setRosterFor(null)} />
          <div className="cgh-roster__card">
            <button
              type="button"
              className="cgh-roster__close"
              aria-label="close"
              data-testid="ghost-roster-cancel"
              onClick={() => setRosterFor(null)}
            >
              ×
            </button>
            <div className="cgh-roster__eyebrow">Starting grid</div>
            <h3 className="cgh-roster__title">Race against…</h3>
            <p className="cgh-roster__hint">Tap to choose riders — or just race everyone.</p>

            <div className="cgh-roster__grid">
              {rosterLive.map((p) => {
                const on = selected.has(p.id);
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`cgh-rider${on ? ' is-on' : ''}`}
                    data-testid="ghost-roster-item"
                    aria-pressed={on}
                    onClick={() => toggleRider(p.id)}
                  >
                    <span className="cgh-rider__avatar">
                      <img src={p.avatarSrc} alt="" onError={(e) => { e.currentTarget.src = FALLBACK_AVATAR; }} />
                      <span className="cgh-rider__check" aria-hidden="true">✓</span>
                    </span>
                    <span className="cgh-rider__name">{p.displayName}</span>
                  </button>
                );
              })}
              {rosterGhosts.map((p) => (
                <div
                  key={p.id}
                  className="cgh-rider cgh-rider--ghost is-locked"
                  data-testid="ghost-roster-ghost"
                  title="A ghost from a past race can't be raced again — only live riders."
                >
                  <span className="cgh-rider__avatar cg-ghost">
                    <img src={p.avatarSrc} alt="" onError={(e) => { e.currentTarget.src = FALLBACK_AVATAR; }} />
                  </span>
                  <span className="cgh-rider__name">{p.displayName}</span>
                  <span className="cgh-rider__tag">ghost</span>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="cgh-roster__cta"
              data-testid="ghost-roster-start"
              disabled={rosterCount === 0}
              onClick={() => {
                onSelect?.({ ...rosterFor, participants: rosterChosen });
                setRosterFor(null);
              }}
            >
              <RaceFlagIcon />
              <span>{rosterCta}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

GhostPicker.propTypes = {
  candidates: PropTypes.array,
  currentGhost: PropTypes.object,
  onSelect: PropTypes.func,
  onClear: PropTypes.func,
  onClose: PropTypes.func
};

export default GhostPicker;
