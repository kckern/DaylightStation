import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CycleChallengeOverlay } from './CycleChallengeOverlay.jsx';

const baseChallenge = {
  type: 'cycle',
  cycleState: 'init',
  dimFactor: 0,
  phaseProgressPct: 0,
  currentPhaseIndex: 0,
  totalPhases: 3,
  currentPhase: { hiRpm: 49, loRpm: 37 },
  rider: { id: 'kckern', name: 'KC Kern' },
  currentRpm: 60,
  initRemainingMs: 23000,
  rampRemainingMs: null,
  cadenceFlags: { lostSignal: false, stale: false, smoothed: false, implausible: false },
  waitingForBaseReq: false,
  baseReqSatisfiedForRider: true,
  swapAllowed: false
};

describe('CycleChallengeOverlay — extended UI', () => {
  it('renders the init countdown', () => {
    render(<CycleChallengeOverlay challenge={baseChallenge} />);
    expect(screen.getByText(/Start in 23s/)).toBeInTheDocument();
  });

  it('renders the base-req indicator in satisfied mode', () => {
    render(<CycleChallengeOverlay challenge={baseChallenge} />);
    expect(screen.getByLabelText(/heart-rate.*satisfied/i)).toBeInTheDocument();
  });

  it('shows lost-signal class when cadenceFlags.lostSignal is true', () => {
    const ch = {
      ...baseChallenge,
      cadenceFlags: { lostSignal: true, stale: false, smoothed: false, implausible: false }
    };
    const { container } = render(<CycleChallengeOverlay challenge={ch} />);
    expect(container.querySelector('.cycle-challenge-overlay--lost-signal')).toBeTruthy();
  });

  it('renders the ramp countdown when cycleState is ramp', () => {
    const ch = {
      ...baseChallenge,
      cycleState: 'ramp',
      initRemainingMs: null,
      rampRemainingMs: 7000
    };
    render(<CycleChallengeOverlay challenge={ch} />);
    expect(screen.getByText(/Reach target in 7s/)).toBeInTheDocument();
  });

  it('does not render countdown when in maintain', () => {
    const ch = { ...baseChallenge, cycleState: 'maintain', initRemainingMs: null, rampRemainingMs: null };
    render(<CycleChallengeOverlay challenge={ch} />);
    expect(screen.queryByText(/Start in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Reach target in/)).not.toBeInTheDocument();
  });

  it('renders the paused init countdown when clockPaused is true', () => {
    const ch = { ...baseChallenge, clockPaused: true };
    render(<CycleChallengeOverlay challenge={ch} />);
    expect(screen.getByText(/Paused — start in 23s/)).toBeInTheDocument();
  });

  it('renders the paused ramp countdown when clockPaused is true', () => {
    const ch = {
      ...baseChallenge,
      cycleState: 'ramp',
      initRemainingMs: null,
      rampRemainingMs: 7000,
      clockPaused: true
    };
    render(<CycleChallengeOverlay challenge={ch} />);
    expect(screen.getByText(/Paused — reach target in 7s/)).toBeInTheDocument();
  });

  it('renders phase count blocks instead of the horizontal progress bar', () => {
    const ch = { ...baseChallenge, totalPhases: 3, currentPhaseIndex: 1 };
    const { container } = render(<CycleChallengeOverlay challenge={ch} />);
    expect(container.querySelector('.cycle-challenge-overlay__phase-blocks')).toBeTruthy();
    // No legacy horizontal progress bar.
    expect(container.querySelector('.cycle-challenge-overlay__progress-bar')).toBeFalsy();
    // 3 blocks, 1 complete (index 1 = first phase done).
    const blocks = container.querySelectorAll('.cycle-challenge-overlay__phase-block');
    expect(blocks.length).toBe(3);
    const complete = container.querySelectorAll('.cycle-challenge-overlay__phase-block--complete');
    expect(complete.length).toBe(1);
  });

  it('renders the danger arc class when dangerActive is true', () => {
    const ch = {
      ...baseChallenge,
      dangerActive: true,
      dangerRemainingMs: 1500,
      dangerProgress: 0.5
    };
    const { container } = render(<CycleChallengeOverlay challenge={ch} />);
    expect(container.querySelector('.cycle-challenge-overlay__phase-arc--danger')).toBeTruthy();
  });

  it('groups lower content inside a single __stack container', () => {
    const ch = {
      ...baseChallenge,
      cycleState: 'init',
      initRemainingMs: 5000,
      totalPhases: 3,
      currentPhaseIndex: 1
    };
    const { container } = render(<CycleChallengeOverlay challenge={ch} />);
    const stack = container.querySelector('.cycle-challenge-overlay__stack');
    expect(stack).toBeTruthy();
    expect(stack.querySelector('.cycle-challenge-overlay__rider-name')).toBeTruthy();
    expect(stack.querySelector('.cycle-challenge-overlay__phase-blocks')).toBeTruthy();
    expect(stack.querySelector('.cycle-challenge-overlay__countdown')).toBeTruthy();
    expect(stack.querySelector('.cycle-challenge-overlay__current-rpm')).toBeTruthy();
  });

  it('does not render the countdown as a direct child of the overlay root', () => {
    const ch = { ...baseChallenge, cycleState: 'init', initRemainingMs: 5000 };
    const { container } = render(<CycleChallengeOverlay challenge={ch} />);
    const root = container.querySelector('.cycle-challenge-overlay');
    const strayCountdown = Array.from(root.children).some((el) =>
      el.classList?.contains('cycle-challenge-overlay__countdown'));
    expect(strayCountdown).toBe(false);
  });

  it('renders the needle as a rotated group, not via animated x2/y2', () => {
    const { container } = render(<CycleChallengeOverlay challenge={baseChallenge} />);
    const group = container.querySelector('.cycle-needle-group');
    expect(group).toBeTruthy();
    expect(group.getAttribute('style') || '').toMatch(/rotate\(/);
  });
});
