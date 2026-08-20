import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import * as sass from 'sass-embedded';
import SurroundFrame from './SurroundFrame.jsx';
import {
  ENTER_MS, ENTER_MEDIA_MS, ENTER_DELAY, ENTER_TOTAL_MS, ENTER_UNCLIP_MS, shrinkFrom,
} from './entrance.js';
import { registerSurroundModule, resetSurroundRegistry } from './registry.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Controllable ResizeObserver. happy-dom ships one, but it never fires, so the
 * collapse rule and the footer's width tracking would both be untestable.
 */
let observers = [];
class FakeResizeObserver {
  constructor(callback) {
    this.callback = callback;
    this.targets = [];
    observers.push(this);
  }
  observe(el) { this.targets.push(el); }
  unobserve(el) { this.targets = this.targets.filter((t) => t !== el); }
  disconnect() { this.targets = []; }
}

const makeLogger = () => ({
  debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn(),
});

const SegmentStub = ({ position, data, region }) => (
  <div data-testid="segment-stub" data-position={position} data-height={region?.height}>
    {(data?.pieceSegments ?? []).length} segments
  </div>
);
const TickerStub = () => <div data-testid="ticker-stub">ticker</div>;
const CardStub = ({ data }) => <div data-testid="card-stub">{data?.composer?.name ?? ''}</div>;

const DEFINITION = {
  id: 'concert-hall',
  regions: {
    right: { width: '20%', module: 'composer-card' },
    bottom: [
      { module: 'segment-map', height: 60 },
      { module: 'cue-ticker', height: 156, collapse: 'first' },
    ],
  },
  collapse: { footerFloor: 90 },
};

const DATA = {
  id: 'concert-hall',
  definition: DEFINITION,
  piece: { title: 'Symphony No. 3' },
  pieceSegments: [{ n: 1, name: 'Allegro con brio', start: 0 }],
  cues: [],
  facts: ['A fact.'],
  composer: { name: 'Ludwig van Beethoven' },
  assetBase: 'surround/classical',
};

const renderFrame = (props = {}) => render(
  <SurroundFrame
    data={DATA}
    contentId="plex:663134"
    position={0}
    duration={3223}
    playing
    seeking={false}
    logger={props.logger ?? makeLogger()}
    {...props}
  >
    <video data-testid="the-player" />
  </SurroundFrame>,
);

/** Deliver a ResizeObserver entry through the frame's observer. */
const resize = (target, rect) => act(() => {
  observers.forEach((o) => {
    if (o.targets.includes(target)) o.callback([{ target, contentRect: rect }], o);
  });
});

