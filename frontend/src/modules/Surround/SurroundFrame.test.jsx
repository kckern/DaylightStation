import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import * as sass from 'sass-embedded';
import SurroundFrame from './SurroundFrame.jsx';
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

const MovementStub = ({ position, data, region }) => (
  <div data-testid="movement-stub" data-position={position} data-height={region?.height}>
    {(data?.movements ?? []).length} movements
  </div>
);
const TickerStub = () => <div data-testid="ticker-stub">ticker</div>;
const CardStub = ({ data }) => <div data-testid="card-stub">{data?.composer?.name ?? ''}</div>;

const DEFINITION = {
  id: 'concert-hall',
  regions: {
    right: { width: '20%', module: 'composer-card' },
    bottom: [
      { module: 'movement-map', height: 60 },
      { module: 'cue-ticker', height: 156, collapse: 'first' },
    ],
  },
  collapse: { footerFloor: 90 },
};

const DATA = {
  id: 'concert-hall',
  definition: DEFINITION,
  piece: { title: 'Symphony No. 3' },
  movements: [{ n: 1, name: 'Allegro con brio', start: 0 }],
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
    registerSurroundModule('movement-map', MovementStub);
    registerSurroundModule('cue-ticker', TickerStub);
    registerSurroundModule('composer-card', CardStub);
  });
  afterEach(() => {
    resetSurroundRegistry();
    observers = [];
  });

  it('renders every declared region through the registry', () => {
    const { getByTestId } = renderFrame();
    expect(getByTestId('movement-stub')).toBeInTheDocument();
    expect(getByTestId('ticker-stub')).toBeInTheDocument();
    expect(getByTestId('card-stub')).toHaveTextContent('Ludwig van Beethoven');
  });

  it('passes the clock and the region definition down to each module', () => {
    const { getByTestId } = renderFrame({ position: 976 });
    const stub = getByTestId('movement-stub');
    expect(stub.getAttribute('data-position')).toBe('976');
    expect(stub.getAttribute('data-height')).toBe('60');
  });

  it('renders a top region as a floating plate, not as a width-pinned band', () => {
    const definition = { regions: { top: { module: 'movement-map' }, right: { module: 'composer-card' } } };
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
    registerSurroundModule('movement-map', Spy);
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
          { module: 'movement-map', height: 64 },
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
    const band = container.querySelector('[data-module="movement-map"]');
    expect(band.style.minHeight).toBe('60px');
    expect(band.style.flex).toBe('0 0 auto');
    // A fixed height would clip the second line of a wrapped movement name.
    expect(band.style.height).toBe('');
  });

  it('still sizes a rail region exactly — a floor there would swallow the rail', () => {
    const definition = {
      ...DEFINITION,
      regions: {
        ...DEFINITION.regions,
        right: [{ module: 'composer-card', width: '33%' }, { module: 'movement-map', height: 230 }],
      },
    };
    const { container } = renderFrame({ data: { ...DATA, definition } });
    const map = container.querySelector('.surround-frame__rail [data-module="movement-map"]');
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
    expect(queryByTestId('movement-stub')).not.toBeNull();
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

  it('still renders a composed frame when the payload has no movements or facts', () => {
    const bare = { ...DATA, movements: undefined, facts: undefined, cues: undefined };
    const { getByTestId } = renderFrame({ data: bare });
    expect(getByTestId('surround-frame')).toBeInTheDocument();
    expect(getByTestId('surround-rail')).toBeInTheDocument();
    expect(getByTestId('surround-footer')).toBeInTheDocument();
    expect(getByTestId('movement-stub')).toHaveTextContent('0 movements');
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

  it('reserves an inert overlay slot', () => {
    const { getByTestId } = renderFrame();
    const overlay = getByTestId('surround-overlay');
    expect(overlay.style.pointerEvents).toBe('none');
    expect(overlay.childElementCount).toBe(0);
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
    registerSurroundModule('movement-map', MovementStub);
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

  it('keeps the paper fibre on the dark rail so the stock keeps its tooth', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const rail = css.match(/\.surround-frame__region--right \{[^}]*\}/)[0];
    expect(rail).toContain('var(--programme-fibre)');
    expect(rail).toContain('multiply');
  });

  it('staggers the entrance rail → band → placard, on one easing', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    expect(css).toMatch(/\.surround-frame--entering \.surround-frame__rail \{[^}]*opacity: 0/);
    expect(css).toMatch(/\.surround-frame--entering \.surround-frame__footer \{[^}]*translateY/);
    expect(css).toMatch(/\.surround-frame--entering \.surround-frame__header \{[^}]*translate\(-50%/);

    const footerDelay = css.match(/\.surround-frame__footer \{ transition-delay: (\d+)ms/);
    const headerDelay = css.match(/\.surround-frame__header \{ transition-delay: (\d+)ms/);
    expect(footerDelay).not.toBeNull();
    expect(headerDelay).not.toBeNull();
    expect(Number(headerDelay[1])).toBeGreaterThan(Number(footerDelay[1]));   // plate last
  });

  it('slides the rail in from whichever side it is on', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    expect(css).toMatch(/\.surround-frame--entering \.surround-frame__rail \{[^}]*translateX\(14%\)/);
    expect(css).toMatch(/\.surround-frame--entering\.surround-frame--rail-left \.surround-frame__rail \{[^}]*translateX\(-14%\)/);
  });

  it('never animates the stage or the media box', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const entering = css.match(/\.surround-frame--entering[^{]*\{[^}]*\}/g) ?? [];
    expect(entering.length).toBeGreaterThan(0);
    entering.forEach((rule) => {
      expect(rule).not.toContain('__stage');
      expect(rule).not.toContain('__media');
    });
  });

  it('reduces the entrance to light alone under prefers-reduced-motion', () => {
    const css = withStyles().replace(/\s+/g, ' ');
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(block.length).toBeGreaterThan(0);
    expect(block).toContain('transform: none');
    // The placard keeps its straddle — "no transform" there would drop it off the edge.
    expect(block).toMatch(/\.surround-frame--entering \.surround-frame__header \{ transform: translate\(-50%, -50%\)/);
  });
});
