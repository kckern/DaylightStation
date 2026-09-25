import { describe, expect, it } from 'vitest';
import { healthUserTimezone } from './healthApi.mjs';

describe('healthUserTimezone (Health AI usage days)', () => {
  const configService = { getHouseholdTimezone: () => 'America/New_York' };

  it('uses the nutrition cleanup\'s per-user timezone once cleanup is composed', () => {
    let cleanup = null;
    const tz = healthUserTimezone({ cleanupProvider: () => cleanup, configService });
    expect(tz('alice')).toBe('America/New_York');
    cleanup = { timezoneFor: userId => (userId === 'alice' ? 'Asia/Seoul' : null) };
    expect(tz('alice')).toBe('Asia/Seoul');
    expect(tz('bob')).toBe('America/New_York');
    expect(tz(null)).toBe('America/New_York');
  });

  it('falls back to the household, then Los Angeles', () => {
    expect(healthUserTimezone({ configService })('alice')).toBe('America/New_York');
    expect(healthUserTimezone()('alice')).toBe('America/Los_Angeles');
  });
});
