import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

const logged = vi.hoisted(() => []);
vi.mock('@/lib/logging/Logger.js', () => {
  const rec = (level) => (event, data) => logged.push({ level, event, data });
  const logger = { child: () => logger, debug: rec('debug'), info: rec('info'), warn: rec('warn'), error: rec('error'), sampled: () => {} };
  return { getLogger: () => logger, default: () => logger };
});

import PlaybackBudgetNotice from './PlaybackBudgetNotice.jsx';

const shown = () => logged.filter((e) => e.event === 'fitness.playback_budget.cover_shown');
const cover = () => screen.getByTestId('playback-budget-overlay');

beforeEach(() => { logged.length = 0; vi.useFakeTimers(); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('PlaybackBudgetNotice', () => {
  it('checking: draws only the backdrop for 1500 ms, then the card with both buttons', () => {
    render(<PlaybackBudgetNotice status="checking" onUnlock={vi.fn()} onBack={vi.fn()} />);
    expect(cover().getAttribute('data-status')).toBe('checking');
    expect(cover().textContent).toBe('');
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(shown()).toHaveLength(0);

    act(() => { vi.advanceTimersByTime(1499); });
    expect(screen.queryByText('Getting your video time…')).toBeNull();

    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByText('Getting your video time…')).toBeTruthy();
    expect(screen.getByText('This only takes a moment.')).toBeTruthy();
    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.getByTestId('playback-budget-unlock').textContent).toBe('Grown-up unlock');
    expect(screen.getByTestId('playback-budget-back').textContent).toBe('Back');
    expect(cover().classList.contains('playback-budget-card--checking')).toBe(true);
    expect(shown()).toEqual([{ level: 'info', event: 'fitness.playback_budget.cover_shown', data: { status: 'checking', delayed: true } }]);
  });

  it.each([
    ['unavailable', "Couldn't check video time", 'Trying again. A grown-up can unlock this video.'],
    ['exhausted', 'Video time is used up for today', 'It starts again tomorrow. A grown-up can join the workout, or unlock this video.'],
  ])('%s: shows title, body and buttons at once', (status, title, body) => {
    render(<PlaybackBudgetNotice status={status} onUnlock={vi.fn()} onBack={vi.fn()} />);
    expect(cover().getAttribute('data-status')).toBe(status);
    expect(cover().classList.contains(`playback-budget-card--${status}`)).toBe(true);
    expect(screen.getByText(title)).toBeTruthy();
    // "grown-up" uses a non-breaking hyphen so it never splits across lines.
    expect(screen.getByRole('status').textContent.replace(/‑/g, '-')).toContain(body);
    expect(screen.getByTestId('playback-budget-unlock')).toBeTruthy();
    expect(screen.getByTestId('playback-budget-back')).toBeTruthy();
    expect(shown()).toEqual([{ level: 'info', event: 'fitness.playback_budget.cover_shown', data: { status, delayed: false } }]);
  });

  it('a check that turns unavailable before 1500 ms shows at once and logs once per status', () => {
    const { rerender } = render(<PlaybackBudgetNotice status="checking" onUnlock={vi.fn()} onBack={vi.fn()} />);
    act(() => { vi.advanceTimersByTime(500); });
    rerender(<PlaybackBudgetNotice status="unavailable" onUnlock={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText("Couldn't check video time")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(5000); });
    rerender(<PlaybackBudgetNotice status="unavailable" onUnlock={vi.fn()} onBack={vi.fn()} />);
    expect(shown().map((e) => e.data)).toEqual([{ status: 'unavailable', delayed: false }]);
  });

  it('pointerdown on Grown-up unlock calls onUnlock; Enter on Back calls onBack', () => {
    const onUnlock = vi.fn();
    const onBack = vi.fn();
    render(<PlaybackBudgetNotice status="exhausted" onUnlock={onUnlock} onBack={onBack} />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Grown-up unlock' }));
    expect(onUnlock).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByRole('button', { name: 'Back' }), { key: 'Enter' });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('each new check gets its own grace: checking → unavailable → checking hides the card again', () => {
    const view = render(<PlaybackBudgetNotice status="checking" onUnlock={vi.fn()} onBack={vi.fn()} />);
    act(() => { vi.advanceTimersByTime(1500); });
    expect(screen.getByText('Getting your video time…')).toBeTruthy();
    view.rerender(<PlaybackBudgetNotice status="unavailable" onUnlock={vi.fn()} onBack={vi.fn()} />);
    expect(screen.getByText("Couldn't check video time")).toBeTruthy();
    view.rerender(<PlaybackBudgetNotice status="checking" onUnlock={vi.fn()} onBack={vi.fn()} />);
    expect(cover().textContent).toBe('');
    act(() => { vi.advanceTimersByTime(1499); });
    expect(screen.queryByText('Getting your video time…')).toBeNull();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByText('Getting your video time…')).toBeTruthy();
  });
});

