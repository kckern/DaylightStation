// frontend/src/modules/Surround/modules/CueTicker.jsx
//
// The programme note that changes as the piece moves. Two sources, one panel:
//
//   * TIMED CUES — `data.cues`, each live while `at <= position < at + dwell`
//     (12 s unless the cue names its own). A timed cue ALWAYS preempts a fact:
//     it is the one line tied to what is sounding right now.
//   * FACTS — `data.facts`, an untimed pool cycled on a 20 s timer whenever no
//     cue is up. The rotation holds still behind a cue so no fact goes unseen.
//
// `render: overlay` cues are ignored here; the pop-up-video overlay is phase two
// and has its own region. An unknown or absent `render` is docked.
//
// A label change never hard-cuts, and it does not flip either: it DISSOLVES
// THROUGH THE DARK. The old line fades fully out to the band's near-black
// ground, the ground is held empty for a beat, then the new line fades in —
// ~800 ms end to end. On a dark band a 280 ms cross-flip reads as a blink; the
// held beat is what makes it read as one line giving way to another.
// Under prefers-reduced-motion the whole thing collapses to an instant swap.
//
// The reserved height in the SCSS is what makes this safe: the panel's box never
// changes, whether the line is one line, two, or momentarily nothing at all.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import getLogger from '../../../lib/logging/Logger.js';
import {
  DISSOLVE_FADE_MS, DISSOLVE_HOLD_MS, DISSOLVE_SWAP_MS, DISSOLVE_COMMIT_MS,
  prefersReducedMotion,
} from '../dissolve.js';
import './CueTicker.scss';

/** Each half of the dissolve: the old line out, then the new line in.
 *  ALIASES of the house dissolve (`../dissolve.js`) — the number lives there, so
 *  the ticker, the rail fact and the place carousel cannot drift apart. */
export const CUE_FADE_MS = DISSOLVE_FADE_MS;
/** The beat of empty ground between them — the "through black" of the dissolve. */
export const CUE_HOLD_MS = DISSOLVE_HOLD_MS;
/** Out + held ground + in. The CSS duration is set inline from CUE_FADE_MS, so
 *  the stylesheet and this timer cannot drift apart. */
export const CUE_SWAP_MS = DISSOLVE_SWAP_MS;
/** How long a timed cue holds the panel when it names no dwell of its own. */
export const CUE_DWELL_S = 12;
/** Fact rotation. Slow: this plays behind music. */
export const FACT_INTERVAL_MS = 20000;

const EMPTY = Object.freeze({ key: 'empty', kind: null, at: null, text: '' });

let moduleLogger = null;
function fallbackLogger() {
  if (!moduleLogger) moduleLogger = getLogger().child({ app: 'surround', component: 'cue-ticker' });
  return moduleLogger;
}
function resolveLogger(logger) {
  if (!logger) return fallbackLogger();
  return logger.child?.({ app: 'surround', component: 'cue-ticker' }) ?? logger;
}

export default function CueTicker({
  position = 0,
  // eslint-disable-next-line no-unused-vars -- part of the fixed module contract
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

  const cues = useMemo(() => (Array.isArray(data?.cues) ? data.cues : [])
    .filter((c) => c && typeof c === 'object' && c.text)
    // Only an explicit `overlay` opts out; anything else — including an unknown
    // value — is docked, so an authoring typo still shows the note.
    .filter((c) => (c.render ?? 'docked') !== 'overlay')
    .filter((c) => Number.isFinite(Number(c.at))), [data]);

  const facts = useMemo(
    () => (Array.isArray(data?.facts) ? data.facts : []).filter((f) => typeof f === 'string' && f.trim()),
    [data],
  );

  // Latest cue whose dwell window contains the playhead. Derived from `position`,
  // so a seek — forwards or backwards — re-evaluates with no extra machinery.
  const activeCue = useMemo(() => {
    let found = null;
    cues.forEach((c) => {
      const at = Number(c.at);
      const dwell = Number.isFinite(Number(c.dwell)) && Number(c.dwell) > 0 ? Number(c.dwell) : CUE_DWELL_S;
      if (position >= at && position < at + dwell) {
        if (!found || at >= Number(found.at)) found = c;
      }
    });
    return found;
  }, [cues, position]);

  const [factIndex, setFactIndex] = useState(0);

  // The rotation only runs when the panel is actually showing facts.
  useEffect(() => {
    if (activeCue || facts.length < 2) return undefined;
    const id = setInterval(() => setFactIndex((i) => i + 1), FACT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [activeCue, facts.length]);

  const next = useMemo(() => {
    if (activeCue) {
      const at = Number(activeCue.at);
      return { key: `cue:${at}`, kind: 'cue', at, text: String(activeCue.text) };
    }
    if (facts.length) {
      const i = ((factIndex % facts.length) + facts.length) % facts.length;
      return { key: `fact:${i}`, kind: 'fact', at: null, text: facts[i] };
    }
    return EMPTY;
  }, [activeCue, facts, factIndex]);

  const [shown, setShown] = useState(() => next);
  const [hidden, setHidden] = useState(false);
  const timers = useRef([]);
  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  useEffect(() => {
    if (next.key === shown.key) return;
    clearTimers();
    // Nothing to fade out of (first line, or recovering from an empty panel).
    if (!shown.text || prefersReducedMotion()) {
      setShown(next);
      setHidden(false);
      return;
    }
    // Fade out, hold the empty ground, then swap and fade in. The swap commits
    // at the end of the held beat so the incoming line is never visible sliding
    // in under the outgoing one's opacity.
    setHidden(true);
    timers.current.push(setTimeout(() => {
      setShown(next);
      setHidden(false);
    }, DISSOLVE_COMMIT_MS));
  }, [next, shown]);

  useEffect(() => () => clearTimers(), []);

  useEffect(() => {
    if (!shown.text) return;
    log.debug('surround.cue.shown', { kind: shown.kind, at: shown.at, contentId });
  }, [shown, contentId, log]);

  return (
    <div
      className={`surround-cue-ticker surround-cue-ticker--${shown.kind ?? 'empty'}`}
      data-testid="surround-cue-ticker"
      data-kind={shown.kind ?? ''}
    >
      <p
        className={`surround-cue-ticker__text${hidden ? ' surround-cue-ticker__text--hidden' : ''}`}
        data-testid="surround-ticker-text"
        style={{ transition: `opacity ${CUE_FADE_MS}ms ease` }}
      >
        {/* Fix round 1 (review finding): the reserve (grid + align-content) and
            the ellipsis (the line clamp) are two jobs, and Chromium will not let
            one element do both — `-webkit-line-clamp` needs `display:
            -webkit-box`, which computes to `flow-root` and drags `align-content`
            off with it (wave 2, flag 4). Splitting them across two elements lets
            BOTH survive: this span clamps to two lines with an ellipsis, and the
            `<p>` around it centres whatever height that clamp produces. */}
        <span className="surround-cue-ticker__line">{shown.text}</span>
      </p>
    </div>
  );
}

CueTicker.propTypes = {
  position: PropTypes.number,
  duration: PropTypes.number,
  playing: PropTypes.bool,
  seeking: PropTypes.bool,
  data: PropTypes.object,
  region: PropTypes.object,
  logger: PropTypes.object,
};
