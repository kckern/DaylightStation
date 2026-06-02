import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
  swapAllowed: false,
  cycleHealthPct: 1
};

describe('CycleChallengeOverlay — extended UI', () => {
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

  it('does not render countdown when in maintain', () => {
    const ch = { ...baseChallenge, cycleState: 'maintain', initRemainingMs: null, rampRemainingMs: null };
    render(<CycleChallengeOverlay challenge={ch} />);
    expect(screen.queryByText(/Start in/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Reach target in/)).not.toBeInTheDocument();
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

  it('renders a health meter reflecting cycleHealthPct', () => {
    const ch = { ...baseChallenge, cycleState: 'maintain', cycleHealthPct: 0.5 };
    const { container } = render(<CycleChallengeOverlay challenge={ch} />);
    const meter = container.querySelector('.cycle-challenge-overlay__health-meter');
    expect(meter).toBeTruthy();
    const fill = container.querySelector('.cycle-challenge-overlay__health-fill');
    expect(fill.getAttribute('style') || '').toMatch(/width:\s*50%/);
  });

  it('keeps the phase-progress arc (positive indicator)', () => {
    const { container } = render(<CycleChallengeOverlay challenge={{ ...baseChallenge, cycleState: 'maintain' }} />);
    expect(container.querySelector('.cycle-challenge-overlay__phase-arc')).toBeTruthy();
    expect(container.querySelector('.cycle-challenge-overlay__danger-ring')).toBeFalsy();
  });

  it('labels the challenge with "phase", not "segment"', () => {
    const { container } = render(<CycleChallengeOverlay challenge={baseChallenge} />);
    const root = container.querySelector('.cycle-challenge-overlay');
    expect(root.getAttribute('aria-label')).toMatch(/phase/i);
    expect(root.getAttribute('aria-label')).not.toMatch(/segment/i);
  });

  it('groups lower content inside a single __stack container without a rider name', () => {
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
    // Rider name is dropped — avatar is the sole identifier.
    expect(container.querySelector('.cycle-challenge-overlay__rider-name')).toBeFalsy();
    expect(stack.querySelector('.cycle-challenge-overlay__phase-blocks')).toBeTruthy();
    expect(stack.querySelector('.cycle-challenge-overlay__current-rpm')).toBeTruthy();
  });

  it('does not render the rider name text', () => {
    render(<CycleChallengeOverlay challenge={baseChallenge} />);
    expect(screen.queryByText('KC Kern')).not.toBeInTheDocument();
  });

  it('renders the heart-rate gate as a compact dot on the avatar', () => {
    const { container } = render(<CycleChallengeOverlay challenge={baseChallenge} />);
    const wrap = container.querySelector('.cycle-challenge-overlay__avatar-wrap');
    expect(wrap).toBeTruthy();
    // Dot lives with the avatar, not in the lower stack.
    expect(wrap.querySelector('.cycle-base-req')).toBeTruthy();
    // Compact mode hides the sentence label but keeps the status aria-label.
    expect(wrap.querySelector('.cycle-base-req__label')).toBeFalsy();
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

  it('phase arc dashoffset reflects phaseProgress', () => {
    const PHASE_ARC_LEN = Math.PI * 100; // π × CYCLE_RING_RADIUS(100)
    const ch = {
      ...baseChallenge,
      cycleState: 'maintain',
      initRemainingMs: null,
      rampRemainingMs: null,
      phaseProgressPct: 0.4
    };
    const { container } = render(<CycleChallengeOverlay challenge={ch} />);
    const arc = container.querySelector('.cycle-challenge-overlay__phase-arc');
    const offset = parseFloat(arc.getAttribute('stroke-dashoffset'));
    // dashoffset = len × (1 − phaseProgress) = len × 0.6
    expect(offset).toBeCloseTo(PHASE_ARC_LEN * (1 - 0.4), 1);
  });

  it('keeps gauge ticks stable when only currentRpm changes', () => {
    const ch1 = { ...baseChallenge, cycleState: 'maintain', currentRpm: 40 };
    const { container, rerender } = render(<CycleChallengeOverlay challenge={ch1} />);
    const before = container.querySelectorAll('.cycle-challenge-overlay__gauge-tick').length;
    rerender(<CycleChallengeOverlay challenge={{ ...ch1, currentRpm: 95 }} />);
    const after = container.querySelectorAll('.cycle-challenge-overlay__gauge-tick').length;
    expect(after).toBe(before);
    expect(after).toBeGreaterThan(0);
  });

  it('shows initials when the avatar image fails, and recovers on rider change', () => {
    const ch = { ...baseChallenge, rider: { id: 'kckern', name: 'KC Kern' } };
    const { container, rerender } = render(<CycleChallengeOverlay challenge={ch} />);
    // Initially the image renders and initials are absent.
    expect(container.querySelector('.cycle-challenge-overlay__avatar-img')).toBeTruthy();
    expect(container.querySelector('.cycle-challenge-overlay__avatar-initials')).toBeFalsy();

    // Image errors → state flips → initials shown, image removed.
    fireEvent.error(container.querySelector('.cycle-challenge-overlay__avatar-img'));
    expect(container.querySelector('.cycle-challenge-overlay__avatar-initials')).toBeTruthy();
    expect(container.querySelector('.cycle-challenge-overlay__avatar-img')).toBeFalsy();

    // New rider → fresh URL → effect resets imgFailed → image is attempted again.
    rerender(<CycleChallengeOverlay challenge={{ ...ch, rider: { id: 'alan', name: 'Alan' } }} />);
    expect(container.querySelector('.cycle-challenge-overlay__avatar-img')).toBeTruthy();
    expect(container.querySelector('.cycle-challenge-overlay__avatar-initials')).toBeFalsy();
  });

  it('renders (phase arc + health meter visible) when cycleState=locked with cycleHealthPct:0', () => {
    // During a health-lock the engine sets cycleState='locked' and cycleHealthPct=0.
    // getCycleOverlayVisuals returns visible:true for 'locked', so the overlay must
    // stay mounted showing the empty health meter — NOT early-return.
    const ch = {
      ...baseChallenge,
      cycleState: 'locked',
      lockReason: 'health',
      cycleHealthPct: 0,
      initRemainingMs: null,
      rampRemainingMs: null
    };
    const { container } = render(<CycleChallengeOverlay challenge={ch} />);
    // Root overlay element must be present.
    expect(container.querySelector('.cycle-challenge-overlay')).toBeTruthy();
    // Phase arc (lower hemisphere) must be present.
    expect(container.querySelector('.cycle-challenge-overlay__phase-arc')).toBeTruthy();
    // Health meter must be present and show 0% fill.
    const fill = container.querySelector('.cycle-challenge-overlay__health-fill');
    expect(fill).toBeTruthy();
    expect(fill.getAttribute('style') || '').toMatch(/width:\s*0%/);
  });

  it('does not violate the rules of hooks when toggling visibility', () => {
    // Visible cycle challenge → renders. Then a non-cycle challenge makes
    // visuals.visible false → early return. If any hook sits after that return,
    // React throws "rendered fewer hooks than expected" on this rerender.
    const { container, rerender } = render(<CycleChallengeOverlay challenge={baseChallenge} />);
    expect(container.querySelector('.cycle-challenge-overlay')).toBeTruthy();
    expect(() => {
      rerender(<CycleChallengeOverlay challenge={{ type: 'zone', cycleState: null }} />);
    }).not.toThrow();
    expect(container.querySelector('.cycle-challenge-overlay')).toBeFalsy();
  });
});

describe('CycleChallengeOverlay — success completion hold (§5A)', () => {
  const successChallenge = {
    type: 'cycle',
    status: 'success',
    rider: { id: 'felix', name: 'Felix' },
    totalPhases: 3,
    currentPhaseIndex: 3,
    currentPhase: { hiRpm: 80, loRpm: 60 }
  };

  it('without done + no active cycleState, early-returns null (baseline)', () => {
    const { container } = render(<CycleChallengeOverlay challenge={successChallenge} />);
    expect(container.querySelector('.cycle-challenge-overlay')).toBeFalsy();
  });

  it('renders the overlay when the done prop is set, even with visuals off', () => {
    const { container } = render(<CycleChallengeOverlay challenge={successChallenge} done />);
    expect(container.querySelector('.cycle-challenge-overlay')).toBeTruthy();
  });

  it('adds the phase-done class and a completion checkmark', () => {
    const { container } = render(<CycleChallengeOverlay challenge={successChallenge} done />);
    expect(container.querySelector('.cycle-challenge-overlay--phase-done')).toBeTruthy();
    expect(container.querySelector('.cycle-challenge-overlay__done-check')).toBeTruthy();
  });

  it('fills the phase-progress arc completely on done (dashoffset 0)', () => {
    const { container } = render(<CycleChallengeOverlay challenge={successChallenge} done />);
    const arc = container.querySelector('.cycle-challenge-overlay__phase-arc');
    expect(parseFloat(arc.getAttribute('stroke-dashoffset'))).toBeCloseTo(0, 3);
  });
});

describe('CycleChallengeOverlay — C3 cleanup (badge float, no boosters, no countdown)', () => {
  const c3Challenge = {
    type: 'cycle',
    cycleState: 'maintain',
    phaseProgressPct: 50,
    currentPhaseIndex: 1,
    totalPhases: 4,
    currentRpm: 72,
    currentPhase: { hiRpm: 80, loRpm: 60 },
    cycleHealthPct: 100,
    boostMultiplier: 2.5,
    boostingUsers: ['kckern', 'milo'],
    rider: { id: 'felix', name: 'Felix' }
  };

  it('renders the boost badge when multiplier > 1', () => {
    const { container } = render(<CycleChallengeOverlay challenge={c3Challenge} />);
    const badge = container.querySelector('.cycle-challenge-overlay__boost-badge');
    expect(badge).not.toBeNull();
    expect(badge.textContent).toContain('2.5');
  });

  it('renders the boost badge OUTSIDE the bottom stack (no reflow)', () => {
    const { container } = render(<CycleChallengeOverlay challenge={c3Challenge} />);
    const stack = container.querySelector('.cycle-challenge-overlay__stack');
    expect(stack).not.toBeNull();
    expect(stack.querySelector('.cycle-challenge-overlay__boost-badge')).toBeNull();
  });

  it('does not render booster avatar pips', () => {
    const { container } = render(<CycleChallengeOverlay challenge={c3Challenge} />);
    expect(container.querySelector('.cycle-challenge-overlay__booster')).toBeNull();
  });

  it('does not render the init/ramp countdown text', () => {
    const { container } = render(
      <CycleChallengeOverlay challenge={{ ...c3Challenge, cycleState: 'init', initRemainingMs: 20000 }} />
    );
    expect(container.querySelector('.cycle-challenge-overlay__countdown')).toBeNull();
  });
});
