import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import SurroundHost from './SurroundHost.jsx';
import { SurroundSettingContext } from './SurroundSettingContext.js';
import { registerSurroundModule, getSurroundRegistry } from './registry.js';

/**
 * These tests encode the FAIL-SOFT CONTRACT, which is the whole point of the
 * host: an un-enriched item must reach the DOM byte-identically to a bare
 * `<Player/>`, and no surround failure may ever be the reason something does not
 * play. Everything else here is secondary.
 */

// --- fakes -----------------------------------------------------------------

/** Minimal media element. happy-dom's <video> has read-only currentTime. */
class FakeMedia extends EventTarget {
  constructor() {
    super();
    this.currentTime = 0;
    this.duration = 3223;
    this.paused = false;
  }
  seekTo(t) {
    this.currentTime = t;
    this.dispatchEvent(new Event('timeupdate'));
  }
}

const makeLogger = () => {
  const log = {
    debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), sampled: vi.fn(),
  };
  // Children resolve back to the same spies so frame/module events are visible here.
  log.child = vi.fn(() => log);
  return log;
};

const eventsNamed = (log, name) =>
  ['debug', 'info', 'warn', 'error'].flatMap((lvl) => log[lvl].mock.calls.filter((c) => c[0] === name));

const DEFINITION = {
  id: 'concert-hall',
  regions: {
    right: { width: '20%', module: 'test-card' },
    bottom: [{ module: 'test-map', height: 60 }],
  },
};

const SURROUND = {
  id: 'concert-hall',
  definition: DEFINITION,
  piece: { title: 'Symphony No. 3' },
  movements: [{ n: 1, name: 'Allegro con brio', start: 0 }],
  cues: [],
  facts: [],
  composer: { name: 'Ludwig van Beethoven' },
  assetBase: 'surround/classical',
};

/** A live, mutable player handle: swap `nowPlaying` to simulate a queue advance. */
function makePlayer({ item = null, media = null } = {}) {
  const state = { item, media };
  const handle = {
    getNowPlaying: () => ({ item: state.item, isQueue: false }),
    getMediaElement: () => state.media,
  };
  return {
    handle,
    state,
    get: () => handle,
    advanceTo: (next) => { state.item = next; },
  };
}

const PLAYER_CHILD = <video data-testid="the-player" />;

function renderHost({ getPlayerHandle, mode = 'auto', logger }) {
  return render(
    <SurroundSettingContext.Provider value={mode}>
      <SurroundHost getPlayerHandle={getPlayerHandle} logger={logger}>
        {PLAYER_CHILD}
      </SurroundHost>
    </SurroundSettingContext.Provider>,
  );
}

let recorded = [];
const RecorderModule = ({ data, position }) => {
  recorded.push({ data, position });
  return <div data-testid="recorder">{position}</div>;
};
const CardModule = ({ data }) => <div data-testid="card">{data?.composer?.name}</div>;
const BoomModule = () => { throw new Error('module exploded'); };

