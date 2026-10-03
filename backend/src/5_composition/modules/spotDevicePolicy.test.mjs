import { describe, it, expect } from 'vitest';
import { createSpotDevicePolicy } from './spotDevicePolicy.mjs';

describe('createSpotDevicePolicy', () => {
  const configService = { getHouseholdDevices: () => ({ devices: { 'livingroom-tv': {}, 'office-tv': {} } }) };
  it('accepts declared fleet devices and any browser, refuses undeclared fleet names', () => {
    const allowed = createSpotDevicePolicy({ configService, householdId: 'default' });
    expect(allowed('fleet:livingroom-tv')).toBe(true);
    expect(allowed('browser:abc')).toBe(true);
    expect(allowed('fleet:made-up')).toBe(false);
  });
  it('fails open for fleet ids when devices cannot be read (a missing file must not drop every spot)', () => {
    const allowed = createSpotDevicePolicy({ configService: { getHouseholdDevices: () => { throw new Error('x'); } } });
    expect(allowed('fleet:any')).toBe(true);
  });
});
