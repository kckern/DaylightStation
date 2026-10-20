import { describe, expect, it } from 'vitest';
import { isFailedHarvest, describeHarvestFailure } from '#apps/harvester/ports/IHarvester.mjs';

describe('harvest failure helpers', () => {
  it('treats status error as failed and nothing else', () => {
    expect(isFailedHarvest({ status: 'error' })).toBe(true);
    expect(isFailedHarvest({ status: 'success' })).toBe(false);
    expect(isFailedHarvest({ status: 'skipped' })).toBe(false);
    expect(isFailedHarvest({ skipped: true })).toBe(false);
    expect(isFailedHarvest(undefined)).toBe(false);
  });
  it('joins reason and error', () => {
    expect(describeHarvestFailure({ reason: 'auth_failed', error: 'invalid refresh_token' })).toBe('auth_failed: invalid refresh_token');
    expect(describeHarvestFailure({ reason: 'auth_failed' })).toBe('auth_failed');
    expect(describeHarvestFailure({ status: 'error' })).toBe('harvest returned an error');
  });
});
