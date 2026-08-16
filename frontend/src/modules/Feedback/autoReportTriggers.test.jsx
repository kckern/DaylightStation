/**
 * The three triggers that make a broken kiosk file its own report.
 *
 * autoReport itself is unit-tested in autoReport.test.js; here it is mocked, and
 * what is under test is whether the surfaces that KNOW something is wrong
 * actually say so. Each of these three sites already had the knowledge and kept
 * it to itself: the error boundary rendered "Playback failed", the render
 * watchdog logged a jank episode into a log that later got truncated, and the
 * session publisher shipped a `position` nobody compared.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';

vi.mock('./autoReport.js', () => ({ autoReport: vi.fn(() => Promise.resolve(null)) }));
vi.mock('../../services/WebSocketService.js', () => ({ wsService: { send: vi.fn() } }));

import { autoReport } from './autoReport.js';
import PlayerBoundary from '../Piano/PianoKiosk/modes/Videos/PlayerBoundary.jsx';
import { useRenderWatchdog } from '../Piano/PianoKiosk/useRenderWatchdog.js';
import { useSessionStatePublisher } from '../../screen-framework/publishers/useSessionStatePublisher.js';

beforeEach(() => { autoReport.mockClear(); });

// ── Trigger 1: an error boundary catching a crash ────────────────────────────

describe('PlayerBoundary', () => {
  function Boom() { throw new Error('dash blew up'); }

  it('files a report when the player crashes', () => {
    // React logs caught boundary errors to console.error; keep the run readable.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      render(<PlayerBoundary onBack={() => {}}><Boom /></PlayerBoundary>);
    } finally { spy.mockRestore(); }

    expect(autoReport).toHaveBeenCalledTimes(1);
    const arg = autoReport.mock.calls[0][0];
    expect(arg.app).toBe('piano');
    expect(arg.reason).toBe('error-boundary');
    expect(arg.detail.error).toBe('dash blew up');
    expect(arg.detail.componentStack).toContain('Boom');
  });

  it('still shows the fallback UI — the report is in addition, not instead', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    let view;
    try {
      view = render(<PlayerBoundary onBack={() => {}}><Boom /></PlayerBoundary>);
    } finally { spy.mockRestore(); }

    expect(view.container.textContent).toContain('Playback failed');
  });
});

// ── Trigger 2: the render watchdog's jank episode ────────────────────────────

describe('useRenderWatchdog', () => {
  let pending, fakeNow, originalRaf, originalCaf, originalPerfNow;

  beforeEach(() => {
    pending = [];
    fakeNow = 0;
    originalRaf = window.requestAnimationFrame;
    originalCaf = window.cancelAnimationFrame;
    originalPerfNow = performance.now;
    window.requestAnimationFrame = (cb) => { pending.push(cb); return pending.length; };
    window.cancelAnimationFrame = () => {};
    performance.now = () => fakeNow;
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRaf;
    window.cancelAnimationFrame = originalCaf;
    performance.now = originalPerfNow;
  });

  /** One presented frame per simulated second — an fps of 1, deep in jank. */
  function frame() {
    const cb = pending.shift();
    fakeNow += 1000;
    act(() => { cb?.(); });
  }

  it('files a report once a jank episode is sustained past the grace window', () => {
    renderHook(() => useRenderWatchdog({ heartbeat: false, onBeat: undefined }));

    // graceMs is 8s and sustainSeconds is 4, so 12 one-fps seconds crosses both.
    for (let i = 0; i < 13; i += 1) frame();

    expect(autoReport).toHaveBeenCalledTimes(1);
    const arg = autoReport.mock.calls[0][0];
    expect(arg.app).toBe('piano');
    expect(arg.reason).toBe('render-watchdog');
    expect(arg.detail.fps).toBeLessThan(12);
  });

  it('does not file while frames are healthy', () => {
    renderHook(() => useRenderWatchdog({ heartbeat: false }));

    // 60 frames per simulated second is a healthy screen.
    for (let s = 0; s < 15; s += 1) {
      for (let f = 0; f < 59; f += 1) {
        const cb = pending.shift();
        act(() => { cb?.(); });
      }
      frame();
    }

    expect(autoReport).not.toHaveBeenCalled();
  });
});

// ── Trigger 3: a sustained playback stall on the device heartbeat ────────────

describe('useSessionStatePublisher stall trigger', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  function playingSnapshot(position) {
    return {
      sessionId: 's-1',
      state: 'playing',
      currentItem: { contentId: 'plex:694719', format: 'dash_video', title: 'A lecture', duration: 1800 },
      position,
      queue: { items: [], currentIndex: -1, upNextCount: 0 },
      config: { shuffle: false, repeat: 'off', shader: null, volume: 50 },
      meta: { ownerId: 'piano-tablet', updatedAt: new Date().toISOString() },
    };
  }

  it('files one report when the playhead stops advancing', () => {
    let position = 0;
    renderHook(() => useSessionStatePublisher({
      deviceId: 'piano-tablet',
      getSnapshot: () => playingSnapshot(position),
      subscribe: () => () => {},
    }));

    // 5s heartbeats for five minutes with a frozen playhead.
    act(() => { vi.advanceTimersByTime(5 * 60 * 1000); });

    expect(autoReport).toHaveBeenCalledTimes(1);
    const arg = autoReport.mock.calls[0][0];
    expect(arg.reason).toBe('playback-stall');
    expect(arg.detail.deviceId).toBe('piano-tablet');
    expect(arg.detail.contentId).toBe('plex:694719');

    // And it recovers: once the playhead moves and freezes again, that is a new
    // episode, which autoReport's own dedupe key then governs.
    position = 100;
    act(() => { vi.advanceTimersByTime(10 * 1000); });
    act(() => { vi.advanceTimersByTime(5 * 60 * 1000); });
    expect(autoReport).toHaveBeenCalledTimes(2);
  });

  it('files nothing while the playhead advances', () => {
    let position = 0;
    renderHook(() => useSessionStatePublisher({
      deviceId: 'piano-tablet',
      getSnapshot: () => { position += 5; return playingSnapshot(position); },
      subscribe: () => () => {},
    }));

    act(() => { vi.advanceTimersByTime(10 * 60 * 1000); });

    expect(autoReport).not.toHaveBeenCalled();
  });

  it('files nothing for a paused screen', () => {
    renderHook(() => useSessionStatePublisher({
      deviceId: 'piano-tablet',
      getSnapshot: () => ({ ...playingSnapshot(42), state: 'paused' }),
      subscribe: () => () => {},
    }));

    act(() => { vi.advanceTimersByTime(10 * 60 * 1000); });

    expect(autoReport).not.toHaveBeenCalled();
  });
});
