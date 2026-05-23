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
