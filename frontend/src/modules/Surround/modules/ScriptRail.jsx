// frontend/src/modules/Surround/modules/ScriptRail.jsx
//
// THE PERFORMANCE TEXT, in a rail of its own on the right.
//
// This module is the second half of a layout the frame already knows how to
// wear: when a piece's segments carry sung text, the programme rail on the left
// slides out, this one slides in on the right, and the video and its band
// travel left with them. The two rails are NEVER both present — see
// `SurroundFrame`, which owns that decision and reads it from the same pure
// function this module does (`../lyrics.js`).
//
// ANATOMY. Three pieces, top to bottom:
//
//   HEADING   The sounding number, with its numeral. Set once per segment and
//             it does NOT page with the text beneath it, so a viewer glancing
//             up in the middle of a long air still knows what is sounding.
//   TEXT      The sung words. Fitted, then paged. Never cut.
//   PLATE     The composer's portrait and brass nameplate, in the corner. This
//             is the load-bearing part: when the left rail slides out it takes
//             the composer's face and name with it, and a frame that stops
//             saying whose music this is has lost something it should not.
//             It is the SAME ComposerCard, in a second home (`variant: plate`),
//             so a change to the plate cannot make the two disagree.
//
// AN INSTRUMENTAL NUMBER RENDERS NO TEXT BOX and keeps the rail up. Handel's
// Pifa sits between two texted numbers; sliding the whole composition out and
// back for ninety seconds of pastoral symphony is exactly the flapping the
// grace window in `../lyrics.js` exists to prevent.
//
// DORMANT BY CONSTRUCTION. A payload whose segments carry no text renders null,
// and a definition with no `lyric:` slot never mounts this at all.

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { smartQuotes } from '../typography.js';
import { surroundLogger } from '../moduleKit.js';
import { DISSOLVE_FADE_MS, useDissolve } from '../dissolve.js';
import { lyricStateAt, paginate } from '../lyrics.js';
import { proseCeilingPx, proseFloorPx, rootWidthOf, FONT_STEP_PX } from '../fit.js';
import ComposerCard from './ComposerCard.jsx';
import './ScriptRail.scss';

/**
 * How long one page of a long air holds before the next.
 *
 * 11 s, and coprime with neither the ticker's 20 s nor the composer card's 27 s
 * by accident: three panels that swap on a shared or harmonic beat make the
 * whole surround look like it blinked. A page of verse is read faster than a
 * programme fact is absorbed, which is why this is the shortest of the three.
 */
export const LYRIC_PAGE_INTERVAL_MS = 11000;

/** Split sung text into the lines the corpus authored. Blank lines are stanza gaps. */
function linesOf(text) {
  if (typeof text !== 'string') return [];
  // An instrumental number's empty text must yield NO lines. `''.split('\n')`
  // is `['']` — one empty line — which renders an empty box, and an empty box
  // is the one thing this module promised not to draw.
  const trimmed = text.trim();
  if (trimmed === '') return [];
  return trimmed.split('\n').map((l) => l.trim());
}

/**
 * The programme path around the sounding segment. At each depth, show every
 * sibling group beneath the active parent: all Parts, then the active Part's
 * Scenes, then that Scene's next grouping level, and so on. This is derived
 * from the flattened rail so the YAML stays a tree and the player stays timed.
 */
function programmePath(segments, activeIndex) {
  const active = segments[activeIndex];
  const ancestors = Array.isArray(active?.ancestors) ? active.ancestors : [];
  return ancestors.map((current, depth) => {
    const parentPath = ancestors.slice(0, depth).map((a) => a.index).join('/');
    const seen = new Set();
    const items = [];
    segments.forEach((segment) => {
      const path = Array.isArray(segment?.ancestors) ? segment.ancestors : [];
      if (path.length <= depth || path.slice(0, depth).map((a) => a.index).join('/') !== parentPath) return;
      const candidate = path[depth];
      const key = `${candidate?.index}:${candidate?.title}`;
      if (!candidate?.title || seen.has(key)) return;
      seen.add(key);
      items.push(candidate);
    });
    return { kind: current.kind ?? 'group', items, activeIndex: current.index };
  });
}

