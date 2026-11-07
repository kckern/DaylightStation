import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, act } from '@testing-library/react';
import HoldProgress, { resolveHoldBar, isBelowTarget } from './HoldProgress.jsx';

const seq = [{ id: 'cool' }, { id: 'active' }, { id: 'warm' }];
const row = (overrides = {}) => ({
  key: 'rider-a', userId: 'rider-a', displayName: 'Rider A',
  currentZone: { id: 'warm' }, targetZone: { id: 'warm', color: '#eab308' }, zoneSequence: seq,
  holdProgress: { elapsedMs: 3000, remainingMs: 7000, totalMs: 10000 }, holdPaused: false,
  ...overrides,
});

afterEach(() => { vi.useRealTimers(); });

describe('resolveHoldBar', () => {
  it('counting: whole-second countdown', () => {
    expect(resolveHoldBar({ elapsedMs: 3000, totalMs: 10000 })).toMatchObject({ phase: 'counting', label: 'Hold 7s' });
    expect(resolveHoldBar({ elapsedMs: 3200, totalMs: 10000 }).label).toBe('Hold 7s');
    expect(resolveHoldBar({ elapsedMs: 9900, totalMs: 10000 }).label).toBe('Hold 1s');
  });
  it('out of zone: "Keep going" once a hold was seen, nothing before', () => {
    expect(resolveHoldBar(null, { seenHold: true })).toMatchObject({ phase: 'out', fraction: 0, label: 'Keep going' });
    expect(resolveHoldBar(null)).toMatchObject({ phase: 'none', label: null });
    // in the engine's dip grace the hold still counts, but the rider is told
    expect(resolveHoldBar({ elapsedMs: 3000, totalMs: 10000 }, { belowTarget: true })).toMatchObject({ phase: 'counting', label: 'Keep going' });
  });
  it('satisfied: full, no label', () => {
    expect(resolveHoldBar({ elapsedMs: 10000, totalMs: 10000 })).toMatchObject({ phase: 'done', fraction: 1, label: null });
  });
  it('zero hold is no indicator', () => {
    expect(resolveHoldBar({ elapsedMs: 0, totalMs: 0 }).phase).toBe('none');
  });
  it('isBelowTarget compares live zone with target', () => {
    expect(isBelowTarget(row())).toBe(false);
    expect(isBelowTarget(row({ currentZone: { id: 'active' } }))).toBe(true);
  });
});

describe('HoldProgress', () => {
  const fill = (c) => c.querySelector('.governance-hold-progress > span');
  const label = (c) => c.querySelector('.governance-hold__label').textContent;

  it('animates with one transform animation, never width', () => {
    const { container } = render(<HoldProgress row={row()} now={() => 50000} />);
    const f = fill(container);
    expect(f.classList.contains('governance-hold-progress__fill--running')).toBe(true);
    expect(f.style.animationDuration).toBe('10000ms');
    expect(f.style.animationDelay).toBe('-3000ms');
    expect(f.style.width).toBe('');
    expect(label(container)).toBe('Hold 7s');
  });

  it('does not restart the animation for a late snapshot of the same hold, but resyncs on a reset', () => {
    let t = 50000;
    const view = render(<HoldProgress row={row()} now={() => t} />);
    const first = fill(view.container);
    // 2s later the engine reports 4.8s elapsed (evaluated ~200ms before render)
    t = 52000;
    view.rerender(<HoldProgress row={row({ holdProgress: { elapsedMs: 4800, remainingMs: 5200, totalMs: 10000 } })} now={() => t} />);
    expect(fill(view.container)).toBe(first); // same element: animation keeps running
    expect(fill(view.container).style.animationDelay).toBe('-5000ms');
    // hold reset by the engine (dropped and re-entered) → new animation
    t = 53000;
    view.rerender(<HoldProgress row={row({ holdProgress: { elapsedMs: 0, remainingMs: 10000, totalMs: 10000 } })} now={() => t} />);
    expect(fill(view.container)).not.toBe(first);
    expect(fill(view.container).style.animationDelay).toBe('0ms');
  });

  it('paused: frozen static transform, no animation, label holds still', () => {
    vi.useFakeTimers();
    let t = 50000;
    const view = render(<HoldProgress row={row({ holdPaused: true })} now={() => t} />);
    const f = fill(view.container);
    expect(f.classList.contains('governance-hold-progress__fill--running')).toBe(false);
    expect(f.style.transform).toBe('scaleX(0.3)');
    t = 55000;
    act(() => { vi.advanceTimersByTime(5000); });
    view.rerender(<HoldProgress row={row({ holdPaused: true })} now={() => t} />);
    expect(fill(view.container).style.transform).toBe('scaleX(0.3)');
    expect(label(view.container)).toBe('Hold 7s');
    // resume picks up from the frozen point
    view.rerender(<HoldProgress row={row({ holdPaused: false })} now={() => t} />);
    expect(fill(view.container).style.animationDelay).toBe('-3000ms');
  });

  it('counts the label down each second without new snapshots', () => {
    vi.useFakeTimers();
    vi.setSystemTime(100000);
    const { container } = render(<HoldProgress row={row()} />);
    expect(label(container)).toBe('Hold 7s');
    act(() => { vi.advanceTimersByTime(2100); });
    expect(label(container)).toBe('Hold 5s');
  });

  it('dropped out of the zone: empty track with "Keep going"; satisfied: full bar, no label', () => {
    const view = render(<HoldProgress row={row()} now={() => 50000} />);
    view.rerender(<HoldProgress row={row({ holdProgress: null, currentZone: { id: 'active' } })} now={() => 51000} />);
    expect(label(view.container)).toBe('Keep going');
    expect(fill(view.container).style.transform).toBe('scaleX(0)');
    expect(view.container.querySelector('.governance-hold--out')).toBeTruthy();
    view.rerender(<HoldProgress row={row({ holdProgress: { elapsedMs: 10000, remainingMs: 0, totalMs: 10000 } })} now={() => 61000} />);
    expect(label(view.container)).toBe('');
    expect(fill(view.container).style.transform).toBe('scaleX(1)');
  });

  it('never shows before a hold has started', () => {
    const { container } = render(<HoldProgress row={row({ holdProgress: null })} />);
    expect(container.firstChild).toBeNull();
  });
});
