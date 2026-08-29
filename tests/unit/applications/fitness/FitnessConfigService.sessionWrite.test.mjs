import { describe, expect, it } from 'vitest';
import { FitnessConfigService } from '#apps/fitness/FitnessConfigService.mjs';

function service(whitelist) {
  return new FitnessConfigService({
    configProjection: {
      publicConfig: () => ({}),
      raw: () => ({ session_write_whitelist: whitelist }),
    },
  });
}

describe('FitnessConfigService session write policy', () => {
  it('default-allows an absent or empty whitelist', () => {
    expect(service(undefined).mayWriteSession('h1', 'anything')).toBe(true);
    expect(service([]).mayWriteSession('h1', 'anything')).toBe(true);
  });

  it('allows only user agents containing a configured pattern', () => {
    expect(service(['Firefox', 'Daylight']).mayWriteSession('h1', 'Mozilla Firefox/151')).toBe(true);
    expect(service(['Firefox', 'Daylight']).mayWriteSession('h1', 'curl/8')).toBe(false);
  });
});
