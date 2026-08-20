// frontend/src/modules/Surround/modules/WorkPlacard.jsx
//
// The work's nameplate, above the stage: ArtMode's recessive dark-stone plate
// (see ArtMode.css `.artmode__music-plaque`) recut as a full-width band for the
// `top` region, carrying the piece — title, opus, composed, premiered. The
// clock props arrive because the module contract is fixed; this plate ignores
// them — it names the work, it does not track it, so it renders the same thing
// at 0:00 and at 53:00.
//
// ...UNLESS THE RAIL IS A CONTAINER (this wave). Seven polonaises by seven
// pianists are seven WORKS, and a plate that headlined "Polonaises" for
// fifty-nine minutes would be naming the box rather than the music. On a
// composed rail the plate headlines the SOUNDING SEGMENT and says where it sits
// in the set beneath it:
//
//     Polonaise in A-flat major, Op. 53
//     Chopin's Polonaises · 6 of 7
//
// A SINGLE WORK IS UNTOUCHED, and that is the load-bearing half of the rule.
// The Eroica has four movements in one media item; its plate names the symphony
// and the rail names the movement, which is the design that shipped. The gate is
// `isComposedContainer` — more than one PART, never more than one segment.
//
// The composer is NOT named here. That is a settled decision, not an oversight:
// the person lives on brass in the rail (ComposerCard); this plate is stone, and
// stone carries only the work. `data.composer` may be present in the payload but
// this module never reads it.
//
// An empty plate is worse than no plate: without a piece title there is nothing
// worth engraving, so the module renders null and the `top` region collapses.
//
// NO NAME IS EVER CUT (this wave). The plate has carried
// `text-overflow: ellipsis` since it was written, as a guard against one long
// authored title. A container makes that guard load-bearing — the headline now
// changes every few minutes and a long segment name is an ordinary authoring
// outcome — so the headline is MEASURED (`../fit.js`, `fitPlate`) and the type
// is sized to the longest name the rail carries. A name that cannot be set even
// at the plate's floor is refused, reported with its character budget, and the
// plate falls back to naming the work; it is never quietly cut mid-word. The
// size is solved against EVERY name on the rail, so it cannot change at a
// segment boundary — the reserved-height law, kept.

