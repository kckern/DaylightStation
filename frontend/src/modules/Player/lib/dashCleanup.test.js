import { describe, it, expect, beforeEach, vi } from 'vitest';

// Capture every emit so a test can read back what the cleanup reported. The
// module resolves its child logger lazily, so this mock is in place well before
// the first call.
const emits = { sampled: [], warn: [], info: [], error: [], debug: [] };
vi.mock('../../../lib/logging/Logger.js', () => {
  const stub = {
    debug: (event, data) => { emits.debug.push({ event, data }); },
    info: (event, data) => { emits.info.push({ event, data }); },
    warn: (event, data) => { emits.warn.push({ event, data }); },
    error: (event, data) => { emits.error.push({ event, data }); },
    sampled: (event, data, opts) => { emits.sampled.push({ event, data, opts }); },
    child: function () { return this; }
  };
  return { __esModule: true, getLogger: () => stub, default: () => stub };
});

import {
  cleanupDashElement,
  getDashCleanupCounters,
  _resetDashCleanupCountersForTests
} from './dashCleanup.js';

const makeMediaEl = ({ src = 'https://plex.example/stream.mpd', pause, load } = {}) => {
  const el = {
    src,
    paused: false,
    removedSrc: false,
    loaded: false,
    pause: pause || (() => { el.paused = true; }),
    removeAttribute: (name) => { if (name === 'src') { el.src = ''; el.removedSrc = true; } },
    load: load || (() => { el.loaded = true; })
  };
  return el;
};

/** A <dash-video>-shaped stand-in: shadow root holding the real <video>. */
const makeDashEl = ({ api, mediaEl, shadow = true, destroy, reset } = {}) => ({
  api,
  destroy,
  reset,
  shadowRoot: shadow ? { querySelector: () => mediaEl || null } : null
});

const outcomeEvents = () => emits.sampled.filter((e) => e.event === 'dash-cleanup.outcome');
const failedEvents = () => emits.sampled.filter((e) => e.event === 'dash-cleanup.failed');
const lastPayload = () => emits.sampled[emits.sampled.length - 1].data;

