import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { afterEach } from 'vitest';
import PlaybackStrip from './PlaybackStrip.jsx';
afterEach(cleanup);
const intervals = [
  { startMs: 0, endMs: 450000, state: 'waiting', contentId: 'video:1', title: 'Episode', x: 30, width: 180, playbackRunId: 'r1' },
  { startMs: 450000, endMs: 720000, state: 'playing', firstPlaying: true, contentId: 'video:1', title: 'Episode', x: 210, width: 108, playbackRunId: 'r1', evidence: { zone: 'hot', reason: 'startup_gate', hrBpm: 165, thresholdBpm: 160, participantId: 'child' } },
  { startMs: 720000, endMs: 723000, state: 'governance_paused', reason: 'challenge_failed', contentId: 'video:1', title: 'Episode', x: 318, width: 1.2, playbackRunId: 'r1' },
  { startMs: 723000, endMs: 800000, state: 'warning', contentId: 'video:1', title: 'Episode', x: 319.2, width: 30.8, playbackRunId: 'r1' },
];
const dialog = () => screen.getByRole('dialog', { name: 'Playback details' });
const detail = () => within(dialog()).getByRole('status').textContent;

describe('saved playback strip', () => {
  it('is only the timeline: no heading, legend or detail line in the chart', () => {
    const { container } = render(<PlaybackStrip intervals={intervals} width={400} />);
    expect(container.querySelector('.playback-strip__track svg')).toBeTruthy();
    expect(container.querySelector('.playback-strip__heading')).toBeNull();
    expect(container.querySelector('.playback-strip__legend')).toBeNull();
    expect(container.querySelector('.playback-strip__detail')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('opens a details modal on tap, explaining a first play with its effort evidence', () => {
    render(<PlaybackStrip intervals={intervals} width={400} />);
    fireEvent.click(screen.getByRole('button', { name: /Video started.*7:30/ }));
    expect(detail()).toMatch(/Episode.*child.*Hot reached.*165 BPM.*160 BPM/);
    // The legend lives in the modal now.
    expect(within(dialog()).getByText('Playing · warning')).toBeTruthy();
  });

  it('closes the modal from its button, the backdrop and Escape', () => {
    render(<PlaybackStrip intervals={intervals} width={400} />);
    const open = () => fireEvent.click(screen.getByRole('button', { name: /Video started/ }));
    open(); fireEvent.click(within(dialog()).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    open(); fireEvent.click(screen.getByTestId('playback-strip-backdrop'));
    expect(screen.queryByRole('dialog')).toBeNull();
    open(); fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps a short pause geometry exact while enlarging its touch target and preventing recap scrubbing', () => {
    const parentPointer = vi.fn();
    const { container } = render(<div onPointerDown={parentPointer}><PlaybackStrip intervals={intervals} width={400} /></div>);
    const button = screen.getByRole('button', { name: /Paused · exercise required/ });
    expect(parseFloat(button.style.width)).toBeGreaterThanOrEqual(24);
    expect(container.querySelector('[data-playback-state="governance_paused"]').getAttribute('width')).toBe('1.2');
    fireEvent.pointerDown(button);
    expect(parentPointer).not.toHaveBeenCalled();
    // Nothing inside the modal scrubs the recap either.
    fireEvent.click(button);
    fireEvent.pointerDown(within(dialog()).getByRole('status'));
    expect(parentPointer).not.toHaveBeenCalled();
  });

  it('labels unrecorded coverage honestly and closes stale details when the session changes', () => {
    const { rerender } = render(<PlaybackStrip intervals={intervals} width={400} />);
    fireEvent.click(screen.getByRole('button', { name: /Video started/ }));
    rerender(<PlaybackStrip intervals={[{ ...intervals[0], state: 'unknown', playbackRunId: null }]} width={400} />);
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByRole('button', { name: /Playback not recorded/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Video started/ })).toBeNull();
    rerender(<PlaybackStrip intervals={[]} width={400} />);
    expect(screen.queryByLabelText('Video playback timeline')).toBeNull();
  });
});

it('does not explain a first play with unrelated warning evidence', () => {
  const observed = { ...intervals[1], evidence: { zone: 'cool', hrBpm: 110, reason: 'requirements_not_met' } };
  render(<PlaybackStrip intervals={[observed]} width={400} />);
  fireEvent.click(screen.getByRole('button', { name: /Video started/ }));
  expect(detail()).not.toContain('Cool reached');
});

it('makes clustered short pauses independently selectable through the transition list in the modal', () => {
  const tiny = intervals[2];
  render(<PlaybackStrip intervals={[{ ...tiny, startMs: 723000, endMs: 724000, state: 'paused', x: 319.2, width: 0.4 }, tiny]} width={400} />);
  fireEvent.click(screen.getAllByRole('button', { name: /Paused/ })[0]);
  const list = within(dialog()).getByRole('group', { name: 'All playback transitions' });
  const lock = [...list.querySelectorAll('button')].find(b => b.textContent.includes('exercise required'));
  expect(lock).toBeTruthy(); fireEvent.click(lock);
  expect(detail()).toContain('Challenge missed');
  expect(lock.getAttribute('aria-current')).toBe('true');
});

it('explains a later pause with the recorded participant, observed effort and required threshold', () => {
  const paused = { ...intervals[2], evidence: { participantId: 'child', zone: 'active', hrBpm: 132, thresholdBpm: 120, requiredZone: 'warm', requiredThresholdBpm: 140 } };
  render(<PlaybackStrip intervals={[paused]} width={400} />);
  fireEvent.click(screen.getByRole('button', { name: /Paused · exercise required/ }));
  expect(detail()).toMatch(/child.*Active.*132 BPM.*Warm.*140 BPM/);
});