import React, {
  useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import PropTypes from 'prop-types';
import { smartQuotes, trimmed } from '../typography.js';
import { surroundLogger } from '../moduleKit.js';
import { segmentAt, isComposedContainer } from '../segments.js';
import { placedRailSegments } from '../band.js';
import { fitPlate, plateStyle, withheldPlate } from '../fit.js';
import './WorkPlacard.scss';

/**
 * A line of nothing that still occupies a line.
 *
 * The set line is blank between two works — the applause after the fifth
 * polonaise names nothing — and blank has to mean BLANK rather than absent: an
 * element that disappears gives its height back, and the plate would shrink by
 * a line every time one work ended and grow again when the next began.
 *
 * IT IS A NO-BREAK SPACE, AND THAT IS THE WHOLE OF IT WORKING. A plain space is
 * collapsible whitespace: a block containing only one generates no line box at
 * all, so the "reserved" line is exactly as absent as no element would have
 * been. Measured in Chromium before this character was changed — the plate came
 * back 89.13px tall between two works against 106.41px with one sounding, the
 * 17.28px of the set line's own line box, and the reserve that was written down
 * was not the reserve that rendered. `band.measure.test.jsx` holds it.
 */
const BLANK_LINE = '\u00a0';

/**
 * WHAT THE PLATE SAYS — the whole decision, as a pure function.
 *
 * Exported because it is the part worth asserting on its own: which of two
 * strings becomes the headline, and whether the set line has anything to say.
 * The component around it is measurement and wiring.
 *
 * @param {object} args
 * @param {object|null} args.piece the payload's `piece`.
 * @param {object|null} args.segment the sounding rail segment, or null.
 * @param {number} args.ordinal its 1-based place on the drawn rail.
 * @param {number} args.count how many segments the rail draws.
 * @param {boolean} [args.refused] the fit cannot set this segment's name whole.
 * @returns {{title:string, set:{name:string, ordinal:number, count:number}|null}}
 *   `title` is what the plate headlines; `set` is null when there is no set line
 *   to write (nothing sounding, or this is not a container).
 */
export function plateText({ piece, segment, ordinal, count, refused = false }) {
  const work = trimmed(piece?.title);
  const name = trimmed(segment?.name);
  // THE FALLBACK IS THE WORK, NOT A CUT NAME. A refused headline is one the fit
  // has certified cannot be set whole at the floor; showing it anyway — at any
  // size — is the ellipsis this wave exists to remove. Naming the set instead
  // is a smaller claim, and a true one.
  const title = name && !refused ? name : work;
  // `short_title` first: the set line is a standing label, and the corpus
  // authors the short form for exactly this use ("Chopin's Polonaises" against
  // the catalogue's "Polonaises"). Where none is authored the title serves.
  const label = trimmed(piece?.short_title) || work;
  const set = segment && count > 0 && label
    ? { name: label, ordinal, count }
    : null;
  return { title, set };
}

export default function WorkPlacard({
  position = 0,
  // The clock's other halves arrive because the module contract is fixed. This
  // plate reads only the position, and only to know which segment is sounding.
  // eslint-disable-next-line no-unused-vars
  duration = 0,
  // eslint-disable-next-line no-unused-vars
  playing = false,
  // eslint-disable-next-line no-unused-vars
  seeking = false,
  data = null,
  // eslint-disable-next-line no-unused-vars
  region = null,
  logger = null,
}) {
  const log = useMemo(() => surroundLogger(logger, 'work-placard'), [logger]);
  const piece = data?.piece ?? null;
  const contentId = data?.contentId ?? null;

  // ---- WHICH SEGMENT IS SOUNDING, ON A CONTAINER'S RAIL ---------------------
  // The same three calls the rail makes, in the same order, from the same two
  // modules: `isComposedContainer` decides whether the question applies at all,
  // `segmentAt` maps (this media item, this position) onto the container's
  // sounding-time axis, and `placedRailSegments` translates that into the
  // DRAWN rail's numbering — which is what "6 of 7" counts, because a segment
  // the rail cannot draw is not one a viewer can count.
  const container = isComposedContainer(data);
  const rail = useMemo(() => (Array.isArray(data?.segments) ? data.segments : []), [data]);
  const drawn = useMemo(() => placedRailSegments(rail), [rail]);
  const mapped = useMemo(
    () => (container ? segmentAt({ segments: rail, contentId, position }) : null),
    [container, rail, contentId, position],
  );
  const index = useMemo(() => {
    if (!mapped || mapped.index < 0) return -1;
    return drawn.findIndex((p) => p.index === mapped.index);
  }, [mapped, drawn]);
  const segment = index >= 0 ? drawn[index].segment : null;

  // ---- THE FIT --------------------------------------------------------------
  // Every name this plate may ever carry, CURLED, because that is what is
  // painted — a measurement of the straight-quoted original measures a string
  // the screen never shows.
  const names = useMemo(
    () => (container
      ? drawn.map(({ segment: m }) => smartQuotes(trimmed(m?.name))).filter(Boolean)
      : []),
    [container, drawn],
  );

  const rootRef = useRef(null);
  const [fit, setFit] = useState(null);
  /** Re-measure ticks: the frame resized, or the display faces finally landed. */
  const [layoutTick, setLayoutTick] = useState(0);

  // THE CAP IS A FUNCTION OF THE VIDEO'S MEASURED WIDTH (`--surround-media-w`,
  // published by the frame), so the frame's own box is watched rather than this
  // plate's — the plate is content-width and does not change when the room
  // around it does. The header is watched too: it is the element carrying the
  // cap, and it is the one that moves when a shrink or a collapse re-lays the
  // column without resizing the frame.
  useEffect(() => {
    const root = rootRef.current;
    const frame = root?.closest?.('.surround-frame');
    if (!frame || typeof ResizeObserver === 'undefined') return undefined;
    let frameId = 0;
    const observer = new ResizeObserver(() => {
      if (frameId) return;
      if (typeof requestAnimationFrame !== 'function') { setLayoutTick((n) => n + 1); return; }
      frameId = requestAnimationFrame(() => { frameId = 0; setLayoutTick((n) => n + 1); });
    });
    observer.observe(frame);
    const header = root?.closest?.('.surround-frame__header');
    if (header) observer.observe(header);
    return () => {
      if (frameId && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [container]);

  // The vendored display face lands after the first layout, and Cormorant is
  // much wider than the fallback serif: a name measured before it arrives is
  // measured against the wrong metrics. Same guard the rail takes.
  useEffect(() => {
    let live = true;
    document?.fonts?.ready?.then?.(() => { if (live) setLayoutTick((n) => n + 1); });
    return () => { live = false; };
  }, []);

  /**
   * HOW MANY TIMES THE FIT HAS ASKED AN UNMEASURED FRAME.
   *
   * The cap is `86% of the MEASURED video`, and the frame publishes that
   * measurement one commit after the media box lays out — so the first fit of
   * an enriched item asks a plate whose cap is still a percentage and gets no
   * answer (`fitPlate` returns null rather than reading "86%" as 86 pixels).
   * Nothing else would wake it: the plate is content-width, so the frame's box
   * and this plate's box are both unchanged by the measurement landing, and the
   * ResizeObserver above never fires. A bounded retry is what closes that
   * window — the same idiom, and the same bound, the band uses while it waits
   * for the vendored faces.
   */
  const tries = useRef(0);
  useEffect(() => { tries.current = 0; }, [container, names]);

  // LAYOUT EFFECT, so the fitted size is committed before the browser paints and
  // the first frame is already the right one.
  useLayoutEffect(() => {
    if (!container || !names.length) { setFit(null); return undefined; }
    const next = fitPlate(rootRef.current, names);
    if (!next) {
      if (tries.current >= 20) return undefined;
      tries.current += 1;
      const timer = setTimeout(() => setLayoutTick((n) => n + 1), 100);
      return () => clearTimeout(timer);
    }
    setFit((prev) => (
      prev
      && prev.fontPx === next.fontPx
      && prev.availPx === next.availPx
      && prev.rejected.length === next.rejected.length
      && prev.rejected.every((r, i) => r.text === next.rejected[i].text)
        ? prev : next
    ));
    return undefined;
  }, [container, names, layoutTick]);

  /**
   * A name that cannot be set whole at the plate's floor is an AUTHORING
   * failure, and this is where it is reported — a `warn`, because the only
   * party who can fix it is a person editing the corpus. The payload carries
   * the budget (how many characters DO fit, measured rather than estimated),
   * the overflow, and the width it was judged against, so the re-authoring
   * target can be read straight out of the log store.
   */
  const rejected = fit?.rejected ?? null;
  const availPx = fit?.availPx ?? null;
  const floorPx = fit?.floorPx ?? null;
  useEffect(() => {
    if (!rejected?.length) return;
    rejected.forEach((r) => {
      log.warn('surround.placard.unfittable', {
        contentId,
        text: r.text,
        chars: r.chars,
        budget: r.budget,
        cut: r.chars - r.budget,
        overflowPx: r.overflowPx,
        floorPx,
        availPx,
      });
    });
  }, [rejected, floorPx, availPx, contentId, log]);

  const refusedNames = useMemo(() => withheldPlate(fit), [fit]);
  const refused = Boolean(segment && refusedNames?.has(smartQuotes(trimmed(segment.name))));

  const { title, set } = plateText({
    piece, segment, ordinal: index + 1, count: drawn.length, refused,
  });

  useEffect(() => {
    if (!container) return;
    // INFO: one per movement, and it says what the plate actually headlined —
    // the other half of "what was on screen" beside the rail's own density.
    log.info('surround.placard.segment', {
      contentId, index, of: drawn.length, title, refused,
    });
    // The event fires on the segment changing; the rest is payload.
  }, [container, index, contentId]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!title) return null;

  // The plate is the frame's largest type, so it is the surface where a straight
  // quote is most obviously unset — both live works have a nickname in quotes
  // ("Eroica", "Spring"). One curl at the render seam, `../typography.js`.
  //
  // THE INTERPUNCT IS AN ELEMENT, NOT WHITESPACE. This line was joined with
  // `'   ·   '` — three spaces either side of the mark — and HTML collapses a
  // whitespace run to a single space unless a `white-space: pre*` rule applies,
  // which none did. The engraved plate's breathing room existed only in the
  // source. A separator span with an `em` margin is the correct mechanism
  // anyway: three space glyphs are whatever this face happens to make them,
  // while an em is a fraction of the type's own size and holds at every screen
  // in the fleet.
  const parts = [piece?.opus, piece?.composed, piece?.premiered].filter(Boolean);

  return (
    <div
      ref={rootRef}
      className={`surround-work-placard${container ? ' surround-work-placard--set' : ''}`}
      data-testid="surround-work-placard"
      style={plateStyle(fit)}
    >
      <h2
        className="surround-work-placard__title"
        data-testid="surround-placard-title"
      >
        {smartQuotes(title)}
        {/* THE RULER (the idiom the band measures its prose with, `../fit.js`).
            Out of flow and invisible, inside the very element it measures, so it
            inherits the face, the weight and the tracking the headline is set
            in. Rendered only on a container: a single work's plate is not
            fitted, and an element nothing measures is an element that can only
            be wrong. */}
        {container && (
          <span className="surround-work-placard__probe" aria-hidden="true" />
        )}
      </h2>
      {/* THE SET LINE. Reserved, not conditional — see BLANK_LINE. It names the
          set and the segment's place in it; the rail below draws the same fact
          as geometry, and this is the sentence form of it for a viewer who has
          just walked in. */}
      {container && (
        <p className="surround-work-placard__set" data-testid="surround-placard-set">
          {set ? (
            <>
              {smartQuotes(set.name)}
              <span className="surround-work-placard__sep" aria-hidden="true">·</span>
              {`${set.ordinal} of ${set.count}`}
            </>
          ) : BLANK_LINE}
        </p>
      )}
      {parts.length > 0 ? (
        <p className="surround-work-placard__meta">
          {parts.map((part, i) => (
            // The parts are authored strings from one corpus entry, in a fixed
            // order; the index is their identity as much as their value is.
            // eslint-disable-next-line react/no-array-index-key
            <React.Fragment key={`${i}:${part}`}>
              {i > 0 && (
                <span className="surround-work-placard__sep" aria-hidden="true">·</span>
              )}
              {smartQuotes(String(part))}
            </React.Fragment>
          ))}
        </p>
      ) : null}
    </div>
  );
}

WorkPlacard.propTypes = {
  position: PropTypes.number,
  duration: PropTypes.number,
  playing: PropTypes.bool,
  seeking: PropTypes.bool,
  data: PropTypes.object,
  region: PropTypes.object,
  logger: PropTypes.object,
};
