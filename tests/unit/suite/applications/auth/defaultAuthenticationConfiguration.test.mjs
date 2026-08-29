import { describe, it, expect } from '@jest/globals';
import { createDefaultAuthenticationConfiguration } from '#apps/auth/defaultAuthenticationConfiguration.mjs';

describe('createDefaultAuthenticationConfiguration', () => {
  it('defines the default application access policy without changing its persisted shape', () => {
    const config = createDefaultAuthenticationConfiguration('test-secret');

    expect(config.roles.sysadmin.apps).toEqual(['*']);
    expect(config.roles.kiosk.apps).toContain('tv');
    expect(config.household_roles.default).toEqual(['kiosk']);
    expect(config.jwt).toEqual({
      issuer: 'daylight-station',
      expiry: '10y',
      algorithm: 'HS256',
      secret: 'test-secret',
    });
  });
});
