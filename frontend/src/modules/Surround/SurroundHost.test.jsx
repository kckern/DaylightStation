import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import SurroundHost, { definitionModules } from './SurroundHost.jsx';
import { SurroundSettingContext } from './SurroundSettingContext.js';
import { registerSurroundModule, getSurroundRegistry } from './registry.js';

/**
 * These tests encode the FAIL-SOFT CONTRACT, which is the whole point of the
 * host: an un-enriched item must LAY OUT exactly like a bare `<Player/>`, and no
 * surround failure may ever be the reason something does not play. Everything
 * else here is secondary.
 *
 * The contract used to be "no wrapper element at all" and was asserted as an
 * innerHTML string. It is now "a wrapper that generates no box" — the shell is
 * always in the tree, because that is what keeps the player at a constant depth
 * and stops React remounting (reloading) it when the frame engages. The
 * assertion moved with it: `expectNoBox` below checks every wrapper declares
 * `display: contents` and carries no class, no role and no aria.
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

/**
 * A player that counts its own mounts. The reload defect is invisible to any
 * assertion that only looks for the <video> — a remounted player is still THERE.
 * Only mount identity distinguishes "kept" from "torn down and rebuilt".
 */
let playerMounts = 0;
const CountingPlayer = () => {
  useEffect(() => { playerMounts += 1; }, []);
  return <video data-testid="the-player" />;
};
/** Created once: a fresh element per render would prove nothing about identity. */
const COUNTING_CHILD = <CountingPlayer />;

function renderHost({ getPlayerHandle, mode = 'auto', logger, children = PLAYER_CHILD }) {
  return render(
    <SurroundSettingContext.Provider value={mode}>
      <SurroundHost getPlayerHandle={getPlayerHandle} logger={logger}>
        {children}
      </SurroundHost>
    </SurroundSettingContext.Provider>,
  );
}

/** Every element between the player and the container, innermost first. */
function wrapperChain(container) {
  const video = container.querySelector('[data-testid="the-player"]');
  const chain = [];
  for (let el = video?.parentElement; el && el !== container; el = el.parentElement) chain.push(el);
  return chain;
}

/**
 * The fail-soft contract in its current form: the player is there, no frame is
 * there, and every element between them generates no box and carries no
 * semantics. Layout-equivalent to a bare `<Player/>`, without the re-parenting.
 */
