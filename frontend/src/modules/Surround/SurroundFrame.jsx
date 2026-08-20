// frontend/src/modules/Surround/SurroundFrame.jsx
//
// The concert programme frame: a darkened auditorium (--hall-ink) with the video
// locked to 16:9 on the left and printed programme panels around it.
//
// Layout geometry is a deliberate COPY of FitnessPlayerFrame's shell (main column
// + rail + footer) in a `surround-frame__*` namespace. It is not
// imported across the module boundary: the fitness frame is owned by the fitness
// player and free to change for reasons that have nothing to do with a surround.
//
// Three rules make this frame different from that one:
//
//  1. The media box locks 16:9 INLINE (aspect-ratio + max-width + max-height), so
//     the video letterboxes on ink and can never be distorted by an outer
//     stylesheet. This is the quality floor of the whole feature.
//  2. The footer is sized to the MEASURED media-box width, so it reads as that
//     video's timeline rather than as page furniture.
//  3. The video is TOP-anchored and the slack all falls to the bottom band. The
//     work placard is not a band above it at all: it floats, content-width,
//     straddling the video's top edge like a plate pinned over a painting.
//
// `PanelRenderer` is deliberately not used to resolve regions: it renders static
// YAML props, and every module here is driven by a 10 Hz clock.
//
// CONSTANT DEPTH — WHY THE SHELL IS ALWAYS RENDERED
// ------------------------------------------------
// The frame is mounted for EVERY item, enriched or not. `children` (the player)
// therefore sit at the same depth in the React tree in both states, and React
// never re-parents them. Re-parenting is a remount, and remounting a <video>
// reloads it: that was one audible restart a second into every enriched item,
// because the host only learns an item is enriched after its first 1 Hz poll.
//
// When inactive the shell elements carry `display: contents`, no class and no
// attributes, so they generate no box: an un-enriched page lays out exactly as a
// bare player does. The old contract was "no wrapper element at all"; the new one
// is "a wrapper that generates no box". `display: contents` also removes the
// element from the accessibility tree in some engines — which is why the inactive
// shell carries no role, no aria and no semantics for anything to lose.

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import PropTypes from 'prop-types';
import { surroundLogger } from './moduleKit.js';
import { getSurroundRegistry } from './registry.js';
import {
  ENTER_TOTAL_MS, ENTER_UNCLIP_MS, entranceVars, shrinkFrom,
} from './entrance.js';
import { labelFloorPx, LABEL_FLOOR_ANCHOR_PX } from './fit.js';
import { lyricStateAt, railHasText } from './lyrics.js';
import './SurroundFrame.scss';

const DEFAULT_RAIL_WIDTH = '20%';

/** The inactive shell: present in the tree, absent from the box tree. */
const NO_BOX = Object.freeze({ display: 'contents' });
const DEFAULT_FOOTER_FLOOR = 90;

/**
 * A region's declared `height`, turned into flex sizing.
 *
 *  * `fill`       — claim the band's slack. The footer now GROWS into the space
 *                   the floating placard freed (see the SCSS), and something has
 *                   to absorb it; the sidecar already says which region that is
 *                   (`cue-ticker: height: fill`), so the frame honours it rather
 *                   than hard-coding "the last one wins".
 *  * bottom, Npx  — a FLOOR, not a cap. Segment names may wrap to two lines and
 *                   the band has to grow to fit them; a fixed height would clip
 *                   the second line against `overflow: hidden`.
 *  * elsewhere    — exact, as before. The rail's country-map is sized against a
 *                   rail whose regions are `height: 100%`; a floor there would
 *                   let that percentage win and swallow the whole rail.
 */
function regionStyle(region) {
  if (region?.height === 'fill') return { flex: '1 1 auto', minHeight: 0 };
  const h = Number(region?.height);
  if (!Number.isFinite(h) || h <= 0) return undefined;
  if (region.slot === 'bottom') return { minHeight: `${h}px`, flex: '0 0 auto' };
  return { height: `${h}px`, flex: `0 0 ${h}px` };
}

/** Lazy module-level child. Used only when no host logger was threaded down. */