export default function ScriptRail({ position, data, region, logger }) {
  const log = useMemo(() => surroundLogger(logger, 'script-rail'), [logger]);
  const contentId = data?.contentId;
  const segments = useMemo(() => (Array.isArray(data?.segments) ? data.segments : []), [data]);

  const state = useMemo(
    () => lyricStateAt({ segments, contentId, position }),
    [segments, contentId, position],
  );

  const lines = useMemo(() => linesOf(state.text), [state.text]);
  const programme = useMemo(() => programmePath(segments, state.index), [segments, state.index]);

  const boxRef = useRef(null);
  const [fontPx, setFontPx] = useState(null);
  const [pages, setPages] = useState([]);
  const [pageIndex, setPageIndex] = useState(0);

  /**
   * FIT, THEN PAGE — in that order, and both from one measured pass.
   *
   * The ladder is the frame's own (`../fit.js`): step the size down toward the
   * prose floor while the text overruns, and page only what still will not fit
   * at the floor. Doing it the other way round — paging first — would break a
   * short verse across two pages that a single step down would have seated
   * whole.
   *
   * `useLayoutEffect` because a measured resize that lands after paint is a
   * visible reflow on every segment boundary.
   */
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || lines.length === 0) { setPages([]); setFontPx(null); return; }

    const rootPx = rootWidthOf(box);
    const ceiling = proseCeilingPx(rootPx);
    const floor = proseFloorPx(rootPx);

    let size = ceiling;
    box.style.fontSize = `${size}px`;
    while (size > floor && box.scrollHeight > box.clientHeight) {
      size = Math.max(floor, size - FONT_STEP_PX);
      box.style.fontSize = `${size}px`;
    }
    setFontPx(size);

    const kids = Array.from(box.querySelectorAll('[data-lyric-line]'));
    const heights = kids.map((el) => el.getBoundingClientRect().height);
    const split = paginate(heights, box.clientHeight);
    setPages(split);
    setPageIndex(0);

    if (split.length > 1) {
      log.debug('surround.lyric.paged', {
        contentId, segment: state.index, pages: split.length, lines: lines.length, fontPx: size,
      });
    }
  }, [lines, contentId, state.index, log]);

  /** Advance the page on a dwell. A single-page text never starts a timer. */
  useEffect(() => {
    if (pages.length <= 1) return undefined;
    const id = setInterval(
      () => setPageIndex((i) => (i + 1) % pages.length),
      LYRIC_PAGE_INTERVAL_MS,
    );
    return () => clearInterval(id);
  }, [pages.length]);

  // The house dissolve, keyed on what is showing: a new segment or a new page
  // fades through empty ground rather than cutting.
  const [shownKey, hidden] = useDissolve(`${state.index}:${pageIndex}`);

  useEffect(() => {
    log.info('surround.lyric.state', {
      contentId, active: state.active, segment: state.index, hasText: lines.length > 0,
    });
  }, [contentId, state.active, state.index, lines.length, log]);

  // Dormant: no words anywhere on this rail, or a gap long enough to hand the
  // screen back to the programme. The frame has already made the same call, so
  // this is agreement, not a second opinion.
  if (!state.active) return null;

  const page = pages[pageIndex] ?? lines.map((_, i) => i);

  return (
    <div className="surround-libretto" data-testid="surround-libretto">
      {state.heading && (
        <h2 className="surround-libretto__heading" data-testid="surround-libretto-heading">
          {smartQuotes(state.heading)}
        </h2>
      )}

      {programme.length > 0 && (
        <nav className="surround-libretto__programme" aria-label="Current place in the work">
          {programme.map((level, depth) => (
            <div className="surround-libretto__programme-level" key={`${depth}:${level.kind}`}>
              <span className="surround-libretto__programme-kind">{level.kind}</span>
              <ol className="surround-libretto__programme-list">
                {level.items.map((item) => (
                  <li
                    key={`${item.index}:${item.title}`}
                    className={`surround-libretto__programme-item${item.index === level.activeIndex ? ' surround-libretto__programme-item--active' : ''}`}
                    aria-current={item.index === level.activeIndex ? 'step' : undefined}
                  >
                    {smartQuotes(item.title)}
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </nav>
      )}

      {/* An instrumental number renders NO box rather than an empty one — a mat
          with nothing in it is worse than an absence, because it is an absence
          the viewer has to look at. The rail stays up regardless. */}
      {lines.length > 0 && (
        <div
          className={`surround-libretto__text${hidden ? ' surround-libretto__text--hidden' : ''}`}
          data-testid="surround-libretto-text"
          data-page={pageIndex}
          data-pages={pages.length || 1}
          data-shown={shownKey}
          ref={boxRef}
          style={{
            fontSize: fontPx ? `${fontPx}px` : undefined,
            transition: `opacity ${DISSOLVE_FADE_MS}ms ease`,
          }}
        >
          {page.map((i) => (
            lines[i] === ''
              ? <div className="surround-libretto__gap" data-lyric-line key={i} />
              : <p className="surround-libretto__line" data-lyric-line key={i}>{smartQuotes(lines[i])}</p>
          ))}
        </div>
      )}

      {/* The composer, relocated rather than copied. Same component, second home. */}
      <div className="surround-libretto__plate" data-testid="surround-libretto-plate">
        <ComposerCard data={data} region={{ ...region, variant: 'plate' }} logger={logger} />
      </div>
    </div>
  );
}

ScriptRail.propTypes = {
  position: PropTypes.number,
  duration: PropTypes.number,
  playing: PropTypes.bool,
  seeking: PropTypes.bool,
  data: PropTypes.object,
  region: PropTypes.object,
  logger: PropTypes.object,
};
