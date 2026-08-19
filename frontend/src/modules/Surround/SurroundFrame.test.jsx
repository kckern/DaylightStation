import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import SurroundFrame from './SurroundFrame.jsx';
import { registerSurroundModule, resetSurroundRegistry } from './registry.js';

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

  it('renders a top region band above the stage, width-pinned like the footer', () => {
    const definition = { regions: { top: { module: 'movement-map' }, right: { module: 'composer-card' } } };
    const { container } = renderFrame({ data: { ...DATA, definition } });
    const main = container.querySelector('.surround-frame__main');
    const header = main.querySelector('.surround-frame__header');
    expect(header).toBeTruthy();
    // First child of main: placard above the stage, never between stage and footer.
    expect(main.firstElementChild).toBe(header);
    expect(header.querySelector('.surround-frame__region--top')).toBeTruthy();
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
