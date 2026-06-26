import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import ChallengeOverlay, { useChallengeOverlays } from './ChallengeOverlay.jsx';

// Issue 1: the success ceremony used to flip the whole ring to green (#22c55e),
// which collides with the "active" HR zone color. The ring must keep the target
// zone hue and signal success with a small green check badge instead.

describe('useChallengeOverlays — success ring color (issue 1)', () => {
  const zones = [{ id: 'warm', name: 'Warm', color: '#facc15' }];

  it('keeps the target zone color on the success ring (does not turn green)', () => {
    const governanceState = {
      challenge: {
        id: 'c1', status: 'success', zone: 'warm', zoneLabel: 'Warm',
        requiredCount: 2, actualCount: 2, totalSeconds: 30, remainingSeconds: 10,
      },
    };
    const { result } = renderHook(() => useChallengeOverlays(governanceState, zones));
    expect(result.current.current.show).toBe(true);
    expect(result.current.current.ringColor).toBe('#facc15');
    expect(result.current.current.ringColor).not.toBe('#22c55e');
  });
});

describe('ChallengeOverlay — success render (issue 1)', () => {
  const successOverlay = {
    show: true, variant: 'current', status: 'success', phase: 'done',
    title: 'Warm', ringColor: '#facc15', progress: 1,
    requiredCount: 2, actualCount: 2, metUsers: [], timeLabel: '', timeLeftSeconds: 5,
  };

  it('renders a green check badge instead of a ✅ emoji', () => {
    const { container } = render(<ChallengeOverlay overlay={successOverlay} />);
    expect(container.querySelector('.challenge-overlay__done-check')).toBeTruthy();
    expect(container.textContent).not.toContain('✅');
  });

  it('does not paint the ring with the success green', () => {
    const { container } = render(<ChallengeOverlay overlay={successOverlay} />);
    const ring = container.querySelector('.challenge-overlay__ring-progress');
    expect(ring.getAttribute('style') || '').not.toContain('#22c55e');
  });
});
