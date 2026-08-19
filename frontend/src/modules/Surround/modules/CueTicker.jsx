// frontend/src/modules/Surround/modules/CueTicker.jsx
//
// The band's text zone. Since design wave 6 it is TWO REGISTERS side by side,
// divided by a hairline, and the division is editorial rather than decorative:
//
//   LEFT — THE PIECE. Untimed `data.facts` about the work itself, rotating on a
//     slow timer. This is the programme note: it is true at 0:00 and at 53:00,
//     and it does not care where the playhead is.
//
//   RIGHT — NOW. A small header naming the movement that is actually sounding
//     (numeral, name, and the translation of its tempo term), and beneath it
//     the `movements[].listen` notes for THAT movement — "the violas bark twice
//     a bar, all the way through". This is the half of the band that teaches:
//     it tells a viewer what to listen for in the next three minutes, not what
//     happened in 1804. A movement change swaps the whole pool and resets the
//     rotation; a TIMED CUE (`data.cues`) interrupts this zone for its dwell,
//     because a cue is the same kind of claim — one line tied to what is
//     sounding right now — only pinned to a second rather than to a movement.
//
// A movement with no authored `listen` notes borrows the piece pool beneath its
// header rather than showing empty paper. A piece with NO MOVEMENTS AT ALL does
// not split: there is no "now" to have a register for, so the band is one zone
// and cues preempt it, exactly as it behaved before this wave.
//
// `render: overlay` cues are ignored here; the pop-up-video overlay is phase two
// and has its own region. An unknown or absent `render` is docked.
//
// THE TWO ZONES NEVER SWAP TOGETHER. Both play the house dissolve — out to the
// band's near-black ground, a held beat of nothing, then in — and two of those
// firing in the same instant reads as the whole band blinking. The right zone's
// rotation is therefore phase-offset by half a period from the left's
// (`LISTEN_PHASE_MS`), which is the maximum separation two equal periods admit.
// Under prefers-reduced-motion both collapse to an instant swap.
//
// The reserved heights in the SCSS are what make all of this safe: neither
// zone's box changes, whether its line is one line, two, or momentarily nothing
// at all.

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
/**
 * The NOW register's rotation. Deliberately the SAME period as the piece
 * register's, not a coprime one: the two zones are read together and a viewer
 * should not be able to feel one running faster than the other. What keeps them
 * from swapping in the same instant is the phase below, which at equal periods
 * is an exact and permanent half-period gap.
 */
export const LISTEN_INTERVAL_MS = FACT_INTERVAL_MS;
/**
 * How long the NOW register waits before its FIRST swap — half a period, so
 * the two zones alternate rather than blink together. Re-established (not
 * merely preserved) at every movement boundary and after every timed cue,
 * because both of those are themselves swaps the viewer just watched: a fresh
 * half-period is the right pacing after one, and it puts the offset back at its
 * maximum at the same time.
 */
export const LISTEN_PHASE_MS = Math.round(FACT_INTERVAL_MS / 2);

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

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

const trimmed = (value) => (typeof value === 'string' && value.trim() ? value.trim() : null);

/**
 * One dissolve controller: hold the current content, and when the next differs,
 * fade out, hold empty ground, then commit and fade in.
 *
 * Extracted in wave 6 because there are now TWO of these in one component and a
 * second copy of the choreography is a second chance for the two halves of the
 * band to drift apart. Each zone gets its own instance and therefore its own
 * timers, which is exactly what lets them be phase-offset.
 */
