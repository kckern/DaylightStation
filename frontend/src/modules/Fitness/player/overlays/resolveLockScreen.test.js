import { describe, it, expect } from 'vitest';
import { resolveLockScreen } from './resolveLockScreen.js';

const cycleHealthLockChallenge = {
  type: 'cycle',
  cycleState: 'locked',
  lockReason: 'health',
  status: 'pending'
};

describe('resolveLockScreen', () => {
  it('cycle health-lock takes precedence even when governance shows a panel', () => {
    const d = resolveLockScreen({
      activeChallenge: cycleHealthLockChallenge,
      governanceDisplay: { show: true, status: 'pending', rows: [] }
    });
    expect(d.variety).toBe('cycle-health');
    expect(d.showCycleOverlay).toBe(true);
    expect(d.showGovernanceOverlay).toBe(false);
    expect(d.promoteCycle).toBe(true);
    expect(d.audioTrack).toBe('locked');
    expect(d.videoLocked).toBe(true);
  });

  it('cycle health-lock is detected when governance status is unlocked (the normal case)', () => {
    const d = resolveLockScreen({
      activeChallenge: cycleHealthLockChallenge,
      governanceDisplay: { show: false, status: 'unlocked', rows: [] }
    });
    expect(d.variety).toBe('cycle-health');
    expect(d.showGovernanceOverlay).toBe(false);
    expect(d.promoteCycle).toBe(true);
  });

  it('governance lock renders the governance overlay (no cycle promotion)', () => {
    const d = resolveLockScreen({
      activeChallenge: null,
      governanceDisplay: { show: true, status: 'locked', rows: [{ key: 'a' }], videoLocked: true }
    });
    expect(d.variety).toBe('governance');
    expect(d.showGovernanceOverlay).toBe(true);
    expect(d.showCycleOverlay).toBe(false);
    expect(d.promoteCycle).toBe(false);
    expect(d.videoLocked).toBe(true);
  });

  it('non-health cycle lock (init/ramp) is NOT a cycle-health lock', () => {
    const d = resolveLockScreen({
      activeChallenge: { type: 'cycle', cycleState: 'locked', lockReason: 'init', status: 'pending' },
      governanceDisplay: { show: false, status: 'unlocked' }
    });
    expect(d.variety).not.toBe('cycle-health');
    expect(d.promoteCycle).toBe(false);
  });

  it('no lock: defaults, governance overlay follows its own show flag', () => {
    const d = resolveLockScreen({
      activeChallenge: { type: 'cycle', cycleState: 'maintain', status: 'pending' },
      governanceDisplay: { show: false, status: 'unlocked' }
    });
    expect(d.variety).toBe('none');
    expect(d.showGovernanceOverlay).toBe(false);
    expect(d.promoteCycle).toBe(false);
    expect(d.audioTrack).toBeNull();
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