describe('cleanupDashElement instrumentation', () => {
  beforeEach(() => {
    emits.sampled.length = 0;
    emits.warn.length = 0;
    emits.info.length = 0;
    emits.error.length = 0;
    emits.debug.length = 0;
    _resetDashCleanupCountersForTests();
    URL.revokeObjectURL = vi.fn();
  });

  it('reports a successful teardown as cleaned, with what it actually released', () => {
    const mediaEl = makeMediaEl();
    const destroy = vi.fn();
    cleanupDashElement(makeDashEl({ api: { destroy }, mediaEl }));

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(mediaEl.removedSrc).toBe(true);
    expect(mediaEl.loaded).toBe(true);

    expect(failedEvents()).toHaveLength(0);
    expect(outcomeEvents()).toHaveLength(1);
    expect(lastPayload()).toMatchObject({
      outcome: 'cleaned',
      hadApi: true,
      apiDestroyOk: true,
      componentTeardown: 'none',
      componentDestroyOk: null,
      mediaElLookup: 'found',
      foundMediaEl: true,
      pauseOk: true,
      srcScheme: 'https',
      blobRevoked: null,
      releaseOk: true,
      error: null
    });
    expect(getDashCleanupCounters()).toMatchObject({ attempted: 1, failed: 0, cleaned: 1, noOp: 0 });
  });

  // A native <video> is NOT a no-op: VideoPlayer renders the dash and native
  // branches under the same containerRef and the same dashElementKey, so this
  // cleanup runs for both. Skipping the native one left a replaced element
  // playing with no DOM node and no controls — the 2026-08-16 "audio from
  // nowhere" report. It must be paused and released like any other.
  it('a native <video> generation is cleaned, not skipped', () => {
    const el = makeMediaEl();
    el.shadowRoot = null;
    cleanupDashElement(el);

    expect(el.paused).toBe(true);
    expect(el.removedSrc).toBe(true);
    expect(failedEvents()).toHaveLength(0);
    expect(lastPayload()).toMatchObject({
      outcome: 'cleaned',
      hadApi: false,
      mediaElLookup: 'native-element',
      foundMediaEl: true,
      pauseOk: true,
      releaseOk: true,
      error: null
    });
    expect(getDashCleanupCounters()).toMatchObject({ attempted: 1, failed: 0, cleaned: 1, noOp: 0 });
  });

  it('a non-media container with no shadow root is still a no-op', () => {
    cleanupDashElement({ shadowRoot: null });

    expect(failedEvents()).toHaveLength(0);
    expect(lastPayload()).toMatchObject({
      outcome: 'no-op',
      mediaElLookup: 'no-shadow-root',
      foundMediaEl: false
    });
  });

  it('a dash wrapper whose inner element cannot be reached is a FAILURE, under its own event name', () => {
    // This is the 2026-08-16 leak: removeAttribute('src')/load() never run and
    // the inner <video> keeps pulling segments. It must not read as a no-op.
    cleanupDashElement(makeDashEl({ api: { destroy: () => {} }, mediaEl: null }));

    expect(outcomeEvents()).toHaveLength(0);
    expect(failedEvents()).toHaveLength(1);
    expect(failedEvents()[0].data).toMatchObject({
      outcome: 'failed',
      hadApi: true,
      apiDestroyOk: true,
      mediaElLookup: 'shadow-root-empty',
      foundMediaEl: false,
      releaseOk: null,
      error: null
    });
    expect(getDashCleanupCounters()).toMatchObject({ attempted: 1, failed: 1, cleaned: 0, noOp: 0 });
  });

  it('never throws when api.destroy throws, and still releases the inner element', () => {
    const mediaEl = makeMediaEl();
    const el = makeDashEl({ api: { destroy: () => { throw new Error('destroy boom'); } }, mediaEl });

    expect(() => cleanupDashElement(el)).not.toThrow();

    expect(mediaEl.removedSrc).toBe(true);
    expect(failedEvents()).toHaveLength(1);
    expect(failedEvents()[0].data).toMatchObject({
      outcome: 'failed',
      hadApi: true,
      apiDestroyOk: false,
      releaseOk: true
    });
    expect(failedEvents()[0].data.error).toContain('api-destroy: destroy boom');
    expect(getDashCleanupCounters()).toMatchObject({ attempted: 1, failed: 1 });
  });

  it('a throwing pause() no longer cancels the release that stops the fetching', () => {
    const mediaEl = makeMediaEl({ pause: () => { throw new Error('pause boom'); } });
    cleanupDashElement(makeDashEl({ mediaEl }));

    expect(mediaEl.removedSrc).toBe(true);
    expect(mediaEl.loaded).toBe(true);
    expect(failedEvents()[0].data).toMatchObject({ pauseOk: false, releaseOk: true, outcome: 'failed' });
    expect(failedEvents()[0].data.error).toContain('pause: pause boom');
  });

  it('records a failed release separately from a failed pause', () => {
    const mediaEl = makeMediaEl({ load: () => { throw new Error('load boom'); } });
    cleanupDashElement(makeDashEl({ mediaEl }));

    expect(failedEvents()[0].data).toMatchObject({ pauseOk: true, releaseOk: false, foundMediaEl: true });
    expect(failedEvents()[0].data.error).toContain('release: load boom');
  });

  it('names the src scheme and revokes a blob url', () => {
    const mediaEl = makeMediaEl({ src: 'blob:https://kiosk/abc-123' });
    cleanupDashElement(makeDashEl({ mediaEl }));

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:https://kiosk/abc-123');
    expect(lastPayload()).toMatchObject({ srcScheme: 'blob', blobRevoked: true, outcome: 'cleaned' });
  });

  it('uses the web component destroy/reset fallback and says which one it used', () => {
    const mediaEl = makeMediaEl();
    const reset = vi.fn();
    cleanupDashElement(makeDashEl({ mediaEl, reset }));

    expect(reset).toHaveBeenCalledTimes(1);
    expect(lastPayload()).toMatchObject({
      componentTeardown: 'reset',
      componentDestroyOk: true,
      hadApi: false,
      apiDestroyOk: null,
      outcome: 'cleaned'
    });
  });

  it('a null element is reported as no-element, not as a failure', () => {
    expect(() => cleanupDashElement(null)).not.toThrow();
    expect(failedEvents()).toHaveLength(0);
    expect(lastPayload()).toMatchObject({ outcome: 'no-element', mediaElLookup: 'no-element', foundMediaEl: false });
    expect(getDashCleanupCounters()).toMatchObject({ attempted: 1, failed: 0, noElement: 1 });
  });

  it('warns once per process on the first failure, then counts the rest', () => {
    for (let i = 0; i < 4; i++) cleanupDashElement(makeDashEl({ api: { destroy: () => {} }, mediaEl: null }));

    expect(emits.warn).toHaveLength(1);
    expect(emits.warn[0].event).toBe('dash-cleanup.first-failure');
    expect(failedEvents()).toHaveLength(4);
    expect(getDashCleanupCounters()).toMatchObject({ attempted: 4, failed: 4 });
  });

  it('exposes a rising failure rate across a mixed run — the leak signal', () => {
    cleanupDashElement(makeDashEl({ mediaEl: makeMediaEl() }));   // cleaned
    cleanupDashElement({ shadowRoot: null });                      // no-op (non-media container)
    cleanupDashElement(makeDashEl({ mediaEl: null }));             // failed
    cleanupDashElement(makeDashEl({ mediaEl: null }));             // failed

    expect(getDashCleanupCounters()).toMatchObject({ attempted: 4, failed: 2, cleaned: 1, noOp: 1 });
    // The running totals ride on every event, so one log line answers "how bad".
    expect(failedEvents()[1].data).toMatchObject({ cleanupsAttempted: 4, cleanupsFailed: 2 });
  });

  it('rate-limits both event names so a remount storm cannot flood the log', () => {
    cleanupDashElement(makeDashEl({ mediaEl: makeMediaEl() }));
    cleanupDashElement(makeDashEl({ mediaEl: null }));

    expect(outcomeEvents()[0].opts).toMatchObject({ aggregate: true });
    expect(outcomeEvents()[0].opts.maxPerMinute).toBeGreaterThan(0);
    expect(failedEvents()[0].opts).toMatchObject({ aggregate: true });
    expect(failedEvents()[0].opts.maxPerMinute).toBeGreaterThan(0);
  });
});