function useDissolve(next) {
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

  return [shown, hidden];
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

  const movements = useMemo(
    () => (Array.isArray(data?.movements) ? data.movements : []), [data],
  );

  /**
   * THE BAND SPLITS ONLY WHERE THERE IS A "NOW" TO SPLIT OFF.
   *
   * Without movements there is no current-movement header, no per-movement
   * listen pool, and the right zone would be a second copy of the left one —
   * two registers saying the same thing is worse than one saying it properly.
   * So a movement-less piece keeps the single, full-width band this module
   * shipped with, cues and all.
   */
  const split = movements.length > 0;

  // The rule ends where the MUSIC ends, not where the file does — the same
  // reading MovementMap takes, so the two halves of the band agree about when
  // the last movement stops sounding and the applause begins.
  const musicEndsAt = Number(data?.piece?.musicEndsAt);
  const end = Number.isFinite(musicEndsAt) && musicEndsAt > 0 ? musicEndsAt : null;

  /** Which movement is sounding, or -1 during the applause / before the first. */
  const movementIndex = useMemo(() => {
    if (!movements.length) return -1;
    if (end !== null && position >= end) return -1;
    for (let i = movements.length - 1; i >= 0; i -= 1) {
      if (position >= (Number(movements[i]?.start) || 0)) return i;
    }
    return -1;
  }, [movements, position, end]);

  const movement = movementIndex >= 0 ? movements[movementIndex] : null;

  const listen = useMemo(
    () => (Array.isArray(movement?.listen) ? movement.listen : [])
      .filter((n) => typeof n === 'string' && n.trim()),
    [movement],
  );

  /**
   * NEVER EMPTY PAPER. A movement nobody has written listening notes for still
   * gets its header — the header is the answer to "what is playing", which does
   * not depend on anyone having authored anything — and the piece pool is
   * borrowed beneath it. Two zones showing from the same pool, half a period
   * apart, is a weaker band than two pools; it is a far better band than a
   * blank half.
   */
  const borrowed = split && listen.length === 0;
  const nowPool = listen.length ? listen : facts;

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

  // ---- the PIECE register (left) -------------------------------------------
  const [factIndex, setFactIndex] = useState(0);

  useEffect(() => {
    if (facts.length < 2) return undefined;
    // Split, the piece register is never interrupted — cues belong to the NOW
    // zone — so its timer is the one clean, unbroken beat in the band. Unsplit,
    // this IS the panel a cue preempts, and the rotation holds still behind it
    // so no fact goes unseen (the behaviour since wave 2).
    if (!split && activeCue) return undefined;
    const id = setInterval(() => setFactIndex((i) => i + 1), FACT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [split, activeCue, facts.length]);

  const pieceNext = useMemo(() => {
    // Unsplit: this single zone carries the cues too.
    if (!split && activeCue) {
      const at = Number(activeCue.at);
      return { key: `cue:${at}`, kind: 'cue', at, text: String(activeCue.text) };
    }
    if (facts.length) {
      const i = ((factIndex % facts.length) + facts.length) % facts.length;
      return { key: `fact:${i}`, kind: 'fact', at: null, text: facts[i] };
    }
    return EMPTY;
  }, [split, activeCue, facts, factIndex]);

  const [pieceShown, pieceHidden] = useDissolve(pieceNext);

  // ---- the NOW register (right) --------------------------------------------
  const [listenIndex, setListenIndex] = useState(0);

  // A movement change swaps the pool; the rotation starts that pool at its
  // first note rather than at wherever the previous movement's index happened
  // to be. (Also covers a seek backwards into an earlier movement.)
  useEffect(() => { setListenIndex(0); }, [movementIndex, contentId]);

  useEffect(() => {
    if (!split || nowPool.length < 2) return undefined;
    // A cue owns this zone for its dwell; the rotation holds still behind it so
    // the note it interrupted is not skipped.
    if (activeCue) return undefined;
    let interval = null;
    const phase = setTimeout(() => {
      setListenIndex((i) => i + 1);
      interval = setInterval(() => setListenIndex((i) => i + 1), LISTEN_INTERVAL_MS);
    }, LISTEN_PHASE_MS);
    return () => { clearTimeout(phase); if (interval) clearInterval(interval); };
  }, [split, activeCue, movementIndex, nowPool.length]);

  const nowNext = useMemo(() => {
    if (!split) return EMPTY;
    if (activeCue) {
      const at = Number(activeCue.at);
      return { key: `cue:${at}`, kind: 'cue', at, text: String(activeCue.text) };
    }
    if (nowPool.length) {
      const i = ((listenIndex % nowPool.length) + nowPool.length) % nowPool.length;
      return {
        key: `${borrowed ? 'borrowed' : 'listen'}:${movementIndex}:${i}`,
        kind: borrowed ? 'fact' : 'listen',
        at: null,
        text: nowPool[i],
      };
    }
    return EMPTY;
  }, [split, activeCue, nowPool, listenIndex, borrowed, movementIndex]);

  const [nowShown, nowHidden] = useDissolve(nowNext);

  // ---- logging --------------------------------------------------------------
  useEffect(() => {
    if (!pieceShown.text) return;
    log.debug('surround.cue.shown', { kind: pieceShown.kind, at: pieceShown.at, contentId });
  }, [pieceShown, contentId, log]);

  useEffect(() => {
    if (!split || !nowShown.text) return;
    log.debug('surround.listen.shown', {
      kind: nowShown.kind, at: nowShown.at, movement: movementIndex, borrowed, contentId,
    });
    // `movementIndex` and `borrowed` ride along as payload; the event fires on
    // the line changing, not on the movement changing.
  }, [nowShown, split, contentId, log]); // eslint-disable-line react-hooks/exhaustive-deps

  // The root's kind is whichever register a TIMED CUE is currently in — the
  // whole band reads as "a cue is up" or "it is not", which is the one piece of
  // state anything outside this module (the accent rule, the runtime gate) has
  // ever cared about.
  const rootKind = activeCue ? 'cue' : (pieceShown.kind ?? nowShown.kind ?? 'empty');

  const numeral = movement
    ? `${ROMAN[Number(movement.n)] ?? (movementIndex + 1)}.`
    : null;
  const movementName = trimmed(movement?.name);
  const movementTranslation = trimmed(movement?.translation);

  return (
    <div
      className={`surround-cue-ticker surround-cue-ticker--${rootKind}${split ? ' surround-cue-ticker--split' : ''}`}
      data-testid="surround-cue-ticker"
      data-kind={rootKind}
      data-split={split ? 'true' : 'false'}
    >
      <div className="surround-cue-ticker__zones">
        <div
          className="surround-cue-ticker__zone surround-cue-ticker__zone--piece"
          data-testid="surround-ticker-zone-piece"
        >
          <p
            className={`surround-cue-ticker__text${pieceHidden ? ' surround-cue-ticker__text--hidden' : ''}`}
            data-testid="surround-ticker-text"
            style={{ transition: `opacity ${CUE_FADE_MS}ms ease` }}
          >
            {/* Fix round 1 (review finding, wave 5): the reserve (grid +
                align-content) and the ellipsis (the line clamp) are two jobs,
                and Chromium will not let one element do both —
                `-webkit-line-clamp` needs `display: -webkit-box`, which
                computes to `flow-root` and drags `align-content` off with it
                (wave 2, flag 4). Splitting them across two elements lets BOTH
                survive: this span clamps to two lines with an ellipsis, and the
                `<p>` around it centres whatever height that clamp produces. */}
            <span className="surround-cue-ticker__line">{pieceShown.text}</span>
          </p>
        </div>

        {split && (
          <div
            className={`surround-cue-ticker__zone surround-cue-ticker__zone--now${activeCue ? ' surround-cue-ticker__zone--cue' : ''}`}
            data-testid="surround-ticker-zone-now"
            data-borrowed={borrowed ? 'true' : 'false'}
          >
            {/* The header is NOT part of the dissolve. It names what is
                sounding, and that changes on a movement boundary — a beat the
                viewer can already see happening on the rule above. Fading it
                with the note beneath it would make an ordinary rotation look
                like the piece had moved on. */}
            <p
              className="surround-cue-ticker__now"
              data-testid="surround-ticker-now"
            >
              {movementName ? (
                <>
                  <span className="surround-cue-ticker__now-head">
                    {numeral && <span className="surround-cue-ticker__now-numeral">{numeral}</span>}
                    <span className="surround-cue-ticker__now-name">{movementName}</span>
                  </span>
                  {movementTranslation && (
                    <span className="surround-cue-ticker__now-translation">{movementTranslation}</span>
                  )}
                </>
              ) : (
                // Between the last chord and the end of the file there is no
                // movement sounding. The header says so rather than holding the
                // final movement's name over the applause.
                <span className="surround-cue-ticker__now-head">
                  <span className="surround-cue-ticker__now-name">Listen for</span>
                </span>
              )}
            </p>
            <p
              className={`surround-cue-ticker__text surround-cue-ticker__text--now${nowHidden ? ' surround-cue-ticker__text--hidden' : ''}`}
              data-testid="surround-ticker-listen"
              style={{ transition: `opacity ${CUE_FADE_MS}ms ease` }}
            >
              <span className="surround-cue-ticker__line">{nowShown.text}</span>
            </p>
          </div>
        )}
      </div>
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
