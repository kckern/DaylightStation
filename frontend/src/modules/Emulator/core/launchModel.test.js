import { describe, it, expect } from 'vitest';
import { requiresIdentity, resolveLaunch } from './launchModel.js';
import { supportsSave, freshLaunch, loadLaunch, claimLaunch } from './launchModel.js';

describe('requiresIdentity', () => {
  it('is false for none, true for state/battery', () => {
    expect(requiresIdentity('none')).toBe(false);
    expect(requiresIdentity('state')).toBe(true);
    expect(requiresIdentity('battery')).toBe(true);
    expect(requiresIdentity(undefined)).toBe(false);
  });
});

describe('resolveLaunch', () => {
  it('no-save game → fresh, anonymous, never persists', () => {
    expect(resolveLaunch({ saveMode: 'none', userId: 'user_5', hasSave: true }))
      .toEqual({ action: 'fresh', persist: false, userId: null });
  });

  it('save-enabled + no identity → cold start', () => {
    expect(resolveLaunch({ saveMode: 'battery', userId: null, hasSave: true }))
      .toEqual({ action: 'cold', persist: false, userId: null });
  });

  it('identified + has save → resume (persist)', () => {
    expect(resolveLaunch({ saveMode: 'battery', userId: 'user_5', hasSave: true }))
      .toEqual({ action: 'resume', persist: true, userId: 'user_5' });
  });

  it('identified + no save → fresh (persist)', () => {
    expect(resolveLaunch({ saveMode: 'state', userId: 'user_3', hasSave: false }))
      .toEqual({ action: 'fresh', persist: true, userId: 'user_3' });
  });

  it('defaults to a no-save fresh launch', () => {
    expect(resolveLaunch()).toEqual({ action: 'fresh', persist: false, userId: null });
  });
});

describe('new launch model', () => {
  it('supportsSave is true for state/battery, false otherwise', () => {
    expect(supportsSave('state')).toBe(true);
    expect(supportsSave('battery')).toBe(true);
    expect(supportsSave('none')).toBe(false);
    expect(supportsSave(undefined)).toBe(false);
  });

  it('freshLaunch is anonymous + non-persisting', () => {
    expect(freshLaunch()).toEqual({ action: 'fresh', persist: false, userId: null });
  });

  it('loadLaunch resumes + persists for the user', () => {
    expect(loadLaunch('user_5')).toEqual({ action: 'resume', persist: true, userId: 'user_5' });
  });

  it('claimLaunch keeps the fresh game + persists for the user', () => {
    expect(claimLaunch('user_3')).toEqual({ action: 'fresh', persist: true, userId: 'user_3' });
  });
});