/** A region slot in the definition may be a single object or a list of them. */
function normalizeRegions(value, slot) {
  if (!value) return [];
  const list = Array.isArray(value) ? value : [value];
  return list
    .filter((r) => r && typeof r === 'object' && typeof r.module === 'string' && r.module)
    .map((r, i) => ({ ...r, slot, key: `${slot}:${i}:${r.module}` }));
}

/**
 * Per-module error boundary. It wraps ONE module and nothing else — deliberately.
 * React tears down the entire subtree beneath a boundary that catches, so a
 * boundary wrapping the player would remount (and reload) the video on any module
 * error. Here the blast radius is the module; the frame reacts to `onError` by
 * collapsing to its inactive shell, which is the "bare children" fallback the
 * contract asks for, reached without moving the player.
 */
class SurroundModuleBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error, info) {
    this.props.onError?.(error, info);
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

SurroundModuleBoundary.propTypes = {
  onError: PropTypes.func,
  children: PropTypes.node,
};

export default function SurroundFrame({
  data = null,
  active = true,
  contentId = null,
  position = 0,
  duration = 0,
  playing = false,
  seeking = false,
  logger = null,
  className = '',
  onModuleError = null,
  children = null,
}) {
  const log = useMemo(() => surroundLogger(logger, 'surround-frame'), [logger]);

  // A module that threw takes the frame off for THIS item only; the next
  // contentId gets a fresh attempt because the failure belonged to the old
  // payload. Storing the failing id (rather than a boolean plus a reset effect)
  // makes that reset a pure render-time comparison.
  const [failedFor, setFailedFor] = useState(undefined);
  const failed = failedFor !== undefined && failedFor === String(contentId);
  const enabled = active !== false && !!data && !failed;

  const handleModuleError = (error) => {
    setFailedFor(String(contentId));
    if (onModuleError) onModuleError(error);
    else log.error('surround.render.error', { contentId, surroundId: data?.id ?? null, error: String(error?.message ?? error) });
  };

  const definition = data?.definition ?? null;
  // `right` is authored as either a single object or a list of modules (e.g.
  // composer-card + country-map). Width and side both belong to the rail as a
  // whole, so when it's a list the first entry carries them.
  const rightDef = definition?.regions?.right;
  const railFirst = Array.isArray(rightDef) ? rightDef[0] : rightDef;
  const railWidth = railFirst?.width ?? DEFAULT_RAIL_WIDTH;
  const railSide = railFirst?.side === 'left' ? 'left' : 'right';
  const footerFloor = Number.isFinite(definition?.collapse?.footerFloor)
    ? definition.collapse.footerFloor
    : DEFAULT_FOOTER_FLOOR;

  const topRegions = useMemo(
    () => normalizeRegions(definition?.regions?.top, 'top'), [definition]);
  const rightRegions = useMemo(
    () => normalizeRegions(definition?.regions?.right, 'right'), [definition]);
  const footerRegions = useMemo(
    () => normalizeRegions(definition?.regions?.bottom, 'bottom'), [definition]);
  /**
   * THE LYRIC SLOT. Authored as a sibling of `right`, never inside it, because
   * the frame renders exactly ONE of the two: when a piece's segments carry
   * sung text this rail takes the right-hand column and the programme rail
   * slides out. A definition with no `lyric:` slot behaves precisely as it did
   * before this existed — which is what makes the feature dormant rather than
   * conditional, and why no shipped piece changes shape until its corpus grows
   * words.
   */
  const lyricRegions = useMemo(
    () => normalizeRegions(definition?.regions?.lyric, 'lyric'), [definition]);

  // The module contract is exactly { position, duration, playing, seeking, data,
  // region }. contentId is not a seventh prop — it rides inside `data`, so every
  // module can tag its events for correlation without widening the contract.
  // Memoized on [data, contentId] so a 10 Hz tick never churns the object.
  const payload = useMemo(() => {
    if (!data) return null;
    return data.contentId === contentId ? data : { ...data, contentId };
  }, [data, contentId]);

  const rootRef = useRef(null);
  const mediaRef = useRef(null);
  const footerRef = useRef(null);
  const [mediaWidth, setMediaWidth] = useState(null);
  const [collapsed, setCollapsed] = useState(false);
  const footerHeightRef = useRef(0);
  /**
   * THE BAND'S HEIGHT, published. Measured already (it drives the collapse),
   * but held in a ref, so no stylesheet could read it. The lyric rail's corner
   * plate needs it: the plate is the square that sits KITTY-CORNER to the
   * video's bottom-right corner, which means its height is the band's height
   * and nothing else. Content-sizing it squashed the portrait.
   */
  const [bandHeight, setBandHeight] = useState(0);
  /**
   * The frame's OWN width, which is the screen root's — and the only thing in
   * the frame that knows it. Every ten-foot type floor in the surround is an
   * ANGULAR claim, and a CSS pixel is not an angle: this fleet's screens are all
   * large televisions read from across a room, and each lays a different number
   * of CSS pixels across a panel of much the same physical size, so the same rem
   * is a different apparent size on each. The floors therefore scale with this
   * number (`fit.js`), and it is published below as one custom property so that
   * every stylesheet in the frame reads one measurement rather than restating a
   * constant that is only right on one screen.
   *
   * The ANCHOR until it is measured, never zero: a frame that has not been laid
   * out yet must paint the number the office screen would get, not the smallest
   * one in the fleet.
   */
  const [labelFloor, setLabelFloor] = useState(LABEL_FLOOR_ANCHOR_PX);

  // One observer watching both boxes: the media box drives the footer's width,
  // the footer's own height drives the collapse rule.
  useLayoutEffect(() => {
    // An un-enriched item observes nothing: no boxes to measure, nothing to collapse.
    if (!enabled) return undefined;
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        const rect = entry.contentRect ?? {};
        if (entry.target === mediaRef.current) {
          const w = Number(rect.width) || 0;
          setMediaWidth(w > 0 ? w : null);
        } else if (entry.target === rootRef.current) {
          // The screen root's width, which every type floor in the frame scales
          // by. Measured rather than read from screen config: `ScreenRenderer`
          // letterboxes a fixed `resolution` box inside whatever viewport the
          // display has, so the window is the wrong number on the office PC and
          // a config value is a number nobody re-reads.
          setLabelFloor(labelFloorPx(Number(rect.width) || 0));
        } else if (entry.target === footerRef.current) {
          const h = Number(rect.height) || 0;
          footerHeightRef.current = h;
          setBandHeight(h);
          // h === 0 means "not laid out yet", not "too short" — never collapse on it.
          setCollapsed(h > 0 && h < footerFloor);
        }
      });
    });
    if (mediaRef.current) observer.observe(mediaRef.current);
    if (footerRef.current) observer.observe(footerRef.current);
    if (rootRef.current) observer.observe(rootRef.current);
    return () => observer.disconnect();
  }, [enabled, footerFloor, footerRegions.length]);

  // Report collapse transitions only — not the steady state on every render.
  const prevCollapsed = useRef(collapsed);
  useEffect(() => {
    if (prevCollapsed.current === collapsed) return;
    prevCollapsed.current = collapsed;
    log.debug('surround.collapse', {
      contentId,
      collapsed,
      floor: footerFloor,
      footerHeight: Math.round(footerHeightRef.current),
    });
  }, [collapsed, footerFloor, contentId, log]);

  const registry = getSurroundRegistry();
  const allRegions = useMemo(
    () => [...topRegions, ...rightRegions, ...lyricRegions, ...footerRegions],
    [topRegions, rightRegions, lyricRegions, footerRegions],
  );
  const resolved = useMemo(
    () => new Map(allRegions.map((r) => [r.key, registry.get(r.module)])),
    // `registry` is a stable singleton; regions change only with the definition.
    [allRegions], // eslint-disable-line react-hooks/exhaustive-deps
  );

  useEffect(() => {
    allRegions.forEach((region) => {
      if (!resolved.get(region.key)) {
        log.warn('surround.module.missing', { contentId, module: region.module, slot: region.slot });
        return;
      }
      // THE REGISTRATION'S `regions` META, FINALLY DOING ITS JOB. Every built-in
      // declares the slots it was designed for (`builtins.js`) — the rail's
      // carousel is a column, the band's rail is a strip, the placard is a
      // full-width plate — and until now that declaration was stored, asserted
      // by a test, and read by nothing. A definition that puts a module in a
      // slot it was never cut for produces a frame that renders and looks
      // wrong, which is the hardest kind of authoring mistake to find.
      // It WARNS AND RENDERS: the surround can never be the reason something
      // does not play, and a module in an unexpected slot may still be exactly
      // what an author wanted. It says so once, with both ends named.
      const slots = registry.getMeta?.(region.module)?.regions;
      if (!Array.isArray(slots) || slots.includes(region.slot)) return;
      log.warn('surround.module.misplaced', {
        contentId, module: region.module, slot: region.slot, declared: slots,
      });
    });
  }, [allRegions, resolved, contentId, log, registry]);

  useEffect(() => {
    // The component itself is now mounted for every item, so the pair tracks the
    // frame being ON — which is what the log reader cares about.
    if (!enabled) return undefined;
    log.debug('surround.frame.mount', {
      contentId,
      surroundId: data?.id ?? null,
      regions: allRegions.map((r) => r.module),
    });
    return () => { log.debug('surround.frame.unmount', { contentId, surroundId: data?.id ?? null }); };
  }, [enabled, contentId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ENTRANCE — THE ENRICHMENT MOMENT (design wave 5).
  //
  // The chrome arrives ~1s after the video, on the first enrichment poll, so
  // without choreography it POPS in — and so does the video's own resize, from
  // full-bleed picture to a 16:9 box beside a rail. `--entering` holds all four
  // moving things in their pre-arrival state for one committed frame; dropping it
  // lets the CSS transitions play them in as one gesture: the video shrinks out
  // of the whole frame into its box while the rail slides in from its side, the
  // band rises and the plate settles down onto the picture.
  //
  // It is CLASSES on the root and nothing else: the inactive shell has no
  // className at all, so no animation state can leak there — the same guarantee
  // `--rail-left` carries.
  //
  // THE VIDEO IS ANIMATED BUT NEVER REMOUNTED. The transform goes on the media
  // box, which is rendered at the same depth in both states, so React only ever
  // updates its style. And it is a UNIFORM scale (see `shrinkFrom`), which is the
  // one kind of size animation that cannot leave 16:9 at any frame of it.
  const [entered, setEntered] = useState(false);
  // The over-sized video does not fit the stage while it is shrinking, and the
  // stage clips. `--arriving` un-clips it, and outlasts the transitions so the
  // clip never snaps back mid-move.
  const [arriving, setArriving] = useState(false);
  const [shrink, setShrink] = useState(null);

  // LAYOUT effect, not a ResizeObserver: the pre-shrink transform has to be in
  // the SAME committed frame as the box it belongs to, or the first painted
  // frame shows the video already small and the shrink starts from nowhere. This
  // runs after the enriched layout exists and before it is painted.
  useLayoutEffect(() => {
    if (!enabled) {
      setShrink(null);
      return;
    }
    const root = rootRef.current;
    const media = mediaRef.current;
    if (typeof root?.getBoundingClientRect !== 'function'
      || typeof media?.getBoundingClientRect !== 'function') return;
    setShrink(shrinkFrom(root.getBoundingClientRect(), media.getBoundingClientRect()));
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setArriving(false);
      return undefined;
    }
    setArriving(true);
    const done = setTimeout(() => setArriving(false), ENTER_UNCLIP_MS);
    return () => clearTimeout(done);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setEntered(false);
      return undefined;
    }
    if (typeof requestAnimationFrame !== 'function') {
      setEntered(true);           // no rAF (SSR/test env): arrive without the animation
      return undefined;
    }
    // Two frames: the first commits the pre-entrance styles, the second releases
    // them. Releasing in the same frame they were painted is a no-op transition.
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setEntered(true));
    });
    // Safety net. A background tab paints no frames, so rAF may never fire — and
    // the pre-entrance state is `opacity: 0`. Without this, a frame that mounted
    // while the kiosk tab was hidden would come back to the foreground with
    // invisible chrome. Timers are throttled in the background, not stopped.
    const net = setTimeout(() => setEntered(true), ENTER_TOTAL_MS);
    return () => {
      cancelAnimationFrame(first);
      if (second) cancelAnimationFrame(second);
      clearTimeout(net);
    };
  }, [enabled]);

  const visibleFooterRegions = collapsed
    ? footerRegions.filter((r) => r.collapse !== 'first')
    : footerRegions;

  const renderRegion = (region) => {
    const Module = resolved.get(region.key);
    const style = regionStyle(region);
    return (
      <div
        key={region.key}
        className={`surround-frame__region surround-frame__region--${region.slot}${Module ? '' : ' surround-frame__region--empty'}`}
        data-module={region.module}
        style={style}
      >
        {Module ? (
          <SurroundModuleBoundary onError={handleModuleError}>
            <Module
              position={position}
              duration={duration}
              playing={playing}
              seeking={seeking}
              data={payload}
              region={region}
              logger={logger}
            />
          </SurroundModuleBoundary>
        ) : null}
      </div>
    );
  };

  /**
   * WHICH RAIL THIS FRAME IS WEARING.
   *
   * The decision lives HERE, in the frame, and is read from the same pure
   * function the libretto module reads (`./lyrics.js`). Having the module
   * report its own emptiness upward would make the layout depend on a child's
   * render, which is the shape that flashes the wrong column for one frame on
   * every segment boundary.
   *
   * `lyricRegions.length` gates it first, so a definition that never authored a
   * lyric slot does not pay for a rail scan at 10 Hz.
   */
  const lyricState = useMemo(
    () => (enabled && lyricRegions.length > 0
      ? lyricStateAt({ segments: data?.segments, contentId, position })
      : { active: false }),
    [enabled, lyricRegions.length, data, contentId, position],
  );
  const lyricUp = lyricState.active;

  /**
   * DOES THIS FRAME SLIDE?
   *
   * Only a piece that can ever show words: the definition authors a lyric slot
   * AND the rail carries text somewhere. That gate matters, because sliding
   * means mounting BOTH rails at once — the programme rail cannot travel out
   * while it is being unmounted — and no instrumental work should pay for a
   * second rail it will never show.
   */
  const slides = enabled && lyricRegions.length > 0 && railHasText(data?.segments);

  /**
   * Which rail is in the tree. When the frame slides, BOTH are: one is on
   * screen and the other is parked just past the edge, and the swap is a move
   * rather than a mount. When it does not, exactly one is, exactly as before —
   * so every instrumental work renders the tree it always did.
   */
  const sideRegions = lyricUp ? lyricRegions : rightRegions;
  const sideSide = lyricUp ? 'right' : railSide;

  const rootClass = [
    'surround-frame',
    sideSide === 'left' && 'surround-frame--rail-left',
    lyricUp && 'surround-frame--lyric',
    slides && 'surround-frame--slides',
    !entered && 'surround-frame--entering',
    arriving && 'surround-frame--arriving',
    className,
  ].filter(Boolean).join(' ');

  // The measured media width, published as a custom property so the SCSS can
  // size the floating placard AGAINST the video (a plate pinned over a painting
  // is narrower than the painting) without a magic number in JS. The entrance's
  // durations ride alongside it, from `entrance.js`, so the stylesheet never
  // restates a number the choreography's JS also has to know; the shrink's three
  // measured numbers join them while the frame is still arriving.
  const rootStyle = enabled
    ? {
      ...entranceVars(),
      ...(mediaWidth ? { '--surround-media-w': `${mediaWidth}px` } : null),
      // The band's measured height, so the lyric rail's corner plate can be the
      // square level with it. Absent until the footer lays out; the stylesheet
      // carries a fallback rather than collapsing to zero in that first beat.
      ...(bandHeight > 0 ? { '--surround-band-h': `${Math.round(bandHeight)}px` } : null),
      // The ten-foot LABEL floor for this root, read by every module's
      // stylesheet through `var(--label-floor, …)`. One published measurement
      // beats five copies of `0.72rem`, exactly as `--bond-ground` beat three
      // copies of a hex.
      '--label-floor': `${labelFloor}px`,
      // The rail's width, as authored. The slide moves the main column by
      // exactly this and parks each rail exactly this far off its own edge, so
      // the three pieces travel as one and the geometry is stated once.
      '--rail-w': railWidth,
      ...(shrink ? {
        '--enter-media-scale': String(shrink.scale),
        '--enter-media-dx': `${shrink.dx}px`,
        '--enter-media-dy': `${shrink.dy}px`,
      } : null),
    }
    : NO_BOX;

  // EVERY element on the path down to `children` is rendered in both states, in
  // the same order, so React sees the player at one fixed position for the whole
  // session. Only the styling and the surrounding regions change.
  return (
    <div
      className={enabled ? rootClass : undefined}
      data-testid={enabled ? 'surround-frame' : undefined}
      ref={rootRef}
      style={rootStyle}
    >
      <div className={enabled ? 'surround-frame__main' : undefined} style={enabled ? undefined : NO_BOX}>
        {/* The placard is FLOATING: still the first child of the main column, but
            out of flow and centred on the video's top edge (see the SCSS). It
            carries no inline width any more — a museum plate is content-width,
            capped against the measured video by `--surround-media-w`. */}
        {enabled && topRegions.length > 0 && (
          <div className="surround-frame__header" data-testid="surround-header">
            {topRegions.map(renderRegion)}
          </div>
        )}
        <div className={enabled ? 'surround-frame__stage' : undefined} style={enabled ? undefined : NO_BOX}>
          {/* 16:9 lock lives inline so no outer cascade can stretch the video. */}
          <div
            className={enabled ? 'surround-frame__media' : undefined}
            data-testid={enabled ? 'surround-media' : undefined}
            ref={mediaRef}
            style={enabled
              ? { aspectRatio: '16 / 9', maxWidth: '100%', maxHeight: '100%' }
              : NO_BOX}
          >
            {children}
          </div>
        </div>

        {enabled && footerRegions.length > 0 && (
          <div
            className="surround-frame__footer"
            data-testid="surround-footer"
            ref={footerRef}
            style={mediaWidth ? { width: `${mediaWidth}px` } : undefined}
          >
            {visibleFooterRegions.map(renderRegion)}
          </div>
        )}
      </div>

      {/* THE SLIDING PAIR. Both rails are mounted and both are always in the
          tree; which one is on screen is a matter of where they are, not of
          whether they exist. The programme rail is parked one rail-width off
          the left edge while the lyric rail holds the column, and the reverse
          when the words stop — and the main column travels between them, so
          the video reads as running on rails rather than jumping. Nothing
          resizes mid-flight: the video's box is identical in both states, so
          this is a translation and not a reflow. */}
      {enabled && slides && (
        <>
          <aside
            className="surround-frame__rail surround-frame__rail--programme"
            data-testid="surround-rail"
            data-rail="programme"
            aria-hidden={lyricUp ? 'true' : undefined}
            style={{ width: railWidth }}
          >
            {rightRegions.map(renderRegion)}
          </aside>
          <aside
            className="surround-frame__rail surround-frame__rail--lyric"
            data-testid="surround-lyric-rail"
            data-rail="lyric"
            aria-hidden={lyricUp ? undefined : 'true'}
            style={{ width: railWidth }}
          >
            {lyricRegions.map(renderRegion)}
          </aside>
        </>
      )}
      {enabled && !slides && sideRegions.length > 0 && (
        <aside
          className="surround-frame__rail"
          data-testid={lyricUp ? 'surround-lyric-rail' : 'surround-rail'}
          data-rail={lyricUp ? 'lyric' : 'programme'}
          style={{ width: railWidth, flex: `0 0 ${railWidth}` }}
        >
          {sideRegions.map(renderRegion)}
        </aside>
      )}
    </div>
  );
}

SurroundFrame.propTypes = {
  /** Resolved surround payload: { id, definition, piece, segments, cues, facts, composer, assetBase }. */
  data: PropTypes.object,
  /** False renders the no-box shell around `children` and no regions at all. */
  active: PropTypes.bool,
  /** Content id of the item being played — correlates every surround log event. */
  contentId: PropTypes.string,
  position: PropTypes.number,
  duration: PropTypes.number,
  playing: PropTypes.bool,
  seeking: PropTypes.bool,
  /** Host logger (carries sessionLog). Falls back to a module-level child. */
  logger: PropTypes.object,
  className: PropTypes.string,
  /** Called when a module throws, so the host can log it as `surround-host`. */
  onModuleError: PropTypes.func,
  /** The player. Rendered inside the aspect-locked media box. */
  children: PropTypes.node,
};

export { SurroundModuleBoundary };
