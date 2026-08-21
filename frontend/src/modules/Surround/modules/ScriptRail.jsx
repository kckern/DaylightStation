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
// ANATOMY. Four pieces, top to bottom. THE WORDS COME FIRST — the rail used to
// open with its contents and put the libretto in the middle, which set the one
// thing a viewer reads in time with the music BELOW the one thing they consult
// once a movement. The contents are a footer now, which is where a contents
// page belongs when the page it indexes is already in front of you:
//
//   BILLING   The number's HEADER and SUBHEADER, and neither is its label.
//             `heading:` is where the words come from ("Lamentations 1:12") and
//             `subheading:` is how they are performed ("Air (Tenor)"); the two
//             are set flush left and LOUDER THAN THE VERSE, because a viewer who
//             has just arrived needs to know what they are hearing before they
//             can read along with it. The label and the numeral are absent by
//             rule — argued in `billingFor` (`../lyrics.js`). Set once per
//             segment and it does NOT page with the text beneath it, so a viewer
//             glancing up mid-air still knows what is sounding.
//   TEXT      The sung words. Fitted, then paged. Never cut, and never
//             REFLOWED either: the ladder is bound by the longest authored
//             line's WIDTH, not just by the block's height — see the fit
//             effect below for the orphan that taught us the difference.
//   PROGRAMME The place in the work, as a nested table of contents, AT THE FOOT
//             of the rail. Every Part is listed; the sounding Part is OPEN and
//             its Scenes are printed inside it, indented, rather than in a
//             second flat list of their own. A scene belongs to a part, and the
//             earlier layout — two sibling blocks captioned PART and SCENE —
//             made the viewer infer a containment the tree can simply show.
//             Closed branches print nothing but their own title, which is what
//             keeps a five-act work from setting its whole contents here.
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
import { lyricCeilingPx, proseFloorPx, rootWidthOf, FONT_STEP_PX } from '../fit.js';
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

/**
 * The coarse rung of the fit ladder, in px.
 *
 * THE LADDER GOT LONGER WHEN THE CEILING WENT UP, and a ladder walked one
 * quarter-pixel at a time from 1.8rem to the living room's 10.56px floor is
 * seventy-odd forced reflows on every segment boundary — on a television, a
 * visible hitch exactly when the words change. So the descent is coarse (1px)
 * and only the last pixel is walked at `FONT_STEP_PX`, which lands on the same
 * size in about a fifth of the measurements.
 */
const COARSE_STEP_PX = 1;

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
 * The programme around the sounding segment, AS A TREE.
 *
 * At each depth, every sibling group beneath the active parent is listed — all
 * Parts, then within the active Part all of its Scenes, and so on — but a level
 * is now nested INSIDE the item it belongs to rather than printed beside it.
 * Only the active branch opens; a closed sibling contributes its own title and
 * nothing beneath it.
 *
 * Derived from the flattened rail so the YAML stays a tree and the player stays
 * timed. Returns the root level, or null when the work has no grouping at all.
 */
function programmeTree(segments, activeIndex) {
  const active = segments[activeIndex];
  const ancestors = Array.isArray(active?.ancestors) ? active.ancestors : [];

  const level = (depth) => {
    if (depth >= ancestors.length) return null;
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
    if (items.length === 0) return null;

    const activeAt = ancestors[depth].index;
    return {
      kind: ancestors[depth].kind ?? 'group',
      items: items.map((item) => ({
        index: item.index,
        title: item.title,
        active: item.index === activeAt,
        child: item.index === activeAt ? level(depth + 1) : null,
      })),
    };
  };

  return level(0);
}

/**
 * One grouping level and, inside its active item, the level beneath it.
 *
 * ONE MARKER, ON THE DEEPEST ACTIVE ITEM. The rail used to set a filled bullet
 * on the Part AND on the Scene inside it — two identical glyphs, only one of
 * which was the viewer's actual position. A parent's OPENNESS is already its
 * marker: its children are printed inside it and nothing else's are. So the
 * ancestors take ink and the item with no active child beneath it takes the
 * rule in the margin.
 *
 * AND NOTHING MARKS AN INACTIVE ITEM. A ring on every sibling is a dozen
 * hairline glyphs that resolve to dust at ten feet; the indent already says
 * these are a list, and a marker that is on everything marks nothing.
 */
