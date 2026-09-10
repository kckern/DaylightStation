import { describe, it, expect, beforeEach } from 'vitest';
import { bindMediaToMaster } from './bindMediaToMaster.js';
import { _publishMasterState, _resetForTests } from './ScreenVolumeContext.js';

beforeEach(() => _resetForTests());

describe('bindMediaToMaster', () => {
  it('sets the element to the effective master now and on every later step', () => {
    const el = { volume: 1, muted: false };
    _publishMasterState(0.6, 0.15, false);
    const unbind = bindMediaToMaster(el);
    expect(el.volume).toBeCloseTo(0.15);
    _publishMasterState(0.3, 0.05, false);
    expect(el.volume).toBeCloseTo(0.05);
    unbind();
    _publishMasterState(1, 1, false);
    expect(el.volume).toBeCloseTo(0.05);
  });

  it('mutes at zero and when the master is muted', () => {
    const el = { volume: 1, muted: false };
    _publishMasterState(0, 0, true);
    bindMediaToMaster(el);
    expect(el.muted).toBe(true);
    _publishMasterState(0.5, 0.1, false);
    expect(el.muted).toBe(false);
  });

  it('scales a local level under the master', () => {
    const el = { volume: 1, muted: false };
    _publishMasterState(1, 1, false);
    bindMediaToMaster(el, 0.4);
    expect(el.volume).toBeCloseTo(0.4);
  });
});
