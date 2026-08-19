// frontend/src/modules/Surround/modules/MovementMap.jsx
//
// The signature element of the concert-hall surround, and the only place the
// design spends any boldness.
//
// This is NOT a progress bar. It is set as the barline grammar of engraved music:
// one hairline staff rule, one quiet separator between movements, each segment
// proportional to that movement's real duration, names above the rule with the
// tempo term in italic.
//
// WHERE PROGRESS IS READ (design wave 2)
// --------------------------------------
// From the FILL, not from the cursor. The sounding movement's rule thickens and
// sweeps left to right as it elapses; finished movements read as filled; movements
// still to come are a faint hairline. The playhead survives as a plain brass
// HAIRLINE — no lit tip, no glow: the glowing tip read as a worm crawling the
// band, and once the fill carries the progress the cursor has nothing left to
// prove. Both the fill and the playhead glide on the same 120ms linear ramp,
// which is what turns the clock's 10 Hz steps into motion.
//
// No clef, no notes, no five-line staff. The restraint is what keeps it from
// reading as fussy pastiche.
//
// Module contract: { position, duration, playing, seeking, data, region }.
// `logger` is threaded alongside as infrastructure, not as content.

import React, { useEffect, useMemo, useRef } from 'react';
import PropTypes from 'prop-types';
import getLogger from '../../../lib/logging/Logger.js';
import './MovementMap.scss';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

let moduleLogger = null;
function fallbackLogger() {
  if (!moduleLogger) moduleLogger = getLogger().child({ app: 'surround', component: 'movement-map' });
  return moduleLogger;
}
function resolveLogger(logger) {
  if (!logger) return fallbackLogger();
  return logger.child?.({ app: 'surround', component: 'movement-map' }) ?? logger;
}

const roman = (n, index) => {
  const value = Number.isFinite(n) ? n : index + 1;
  return `${ROMAN[value] ?? value}.`;
};

/**
 * Split an engraved movement heading into its title and its tempo marking.
 * "Marcia funebre. Adagio assai" -> { title: 'Marcia funebre.', tempo: 'Adagio assai' }
 * "Allegro con brio"            -> { title: null,               tempo: 'Allegro con brio' }
 * Scores set the tempo term in italic and any character title in roman; the last
 * period is the divider that convention uses.
 */
function splitHeading(name) {
  const text = String(name ?? '').trim();
  if (!text) return { title: null, tempo: '' };
  const cut = text.lastIndexOf('.');
  if (cut <= 0 || cut === text.length - 1) return { title: null, tempo: text };
  return { title: text.slice(0, cut + 1).trim(), tempo: text.slice(cut + 1).trim() };
}

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