function expectNoBox(container) {
  expect(container.querySelector('[data-testid="the-player"]')).toBeTruthy();
  expect(container.querySelector('[data-testid="surround-frame"]')).toBeNull();
  const chain = wrapperChain(container);
  expect(chain.length).toBeGreaterThan(0);
  chain.forEach((el) => {
    expect(el.style.display).toBe('contents');
    expect(el.className).toBe('');
    expect(el.getAttribute('role')).toBeNull();
    expect([...el.attributes].some((a) => a.name.startsWith('aria-'))).toBe(false);
  });
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
    playerMounts = 0;
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

  it('renders children in a no-box shell when the item carries no surround', () => {
    const player = makePlayer({ item: { id: 'plex:1', title: 'Plain' }, media: new FakeMedia() });
    const { container } = renderHost({ getPlayerHandle: player.get, logger });

    expectNoBox(container);

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

    expectNoBox(container);
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
    const nullHost = renderHost({ getPlayerHandle: () => null, logger });
    expectNoBox(nullHost.container);

    const partialHost = renderHost({ getPlayerHandle: () => ({}), logger });
    expectNoBox(partialHost.container);

    const throwingHost = renderHost({
      getPlayerHandle: () => { throw new Error('handle blew up'); },
      logger,
    });
    expectNoBox(throwingHost.container);

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

    // Let the clock's supervisor find the media element (<=250ms) AND the
    // entrance choreography finish (`ENTER_UNCLIP_MS`, the timer that puts the
    // stage's clip back once nothing is moving). Both are legitimate one-off
    // commits; counting either here would say nothing about the poll.
    await act(async () => { vi.advanceTimersByTime(1500); });

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

  // --- player continuity ----------------------------------------------------
  //
  // THE DEFECT THESE EXIST FOR. The host used to render `children` bare and then
  // re-parent them into the frame once the 1 Hz poll found a surround. Moving an
  // element to a new depth is a React remount, and remounting the player reloads
  // the video: an audible restart about a second into every enriched item.
  //
  // "The player is still in the DOM" does not detect this — a remounted player is
  // still in the DOM. Every test below asserts IDENTITY: the same mount, and the
  // same DOM node. One act() per step, so React 18 cannot batch two transitions
  // into one commit and hide a remount in between.

  describe('player continuity', () => {
    it('does not remount the player when the surround engages', async () => {
      const player = makePlayer({ item: { id: 'plex:900001' }, media: new FakeMedia() });
      const { container } = renderHost({
        getPlayerHandle: player.get, logger, children: COUNTING_CHILD,
      });
      const node = container.querySelector('[data-testid="the-player"]');
      expect(playerMounts).toBe(1);
      expect(container.querySelector('[data-testid="surround-frame"]')).toBeNull();

      player.advanceTo({ id: 'plex:663134', surround: SURROUND });
      await act(async () => { vi.advanceTimersByTime(1000); });

      expect(container.querySelector('[data-testid="surround-frame"]')).toBeTruthy();
      expect(container.querySelector('[data-testid="the-player"]')).toBe(node);
      expect(playerMounts).toBe(1);
    });

    it('does not remount the player when the frame drops on a queue advance', async () => {
      const player = makePlayer({
        item: { id: 'plex:663134', surround: SURROUND }, media: new FakeMedia(),
      });
      const { container } = renderHost({
        getPlayerHandle: player.get, logger, children: COUNTING_CHILD,
      });
      const node = container.querySelector('[data-testid="the-player"]');
      expect(container.querySelector('[data-testid="surround-frame"]')).toBeTruthy();
      expect(playerMounts).toBe(1);

      player.advanceTo({ id: 'plex:900001', title: 'Something plain' });
      await act(async () => { vi.advanceTimersByTime(1000); });

      expect(container.querySelector('[data-testid="surround-frame"]')).toBeNull();
      expect(container.querySelector('[data-testid="the-player"]')).toBe(node);
      expect(playerMounts).toBe(1);
    });

    it('does not remount the player when one enriched item follows another', async () => {
      const player = makePlayer({
        item: { id: 'plex:663134', surround: SURROUND }, media: new FakeMedia(),
      });
      const { container } = renderHost({
        getPlayerHandle: player.get, logger, children: COUNTING_CHILD,
      });
      const node = container.querySelector('[data-testid="the-player"]');

      player.advanceTo({ id: 'plex:663135', surround: { ...SURROUND, id: 'concert-hall-2' } });
      await act(async () => { vi.advanceTimersByTime(1000); });

      expect(container.querySelector('[data-testid="surround-frame"]')).toBeTruthy();
      expect(container.querySelector('[data-testid="the-player"]')).toBe(node);
      expect(playerMounts).toBe(1);
      // The per-item lifecycle still turns over even though nothing remounted.
      expect(eventsNamed(logger, 'surround.unmount')).toHaveLength(1);
      expect(eventsNamed(logger, 'surround.mount')).toHaveLength(2);
    });

    it('does not remount the player when a module throws and the frame falls back', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const player = makePlayer({ item: { id: 'plex:900001' }, media: new FakeMedia() });
      const { container } = renderHost({
        getPlayerHandle: player.get, logger, children: COUNTING_CHILD,
      });
      const node = container.querySelector('[data-testid="the-player"]');

      player.advanceTo({
        id: 'plex:663134',
        surround: { ...SURROUND, definition: { id: 'boom', regions: { bottom: [{ module: 'test-boom' }] } } },
      });
      await act(async () => { vi.advanceTimersByTime(1000); });

      // Fell back to the bare player...
      expect(container.querySelector('[data-testid="surround-frame"]')).toBeNull();
      expect(eventsNamed(logger, 'surround.render.error')).toHaveLength(1);
      // ...without tearing the player down to do it.
      expect(container.querySelector('[data-testid="the-player"]')).toBe(node);
      expect(playerMounts).toBe(1);
    });

    it('wraps an un-enriched player in elements that generate no layout box', () => {
      const player = makePlayer({ item: { id: 'plex:1', title: 'Plain' }, media: new FakeMedia() });
      const { container } = renderHost({ getPlayerHandle: player.get, logger });

      // The wrapper now always exists (that is what keeps the depth constant)...
      const chain = wrapperChain(container);
      expect(chain.length).toBeGreaterThan(0);
      chain.forEach((el) => {
        // ...but generates no box, so an un-enriched page lays out as before.
        expect(el.style.display).toBe('contents');
        // display:contents removes the element from the box tree in some engines,
        // so it must carry no semantics for an AT to lose.
        expect(el.className).toBe('');
        expect(el.getAttribute('role')).toBeNull();
        expect([...el.attributes].some((a) => a.name.startsWith('aria-'))).toBe(false);
      });
      expect(container.querySelector('[data-testid="the-player"]')).toBeTruthy();
    });
  });

  // --- shader enforcement ----------------------------------------------------
  //
  // THE RULE: when the surround frame is active for the current item, the Player
  // it wraps ALWAYS renders the focused/minimal shader — no dispatch parameter
  // required, and no exception for whatever the launch path asked for. The host
  // enforces this by `cloneElement`-ing `forceShader: 'focused'` onto `children`,
  // which is a prop update on the existing element (same type/key => no remount).

  describe('shader enforcement', () => {
    /** Renders forceShader/shader as data attributes so tests can read the props
     * React actually delivered, and counts mounts so identity can be checked. */
    let shaderProbeMounts = 0;
    const ShaderProbe = ({ forceShader, shader }) => {
      useEffect(() => { shaderProbeMounts += 1; }, []);
      return (
        <video
          data-testid="the-player"
          data-force-shader={forceShader ?? ''}
          data-shader={shader ?? ''}
        />
      );
    };

    beforeEach(() => { shaderProbeMounts = 0; });

    it('injects forceShader="focused" onto the child when the surround is active', () => {
      const player = makePlayer({
        item: { id: 'plex:663134', surround: SURROUND },
        media: new FakeMedia(),
      });
      const { container } = renderHost({
        getPlayerHandle: player.get, logger, children: <ShaderProbe />,
      });

      expect(container.querySelector('[data-testid="surround-frame"]')).toBeTruthy();
      expect(container.querySelector('[data-testid="the-player"]').dataset.forceShader).toBe('focused');
    });

    it('leaves the child untouched when the surround is inactive', () => {
      const player = makePlayer({ item: { id: 'plex:1', title: 'Plain' }, media: new FakeMedia() });
      const { container } = renderHost({
        getPlayerHandle: player.get, logger, children: <ShaderProbe />,
      });

      expect(container.querySelector('[data-testid="surround-frame"]')).toBeNull();
      // No forceShader prop was injected at all — not merely empty/undefined by
      // coincidence, but genuinely never set, so the data attribute is absent.
      expect(container.querySelector('[data-testid="the-player"]').dataset.forceShader).toBe('');
    });

    it('preserves the child element identity across the activation flip (no remount)', async () => {
      const player = makePlayer({ item: { id: 'plex:900001' }, media: new FakeMedia() });
      const { container } = renderHost({
        getPlayerHandle: player.get, logger, children: <ShaderProbe />,
      });
      const node = container.querySelector('[data-testid="the-player"]');
      expect(shaderProbeMounts).toBe(1);
      expect(node.dataset.forceShader).toBe('');

      player.advanceTo({ id: 'plex:663134', surround: SURROUND });
      await act(async () => { vi.advanceTimersByTime(1000); });

      // Same DOM node, same mount — cloneElement only updated the prop.
      expect(container.querySelector('[data-testid="the-player"]')).toBe(node);
      expect(shaderProbeMounts).toBe(1);
      expect(container.querySelector('[data-testid="the-player"]').dataset.forceShader).toBe('focused');
    });

    it('overrides an incoming explicit shader on the child while active', () => {
      const player = makePlayer({
        item: { id: 'plex:663134', surround: SURROUND },
        media: new FakeMedia(),
      });
      // The launch path dispatched shader="dark" onto the player directly —
      // surround's focused must win over it while the frame is active.
      const { container } = renderHost({
        getPlayerHandle: player.get, logger, children: <ShaderProbe shader="dark" />,
      });

      const node = container.querySelector('[data-testid="the-player"]');
      expect(node.dataset.shader).toBe('dark');
      expect(node.dataset.forceShader).toBe('focused');
    });
  });
});

