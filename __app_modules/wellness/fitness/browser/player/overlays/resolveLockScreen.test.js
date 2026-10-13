import { describe, it, expect } from 'vitest';
import { resolveLockScreen } from "./resolveLockScreen.js";

const govShown = { show: true, status: 'locked', rows: [{ key: 'a' }], videoLocked: true };

describe('resolveLockScreen — cycle owns all lock/fail presentation', () => {
  it('health lock promotes the cycle overlay (variety cycle-lock)', () => {
    const d = resolveLockScreen({
      activeChallenge: { type: 'cycle', cycleState: 'locked', lockReason: 'health', status: 'pending' },
      governanceDisplay: { show: true, status: 'pending', rows: [] }
    });
    expect(d.variety).toBe('cycle-lock');
    expect(d.showCycleOverlay).toBe(true);
    expect(d.showGovernanceOverlay).toBe(false);
    expect(d.promoteCycle).toBe(true);
    expect(d.audioTrack).toBe('locked');
    expect(d.videoLocked).toBe(true);
  });

  it('ramp lock ALSO promotes the cycle overlay (no blank governance panel)', () => {
    const d = resolveLockScreen({
      activeChallenge: { type: 'cycle', cycleState: 'locked', lockReason: 'ramp', status: 'pending' },
      governanceDisplay: govShown
    });
    expect(d.variety).toBe('cycle-lock');
    expect(d.promoteCycle).toBe(true);
    expect(d.showGovernanceOverlay).toBe(false);
    expect(d.videoLocked).toBe(true);
  });

  it('init lock ALSO promotes the cycle overlay', () => {
    const d = resolveLockScreen({
      activeChallenge: { type: 'cycle', cycleState: 'locked', lockReason: 'init', status: 'pending' },
      governanceDisplay: govShown
    });
    expect(d.promoteCycle).toBe(true);
    expect(d.showGovernanceOverlay).toBe(false);
  });

  it('terminal fail promotes the cycle overlay (variety cycle-fail)', () => {
    const d = resolveLockScreen({
      activeChallenge: { type: 'cycle', status: 'failed' },
      governanceDisplay: govShown
    });
    expect(d.variety).toBe('cycle-fail');
    expect(d.promoteCycle).toBe(true);
    expect(d.showGovernanceOverlay).toBe(false);
  });

  it('never shows the generic governance panel for ANY cycle challenge, even unlocked', () => {
    const d = resolveLockScreen({
      activeChallenge: { type: 'cycle', cycleState: 'maintain', status: 'pending' },
      governanceDisplay: govShown
    });
    expect(d.showGovernanceOverlay).toBe(false);
    expect(d.promoteCycle).toBe(false);
    expect(d.variety).toBe('none');
  });

  it('non-cycle governance lock still uses the governance panel', () => {
    const d = resolveLockScreen({ activeChallenge: null, governanceDisplay: govShown });
    expect(d.variety).toBe('governance');
    expect(d.showGovernanceOverlay).toBe(true);
    expect(d.showCycleOverlay).toBe(false);
    expect(d.promoteCycle).toBe(false);
    expect(d.videoLocked).toBe(true);
  });

  it('handles null/empty inputs without throwing', () => {
    const d = resolveLockScreen({});
    expect(d.variety).toBe('none');
    expect(d.showGovernanceOverlay).toBe(false);
    expect(d.showCycleOverlay).toBe(false);
    expect(d.promoteCycle).toBe(false);
    expect(d.audioTrack).toBeNull();
    expect(d.videoLocked).toBe(false);
  });
});


describe('resolveLockScreen — cadence sensor recovery', () => {
  it.each(['pending', 'failed'])('does not promote or play cycle audio for a frozen %s challenge during recovery', (status) => {
    const result = resolveLockScreen({
      activeChallenge: { type: 'cycle', status, cycleState: 'locked', lockReason: 'health', sensorUnavailable: true },
      governanceDisplay: { show: false, status: 'unlocked', videoLocked: false }
    });
    expect(result).toEqual({ variety: 'none', showGovernanceOverlay: false, showCycleOverlay: true, promoteCycle: false, audioTrack: null, videoLocked: false });
  });

  it('shows the real base HR lock during recovery and retains the cycle dial', () => {
    const result = resolveLockScreen({
      activeChallenge: { type: 'cycle', status: 'pending', cycleState: 'locked', sensorUnavailable: true },
      governanceDisplay: govShown
    });
    expect(result).toEqual({ variety: 'governance', showGovernanceOverlay: true, showCycleOverlay: true, promoteCycle: false, audioTrack: null, videoLocked: true });
  });

  it('restores the original cycle promotion once a fresh sensor sample arrives', () => {
    const result = resolveLockScreen({
      activeChallenge: { type: 'cycle', status: 'pending', cycleState: 'locked', sensorUnavailable: false },
      governanceDisplay: govShown
    });
    expect(result.variety).toBe('cycle-lock');
    expect(result.promoteCycle).toBe(true);
    expect(result.showGovernanceOverlay).toBe(false);
    expect(result.audioTrack).toBe('locked');
  });
});
