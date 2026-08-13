import React from 'react';
import { render, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PlayerOverlayLoading } from './PlayerOverlayLoading.jsx';

// Capture logger and playbackLog calls.
const loggerCalls = [];
const playbackLogCalls = [];

vi.mock('../lib/playbackLogger.js', () => ({
  __esModule: true,
  playbackLog: (event, ...rest) => playbackLogCalls.push({ event, rest }),
}));

vi.mock('../../../lib/logging/Logger.js', () => ({
  __esModule: true,
  default: () => ({
    info: (event, ...rest) => loggerCalls.push({ event, rest }),
    warn: (event, ...rest) => loggerCalls.push({ event, rest }),
    error: () => {},
    debug: () => {},
    child: function () { return this; },
    sampled: () => {},
  }),
}));

describe('PlayerOverlayLoading — phantom suppression', () => {
  beforeEach(() => {
    loggerCalls.length = 0;
    playbackLogCalls.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('emits NO overlay-summary log events when effectiveMetaIsNull=true (phantom Player)', () => {
    render(
      <PlayerOverlayLoading
        shouldRender={true}
        isVisible={true}
        status="startup"
        effectiveMetaIsNull={true}
      />
    );
    act(() => { vi.advanceTimersByTime(5000); });
    const overlaySummaries = [...loggerCalls, ...playbackLogCalls].filter(c => c.event === 'overlay-summary');
    expect(overlaySummaries.length).toBe(0);
  });

  it('still emits overlay-summary when effectiveMetaIsNull=false (real Player)', () => {
    render(
      <PlayerOverlayLoading
        shouldRender={true}
        isVisible={true}
        status="startup"
        effectiveMetaIsNull={false}
      />
    );
    act(() => { vi.advanceTimersByTime(2000); });
    const overlaySummaries = [...loggerCalls, ...playbackLogCalls].filter(c => c.event === 'overlay-summary');
    expect(overlaySummaries.length).toBeGreaterThan(0);
  });
});

describe('PlayerOverlayLoading — paused suppression', () => {
  beforeEach(() => {
    loggerCalls.length = 0;
    playbackLogCalls.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  const summaries = () =>
    [...loggerCalls, ...playbackLogCalls].filter((c) => c.event === 'overlay-summary');

  // 2026-08-12: one pause shipped 135 events to the production log at 1/sec,
  // each reporting a spinner that the pause overlay was suppressing.
  it('a paused video with the pause overlay up says nothing', () => {
    render(
      <PlayerOverlayLoading
        shouldRender
        isVisible
        pauseOverlayActive
        isPaused
        showPauseOverlay
        status="paused"
        stalled={false}
        effectiveMetaIsNull={false}
      />
    );
    act(() => { vi.advanceTimersByTime(180_000); });
    expect(summaries().length).toBe(0);
  });

  it('but a STALLED pause still reports — the spinner is really painted then', () => {
    render(
      <PlayerOverlayLoading
        shouldRender
        isVisible
        pauseOverlayActive
        isPaused
        showPauseOverlay
        status="stalled"
        stalled
        effectiveMetaIsNull={false}
      />
    );
    act(() => { vi.advanceTimersByTime(3000); });
    expect(summaries().length).toBeGreaterThan(0);
  });

  it('a recovering start still reports even before anything paints', () => {
    render(
      <PlayerOverlayLoading
        shouldRender
        isVisible
        status="recovering"
        effectiveMetaIsNull={false}
      />
    );
    act(() => { vi.advanceTimersByTime(3000); });
    expect(summaries().length).toBeGreaterThan(0);
  });
});
