import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, renderHook } from '@testing-library/react';
import ChallengeOverlay from "./ChallengeOverlay.jsx";
import { useChallengeOverlays } from "./challengeMachine.js";

// D5: a rider in the zone whose 10s hold has not finished yet is neither met
// nor missing — the overlay shows them as a distinct "holding" block.
describe('challenge overlay — riders mid-hold', () => {
  const zones = [{ id: 'warm', name: 'Warm', color: '#facc15' }];

  it('carries the engine\'s holding list onto the overlay view-model', () => {
    const governanceState = {
      challenge: {
        id: 'c1', status: 'pending', zone: 'warm', zoneLabel: 'Warm',
        requiredCount: 2, actualCount: 0, totalSeconds: 90, remainingSeconds: 80,
        metUsers: [], missingUsers: ['child-a', 'child-b'], holding: ['child-a'], holdRemainingMs: 6000,
      },
    };
    const { result } = renderHook(() => useChallengeOverlays(governanceState, zones));
    expect(result.current.current.holdingUsers).toEqual(['child-a']);
  });

  it('renders a holding block, not an empty (missing) one', () => {
    const overlay = {
      show: true, variant: 'current', status: 'pending', phase: 'on',
      title: 'Warm', progress: 0.1, requiredCount: 2, actualCount: 0,
      metUsers: [], holdingUsers: ['child-a'], timeLabel: '80', timeLeftSeconds: 80,
    };
    const { container } = render(<ChallengeOverlay overlay={overlay} />);
    const blocks = container.querySelectorAll('.challenge-overlay__count-block');
    expect(blocks).toHaveLength(2);
    expect(blocks[0].classList.contains('challenge-overlay__count-block--holding')).toBe(true);
    expect(blocks[1].classList.contains('challenge-overlay__count-block--holding')).toBe(false);
    expect(container.querySelectorAll('.challenge-overlay__count-block--complete')).toHaveLength(0);
  });
});
