import { describe, it, expect } from 'vitest';
import { supportsSave, freshLaunch, loadLaunch, claimLaunch } from './launchModel.js';

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
