/**
 * MediaLessonScreen — the composition, tested as a composition.
 *
 * Everything that makes the feature a GATE runs for real here: the session
 * hook, `useCheckpointGate`, `useMediaGate`, `CheckpointQuizOverlay`,
 * `SurroundFrame` and the two lesson surround modules. Four things are stood
 * in for, and each for a reason:
 *
 *   - the WebSocket and `fetch` — transports, not behaviour;
 *   - the overlay slot — reproduced faithfully below (`OverlaySlot` renders
 *     exactly what `ScreenOverlayProvider` renders, from the same record), so
 *     the widget really does mount its stage through `showOverlay`;
 *   - `Player` — 1,500 lines of media stack; what matters is what is handed TO
 *     it and what comes back OUT of it, so the double hands back a real media
 *     element and a real `clear`;
 *   - `useMediaClockState` — the 10 Hz sampler has its own suite; here it is a
 *     dial the test turns, which is the only way to put a playhead on a
 *     checkpoint deterministically.
 *
 * The gate itself is NEVER mocked. A test that stubbed `useMediaGate` would
 * prove the markup and nothing about whether the video actually stops.
 */
import { render, screen, act, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useSyncExternalStore } from 'react';

const h = vi.hoisted(() => {
  const mkStore = (initial) => {
    let snap = initial;
    const subs = new Set();
    return {
      get: () => snap,
      set: (next) => { snap = next; subs.forEach((f) => f()); },
      subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
    };
  };
  return {
    handler: null,
    overlay: mkStore(null),
    shown: [],
    dismissed: 0,
    interceptor: null,
    trace: [],
    clock: mkStore({ position: 0, duration: 600, playing: false, seeking: false }),
    clockOpts: null,
    player: { clear: null, onMediaRef: null, onPlaybackCompleted: null, play: null },
    posts: [],
    mkStore,
  };
});

vi.mock('../../../hooks/useWebSocket.js', () => ({
  useWebSocketSubscription: (_topic, cb) => { h.handler = cb; },
}));

vi.mock('../../../screen-framework/overlays/ScreenOverlayProvider.jsx', () => ({
  useScreenOverlay: () => ({
    showOverlay: (Component, props, options) => {
      h.shown.push({ Component, props, options });
      h.trace.push('show');
      h.overlay.set({ Component, props });
    },
    dismissOverlay: () => { h.dismissed += 1; h.trace.push('dismiss'); h.overlay.set(null); },
    hasOverlay: h.overlay.get() !== null,
    registerEscapeInterceptor: (fn) => { h.interceptor = fn; },
    unregisterEscapeInterceptor: () => { h.interceptor = null; },
  }),
}));

vi.mock('../../Player/Player.jsx', () => ({
  default: (props) => {
    h.player.clear = props.clear;
    h.player.onMediaRef = props.onMediaRef;
    h.player.onPlaybackCompleted = props.onPlaybackCompleted;
    h.player.play = props.play;
    return null;
  },
}));

vi.mock('../../../lib/Player/useMediaClock.js', () => ({
  useMediaClockState: (opts) => {
    h.clockOpts = opts;
    return useSyncExternalStore(h.clock.subscribe, h.clock.get);
  },
}));

vi.mock('../../../lib/logging/Logger.js', () => {
  const child = { info() {}, debug() {}, warn() {}, error() {} };
  child.child = () => child;
  return { default: () => child, getLogger: () => child };
});

import { getActionBus, resetActionBus } from '../../../screen-framework/input/ActionBus.js';
import { MediaLessonScreen } from './MediaLessonScreen.jsx';

const MC = {
  id: 'q1',
  type: 'multiple_choice',
  prompt: 'What holds the planets in orbit?',
  choices: ['Gravity', 'Wind', 'Magnets', 'Rope'],
};

const SNAPSHOT = {
  sessionId: 'sess-1',
  contentId: 'plex:4242',
  title: 'How the Solar System Works',
  resumePosition: 0,
  learner: { id: 'user_4', name: 'User_4' },
  checkpoints: [
    { id: 'cp-100', at: 100, items: [MC] },
    { id: 'cp-300', at: 300, items: [MC] },
  ],
  cleared: [],
};