describe('SurroundFrame', () => {
  beforeEach(() => {
    observers = [];
    globalThis.ResizeObserver = FakeResizeObserver;
    resetSurroundRegistry();
    registerSurroundModule('segment-map', SegmentStub);
    registerSurroundModule('cue-ticker', TickerStub);
    registerSurroundModule('composer-card', CardStub);
  });
  afterEach(() => {
    resetSurroundRegistry();
    observers = [];
  });

  it('renders every declared region through the registry', () => {
    const { getByTestId } = renderFrame();
    expect(getByTestId('segment-stub')).toBeInTheDocument();
    expect(getByTestId('ticker-stub')).toBeInTheDocument();
    expect(getByTestId('card-stub')).toHaveTextContent('Ludwig van Beethoven');
  });

  it('passes the clock and the region definition down to each module', () => {
    const { getByTestId } = renderFrame({ position: 976 });
    const stub = getByTestId('segment-stub');
    expect(stub.getAttribute('data-position')).toBe('976');
    expect(stub.getAttribute('data-height')).toBe('60');
  });

  it('renders a top region as a floating plate, not as a width-pinned band', () => {
    const definition = { regions: { top: { module: 'segment-map' }, right: { module: 'composer-card' } } };
    const { container, getByTestId } = renderFrame({ data: { ...DATA, definition } });
    const main = container.querySelector('.surround-frame__main');
    const header = main.querySelector('.surround-frame__header');
    expect(header).toBeTruthy();
    // First child of main: placard above the stage, never between stage and footer.
    expect(main.firstElementChild).toBe(header);
    expect(header.querySelector('.surround-frame__region--top')).toBeTruthy();

    // Design wave 2: the plate is content-width. It no longer carries the
    // measured media width as an inline WIDTH — that is what made it a band.
    resize(getByTestId('surround-media'), { width: 800, height: 450 });
    expect(header.style.width).toBe('');
  });

  it('publishes the measured media width for the placard to size against', () => {
    const { getByTestId } = renderFrame();
    resize(getByTestId('surround-media'), { width: 800, height: 450 });
    expect(getByTestId('surround-frame').style.getPropertyValue('--surround-media-w')).toBe('800px');
  });

  it('renders no header element at all when the definition has no top region', () => {
    const definition = { regions: { right: { module: 'composer-card' } } };
    const { container } = renderFrame({ data: { ...DATA, definition } });
    expect(container.querySelector('.surround-frame__header')).toBeNull();
  });

  it('gives modules a data payload carrying the contentId for log correlation', () => {
    const Spy = vi.fn(() => null);
    registerSurroundModule('segment-map', Spy);
    renderFrame();
    expect(Spy.mock.calls[0][0].data.contentId).toBe('plex:663134');
    expect(Spy.mock.calls[0][0].data.piece.title).toBe('Symphony No. 3');
  });

  it('leaves an empty region and warns when a module name is unknown', () => {
    const logger = makeLogger();
    const definition = {
      ...DEFINITION,
      regions: { ...DEFINITION.regions, bottom: [{ module: 'does-not-exist', height: 60 }] },
    };
    const { container } = renderFrame({ data: { ...DATA, definition }, logger });
    const region = container.querySelector('[data-module="does-not-exist"]');
    expect(region).not.toBeNull();
    expect(region.childElementCount).toBe(0);
    const warned = logger.warn.mock.calls.find((c) => c[0] === 'surround.module.missing');
    expect(warned).toBeDefined();
    expect(warned[1]).toMatchObject({ module: 'does-not-exist', contentId: 'plex:663134' });
  });

  it('does not warn when every module resolves', () => {
    const logger = makeLogger();
    renderFrame({ logger });
    expect(logger.warn.mock.calls.filter((c) => c[0] === 'surround.module.missing')).toHaveLength(0);
  });

  it('locks the media box to 16:9 and letterboxes rather than distorting', () => {
    const { getByTestId } = renderFrame();
    const media = getByTestId('surround-media');
    expect(media.style.aspectRatio).toBe('16 / 9');
    expect(media.style.maxWidth).toBe('100%');
    expect(media.style.maxHeight).toBe('100%');
    // The player lives inside the locked box, not beside it.
    expect(media.contains(getByTestId('the-player'))).toBe(true);
  });

  it('sizes the footer to exactly the measured media-box width', () => {
    const { getByTestId } = renderFrame();
    resize(getByTestId('surround-media'), { width: 800, height: 450 });
    expect(getByTestId('surround-footer').style.width).toBe('800px');
  });

  it('takes the rail width from the definition', () => {
    const { getByTestId } = renderFrame();
    expect(getByTestId('surround-rail').style.width).toBe('20%');
  });

  it('takes the rail width from the first entry when the right region is a list', () => {
    const definition = {
      ...DEFINITION,
      regions: {
        ...DEFINITION.regions,
        right: [{ module: 'composer-card', width: '33%' }, { module: 'composer-card' }],
      },
    };
    const { getByTestId } = renderFrame({ data: { ...DATA, definition } });
    expect(getByTestId('surround-rail').style.width).toBe('33%');
  });

  it('defaults the rail width to 20% when the definition omits it', () => {
    const definition = { ...DEFINITION, regions: { ...DEFINITION.regions, right: { module: 'composer-card' } } };
    const { getByTestId } = renderFrame({ data: { ...DATA, definition } });
    expect(getByTestId('surround-rail').style.width).toBe('20%');
  });

  it('flips the rail to the left when the definition says so (single-object shape)', () => {
    const definition = {
      ...DEFINITION,
      regions: { ...DEFINITION.regions, right: { module: 'composer-card', side: 'left' } },
    };
    const { getByTestId } = renderFrame({ data: { ...DATA, definition } });
    expect(getByTestId('surround-frame').className).toContain('surround-frame--rail-left');
  });

  it('flips the rail to the left from the first entry when the right region is a list', () => {
    const definition = {
      ...DEFINITION,
      regions: {
        ...DEFINITION.regions,
        right: [{ module: 'composer-card', side: 'left' }, { module: 'composer-card' }],
      },
    };
    const { getByTestId } = renderFrame({ data: { ...DATA, definition } });
    expect(getByTestId('surround-frame').className).toContain('surround-frame--rail-left');
  });

  it('does not add the left-rail modifier when the definition omits side (right stays default)', () => {
    const { getByTestId } = renderFrame();
    expect(getByTestId('surround-frame').className).not.toContain('surround-frame--rail-left');
  });

  it('never leaks the rail-side modifier onto the inactive boxless shell', () => {
    const definition = {
      ...DEFINITION,
      regions: { ...DEFINITION.regions, right: { module: 'composer-card', side: 'left' } },
    };
    const { container } = renderFrame({ data: { ...DATA, definition }, active: false });
    const root = container.firstElementChild;
    expect(root.className).toBe('');
    expect(root.className).not.toContain('surround-frame--rail-left');
  });

  // -------------------------------------------------------------------------
  // Design wave 2 — band sizing. The footer absorbs the column's slack, so the
  // regions inside it are sized by intent rather than by a fixed pixel height.
  // -------------------------------------------------------------------------

  it('lets a `height: fill` region claim the band’s slack', () => {
    const definition = {
      ...DEFINITION,
      regions: {
        ...DEFINITION.regions,
        bottom: [
          { module: 'segment-map', height: 64 },
          { module: 'cue-ticker', height: 'fill', collapse: 'first' },
        ],
      },
    };
    const { container } = renderFrame({ data: { ...DATA, definition } });
    const ticker = container.querySelector('[data-module="cue-ticker"]');
    expect(ticker.style.flex).toBe('1 1 auto');
    // "fill" is not a length: it must never reach the DOM as one.
    expect(ticker.style.height).toBe('');
  });

  it('treats a bottom region’s declared height as a FLOOR, so two-line names fit', () => {
    const { container } = renderFrame();
    const band = container.querySelector('[data-module="segment-map"]');
    expect(band.style.minHeight).toBe('60px');
    expect(band.style.flex).toBe('0 0 auto');
    // A fixed height would clip the second line of a wrapped segment name.
    expect(band.style.height).toBe('');
  });

  it('still sizes a rail region exactly — a floor there would swallow the rail', () => {
    const definition = {
      ...DEFINITION,
      regions: {
        ...DEFINITION.regions,
        right: [{ module: 'composer-card', width: '33%' }, { module: 'segment-map', height: 230 }],
      },
    };
    const { container } = renderFrame({ data: { ...DATA, definition } });
    const map = container.querySelector('.surround-frame__rail [data-module="segment-map"]');
    expect(map.style.height).toBe('230px');
    expect(map.style.flex).toBe('0 0 230px');
  });

  // -------------------------------------------------------------------------
  // Design wave 2 — the entrance.
  // -------------------------------------------------------------------------

  it('holds the chrome off-position for the first frame, then lets it arrive', async () => {
    const { getByTestId } = renderFrame();
    expect(getByTestId('surround-frame').className).toContain('surround-frame--entering');

    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    expect(getByTestId('surround-frame').className).not.toContain('surround-frame--entering');
  });

  it('never leaks the entrance class onto the inactive boxless shell', () => {
    const { container } = renderFrame({ active: false });
    const root = container.firstElementChild;
    expect(root.className).toBe('');
    expect(root.className).not.toContain('surround-frame--entering');
    expect(root.className).not.toContain('surround-frame--arriving');
  });

  /**
   * Design wave 5 — the stage un-clips for the whole gesture, and only for it.
   *
   * The video shrinks from the size of the WHOLE FRAME into its box, so for the
   * length of the shrink it is bigger than the stage that holds it — and the
   * stage clips. `--arriving` releases that clip. It is a class flip, not a
   * transition, so its window has to OUTLAST every transition: one landing
   * mid-move would guillotine the picture. It also has to end, or a later
   * overflow (a mis-sized module) would silently paint over the band.
   */
  it('un-clips the stage for the whole shrink, and puts the clip back after it', async () => {
    const { getByTestId } = renderFrame();
    expect(getByTestId('surround-frame').className).toContain('surround-frame--arriving');
    expect(ENTER_UNCLIP_MS).toBeGreaterThan(ENTER_TOTAL_MS);

    await act(async () => { await new Promise((r) => setTimeout(r, ENTER_TOTAL_MS)); });
    expect(
      getByTestId('surround-frame').className,
      'the stage re-clipped while the video was still shrinking',
    ).toContain('surround-frame--arriving');

    await act(async () => { await new Promise((r) => setTimeout(r, ENTER_UNCLIP_MS)); });
    expect(getByTestId('surround-frame').className).not.toContain('surround-frame--arriving');
  });

  /**
   * The stylesheet reads its durations from the component, not from its own
   * literals — `entrance.js` is the one file that knows how long the enrichment
   * moment takes, because the rAF safety net and the un-clip window need the
   * same answer as the transitions do.
   */
  it('publishes the entrance timings the stylesheet animates on', () => {
    const { getByTestId } = renderFrame();
    const root = getByTestId('surround-frame');
    expect(root.style.getPropertyValue('--enter-ms')).toBe(`${ENTER_MS}ms`);
    expect(root.style.getPropertyValue('--enter-media-ms')).toBe(`${ENTER_MEDIA_MS}ms`);
    expect(root.style.getPropertyValue('--enter-delay-header')).toBe(`${ENTER_DELAY.header}ms`);
    // The last thing to stop is what "the entrance is over" means.
    expect(ENTER_TOTAL_MS).toBe(Math.max(
      ENTER_DELAY.media + ENTER_MEDIA_MS,
      ENTER_DELAY.rail + ENTER_MS,
      ENTER_DELAY.footer + ENTER_MS,
      ENTER_DELAY.header + ENTER_MS,
    ));
    // ...and the whole gesture stays inside the 450-650ms the design asks for.
    expect(ENTER_TOTAL_MS).toBeGreaterThanOrEqual(450);
    expect(ENTER_TOTAL_MS).toBeLessThanOrEqual(650);
  });

  it('keeps the player mounted across the entrance — the video never re-parents', async () => {
    const { getByTestId } = renderFrame();
    const player = getByTestId('the-player');
    const media = getByTestId('surround-media');
    await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
    // Same node, same parent: an entrance that remounted this would reload the video.
    expect(getByTestId('the-player')).toBe(player);
    expect(player.parentElement).toBe(media);
  });

  it('drops the collapse:first region when the footer falls below the floor', () => {
    const logger = makeLogger();
    const { getByTestId, queryByTestId } = renderFrame({ logger });
    expect(queryByTestId('ticker-stub')).not.toBeNull();

    resize(getByTestId('surround-footer'), { width: 800, height: 40 });

    expect(queryByTestId('ticker-stub')).toBeNull();
    expect(queryByTestId('segment-stub')).not.toBeNull();
    const collapsed = logger.debug.mock.calls.find((c) => c[0] === 'surround.collapse');
    expect(collapsed).toBeDefined();
    expect(collapsed[1]).toMatchObject({ collapsed: true, floor: 90, contentId: 'plex:663134' });
  });

  it('keeps the collapse:first region while the footer is at or above the floor', () => {
    const { getByTestId, queryByTestId } = renderFrame();
    resize(getByTestId('surround-footer'), { width: 800, height: 216 });
    expect(queryByTestId('ticker-stub')).not.toBeNull();
  });

  it('restores the collapse:first region when the footer grows back', () => {
    const { getByTestId, queryByTestId } = renderFrame();
    resize(getByTestId('surround-footer'), { width: 800, height: 40 });
    expect(queryByTestId('ticker-stub')).toBeNull();
    resize(getByTestId('surround-footer'), { width: 800, height: 216 });
    expect(queryByTestId('ticker-stub')).not.toBeNull();
  });

  it('uses the default 90px floor when the definition omits collapse', () => {
    const definition = { ...DEFINITION, collapse: undefined };
    const { getByTestId, queryByTestId } = renderFrame({ data: { ...DATA, definition } });
    resize(getByTestId('surround-footer'), { width: 800, height: 89 });
    expect(queryByTestId('ticker-stub')).toBeNull();
  });

  it('still renders a composed frame when the payload has no segments or facts', () => {
    const bare = { ...DATA, pieceSegments: undefined, facts: undefined, cues: undefined };
    const { getByTestId } = renderFrame({ data: bare });
    expect(getByTestId('surround-frame')).toBeInTheDocument();
    expect(getByTestId('surround-rail')).toBeInTheDocument();
    expect(getByTestId('surround-footer')).toBeInTheDocument();
    expect(getByTestId('segment-stub')).toHaveTextContent('0 segments');
    expect(getByTestId('the-player')).toBeInTheDocument();
  });

  it('renders the player even when the definition declares no regions at all', () => {
    const definition = { id: 'bare', regions: {} };
    const { getByTestId, queryByTestId } = renderFrame({ data: { ...DATA, definition } });
    expect(getByTestId('surround-frame')).toBeInTheDocument();
    expect(getByTestId('the-player')).toBeInTheDocument();
    expect(queryByTestId('surround-rail')).toBeNull();
    expect(queryByTestId('surround-footer')).toBeNull();
  });

  // The frame used to render an inert `z-50` overlay layer for a phase-two
  // pop-up cue that was never built. It is gone: a layer over the whole player
  // that renders nothing is a thing to trip over, not a foundation.
  it('renders no overlay layer over the player', () => {
    const { queryByTestId } = renderFrame();
    expect(queryByTestId('surround-overlay')).toBeNull();
  });

  it('never throws when the surround payload is missing entirely', () => {
    expect(() => render(
      <SurroundFrame data={null} contentId={null} position={0} duration={0} playing={false} seeking={false}>
        <video data-testid="bare-player" />
      </SurroundFrame>,
    )).not.toThrow();
  });

  it('disconnects its observer on unmount', () => {
    const { unmount, getByTestId } = renderFrame();
    const media = getByTestId('surround-media');
    expect(observers.some((o) => o.targets.includes(media))).toBe(true);
    unmount();
    expect(observers.every((o) => o.targets.length === 0)).toBe(true);
  });
});

