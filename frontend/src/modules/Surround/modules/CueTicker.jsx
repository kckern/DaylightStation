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
// THE NOW REGISTER STOPPED PRINTING THE MOVEMENT HEADING (design wave 7)
// ---------------------------------------------------------------------
// It used to name the sounding movement — directly beneath a rail that had just
// named it. The user's word for that was "wasteful", and the replacement is
// VISUAL: this register carries the same lifted panel ground as the sounding
// segment on the rail, joined to it by a connector along the band's seam (the
// BOND — see `MovementMap.jsx`). The eye follows the shape from the rule down
// into the register and the name never needs setting twice. The heading code is
// still here and still correct, because a rail in a bars-only density has no
// name for the bond to point at: `band.nowHeading` (auto | always | never)
// decides, and `auto` — the default — shows it exactly when the rail does not.
//
// THE PIECE REGISTER GAINED ONE (design wave 7)
// ---------------------------------------------
// The left zone read as orphan prose: a paragraph about a symphony with nothing
// saying which symphony. `piece.short_title` is the work's own alternate name
// ("Beethoven's Third Symphony"), set as a standing label rather than a
// headline. It is fixed: it never takes the bond's ground, never moves with
// progress, and where the corpus has not authored one the zone renders with no
// header at all rather than an ellipsized long title pretending to be short.
//
// WHICH SIDE IS WHICH IS CONFIGURABLE (design wave 7)
// ---------------------------------------------------
// `band.nowSide` is right (today's behaviour), left, or dynamic — dynamic puts
// the NOW register on the same side of the band as the sounding segment, which
// keeps the bond short. The swap is a considered move, not a jump: the panel
// slides across the band while the two registers' text cross-fades through the
// house dissolve. See `../band.js` for the threshold and its hysteresis.
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
// THAT LAW HAS EXACTLY ONE EXCEPTION, and it is deliberate: the `nowSide` swap
// (design wave 7) dissolves BOTH registers at once, because the thing changing
// is not either register's content — it is the band's layout, and hiding half
// of it while the other half reorders underneath would read as a glitch rather
// than as a move. One blink, once, for a change the viewer is meant to notice.
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
import { smartQuotes, smartQuotesAll } from '../typography.js';
import {
  resolveBandConfig, showsNowHeading, useNowSide, elapsedFraction, ACCORDION_MS,
} from '../band.js';
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
    // Fix round 1 (review finding I2), scoped to the NOW ZONE ONLY — `mv` is
    // carried solely on the now-zone's payload (see `nowNext`), so both
    // conditions below are false whenever `next`/`shown` are the piece
    // register's. The piece register's cue interrupt (the unsplit band, wave
    // 2) keeps its original gentle dissolve on purpose: it has no header to
    // disagree with, and a hard cut there was never the bug this finding
    // named. Two now-zone edges ARE urgent enough to skip the out-fade
    // entirely rather than queue a fresh full dissolve:
    //   - an ACTIVATING CUE (`shown` was not a cue, `next` is) — a cue is a
    //     claim about what is sounding RIGHT NOW, and a stale rotation note
    //     lingering through even one fade-out is a wrong answer, however
    //     briefly.
    //   - a MOVEMENT BOUNDARY (`next.mv` names a different movement than
    //     `shown.mv`). The header above this text is NOT dissolved (it just
    //     re-renders), so a softened note here would show the NEW movement's
    //     header over the OLD movement's note for up to a full fade — the two
    //     halves of the band naming different movements at the same instant.
    // Without this, a second edge arriving before the first dissolve's commit
    // fires re-queues a full `DISSOLVE_COMMIT_MS` wait on top of whatever was
    // left of the first — up to twice the normal commit latency for a cue
    // that happens to land mid-rotation.
    const isNowZone = next.mv !== undefined || shown.mv !== undefined;
    const activating = isNowZone && next.kind === 'cue' && shown.kind !== 'cue';
    const boundary = next.mv !== undefined && shown.mv !== undefined && next.mv !== shown.mv;
    // Nothing to fade out of (first line, or recovering from an empty panel).
    if (!shown.text || prefersReducedMotion() || activating || boundary) {
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
  const config = useMemo(() => resolveBandConfig(data), [data]);

  const cues = useMemo(() => (Array.isArray(data?.cues) ? data.cues : [])
    .filter((c) => c && typeof c === 'object' && c.text)
    // Only an explicit `overlay` opts out; anything else — including an unknown
    // value — is docked, so an authoring typo still shows the note.
    .filter((c) => (c.render ?? 'docked') !== 'overlay')
    .filter((c) => Number.isFinite(Number(c.at))), [data]);

  // Every authored string this band prints is curled at its render seam — one
  // helper, `../typography.js`, called here rather than a regex scattered
  // through the JSX. A programme note is set in Garamond on stock; a straight
  // apostrophe is the one mark on the screen that was never cut for the face.
  const facts = useMemo(
    () => smartQuotesAll(
      (Array.isArray(data?.facts) ? data.facts : []).filter((f) => typeof f === 'string' && f.trim()),
    ),
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
    () => smartQuotesAll(
      (Array.isArray(movement?.listen) ? movement.listen : [])
        .filter((n) => typeof n === 'string' && n.trim()),
    ),
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

  // Fix round 1 (review finding I1). TWO separate effects, not one reading
  // `activeCue` for both branches: a single effect with `activeCue` in its
  // deps tore the SPLIT rotation's interval down and rebuilt it on every cue
  // edge, even though split mode never consumes `activeCue` here at all —
  // resetting the piece register's clean 20s beat every time a cue anywhere
  // in the now-zone started or ended. Splitting the effect means the split
  // branch's dependency list can no longer even mention `activeCue`, so its
  // identity churning cannot retrigger it.
  useEffect(() => {
    // Split, the piece register is never interrupted — cues belong to the NOW
    // zone — so its timer is the one clean, unbroken beat in the band, and
    // must survive a cue landing or lifting in the OTHER zone untouched.
    if (!split) return undefined;
    if (facts.length < 2) return undefined;
    const id = setInterval(() => setFactIndex((i) => i + 1), FACT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [split, facts.length]);

  useEffect(() => {
    // Unsplit, this IS the panel a cue preempts, and the rotation holds still
    // behind it so no fact goes unseen (the behaviour since wave 2) — so this
    // branch legitimately depends on `activeCue`.
    if (split) return undefined;
    if (facts.length < 2) return undefined;
    if (activeCue) return undefined;
    const id = setInterval(() => setFactIndex((i) => i + 1), FACT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [split, activeCue, facts.length]);

  const pieceNext = useMemo(() => {
    // Unsplit: this single zone carries the cues too.
    if (!split && activeCue) {
      const at = Number(activeCue.at);
      return { key: `cue:${at}`, kind: 'cue', at, text: smartQuotes(String(activeCue.text)) };
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
      // `mv` rides along even on a cue line: fix round 1 (review finding I2)
      // reads it in `useDissolve` to force an instant commit across a
      // movement boundary, and a cue landing exactly on one is not exempt —
      // the header above it changes either way.
      return {
        key: `cue:${at}`, kind: 'cue', at, text: smartQuotes(String(activeCue.text)), mv: movementIndex,
      };
    }
    if (nowPool.length) {
      const i = ((listenIndex % nowPool.length) + nowPool.length) % nowPool.length;
      return {
        key: `${borrowed ? 'borrowed' : 'listen'}:${movementIndex}:${i}`,
        kind: borrowed ? 'fact' : 'listen',
        at: null,
        text: nowPool[i],
        // Fix round 1 (review finding I2): which movement this line belongs
        // to. `useDissolve` compares this against the currently-SHOWN line's
        // `mv` to detect a movement boundary and commit instantly instead of
        // softening across it — the header (not part of the dissolve) has
        // already changed by the time this renders, so a dissolved note would
        // disagree with it for up to a full commit.
        mv: movementIndex,
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
  const movementName = smartQuotes(trimmed(movement?.name));
  const movementTranslation = smartQuotes(trimmed(movement?.translation));

  // ---- the bond's two shared decisions --------------------------------------
  // Both come from `../band.js` so this module and the rail cannot disagree
  // about the shape they are drawing two halves of.
  const nowHeading = showsNowHeading(config);
  // ONE definition of "how far through the piece" (review finding I3). This
  // used to be `position / pieceEnd` while the rail measured
  // `(position - first) / (end - first)` — equal only while the first movement
  // starts at 0, which both shipped sidecars do and a sidecar with a late first
  // movement would not. When they disagree the register's panel and the rail's
  // connector point at opposite sides of the screen, each held there by its own
  // hysteresis, and nothing anywhere reports it. `elapsedFraction` is now the
  // single source, called with the same inputs in both modules.
  const pieceEnd = end !== null ? end : (duration > 0 ? duration : 0);
  const pieceFirst = movements.length ? (Number(movements[0]?.start) || 0) : 0;
  const fraction = elapsedFraction({ position, first: pieceFirst, end: pieceEnd });
  // NaN until the transport reports an extent. That is a real state, not zero:
  // seeding the side from a fraction of 0 and then swapping on the first real
  // tick plays a full band-blanking dissolve during the entrance whenever a
  // work with no `musicEndsAt` resumes past half-way.
  const settled = Number.isFinite(fraction);
  const side = useNowSide(config, fraction, log);

  // The swap is a CONSIDERED MOVE, in the house language. The panel slides
  // across the band (the SCSS, `__ground`) while the two registers' text
  // dissolves — out to the ground, a held beat, in on the other side. Reusing
  // `useDissolve` rather than writing a second choreography is what keeps the
  // swap on the same clock as every other content change in the frame, and it
  // brings `prefers-reduced-motion` (an instant commit) with it for free.
  // `text` is EMPTY until the transport has reported. `useDissolve` commits
  // instantly out of an empty panel (there is nothing on screen to fade), so
  // the first real side arrives without a dissolve — and every side change
  // after it plays the full swap.
  const sideNext = useMemo(
    () => ({
      key: settled ? `side:${side}` : 'side:pending',
      kind: 'side',
      at: null,
      text: settled ? side : '',
    }),
    [side, settled],
  );
  const [sideShown, sideSwapping] = useDissolve(sideNext);
  const renderedSide = sideShown.text
    ? (sideShown.text === 'left' ? 'left' : 'right')
    : side;

  /**
   * THE PIECE REGISTER'S STANDING LABEL (design wave 7).
   * `short_title` only — never a truncated `title`. A long title cut down to
   * fit would be a different, wronger claim about the work than saying nothing,
   * and the zone reads perfectly well with no header at all.
   */
  const shortTitle = smartQuotes(trimmed(data?.piece?.short_title));

  return (
    <div
      className={`surround-cue-ticker surround-cue-ticker--${rootKind}${split ? ' surround-cue-ticker--split' : ''}${split && renderedSide === 'left' ? ' surround-cue-ticker--now-left' : ''}${split && !nowHeading ? ' surround-cue-ticker--no-now-heading' : ''}`}
      data-testid="surround-cue-ticker"
      data-kind={rootKind}
      data-split={split ? 'true' : 'false'}
      data-now-side={split ? side : null}
      style={{ '--accordion-ms': `${ACCORDION_MS}ms`, '--cue-fade-ms': `${CUE_FADE_MS}ms` }}
    >
      <div className={`surround-cue-ticker__zones${sideSwapping ? ' surround-cue-ticker__zones--swapping' : ''}`}>
        {/* THE NOW PANEL'S GROUND — the band's half of the bond (design wave 7).
            It is a sibling of the zones rather than a background ON the now
            zone, for one reason: when `nowSide` is dynamic this panel has to
            SLIDE from one half of the band to the other, and a background
            cannot travel. Out of flow, so it is not a flex item; behind the
            zones, which carry `position: relative` for exactly that. */}
        {split && (
          // THE PANEL MOVES FIRST, THE WORDS FOLLOW. Its side is the RAW
          // decision, not the dissolved one: the rail's connector starts
          // travelling the instant the side changes, and a panel that waited
          // for the text's commit would leave the connector pointing at half a
          // shape for the length of a fade. Both slide on `--accordion-ms`, so
          // the two halves of the bond arrive together; the registers' text
          // swaps underneath, on the dissolve's own clock.
          <span
            className="surround-cue-ticker__ground"
            data-testid="surround-ticker-ground"
            data-side={side}
            style={{ '--now-left': side === 'left' ? '0%' : '50%' }}
            aria-hidden="true"
          />
        )}
        <div
          className="surround-cue-ticker__zone surround-cue-ticker__zone--piece"
          data-testid="surround-ticker-zone-piece"
        >
          {/* THE WORK, NAMED ONCE (design wave 7). A standing label in the
              quietest register on the band — smaller and greyer than the note
              beneath it, because it is the thing the note is ABOUT rather than
              a heading competing with it. Fixed: it never takes the bond's
              ground and never moves with the playhead. */}
          {split && shortTitle && (
            <p
              className="surround-cue-ticker__piece-head"
              data-testid="surround-ticker-piece-head"
            >
              {shortTitle}
            </p>
          )}
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
            {/* THE HEADING IS OFF BY DEFAULT (design wave 7). The rail six
                inches above already names the sounding movement, and the bond
                — this panel's ground, continuous with that segment's — is what
                now says WHICH one without printing it twice. `band.nowHeading`
                brings it back: `always`, or `auto` on a bars-only rail that has
                no name of its own for the bond to point at.
                When it IS shown it is still NOT part of the dissolve. It names
                what is sounding, and that changes on a movement boundary — a
                beat the viewer can already see happening on the rule above.
                Fading it with the note beneath it would make an ordinary
                rotation look like the piece had moved on. */}
            {nowHeading && (
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
            )}
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
