/**
 * Dash subscribe-time diagnostics — Task 4.5.
 *
 * VideoPlayer polls for `el.api` on a 100ms interval and only then subscribes to
 * dash.js events. Anything emitted before the poll wins is lost, so on
 * 2026-08-16 the absence of `dash.manifest-loaded` was read as "no manifest ever
 * loaded" while Plex's server log showed segments being served throughout. These
 * tests pin the three things that make that absence interpretable: the api-ready
 * line now carries the player's state, an api that never arrives says so, and an
 * element torn down before its api arrives says so differently.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';

const events = [];

vi.mock('../lib/dashCleanup.js', () => ({ cleanupDashElement: vi.fn() }));

// The ledger's verdict is the input to the level under test; the ledger itself
// has its own tests and driving it from here would only obscure which is failing.
vi.mock('../lib/dashErrorRecovery.js', () => ({ requestDashErrorRecovery: vi.fn() }));

// Defined inside the factory: vi.mock is hoisted above every const in the file.
vi.mock('../../../lib/logging/Logger.js', () => {
  const record = (level) => (event, data, options) => { events.push({ level, event, data, options }); };
  const stub = {
    debug: record('debug'),
    info: record('info'),
    warn: record('warn'),
    error: record('error'),
    log: record('log'),
    sampled: record('sampled'),
    child: () => stub
  };
  return { __esModule: true, getLogger: () => stub, default: () => stub };
});

import { VideoPlayer } from './VideoPlayer.jsx';
import { requestDashErrorRecovery } from '../lib/dashErrorRecovery.js';

const dashProps = (media) => ({
  media: { mediaType: 'dash_video', title: 'Introduction to Singing', mediaUrl: '/a.mpd', ...media },
  advance: vi.fn(),
  clear: vi.fn()
});

const named = (event) => events.filter((e) => e.event === event);
const apiReady = () => named('dash.api-ready');
const neverReady = () => named('dash.api-never-ready');

/** A dash.js player mid-playback — the case that was invisible to us. */
const runningApi = () => ({
  isReady: () => true,
  getActiveStream: () => ({ getId: () => 'stream-0' }),
  time: () => 42.5,
  duration: () => 3600,
  getSource: () => 'https://plex.test/start.mpd',
  on: vi.fn(),
  // dash-video-element calls this itself when the src attribute changes, which
  // the refresh-url recovery path below does for real.
  attachSource: vi.fn()
});

/** Attaches an api to the rendered <dash-video> and lets the poll find it. */
const attachApi = (container, api) => {
  const el = container.querySelector('dash-video');
  expect(el).toBeTruthy();
  el.api = api;
  act(() => { vi.advanceTimersByTime(150); });
  return el;
};