describe('SurroundHost', () => {
  let logger;

  beforeEach(() => {
    vi.useFakeTimers();
    recorded = [];
    logger = makeLogger();
    registerSurroundModule('test-map', RecorderModule);
    registerSurroundModule('test-card', CardModule);
    registerSurroundModule('test-boom', BoomModule);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('registers the built-in modules by importing the host', () => {
    // The seams must not need a registration call of their own.
    const registry = getSurroundRegistry();
    expect(registry.get('movement-map')).toBeTruthy();
    expect(registry.get('cue-ticker')).toBeTruthy();
    expect(registry.get('composer-card')).toBeTruthy();
  });

  it('renders children with NO wrapper element when the item carries no surround', () => {
    const player = makePlayer({ item: { id: 'plex:1', title: 'Plain' }, media: new FakeMedia() });
    const { container } = renderHost({ getPlayerHandle: player.get, logger });

    const bare = render(PLAYER_CHILD);
    expect(container.innerHTML).toBe(bare.container.innerHTML);
    expect(container.querySelector('[data-testid="surround-frame"]')).toBeNull();

    const changes = eventsNamed(logger, 'surround.item-change');
    expect(changes).toHaveLength(1);
    expect(changes[0][1]).toMatchObject({ contentId: 'plex:1', from: null, to: 'plex:1', enriched: false });
  });

  it('frames the player when the item carries a surround and the mode is auto', () => {
    const player = makePlayer({
      item: { id: 'plex:663134', title: 'Eroica', surround: SURROUND },
      media: new FakeMedia(),
    });
    const { container } = renderHost({ getPlayerHandle: player.get, logger });

    const frame = container.querySelector('[data-testid="surround-frame"]');
    expect(frame).toBeTruthy();

    // The player must live INSIDE the aspect-locked media box, not beside it.
    const media = container.querySelector('[data-testid="surround-media"]');
    expect(media.querySelector('[data-testid="the-player"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="card"]').textContent).toBe('Ludwig van Beethoven');

    const mounts = eventsNamed(logger, 'surround.mount');
    expect(mounts).toHaveLength(1);
    expect(mounts[0][1]).toMatchObject({ contentId: 'plex:663134', surroundId: 'concert-hall', mode: 'auto' });
  });

  it('renders bare children when the mode is off, even for an enriched item', () => {
    const player = makePlayer({
      item: { id: 'plex:663134', surround: SURROUND },
      media: new FakeMedia(),
    });
    const { container } = renderHost({ getPlayerHandle: player.get, mode: 'off', logger });

    const bare = render(PLAYER_CHILD);
    expect(container.innerHTML).toBe(bare.container.innerHTML);
    expect(eventsNamed(logger, 'surround.disabled')).toHaveLength(1);
    expect(eventsNamed(logger, 'surround.disabled')[0][1]).toMatchObject({ mode: 'off' });
    expect(eventsNamed(logger, 'surround.mount')).toHaveLength(0);
  });

  it('catches a module that throws in render, logs surround.render.error, and still mounts the player', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const player = makePlayer({
      item: {
        id: 'plex:663134',
        surround: {
          ...SURROUND,
          definition: { id: 'boom', regions: { bottom: [{ module: 'test-boom' }] } },
        },
      },
      media: new FakeMedia(),
    });
    const { container } = renderHost({ getPlayerHandle: player.get, logger });

    expect(container.querySelector('[data-testid="the-player"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="surround-frame"]')).toBeNull();

    const errors = eventsNamed(logger, 'surround.render.error');
    expect(errors).toHaveLength(1);
    expect(errors[0][1]).toMatchObject({ contentId: 'plex:663134' });
    expect(String(errors[0][1].error)).toContain('module exploded');
  });

  it('drops the frame when the queue advances to an un-enriched item', async () => {
    const player = makePlayer({
      item: { id: 'plex:663134', surround: SURROUND },
      media: new FakeMedia(),
    });
    const { container } = renderHost({ getPlayerHandle: player.get, logger });
    expect(container.querySelector('[data-testid="surround-frame"]')).toBeTruthy();

    player.advanceTo({ id: 'plex:900001', title: 'Something plain' });
    await act(async () => { vi.advanceTimersByTime(1000); });

    expect(container.querySelector('[data-testid="surround-frame"]')).toBeNull();
    expect(container.querySelector('[data-testid="the-player"]')).toBeTruthy();

    const changes = eventsNamed(logger, 'surround.item-change');
    expect(changes).toHaveLength(2);
    expect(changes[1][1]).toMatchObject({ from: 'plex:663134', to: 'plex:900001', enriched: false });

    const unmounts = eventsNamed(logger, 'surround.unmount');
    expect(unmounts).toHaveLength(1);
    expect(unmounts[0][1].contentId).toBe('plex:663134');
    expect(typeof unmounts[0][1].watchedSec).toBe('number');
  });

  it('picks up a frame when the queue advances INTO an enriched item', async () => {
    const player = makePlayer({ item: { id: 'plex:900001' }, media: new FakeMedia() });
    const { container } = renderHost({ getPlayerHandle: player.get, logger });
    expect(container.querySelector('[data-testid="surround-frame"]')).toBeNull();

    player.advanceTo({ id: 'plex:663134', surround: SURROUND });
    await act(async () => { vi.advanceTimersByTime(1000); });

    expect(container.querySelector('[data-testid="surround-frame"]')).toBeTruthy();
  });

  it('renders bare children when the handle is null or lacks getNowPlaying', async () => {
    const bare = render(PLAYER_CHILD);

    const nullHost = renderHost({ getPlayerHandle: () => null, logger });
    expect(nullHost.container.innerHTML).toBe(bare.container.innerHTML);

    const partialHost = renderHost({ getPlayerHandle: () => ({}), logger });
    expect(partialHost.container.innerHTML).toBe(bare.container.innerHTML);

    const throwingHost = renderHost({
      getPlayerHandle: () => { throw new Error('handle blew up'); },
      logger,
    });
    expect(throwingHost.container.innerHTML).toBe(bare.container.innerHTML);

    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('keeps the surround data identity stable across clock ticks', async () => {
    const media = new FakeMedia();
    const player = makePlayer({ item: { id: 'plex:663134', surround: SURROUND }, media });
    renderHost({ getPlayerHandle: player.get, logger });

    // One act() per step: batching several steps into one act() would collapse
    // the commits and hide a churning memo.
    await act(async () => { vi.advanceTimersByTime(200); });
    act(() => { media.seekTo(10); });
    await act(async () => { vi.advanceTimersByTime(200); });
    act(() => { media.seekTo(20); });
    await act(async () => { vi.advanceTimersByTime(200); });

    const positions = recorded.map((r) => r.position);
    expect(positions).toContain(10);
    expect(positions).toContain(20);
    expect(recorded.length).toBeGreaterThan(2);

    const identities = new Set(recorded.map((r) => r.data));
    expect(identities.size).toBe(1);
  });

  it('does not re-render the frame on a poll tick that changes nothing', async () => {
    const media = new FakeMedia();
    const player = makePlayer({ item: { id: 'plex:663134', surround: SURROUND }, media });
    renderHost({ getPlayerHandle: player.get, logger });

    const before = recorded.length;
    // Three idle polls. A host that setStates on every tick (instead of only on a
    // real item change) would re-render the whole frame at 1Hz for 54 minutes.
    await act(async () => { vi.advanceTimersByTime(3000); });

    expect(recorded.length).toBe(before);
  });

  it('polls repeatedly rather than reading the handle once', async () => {
    const getPlayerHandle = vi.fn(() => null);
    renderHost({ getPlayerHandle, logger });
    const afterMount = getPlayerHandle.mock.calls.length;

    await act(async () => { vi.advanceTimersByTime(3000); });
    expect(getPlayerHandle.mock.calls.length).toBeGreaterThan(afterMount);
  });
});