export default function MovementMap({
  position = 0,
  duration = 0,
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  playing = false,
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  seeking = false,
  data = null,
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
  region = null,
  logger = null,
}) {
  const log = useMemo(() => resolveLogger(logger), [logger]);
  const contentId = data?.contentId ?? null;

  // Memoized: the `[]` fallback would otherwise be a fresh array every render and
  // recompute `segments` on every 10 Hz tick.
  const movements = useMemo(
    () => (Array.isArray(data?.movements) ? data.movements : []), [data],
  );

  // The rule ends where the MUSIC ends, not where the file does. The Eroica has
  // ~4½ minutes of applause after the final chord; a bar running to `duration`
  // would tell the viewer the piece is still playing.
  const musicEndsAt = data?.piece?.musicEndsAt;
  const end = Number.isFinite(musicEndsAt) && musicEndsAt > 0 ? musicEndsAt : duration;

  const segments = useMemo(() => {
    if (!movements.length) return [];
    const first = Number(movements[0]?.start) || 0;
    const span = end - first;
    if (!(span > 0)) return [];
    return movements.map((m, i) => {
      const start = Number(m?.start) || 0;
      const next = i + 1 < movements.length ? (Number(movements[i + 1]?.start) || 0) : end;
      const stop = Math.max(start, Math.min(next, end));
      return {
        n: m?.n,
        name: m?.name ?? '',
        start,
        stop,
        widthPct: ((stop - start) / span) * 100,
      };
    });
  }, [movements, end]);

  const first = segments.length ? segments[0].start : 0;
  const span = end - first;

  // -1 = no movement is playing (the applause after the final chord).
  const activeIndex = useMemo(() => {
    if (!segments.length) return -1;
    if (position >= end) return -1;
    for (let i = segments.length - 1; i >= 0; i -= 1) {
      if (position >= segments[i].start) return i;
    }
    return 0;
  }, [segments, position, end]);

  const lastLogged = useRef(null);
  useEffect(() => {
    if (!segments.length) return;
    if (lastLogged.current === activeIndex) return;
    lastLogged.current = activeIndex;
    const active = activeIndex >= 0 ? segments[activeIndex] : null;
    log.debug('surround.movement.change', {
      contentId,
      index: activeIndex,
      n: active?.n ?? null,
      name: active?.name ?? null,
      position: Math.round(position),
    });
    // `position` is read for the log payload only; the event fires on the change.
  }, [activeIndex, segments, contentId, log]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!segments.length) return null;

  const headPct = clamp01((position - first) / span) * 100;

  return (
    <div className="surround-movement-map" data-testid="surround-movement-map">
      <div className="surround-movement-map__rule">
        <span className="surround-movement-map__barline surround-movement-map__barline--terminal surround-movement-map__barline--start" aria-hidden="true" />
        {segments.map((seg, i) => {
          const state = activeIndex === i ? 'active' : (activeIndex === -1 || i < activeIndex) ? 'elapsed' : 'future';
          const { title, tempo } = splitHeading(seg.name);
          // How much of THIS movement has sounded. Elapsed movements read full,
          // future ones empty, and the sounding one sweeps — that sweep is where
          // the viewer reads progress now.
          const length = seg.stop - seg.start;
          const fill = state === 'elapsed' ? 1
            : state === 'future' ? 0
              : (length > 0 ? clamp01((position - seg.start) / length) : 0);
          return (
            <div
              key={`${seg.n ?? i}:${seg.start}`}
              className={`surround-movement-map__segment surround-movement-map__segment--${state}`}
              data-testid="surround-movement"
              data-state={state}
              data-index={i}
              style={{ width: `${seg.widthPct}%` }}
            >
              {/* ONE quiet separator between movements. The double barline was
                  correct notation and too much ink at this size — it read as
                  clutter across four segments, so the grammar keeps the mark
                  and drops the doubling. */}
              {i > 0 && (
                <span
                  className="surround-movement-map__barline surround-movement-map__barline--separator"
                  aria-hidden="true"
                />
              )}
              <span className="surround-movement-map__heading">
                <span className="surround-movement-map__numeral">{roman(seg.n, i)}</span>
                {title && <span className="surround-movement-map__title">{title}</span>}
                {tempo && <span className="surround-movement-map__tempo">{tempo}</span>}
              </span>
              <span className="surround-movement-map__bar" aria-hidden="true">
                <span
                  className="surround-movement-map__bar-fill"
                  data-testid="surround-movement-fill"
                  style={{ width: `${fill * 100}%` }}
                />
              </span>
            </div>
          );
        })}
        <span className="surround-movement-map__barline surround-movement-map__barline--terminal surround-movement-map__barline--end" aria-hidden="true" />

        {/* A barline in motion: one brass hairline, unlit. */}
        <span
          className="surround-movement-map__playhead"
          data-testid="surround-playhead"
          style={{ left: `${headPct}%` }}
          aria-hidden="true"
        />
      </div>
    </div>
  );
}

MovementMap.propTypes = {
  position: PropTypes.number,
  duration: PropTypes.number,
  playing: PropTypes.bool,
  seeking: PropTypes.bool,
  data: PropTypes.object,
  region: PropTypes.object,
  logger: PropTypes.object,
};