/**
 * The overlay slot, reproduced from `ScreenOverlayProvider`'s own JSX: one
 * record, rendered as `<record.Component {...record.props} />`. The widget is
 * rendered BESIDE it, exactly as it sits beside the slot on a real screen.
 */
function OverlaySlot() {
  const record = useSyncExternalStore(h.overlay.subscribe, h.overlay.get);
  if (!record) return null;
  const { Component, props } = record;
  return <Component {...props} />;
}

function makeMediaEl(tag = 'video') {
  const el = document.createElement(tag);
  let paused = true;
  Object.defineProperty(el, 'paused', { get: () => paused, configurable: true });
  el.play = vi.fn(() => { paused = false; el.dispatchEvent(new Event('play')); return Promise.resolve(); });
  el.pause = vi.fn(() => { paused = true; el.dispatchEvent(new Event('pause')); });
  Object.defineProperty(el, 'currentTime', { value: 0, writable: true, configurable: true });
  return el;
}

function stubFetch({ answer = { correct: true, checkpointCleared: true, status: 'correct' }, session = SNAPSHOT } = {}) {
  return vi.fn(async (url, opts) => {
    const href = String(url);
    h.posts.push({ href, body: opts?.body ? JSON.parse(opts.body) : null });
    if (/\/lesson\/[^/]+$/.test(href)) return { ok: true, status: 200, json: async () => session };
    if (href.endsWith('/answer')) return { ok: true, status: 200, json: async () => answer };
    if (href.endsWith('/ended')) return { ok: true, status: 200, json: async () => ({ completed: true, remaining: [] }) };
    return { ok: true, status: 200, json: async () => ({}) };
  });
}

const deliver = async (payload) => { await act(async () => { h.handler(payload); }); };
const tick = async (position) => { await act(async () => { h.clock.set({ ...h.clock.get(), position }); }); };
const emit = async (action, payload = {}) => { await act(async () => { getActionBus().emit(action, payload); }); };

/** Mount the screen, open the lesson, attach a media element and start it. */
async function openLesson({ tag = 'video', celebrateMs = 40 } = {}) {
  const view = render(<>
    <MediaLessonScreen checkpointCelebrateMs={celebrateMs} lessonCelebrateMs={celebrateMs} />
    <OverlaySlot />
  </>);
  await deliver({ type: 'lesson.open', sessionId: 'sess-1' });
  await waitFor(() => expect(h.player.onMediaRef).toBeTruthy());
  const el = makeMediaEl(tag);
  await act(async () => { h.player.onMediaRef(el); });
  await act(async () => { el.dispatchEvent(new Event('playing')); await el.play(); });
  return { ...view, el };
}