/**
 * The recomposition of design wave 2 is almost entirely geometry expressed in
 * CSS, and vitest runs with `css: false` — so the component's own SCSS import
 * injects nothing and a computed-style assertion off a plain render would read
 * UA defaults and pass whatever the shipped file says. These specs compile the
 * REAL SurroundFrame.scss with the project's sass and inject it first (the
 * pattern ComposerCard.test.jsx established).
 *
 * The runtime gate measures the same contract against a real browser with a real
 * video in it; this is the cheap half that fails in a second rather than in a
 * deploy.
 */
describe('SurroundFrame — the shipped composition', () => {
  let injected = null;
  const withStyles = () => {
    const compiled = sass.compile(path.join(__dirname, 'SurroundFrame.scss'));
    injected = document.createElement('style');
    injected.textContent = compiled.css;
    document.head.appendChild(injected);
    return compiled.css;
  };

  beforeEach(() => {
    observers = [];
    globalThis.ResizeObserver = FakeResizeObserver;
    resetSurroundRegistry();
    registerSurroundModule('segment-map', SegmentStub);
    registerSurroundModule('cue-ticker', TickerStub);
    registerSurroundModule('composer-card', CardStub);
    registerSurroundModule('work-placard', () => <div data-testid="placard-stub">plate</div>);
  });
  afterEach(() => {
    injected?.remove();
    injected = null;
    resetSurroundRegistry();
    observers = [];
  });

  const WITH_TOP = {
    ...DATA,
    definition: { ...DEFINITION, regions: { ...DEFINITION.regions, top: { module: 'work-placard' } } },
  };

  it('floats the placard out of flow, centred on the video’s top edge', () => {
    withStyles();
    const { container } = renderFrame({ data: WITH_TOP });
    const style = window.getComputedStyle(container.querySelector('.surround-frame__header'));
    expect(style.getPropertyValue('position')).toBe('absolute');
    expect(style.getPropertyValue('left')).toBe('50%');
    // translate(-50%, -50%) is what straddles the edge whatever the plate's height.
    expect(style.getPropertyValue('transform')).toContain('-50%');
    // Above the video, below the overlay slot.
    expect(parseInt(style.getPropertyValue('z-index'), 10)).toBeGreaterThan(0);
  });

  it('caps the plate narrower than the video it sits on', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rule = css.match(/\.surround-frame__header \{[^}]*\}/);
    expect(rule).not.toBeNull();
    const cap = rule[0].match(/max-width: calc\(var\(--surround-media-w, 100%\) \* ([\d.]+)\)/);
    expect(cap, 'the plate is not capped against the measured media width').not.toBeNull();
    expect(parseFloat(cap[1])).toBeLessThan(1);       // narrower than the painting
    expect(rule[0]).toContain('width: max-content');  // ...and content-width within that
  });

  it('casts a shadow off the plate so it reads as sitting on the video', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    expect(css).toMatch(/\.surround-frame__header \{[^}]*box-shadow:[^}]*\}/);
  });

  // The plate straddles the video's top edge, so its box sits on top of real
  // video pixels — without this, a tap in the top-centre of the picture would
  // die on an inert nameplate instead of reaching the player. Same shape as
  // `__overlay`'s pointer-events contract, asserted the same way §2 already
  // asserts it for the footer's join gradient.
  it('lets taps pass through the plate to the video underneath', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rule = css.match(/\.surround-frame__header \{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule[0]).toContain('pointer-events: none');
  });

  // The stage must NOT shrink. `flex: 0` on both axes is the last thing standing
  // between the band and the 16:9 lock: the media box is `width: 100%` +
  // `aspect-ratio` + `max-height: 100%`, and the moment the column overflows,
  // `max-height` clamps the box's height while nothing pulls its width down with
  // it — the picture stretches. With a shrink factor of 1 the band could cause
  // that overflow and did: a 960x540 living-room screen-root measured a 643x349
  // media box (ratio 1.845) in the runtime gate. The band shrinks instead, and
  // collapses past `collapse.footerFloor` if it has to. Only the runtime gate can
  // measure the distortion; this pins the declaration that prevents it.
  it('anchors the video to the top and leaves the slack to the band', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const stage = css.match(/\.surround-frame__stage \{[^}]*\}/)[0];
    expect(stage).toContain('align-items: flex-start');
    expect(stage).toMatch(/flex: 0 0 auto/);
    expect(stage).toMatch(/padding-top: var\(--placard-inset/);

    const footer = css.match(/\.surround-frame__footer \{[^}]*\}/)[0];
    expect(footer).toMatch(/flex: 1 1 auto/);
  });

  // Read the declaration rather than the computed value: happy-dom does not
  // resolve `calc()` over a custom property, and a NaN comparison would pass for
  // the wrong reason.
  it('rides the band up over the video’s last pixels — a negative margin, not a reflow', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const footer = css.match(/\.surround-frame__footer \{[^}]*\}/)[0];
    expect(footer).toContain('margin-top: calc(var(--band-overlap) * -1)');

    const token = css.match(/--band-overlap: ([\d.]+)px/);
    expect(token, 'the overlap has no token').not.toBeNull();
    expect(parseFloat(token[1])).toBeGreaterThan(0);
    expect(parseFloat(token[1])).toBeLessThanOrEqual(16);   // the gate's tolerance

    // The media box itself is untouched: the 16:9 lock is not negotiable, and
    // the overlap is a footer margin — nothing about the media geometry moves.
    const { getByTestId } = renderFrame();
    expect(getByTestId('surround-media').style.aspectRatio).toBe('16 / 9');
    const mediaRule = css.match(/\.surround-frame__media \{[^}]*\}/)[0];
    expect(mediaRule).not.toContain('margin');
    expect(mediaRule).toMatch(/aspect-ratio: 16\s*\/\s*9/);   // sass prints it unspaced
  });

  it('joins band to video with a gradient rather than a hard edge', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const join = css.match(/\.surround-frame__footer::before \{[^}]*\}/);
    expect(join, 'no join gradient above the band').not.toBeNull();
    expect(join[0]).toContain('linear-gradient');
    expect(join[0]).toContain('bottom: 100%');          // paints ABOVE the band
    expect(join[0]).toContain('pointer-events: none');
  });

  it('takes the rail dark, in the same house material as the band', () => {
    withStyles();
    const { container } = renderFrame();
    const rail = container.querySelector('.surround-frame__region--right');
    const style = window.getComputedStyle(rail);
    // Parchment ink, exactly as the bottom band re-maps it.
    expect(style.getPropertyValue('--ink').trim()).toBe('#e9dfc8');
    expect(style.getPropertyValue('--ink-soft').trim()).toBe('#a89a80');
    // ...and a maroon ground, not paper.
    expect(style.getPropertyValue('background-color').trim().toLowerCase()).not.toBe('#efe6d2');
  });

  // happy-dom's getComputedStyle does not inherit custom properties from an
  // ancestor, so the honest assertion is about the rule: the rail re-maps the
  // INK tokens and deliberately leaves `--programme` to cascade from the frame.
  // That is what keeps the portrait plate and the city figure on real paper.
  it('leaves --programme alone so the rail’s mats stay paper', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rail = css.match(/\.surround-frame__region--right \{[^}]*\}/)[0];
    expect(rail).toContain('--ink:');
    expect(rail).not.toMatch(/--programme:\s/);
    expect(css).toMatch(/\.surround-frame \{[^}]*--programme: #efe6d2/);
  });

  /**
   * Design wave 4 — the frame publishes a MAT, and it is dark. Every picture in
   * the frame (the portrait, the city photograph, the two map plates) reads
   * these two tokens, so the "no white borders" decision lives in exactly one
   * place. `--programme` survives beside it and is a different thing: the
   * programme STOCK the panels are printed on, never a border round a picture.
   */
  it('publishes one dark mat for every picture in the frame', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const root = css.match(/\.surround-frame \{[^}]*\}/)[0];
    const mat = root.match(/--mat: (#[0-9a-f]{6})/i);
    expect(mat, 'the frame declares no --mat').not.toBeNull();
    expect(root).toMatch(/--mat-edge: /);
    // Near-black, not paper: every channel well below the parchment it replaces.
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(mat[1].slice(i, i + 2), 16));
    expect(Math.max(r, g, b), `--mat is ${mat[1]} — that is not a dark mat`).toBeLessThan(0x50);
    // ...and it is a token of its own, not an alias of the programme stock.
    expect(root).toMatch(/--programme: #efe6d2/);
  });

  it('keeps the paper fibre on the dark rail so the stock keeps its tooth', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rail = css.match(/\.surround-frame__region--right \{[^}]*\}/)[0];
    expect(rail).toContain('var(--programme-fibre)');
    expect(rail).toContain('multiply');
  });

  it('staggers the entrance video+rail → band → placard, on one easing', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    expect(css).toMatch(/\.surround-frame--entering \.surround-frame__rail \{[^}]*opacity: 0/);
    expect(css).toMatch(/\.surround-frame--entering \.surround-frame__footer \{[^}]*translateY/);
    expect(css).toMatch(/\.surround-frame--entering \.surround-frame__header \{[^}]*translate\(-50%/);
    expect(css).toMatch(/\.surround-frame--entering \.surround-frame__media \{[^}]*scale\(/);

    // The delays come from `entrance.js`; the stylesheet's job is only to put
    // them in the right ORDER, which is what these fallbacks encode.
    const delay = (el) => {
      const m = css.match(new RegExp(`\\.surround-frame__${el} \\{ transition-delay: var\\(--enter-delay-${el === 'media' ? 'media' : el}, (\\d+)ms\\)`));
      expect(m, `no published transition-delay for __${el}`).not.toBeNull();
      return Number(m[1]);
    };
    expect(delay('header')).toBeGreaterThan(delay('footer'));   // plate last
    expect(delay('footer')).toBeGreaterThan(delay('media'));    // band after the picture
    expect(delay('media')).toBe(delay('rail'));                 // one beat, two moves
  });

  /**
   * Design wave 5 — THE ENRICHMENT MOMENT, and the law it has to keep.
   *
   * The video visibly shrinks from the whole frame into its box. 16:9 is the
   * quality floor of the feature and it binds at every FRAME of that animation,
   * not just at its ends — so the shrink has to be a single UNIFORM `scale()`,
   * which multiplies both axes by the same number and therefore cannot leave
   * the ratio even in principle. `scaleX`/`scaleY`, or an animation of `width`
   * and `height`, would each ask the browser to hold a ratio it never promised.
   */
  it('shrinks the video on one uniform scale — never on two axes, never on a box size', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rule = css.match(/\.surround-frame--entering \.surround-frame__media \{[^}]*\}/);
    expect(rule, 'the video does not shrink at all').not.toBeNull();
    expect(rule[0]).toMatch(/scale\(var\(--enter-media-scale/);
    expect(rule[0], 'the shrink is per-axis — 16:9 is not guaranteed mid-animation').not.toMatch(/scaleX|scaleY|scale3d/);
    expect(rule[0], 'the shrink animates the BOX, which relayouts a playing video').not.toMatch(/(^|[^-])(width|height):/);

    // ...and it is the transform that is transitioned, on the media box itself.
    const base = css.match(/\.surround-frame__media \{[^}]*transition:[^}]*\}/);
    expect(base, 'the media box has no transition to shrink on').not.toBeNull();
    expect(base[0]).toMatch(/transition: transform var\(--enter-media-ms/);
  });

  it('lets the over-sized video out of the stage while, and only while, it is arriving', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    expect(css).toMatch(/\.surround-frame--arriving \.surround-frame__stage \{ overflow: visible/);
    // The steady state still clips: an un-clipped stage would let any later
    // overflow paint over the band.
    expect(css).toMatch(/\.surround-frame__stage \{[^}]*overflow: hidden/);
  });

  /**
   * Design wave 5 — the plate is hung two thirds on the hall, a third on the
   * picture. Half and half cut too deep into the video. One token carries it, so
   * the base straddle and the entrance's settle cannot drift apart.
   */
  it('hangs the plate a third over the picture, from one token', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const declared = css.match(/--placard-straddle: (-[\d.]+)%/);
    expect(declared, 'no --placard-straddle token').not.toBeNull();
    const overlapPct = 100 + Number(declared[1]);        // -66.67% -> 33.33% below the edge
    expect(overlapPct, 'the plate cuts too deep into the video').toBeLessThan(45);
    expect(overlapPct, 'the plate barely touches the video — it is not straddling').toBeGreaterThan(20);
    // Both the resting transform and the entrance's settle read the token.
    expect(css).toMatch(/\.surround-frame__header \{[^}]*transform: translate\(-50%, var\(--placard-straddle\)\)/);
    expect(css).toMatch(/\.surround-frame--entering \.surround-frame__header \{[^}]*calc\(var\(--placard-straddle\) - 12px\)/);
  });

  /**
   * Design wave 5 — THE HALL WEARS VELVET. The stage's slack (the strip above
   * the video the plate hangs on, and the letterbox slack beside it) is a drape,
   * not flat black. ArtMode's curtain recipe, taken down: the fold stripes and
   * the burgundy ramp, no animation, no second colour system.
   */
  it('drapes the stage in velvet without touching any other ground', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const stage = css.match(/\.surround-frame__stage \{[^}]*\}/);
    expect(stage, 'no stage rule').not.toBeNull();
    expect(stage[0], 'the stage has no fold stripes — it is a flat panel, not a drape')
      .toContain('repeating-linear-gradient');
    expect(stage[0], 'the drape does not read the house velvet').toContain('var(--velvet');
    expect(stage[0], 'the drape animates — it is scenery, not a curtain call').not.toContain('transition');

    // The picture keeps its own black, so nothing shows through the video.
    const media = css.match(/\.surround-frame__media \{[^}]*\}/);
    expect(media[0]).toContain('background: #000');
  });

  /**
   * Fix round 1 (review finding, CRITICAL, user-reported). Nothing between the
   * Player's own `.loading-overlay` (z-40) and the page root created a stacking
   * context, so it escaped `.surround-frame__media` and painted over
   * `.surround-frame__header` (z-30) — the placard's lower third disappeared
   * behind the pause/loading scrim. `isolation: isolate` seals the media box:
   * every z-index the Player publishes inside it (the loading overlay, the
   * filter overlay at z-55, the debug strip at z-60) now resolves against each
   * other INSIDE this box and can never out-rank a sibling of it.
   */
  it('seals the media box so the Player’s own overlays cannot paint over the frame’s chrome', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const media = css.match(/\.surround-frame__media \{[^}]*\}/)[0];
    expect(media, 'the media box creates no stacking context — a Player overlay can escape it')
      .toContain('isolation: isolate');
  });

  /**
   * Fix round 1 (review finding, IMPORTANT). The entering media box is
   * transformed, which paints it at the implicit `z-index: 0` — the same level
   * as the unpositioned, in-flow rail — and DOM order puts the media box after
   * the rail, so for the ~200ms the video is still oversized mid-entrance it
   * paints OVER the rail rather than beside it. The rail needs its own stacking
   * context and a z-index above that implicit 0 to stay on top of the arriving
   * picture; harmless at rest, since the rail and the settled media box never
   * overlap once the entrance ends.
   */
  it('keeps the rail above the arriving (scaled-up) video during the entrance', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rail = css.match(/\.surround-frame__rail \{[^}]*\}/)[0];
    expect(rail).toContain('position: relative');
    expect(parseInt(rail.match(/z-index: (\d+)/)?.[1] ?? '0', 10)).toBeGreaterThan(0);
  });

  it('slides the rail in from whichever side it is on', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    expect(css).toMatch(/\.surround-frame--entering \.surround-frame__rail \{[^}]*translateX\(14%\)/);
    expect(css).toMatch(/\.surround-frame--entering\.surround-frame--rail-left \.surround-frame__rail \{[^}]*translateX\(-14%\)/);
  });

  /**
   * Wave 2 asserted "never animates the stage or the media box" — wave 5
   * deliberately reverses half of that: the VIDEO is now the loudest thing in
   * the entrance. What survives, and is the part that was ever load-bearing, is
   * that the STAGE does not move: it is the letterbox the media box is measured
   * inside, and animating it would move the box the 16:9 lock is resolved
   * against.
   */
  it('never animates the stage — only the picture inside it', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const entering = css.match(/\.surround-frame--entering[^{]*\{[^}]*\}/g) ?? [];
    expect(entering.length).toBeGreaterThan(0);
    entering.forEach((rule) => {
      expect(rule).not.toContain('__stage');
    });
    expect(css, 'the stage has grown a transition').not.toMatch(/\.surround-frame__stage \{[^}]*transition:/);
  });

  it('reduces the entrance to light alone under prefers-reduced-motion', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain('transform: none');
    // The placard keeps its straddle — "no transform" there would drop it off the edge.
    expect(block).toMatch(/\.surround-frame--entering \.surround-frame__header \{ transform: translate\(-50%, var\(--placard-straddle\)\)/);
    // Design wave 5: the video does not shrink either — it is simply in its box
    // from the first painted frame, which is what "no size animation" means for
    // the one element whose size the entrance otherwise animates.
    expect(block).toMatch(/\.surround-frame__media \{ transition: none/);
    expect(block).toMatch(/\.surround-frame--entering \.surround-frame__media/);
  });

  /**
   * `shrinkFrom` is the whole geometry of the entrance, and it is a pure
   * function precisely so it can be checked without a layout engine (happy-dom
   * measures every box as 0x0).
   */
  describe('shrinkFrom — the pre-shrink transform', () => {
    const frame = { x: 0, y: 0, width: 960, height: 540 };

    it('scales the box up to CONTAIN it in the frame, and centres it', () => {
      // A 16:9 media box inside a 16:9 frame: contain is the width ratio.
      const media = { x: 316, y: 67, width: 643, height: 362 };
      const s = shrinkFrom(frame, media);
      expect(s.scale).toBeCloseTo(Math.min(960 / 643, 540 / 362), 3);
      expect(s.dx).toBe(Math.round(480 - (316 + 643 / 2)));
      expect(s.dy).toBe(Math.round(270 - (67 + 362 / 2)));
    });

    it('takes the SMALLER ratio, so the pre-state never overflows the frame', () => {
      // A tall box: height is the binding constraint, and using the width ratio
      // would have started the video taller than the frame it came from.
      const s = shrinkFrom(frame, { x: 0, y: 0, width: 200, height: 400 });
      expect(s.scale).toBeCloseTo(540 / 400, 3);
    });

    it('declines to animate a box that is already the frame', () => {
      expect(shrinkFrom(frame, { x: 0, y: 0, width: 960, height: 540 })).toBeNull();
      expect(shrinkFrom(frame, { x: 0, y: 0, width: 0, height: 0 })).toBeNull();
      expect(shrinkFrom(null, null)).toBeNull();
    });
  });
});