function ProgrammeLevel({ level, depth }) {
  if (!level) return null;
  return (
    <div className="surround-script-rail__programme-level" data-depth={depth}>
      <span className="surround-script-rail__programme-kind">{level.kind}</span>
      <ol className="surround-script-rail__programme-list">
        {level.items.map((item) => (
          <li
            key={`${item.index}:${item.title}`}
            className={[
              'surround-script-rail__programme-item',
              item.active ? 'surround-script-rail__programme-item--active' : '',
              item.active && !item.child ? 'surround-script-rail__programme-item--here' : '',
            ].filter(Boolean).join(' ')}
            aria-current={item.active ? 'step' : undefined}
          >
            <span className="surround-script-rail__programme-title">{smartQuotes(item.title)}</span>
            <ProgrammeLevel level={item.child} depth={depth + 1} />
          </li>
        ))}
      </ol>
    </div>
  );
}

ProgrammeLevel.propTypes = {
  level: PropTypes.object,
  depth: PropTypes.number,
};

export default function ScriptRail({ position, data, region, logger }) {
  const log = useMemo(() => surroundLogger(logger, 'script-rail'), [logger]);
  const contentId = data?.contentId;
  const segments = useMemo(() => (Array.isArray(data?.segments) ? data.segments : []), [data]);

  const state = useMemo(
    () => lyricStateAt({ segments, contentId, position }),
    [segments, contentId, position],
  );

  const lines = useMemo(() => linesOf(state.text), [state.text]);
  const programme = useMemo(() => programmeTree(segments, state.index), [segments, state.index]);

  const boxRef = useRef(null);
  const [fontPx, setFontPx] = useState(null);
  const [pages, setPages] = useState([]);
  const [pageIndex, setPageIndex] = useState(0);

  /**
   * FIT, THEN PAGE — in that order, and both from one measured pass.
   *
   * THE LADDER IS BOUND BY WIDTH, NOT ONLY BY HEIGHT, and that is the whole
   * lesson of this effect. It used to ask one question — `scrollHeight >
   * clientHeight` — which a browser answers "fits" for type so large that every
   * long line has silently wrapped. On Messiah's 29th number that set `He looked
   * for some to have pity on Him,` as two centered lines, the second of which
   * was the single word `Him,` — indistinguishable, at ten feet, from a line the
   * librettist wrote. Destroying an author's lineation is a worse failure than
   * setting the verse a rung smaller, because the viewer cannot even see that it
   * happened. So a line that renders taller than one line-height HAS WRAPPED, and
   * a wrap is an overrun.
   *
   * Only what still will not fit at the floor is paged. Doing it the other way
   * round — paging first — would break a short verse across two pages that a
   * single step down would have seated whole.
   *
   * `useLayoutEffect` because a measured resize that lands after paint is a
   * visible reflow on every segment boundary.
   */
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || lines.length === 0) { setPages([]); setFontPx(null); return; }

    const rootPx = rootWidthOf(box);
    const ceiling = lyricCeilingPx(rootPx);
    const floor = proseFloorPx(rootPx);
    const linesOfBox = () => Array.from(box.querySelectorAll('[data-lyric-line]'));

    /**
     * Does this size overrun, on EITHER axis? Height is the block against its
     * box; width is any authored line rendering as more than one. The wrap test
     * measures against the line's own computed leading rather than a constant,
     * so it stays honest if the stylesheet's `line-height` ever moves.
     */
    const overruns = () => {
      if (box.scrollHeight > box.clientHeight) return true;
      return linesOfBox().some((el) => {
        if (!el.textContent) return false;             // a stanza gap has no lineation to lose
        const leading = parseFloat(getComputedStyle(el).lineHeight);
        if (!Number.isFinite(leading) || leading <= 0) return false;
        return el.getBoundingClientRect().height > leading * 1.5;
      });
    };

    // Coarse descent, then walk back up through the last pixel at the fine
    // step. The two together return the same size the fine ladder alone would,
    // for a fraction of the layout work — see COARSE_STEP_PX.
    let size = ceiling;
    box.style.fontSize = `${size}px`;
    while (size > floor && overruns()) {
      size = Math.max(floor, size - COARSE_STEP_PX);
      box.style.fontSize = `${size}px`;
    }
    if (!overruns()) {
      const reach = Math.min(ceiling, size + COARSE_STEP_PX);
      for (let up = size + FONT_STEP_PX; up < reach; up += FONT_STEP_PX) {
        box.style.fontSize = `${up}px`;
        if (overruns()) break;
        size = up;
      }
      box.style.fontSize = `${size}px`;
    }
    setFontPx(size);

    // A VERSE THAT STILL WRAPS AT THE FLOOR is worth knowing about, but it no
    // longer switches the block into a second mode: the verse is flush left
    // with a hanging turn-over ALWAYS now, which is the printed-poetry setting
    // and makes a continuation unmistakable without the stylesheet having to be
    // told that one happened.
    const wrapped = overruns();

    const heights = linesOfBox().map((el) => el.getBoundingClientRect().height);
    const split = paginate(heights, box.clientHeight);
    setPages(split);
    setPageIndex(0);

    if (split.length > 1 || wrapped) {
      log.debug('surround.lyric.paged', {
        contentId, segment: state.index, pages: split.length, lines: lines.length, fontPx: size, wrapped,
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
    <div className="surround-script-rail" data-testid="surround-script-rail">
      {state.heading && (
        <header className="surround-script-rail__billing">
          <h2 className="surround-script-rail__heading" data-testid="surround-script-rail-heading">
            {smartQuotes(state.heading)}
          </h2>
          {state.subheading && (
            <p className="surround-script-rail__subheading" data-testid="surround-script-rail-subheading">
              {smartQuotes(state.subheading)}
            </p>
          )}
        </header>
      )}

      {/* An instrumental number renders NO box rather than an empty one — a mat
          with nothing in it is worse than an absence, because it is an absence
          the viewer has to look at. The rail stays up regardless. */}
      {lines.length > 0 && (
        <div
          className={`surround-script-rail__text${hidden ? ' surround-script-rail__text--hidden' : ''}`}
          data-testid="surround-script-rail-text"
          data-page={pageIndex}
          data-pages={pages.length || 1}
          data-shown={shownKey}
          ref={boxRef}
          style={{
            fontSize: fontPx ? `${fontPx}px` : undefined,
            transition: `opacity ${DISSOLVE_FADE_MS}ms ease`,
          }}
        >
          {/* A STANZA OPENS FLUSH AND RUNS INDENTED. The first line of each
              stanza — and of each page, which is a stanza the paging happened
              to start — sits on the rail's own left edge; every line after it
              steps in. That is the printed-verse setting, and it is what gives
              a left-aligned block the shape a centred one got for free.
              Computed from the PAGE rather than from `lines`, so a stanza split
              across two pages opens on both. */}
          {page.map((i, at) => (
            lines[i] === ''
              ? <div className="surround-script-rail__gap" data-lyric-line key={i} />
              : (
                <p
                  className={`surround-script-rail__line${at === 0 || lines[page[at - 1]] === '' ? ' surround-script-rail__line--opens' : ''}`}
                  data-lyric-line
                  key={i}
                >
                  {smartQuotes(lines[i])}
                </p>
              )
          ))}
        </div>
      )}

      {programme && (
        <nav className="surround-script-rail__programme" aria-label="Current place in the work">
          <ProgrammeLevel level={programme} depth={0} />
        </nav>
      )}

      {/* The composer, relocated rather than copied. Same component, second home. */}
      <div className="surround-script-rail__plate" data-testid="surround-script-rail-plate">
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