describe('MediaLessonScreen', () => {
  beforeEach(() => {
    h.handler = null;
    h.overlay.set(null);
    h.shown.length = 0;
    h.dismissed = 0;
    h.interceptor = null;
    h.trace.length = 0;
    h.clock.set({ position: 0, duration: 600, playing: false, seeking: false });
    h.player.clear = null;
    h.player.onMediaRef = null;
    h.player.onPlaybackCompleted = null;
    h.player.play = null;
    h.posts.length = 0;
    resetActionBus();
    vi.stubGlobal('fetch', stubFetch());
  });

  afterEach(() => { resetActionBus(); vi.unstubAllGlobals(); });

  // ── idle ────────────────────────────────────────────────────────────────
  it('renders NOTHING and mounts NOTHING until a lesson is dispatched', () => {
    const { container } = render(<MediaLessonScreen />);
    expect(container).toBeEmptyDOMElement();
    expect(h.shown).toHaveLength(0);
  });

  // ── the window between `lesson.open` and the first frame ─────────────────
  it('names the child and the lesson while the stream loads, and clears the screensaver', async () => {
    render(<MediaLessonScreen />);
    await deliver({ type: 'lesson.open', sessionId: 'sess-1' });
    expect(screen.getByTestId('media-lesson')).toHaveAttribute('data-view', 'open');
    await waitFor(() => expect(screen.getByTestId('media-lesson-curtain')).toHaveTextContent('How the Solar System Works'));
    expect(screen.getByTestId('media-lesson-curtain')).toHaveTextContent('User_4');
    // TWO dismisses before the Player is ever mounted: one on the way OUT OF
    // IDLE (the screensaver, which suppresses for content and for an overlay —
    // and a curtain is neither), one immediately before `showOverlay` claims
    // the slot at `high`. Counting only "at least one" would let the first go
    // missing and leave the child looking at a framed painting.
    const firstShow = h.trace.indexOf('show');
    expect(firstShow).toBeGreaterThan(-1);
    expect(h.trace.slice(0, firstShow).filter((t) => t === 'dismiss')).toHaveLength(2);
  });

  it('mounts the Player through the overlay slot with the lesson content and its resume point', async () => {
    render(<><MediaLessonScreen /><OverlaySlot /></>);
    await deliver({ type: 'lesson.open', sessionId: 'sess-1' });
    await waitFor(() => expect(h.shown.length).toBeGreaterThan(0));
    const mount = h.shown[h.shown.length - 1];
    expect(mount.options).toMatchObject({ chrome: 'media', priority: 'high' });
    expect(h.player.play).toMatchObject({ contentId: 'plex:4242' });
  });

  // Found by mutation testing: dropping `seconds` survived the whole suite, and
  // a half-watched lesson restarting from zero is the loudest bug this feature
  // could ship — every checkpoint already cleared would be re-asked.
  it('resumes a half-watched lesson where the child left it', async () => {
    vi.stubGlobal('fetch', stubFetch({ session: { ...SNAPSHOT, resumePosition: 240, cleared: ['cp-100'] } }));
    render(<><MediaLessonScreen /><OverlaySlot /></>);
    await deliver({ type: 'lesson.open', sessionId: 'sess-1' });
    await waitFor(() => expect(h.player.play).toBeTruthy());
    expect(h.player.play).toMatchObject({ contentId: 'plex:4242', seconds: 240 });
  });

  it('goes quiet in the layout once the lesson is playing — the Player owns the screen', async () => {
    await openLesson();
    expect(screen.queryByTestId('media-lesson')).toBeNull();
  });

  it('reports the playhead the CLOCK is sampling, not the one it was launched with', async () => {
    await openLesson();
    h.posts.length = 0;
    await tick(101);
    await waitFor(() => expect(screen.getByTestId('checkpoint-quiz')).toBeInTheDocument());
    // The gate hit is the single most useful heartbeat there is, and the
    // periodic one stops at a checkpoint — so this post is the position wiring's
    // only witness.
    const post = h.posts.find((p) => p.href.endsWith('/position'));
    expect(post).toBeTruthy();
    expect(post.body.position).toBe(101);
  });

  // ── the surround frame ──────────────────────────────────────────────────
  it('frames a VIDEO lesson with the checkpoint map and the score placard', async () => {
    await openLesson({ tag: 'video' });
    await waitFor(() => expect(document.querySelector('.surround-frame')).toBeTruthy());
    expect(screen.getByTestId('lesson-checkpoint-map')).toBeInTheDocument();
    expect(screen.getByTestId('lesson-score-name')).toHaveTextContent('User_4');
  });

  it('does NOT frame an AUDIO lesson — there is no media box to letterbox', async () => {
    await openLesson({ tag: 'audio' });
    await new Promise((r) => setTimeout(r, 20));
    expect(document.querySelector('.surround-frame')).toBeNull();
  });

  // ── the gate ────────────────────────────────────────────────────────────
  it('STOPS the video at an authored checkpoint and puts the question up', async () => {
    const { el } = await openLesson();
    expect(el.paused).toBe(false);
    await tick(101);
    await waitFor(() => expect(screen.getByTestId('checkpoint-quiz')).toBeInTheDocument());
    expect(el.pause).toHaveBeenCalled();
    expect(el.paused).toBe(true);
    expect(screen.getByText('What holds the planets in orbit?')).toBeInTheDocument();
  });

  it('keeps the question mounted through the ✓ beat, then resumes the video', async () => {
    const { el } = await openLesson({ celebrateMs: 60 });
    await tick(101);
    await waitFor(() => expect(screen.getByTestId('checkpoint-quiz')).toBeInTheDocument());
    el.play.mockClear();

    // Answer through the real focus ring: arm, then confirm.
    await emit('select');
    await emit('select');

    // THE ✓ BEAT. The hook has left `checkpoint` for `celebrating`; the overlay
    // must still be mounted or the tick never paints.
    await waitFor(() => expect(screen.getByTestId('checkpoint-cleared')).toBeInTheDocument());
    expect(el.paused).toBe(true);

    // …and the beat ending is what publishes the clear and releases the gate.
    await waitFor(() => expect(screen.queryByTestId('checkpoint-quiz')).toBeNull());
    await waitFor(() => expect(el.play).toHaveBeenCalled());
  });

  // ── escape ──────────────────────────────────────────────────────────────
  it('claims the screen framework\'s escape while a checkpoint is up, and gives it back after', async () => {
    await openLesson();
    expect(h.interceptor).toBeNull();
    await tick(101);
    await waitFor(() => expect(screen.getByTestId('checkpoint-quiz')).toBeInTheDocument());
    expect(typeof h.interceptor).toBe('function');
    expect(h.interceptor()).toBe(true);

    await emit('select');
    await emit('select');
    await waitFor(() => expect(screen.queryByTestId('checkpoint-quiz')).toBeNull());
    expect(h.interceptor).toBeNull();
  });

  // ── the Player leaving mid-checkpoint ───────────────────────────────────
  it('lets the Player win when it clears mid-checkpoint: the lesson ENDS and claims nothing', async () => {
    await openLesson();
    await tick(101);
    await waitFor(() => expect(screen.getByTestId('checkpoint-quiz')).toBeInTheDocument());

    await act(async () => { h.player.clear(); });

    expect(screen.queryByTestId('checkpoint-quiz')).toBeNull();
    expect(h.overlay.get()).toBeNull();
    expect(h.posts.some((p) => p.href.endsWith('/ended'))).toBe(false);
    expect(h.interceptor).toBeNull();
  });

  // ── a lesson that never opened ──────────────────────────────────────────
  it('says so when the server has already let the session go, and back takes it away', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 410, json: async () => ({}) })));
    render(<><MediaLessonScreen /><OverlaySlot /></>);
    await deliver({ type: 'lesson.open', sessionId: 'sess-gone' });
    await waitFor(() => expect(screen.getByTestId('media-lesson-notice'))
      .toHaveTextContent('That lesson is finished'));
    // Nothing was mounted, so there is no picture to strand — and no Player to
    // tear down when the child presses back.
    expect(h.shown).toHaveLength(0);
    await emit('escape');
    expect(screen.queryByTestId('media-lesson-notice')).toBeNull();
  });

  // ── the end ─────────────────────────────────────────────────────────────
  it('claims the lesson only on Player semantic completion, once, and celebrates it', async () => {
    await openLesson({ celebrateMs: 10000 });
    await act(async () => {
      const pending = h.player.onPlaybackCompleted({ reason: 'natural-end', assetId: 'plex:4242' });
      h.player.clear();
      h.player.onPlaybackCompleted({ reason: 'natural-end', assetId: 'plex:4242' });
      await pending;
    });
    await waitFor(() => expect(h.posts.some((p) => p.href.endsWith('/ended'))).toBe(true));
    expect(h.posts.filter((p) => p.href.endsWith('/ended'))).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId('media-lesson-celebrate')).toBeInTheDocument());
    expect(h.overlay.get()).toBeNull();
  });
});

describe('the widget registry', () => {
  it('registers `school-lesson`', async () => {
    const { registerBuiltinWidgets } = await import('../../../screen-framework/widgets/builtins.js');
    const { default: MediaLessonScreenDefault } = await import('./MediaLessonScreen.jsx');
    expect(registerBuiltinWidgets().get('school-lesson')).toBe(MediaLessonScreenDefault);
  });
});