/**
 * THE CURTAIN BLEEDS INTO THE PICTURE (design wave 7).
 *
 * The band already dissolves upward into the video's foot; the velvet above it
 * met the picture on a dead-level line, so the video read as a rectangle cut out
 * of a drape rather than as something the drape hangs in front of.
 */
describe('SurroundFrame — the curtain’s bleed', () => {
  const sheet = () => sass.compile(
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'SurroundFrame.scss'),
  ).css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');

  it('lays a veil on the video’s top edge, at a depth derived from the placard’s straddle', () => {
    const css = sheet();
    const veil = css.match(/\.surround-frame__stage::after \{[^}]*\}/);
    expect(veil, 'the velvet still meets the video on a hard edge').not.toBeNull();
    // It starts exactly at the video's top edge — which is the stage's own
    // padding edge, i.e. `--placard-inset`.
    expect(veil[0]).toMatch(/top: var\(--placard-inset\)/);
    expect(veil[0]).toMatch(/height: var\(--curtain-bleed\)/);

    // THE DEPTH IS DERIVED. The placard overlaps the video by a third of its own
    // height (`--placard-straddle`, settled in wave 5 and not this wave's to
    // move), and the veil reaches half to 60% of that overlap. The placard
    // measures 80.3px at every screen in the fleet.
    const root = css.match(/\.surround-frame \{[^}]*\}/)[0];
    const bleed = Number(root.match(/--curtain-bleed: ([\d.]+)px/)[1]);
    const overlap = 80.3 / 3;
    expect(bleed, 'the veil is shallower than half the placard’s overlap')
      .toBeGreaterThanOrEqual(overlap * 0.5);
    expect(bleed, 'the veil reaches deeper into the picture than 60% of the overlap')
      .toBeLessThanOrEqual(overlap * 0.6);
  });

  it('is the SAME cloth as the drape above it, faded out — not a black bar', () => {
    const veil = sheet().match(/\.surround-frame__stage::after \{[^}]*\}/)[0];
    const stage = sheet().match(/\.surround-frame__stage \{[^}]*\}/)[0];
    // The two horizontal layers are the stage's own, VERBATIM: same fold stripes
    // at the same `vw` phase, same ramp across the same width. That is what
    // makes the join invisible rather than merely soft.
    //
    // The layers are read off the stage rather than spelled out here, and that
    // is the point of the assertion: what has to hold is that the two rules
    // paint the SAME cloth, not that the cloth is any particular colour. A
    // spelled-out gradient pinned the palette in a layout spec — so retuning the
    // drape turned this test red while the join it guards was still perfect.
    // The palette has its own home (`_tokens.scss`) and its own measurements
    // (`band.measure.test.jsx`); this spec is about the seam.
    // Paren-BALANCED, not a regex: these gradients nest `rgba(…)`, so any
    // non-greedy match ends at the first inner bracket and returns half a layer.
    const horizontals = (rule) => {
      const out = [];
      const re = /(?:repeating-)?linear-gradient\(90deg/g;
      let m;
      while ((m = re.exec(rule)) !== null) {
        let depth = 0;
        for (let i = m.index; i < rule.length; i += 1) {
          if (rule[i] === '(') depth += 1;
          else if (rule[i] === ')') {
            depth -= 1;
            if (depth === 0) { out.push(rule.slice(m.index, i + 1)); break; }
          }
        }
      }
      return out;
    };
    const stageLayers = horizontals(stage);
    expect(stageLayers, 'the stage paints no horizontal cloth at all').toHaveLength(2);
    for (const layer of stageLayers) {
      expect(veil, 'the veil is not the drape’s own cloth').toContain(layer);
    }
    // ...and it is a MASK that fades it out, held opaque at the join so the
    // topmost rows paint the drape's colour exactly.
    expect(veil).toMatch(/mask-image: linear-gradient\(to bottom, #000 0%, #000 12%, rgba\(0, 0, 0, 0\) 100%\)/);
  });

  it('cannot intercept a tap, and cannot move the media box', () => {
    const css = sheet();
    const veil = css.match(/\.surround-frame__stage::after \{[^}]*\}/)[0];
    expect(veil, 'the veil eats taps on the top of the picture').toContain('pointer-events: none');
    // The 16:9 lock is untouched: the media box's own rule still carries it,
    // and the veil is a positioned pseudo-element with no bearing on layout.
    const media = css.match(/\.surround-frame__media \{[^}]*\}/)[0];
    expect(media).toContain('aspect-ratio: 16/9');
    expect(veil).toContain('position: absolute');
    // It exists only when the frame is active — the inactive shell has no
    // class, so this selector matches nothing there.
    const { container } = render(
      <SurroundFrame data={null} active={false} contentId="x"><video /></SurroundFrame>,
    );
    expect(container.querySelector('.surround-frame__stage')).toBeNull();
  });
});

