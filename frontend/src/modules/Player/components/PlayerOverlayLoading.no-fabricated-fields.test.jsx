import React from 'react';
import { render, act } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { PlayerOverlayLoading } from './PlayerOverlayLoading.jsx';

// The regression guard for the class of bug that misled the 2026-08-16
// investigation: an overlay field whose value came from a prop default rather
// than from anything measured. The line read for three minutes was
//
//   [008c56a342] vis:141830ms/0ms | status:Loading… | countdown:n/a | seek:0:00
//   | el:t=0 r=n/a n=n/a p=false | startup:armed attempts=0 timeout=n/a
//
// and four of those fields had no caller anywhere in the repo. `startup:armed
// attempts=0` was read as evidence that the startup watchdog was armed and had
// not retried; it was `?.state || 'armed'` over an object nobody ever passed.
//
// The rule these tests enforce: when an input is absent, the report must say so
// or say nothing. It may never substitute a concrete-looking stand-in.

const playbackLogCalls = [];
vi.mock('../lib/playbackLogger.js', () => ({
  __esModule: true,
  playbackLog: (event, payload, opts) => { playbackLogCalls.push({ event, payload, opts }); }
}));

const summaries = () => playbackLogCalls.filter((c) => c.event === 'overlay-summary');
const lastSummary = () => summaries()[summaries().length - 1];

describe('PlayerOverlayLoading — no field may report a default as a measurement', () => {
  beforeEach(() => {
    playbackLogCalls.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  it('reports nothing it was not told, when told almost nothing', () => {
    render(
      <PlayerOverlayLoading
        shouldRender
        isVisible
        status="startup"
        effectiveMetaIsNull={false}
      />
    );
    act(() => { vi.advanceTimersByTime(1000); });

    // Anti-vacuity: this test is worthless if nothing was emitted to inspect.
    expect(summaries().length).toBeGreaterThan(0);
    const { payload } = lastSummary();
    expect(typeof payload).toBe('object');

    // Fields whose only source was a prop default. Each of these had no caller
    // in the entire repo, so every value it ever reported was invented.
    ['startupState', 'countdownSeconds', 'revealDelayMs', 'videoFps'].forEach((key) => {
      expect(Object.prototype.hasOwnProperty.call(payload, key)).toBe(false);
    });

    // …and the human-readable line must not carry them either.
    expect(payload.summary).not.toMatch(/armed|attempts=|timeout=|countdown:/);
    expect(payload.summary).not.toMatch(/\/0ms/);

    // An absent measurement reads as absent.
    expect(payload.intentPosition).toBeNull();
    expect(payload.waitKey).toBeNull();
    expect(payload.mediaDetails.readyState).toBeNull();
  });

  it('says el:none when there is no element, instead of asserting one', () => {
    render(
      <PlayerOverlayLoading
        shouldRender
        isVisible
        status="startup"
        effectiveMetaIsNull={false}
        mediaDetails={{ hasElement: false, currentTime: null, readyState: null, networkState: null, paused: null }}
      />
    );
    act(() => { vi.advanceTimersByTime(1000); });

    expect(summaries().length).toBeGreaterThan(0);
    const { payload } = lastSummary();
    expect(payload.mediaDetails.hasElement).toBe(false);
    expect(payload.summary).toContain('el:none');
  });

  it('names the element it measured when there is one', () => {
    render(
      <PlayerOverlayLoading
        shouldRender
        isVisible
        status="startup"
        effectiveMetaIsNull={false}
        mediaDetails={{
          hasElement: true,
          elTag: 'dash-video',
          elSource: 'container',
          currentTime: 12.5,
          readyState: 0,
          networkState: 2,
          paused: false
        }}
      />
    );
    act(() => { vi.advanceTimersByTime(1000); });

    const { payload } = lastSummary();
    expect(payload.mediaDetails.elTag).toBe('dash-video');
    expect(payload.mediaDetails.elSource).toBe('container');
    // r=0 is a real readyState. Without elTag/elSource it was indistinguishable
    // from the wrapper case, where readyState is not a number at all.
    expect(payload.summary).toContain('el:dash-video/container');
    expect(payload.summary).toContain('r=0');
  });

  it('ships the structured payload, not a string that discards it', () => {
    render(
      <PlayerOverlayLoading
        shouldRender
        isVisible
        status="stalled"
        stalled
        waitKey="IIni70e01E:0"
        effectiveMetaIsNull={false}
      />
    );
    act(() => { vi.advanceTimersByTime(1000); });

    const { payload, opts } = lastSummary();
    expect(payload.waitKey).toBe('IIni70e01E:0');
    expect(payload.status).toBe('Recovering…');
    expect(payload.stalled).toBe(true);
    expect(typeof payload.timestamp).toBe('string');
    expect(opts?.level).toBe('info');
  });
});

describe('PlayerOverlayLoading — the stall report carries a real playhead', () => {
  beforeEach(() => {
    playbackLogCalls.length = 0;
    vi.useFakeTimers();
  });
  afterEach(() => vi.useRealTimers());

  const stallReports = () =>
    playbackLogCalls.filter((c) => c.event === 'playback.stall_threshold_exceeded');

  // playback.stall_threshold_exceeded reported playheadPosition: null and
  // lastGoodPosition: null on every stall it ever described, because it read a
  // `currentTime` prop no caller supplies. Those nulls were read during the
  // 2026-08-16 investigation as "the player had no position to report".
  it('reports the position it was given, not null', () => {
    const { rerender } = render(
      <PlayerOverlayLoading
        shouldRender
        isVisible
        status="playing"
        stalled={false}
        seconds={42.5}
        effectiveMetaIsNull={false}
      />
    );
    act(() => { vi.advanceTimersByTime(4000); });

    rerender(
      <PlayerOverlayLoading
        shouldRender
        isVisible
        status="stalled"
        stalled
        seconds={42.5}
        effectiveMetaIsNull={false}
      />
    );

    expect(stallReports().length).toBeGreaterThan(0);
    const { payload } = stallReports()[0];
    expect(payload.playheadPosition).toBe(42.5);
    expect(payload.lastGoodPosition).toBe(42.5);
    expect(Object.prototype.hasOwnProperty.call(payload, 'videoFps')).toBe(false);
  });
});
