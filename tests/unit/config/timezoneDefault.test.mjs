import { describe, it, expect } from 'vitest';
import { ConfigService } from '#system/config/ConfigService.mjs';
import { DEFAULT_TIMEZONE } from '#domains/core/utils/timezone.mjs';

describe('ConfigService — timezone default (DEFAULT_TIMEZONE SSOT)', () => {
  it('getTimezone() falls back to DEFAULT_TIMEZONE when no system timezone configured', () => {
    const svc = new ConfigService({});
    expect(svc.getTimezone()).toBe(DEFAULT_TIMEZONE);
  });

  it('getHouseholdTimezone() falls back to DEFAULT_TIMEZONE (no UTC drift)', () => {
    const svc = new ConfigService({});
    expect(svc.getHouseholdTimezone()).toBe(DEFAULT_TIMEZONE);
    // Regression guard: household default must no longer be 'UTC'
    expect(svc.getHouseholdTimezone()).not.toBe('UTC');
  });

  it('DEFAULT_TIMEZONE is the single canonical value', () => {
    expect(DEFAULT_TIMEZONE).toBe('America/Los_Angeles');
  });
});