/**
 * THE REGISTRATION'S `regions` META, DOING ITS JOB (wave 8, critique finding 9).
 *
 * Every built-in declares the slots it was cut for. That declaration was stored,
 * asserted by a registry test, and read by nothing — a validation hook nobody
 * built. It is read now: a definition that puts a rail module in the band still
 * renders (the surround can never be the reason something does not play) and
 * says so once, with both ends named.
 *
 * TO GO RED: drop the `surround.module.misplaced` branch from the frame's
 * region effect, or the `{ regions: [...] }` argument from a registration.
 */
describe('SurroundFrame — a module in a slot it was not cut for', () => {
  const Stub = () => <div data-testid="stub" />;

  beforeEach(() => {
    resetSurroundRegistry();
    registerSurroundModule('rail-only', Stub, { regions: ['right'] });
    registerSurroundModule('anywhere', Stub);
  });
  afterEach(() => { resetSurroundRegistry(); });

  const frameWith = (definition, logger) => render(
    <SurroundFrame
      data={{ ...DATA, definition }} contentId="plex:663134"
      position={0} duration={3223} playing seeking={false} logger={logger}
    >
      <video />
    </SurroundFrame>,
  );

  it('warns, and still renders, when a module lands in an undeclared slot', () => {
    const logger = makeLogger();
    const { container } = frameWith({ regions: { bottom: [{ module: 'rail-only' }] } }, logger);
    expect(container.querySelector('[data-testid="stub"]'), 'the frame refused to render it')
      .not.toBeNull();
    const warns = logger.warn.mock.calls.filter((c) => c[0] === 'surround.module.misplaced');
    expect(warns).toHaveLength(1);
    expect(warns[0][1]).toMatchObject({ module: 'rail-only', slot: 'bottom', declared: ['right'] });
  });

  it('stays quiet for a module in a slot it declared', () => {
    const logger = makeLogger();
    frameWith({ regions: { right: { module: 'rail-only' } } }, logger);
    expect(logger.warn.mock.calls.filter((c) => c[0] === 'surround.module.misplaced')).toHaveLength(0);
  });

  it('stays quiet for a module that declares nothing — an omission is not a claim', () => {
    const logger = makeLogger();
    frameWith({ regions: { bottom: [{ module: 'anywhere' }] } }, logger);
    expect(logger.warn.mock.calls.filter((c) => c[0] === 'surround.module.misplaced')).toHaveLength(0);
  });
});
