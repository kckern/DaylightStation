import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import PlaybackStrip from './PlaybackStrip.jsx';
afterEach(cleanup);
const intervals = [
  { startMs: 0, endMs: 450000, state: 'waiting', contentId: 'video:1', title: 'Episode', x: 30, width: 180, playbackRunId: 'r1' },
  { startMs: 450000, endMs: 720000, state: 'playing', firstPlaying: true, contentId: 'video:1', title: 'Episode', x: 210, width: 108, playbackRunId: 'r1', evidence: { zone: 'hot', reason: 'startup_gate', hrBpm: 165, thresholdBpm: 160, participantId: 'child' } },
  { startMs: 720000, endMs: 723000, state: 'governance_paused', reason: 'challenge_failed', contentId: 'video:1', title: 'Episode', x: 318, width: 1.2, playbackRunId: 'r1' },
  { startMs: 723000, endMs: 800000, state: 'warning', contentId: 'video:1', title: 'Episode', x: 319.2, width: 30.8, playbackRunId: 'r1' },
];
describe('saved playback strip', () => {
  it('explains an actual first play with historical effort evidence through tap and keyboard focus', () => {
    render(<PlaybackStrip intervals={intervals} width={400} />);
    fireEvent.click(screen.getByRole('button', { name: /Video started.*7:30/ }));
    expect(screen.getByRole('status').textContent).toMatch(/Episode.*child.*Hot reached.*165 BPM.*160 BPM/);
    fireEvent.focus(screen.getByRole('button', { name: /Paused · exercise required/ }));
    expect(screen.getByRole('status').textContent).toContain('Challenge missed');
    expect(screen.getByText('Playing · warning')).toBeTruthy();
  });
  it('keeps a short pause geometry exact while enlarging its touch target and preventing recap scrubbing', () => {
    const parentPointer = vi.fn();
    const { container } = render(<div onPointerDown={parentPointer}><PlaybackStrip intervals={intervals} width={400} /></div>);
    const button = screen.getByRole('button', { name: /Paused · exercise required/ });
    expect(parseFloat(button.style.width)).toBeGreaterThanOrEqual(24);
    expect(container.querySelector('[data-playback-state="governance_paused"]').getAttribute('width')).toBe('1.2');
    fireEvent.pointerDown(button);
    expect(parentPointer).not.toHaveBeenCalled();
  });
  it('labels unrecorded coverage honestly and clears stale selected evidence when the session changes', () => {
    const { rerender } = render(<PlaybackStrip intervals={intervals} width={400} />);
    fireEvent.click(screen.getByRole('button', { name: /Video started/ }));
    rerender(<PlaybackStrip intervals={[{ ...intervals[0], state: 'unknown', playbackRunId: null }]} width={400} />);
    expect(screen.getByRole('status').textContent).not.toContain('165 BPM');
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
  expect(screen.getByRole('status').textContent).not.toContain('Cool reached');
});