/**
 * THE MOUNT LOG TOLD THE TRUTH ABOUT HALF THE FRAME (wave 8, critique finding 6).
 *
 * `surround.mount`'s `modules` field read `regions.right?.module` — a single
 * object — while `right` has been a LIST since the rail gained its carousel, and
 * `top` was never read at all. So the one event that says what a frame is made
 * of reported the band and nothing else, for six waves, on every enriched item.
 *
 * TO GO RED: read `regions.right?.module` instead of walking the slot, or drop
 * `'top'` from `REGION_SLOTS`.
 */
describe('SurroundHost — the mount log names the whole frame', () => {
  const SHIPPED = {
    regions: {
      top: { module: 'work-placard' },
      right: [
        { module: 'composer-card', width: '33%', side: 'left' },
        { module: 'place-carousel' },
      ],
      bottom: [
        { module: 'movement-map', height: 64 },
        { module: 'cue-ticker', height: 'fill', collapse: 'first' },
      ],
    },
    collapse: { footerFloor: 90 },
  };

  it('reports every module of the shipped definition, in layout order', () => {
    expect(definitionModules(SHIPPED)).toEqual([
      'work-placard', 'composer-card', 'place-carousel', 'movement-map', 'cue-ticker',
    ]);
  });

  it('reads a slot authored as a single object exactly as it reads a list', () => {
    expect(definitionModules({ regions: { bottom: { module: 'movement-map' } } }))
      .toEqual(['movement-map']);
    expect(definitionModules({ regions: { bottom: [{ module: 'movement-map' }] } }))
      .toEqual(['movement-map']);
  });

  it('never throws on a definition that is missing, empty or malformed', () => {
    expect(definitionModules(null)).toEqual([]);
    expect(definitionModules({})).toEqual([]);
    expect(definitionModules({ regions: { right: [null, { width: '33%' }, { module: 42 }] } }))
      .toEqual([]);
  });
});