beforeEach(() => {
  events.length = 0;
  requestDashErrorRecovery.mockReset();
  requestDashErrorRecovery.mockReturnValue({ fire: false, decision: {}, gate: null });
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('dash.api-ready carries state, not just the fact of arrival', () => {
  it('reports the player state that proves a stream was already running', () => {
    const { container } = render(<VideoPlayer {...dashProps()} />);
    attachApi(container, runningApi());

    expect(apiReady()).toHaveLength(1);
    expect(apiReady()[0].data).toMatchObject({
      isReady: true,
      activeStreamId: 'stream-0',
      time: 42.5,
      duration: 3600
    });
    // Empty means every accessor answered. A named field would mean that
    // field's null is "not measured" rather than "measured as nothing".
    expect(apiReady()[0].data.unreadable).toEqual({});
  });

  it('stamps how long the element generation waited for its api', () => {
    const { container } = render(<VideoPlayer {...dashProps()} />);
    attachApi(container, runningApi());

    expect(apiReady()[0].data.msFromMountToApiReady).toEqual(expect.any(Number));
    expect(apiReady()[0].data.msFromMountToApiReady).toBeGreaterThanOrEqual(0);
  });

  it('no longer counts event constants, which were always zero', () => {
    const { container } = render(<VideoPlayer {...dashProps()} />);
    attachApi(container, runningApi());
    expect(apiReady()[0].data).not.toHaveProperty('events');
  });

  it('survives a dash.js build whose getters throw, and says which one did', () => {
    const { container } = render(<VideoPlayer {...dashProps()} />);
    attachApi(container, {
      ...runningApi(),
      duration: () => { throw new Error('not initialised'); }
    });

    expect(apiReady()).toHaveLength(1);
    expect(apiReady()[0].data.duration).toBeNull();
    expect(apiReady()[0].data.unreadable).toMatchObject({ duration: 'threw' });
    // The rest of the snapshot must still arrive.
    expect(apiReady()[0].data.isReady).toBe(true);
  });

  it('subscribes to dash events as well as reading state', () => {
    const api = runningApi();
    const { container } = render(<VideoPlayer {...dashProps()} />);
    attachApi(container, api);

    const subscribed = api.on.mock.calls.map(([name]) => name);
    expect(subscribed).toContain('manifestLoaded');
    expect(subscribed).toContain('playbackStarted');
  });
});

describe('dash.api-never-ready — an api that does not arrive says so', () => {
  it('warns once the wait passes the timeout, so silence is no longer ambiguous', () => {
    render(<VideoPlayer {...dashProps()} />);
    expect(neverReady()).toHaveLength(0);

    act(() => { vi.advanceTimersByTime(15000); });

    expect(neverReady()).toHaveLength(1);
    expect(neverReady()[0].level).toBe('warn');
    expect(neverReady()[0].data).toMatchObject({ reason: 'timeout', elTag: 'dash-video' });
    expect(neverReady()[0].data.msWaited).toBeGreaterThanOrEqual(15000);
  });

  it('stays quiet when the api does arrive', () => {
    const { container } = render(<VideoPlayer {...dashProps()} />);
    attachApi(container, runningApi());

    act(() => { vi.advanceTimersByTime(30000); });
    expect(neverReady()).toHaveLength(0);
  });

  it('flags a late api, because every event before the subscription is still lost', () => {
    const { container } = render(<VideoPlayer {...dashProps()} />);
    act(() => { vi.advanceTimersByTime(15000); });
    expect(neverReady()).toHaveLength(1);

    attachApi(container, runningApi());
    expect(apiReady()[0].data.afterNeverReadyTimeout).toBe(true);
  });

  it('marks the normal case as not-late', () => {
    const { container } = render(<VideoPlayer {...dashProps()} />);
    attachApi(container, runningApi());
    expect(apiReady()[0].data.afterNeverReadyTimeout).toBe(false);
  });
});

describe('dash.api-never-ready — the storm signature', () => {
  it('reports an element torn down before its api arrived, with a distinct reason', () => {
    const { unmount } = render(<VideoPlayer {...dashProps()} />);
    unmount();

    expect(neverReady()).toHaveLength(1);
    expect(neverReady()[0].data).toMatchObject({
      reason: 'torn-down-before-ready',
      apiPresentAtTeardown: false
    });
  });

  it('is rate limited, because fast churn is exactly when it fires most', () => {
    const { unmount } = render(<VideoPlayer {...dashProps()} />);
    unmount();
    expect(neverReady()[0].level).toBe('sampled');
    expect(neverReady()[0].options).toMatchObject({ maxPerMinute: 30, aggregate: true });
  });

  it('says nothing on teardown once the api was reached', () => {
    const { container, unmount } = render(<VideoPlayer {...dashProps()} />);
    attachApi(container, runningApi());
    unmount();
    expect(neverReady()).toHaveLength(0);
  });

  it('does not double-report an element that already timed out', () => {
    const { unmount } = render(<VideoPlayer {...dashProps()} />);
    act(() => { vi.advanceTimersByTime(15000); });
    unmount();

    expect(neverReady()).toHaveLength(1);
    expect(neverReady()[0].data.reason).toBe('timeout');
  });
});

describe('dash.error-recovery-budget-denied is visible at production level', () => {
  /** Fires a dash.js error through the handler VideoPlayer subscribed. */
  const fireDashError = (api) => {
    const handler = api.on.mock.calls.find(([name]) => name === 'error')?.[1];
    expect(handler).toBeTypeOf('function');
    act(() => {
      handler({ error: { code: 27, message: 'segment unavailable' } });
    });
  };

  it('warns when the ledger denies a refresh, rather than dropping to debug', () => {
    requestDashErrorRecovery.mockReturnValue({
      fire: false,
      decision: { reason: 'source-error' },
      gate: { deniedBy: 'mount-budget', attempt: 4 }
    });

    const api = runningApi();
    const { container } = render(<VideoPlayer {...dashProps()} />);
    attachApi(container, api);
    fireDashError(api);

    const denied = named('dash.error-recovery-budget-denied');
    expect(denied).toHaveLength(1);
    // Production runs at info. At debug this line did not exist in prod, so a
    // storm that had spent its budget showed only dash.error lines that had
    // stopped having any consequence, with nothing saying why.
    expect(denied[0].level).toBe('warn');
    expect(denied[0].data).toMatchObject({ deniedBy: 'mount-budget', attempt: 4 });
  });

  it('says nothing about a denial when the refresh was allowed to fire', () => {
    requestDashErrorRecovery.mockReturnValue({
      fire: true,
      decision: { reason: 'source-error' },
      gate: { attempt: 1 }
    });

    const api = runningApi();
    const { container } = render(<VideoPlayer {...dashProps()} />);
    attachApi(container, api);
    fireDashError(api);

    expect(named('dash.error-recovery-budget-denied')).toHaveLength(0);
    expect(named('dash.error-recovery')).toHaveLength(1);
  });
});
