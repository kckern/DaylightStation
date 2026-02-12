// tests/unit/suite/system/auth/authConfigDefaults.test.mjs
import { describe, it, expect } from '@jest/globals';
import { getDefaultAuthConfig, generateJwtSecret } from '#system/auth/authConfigDefaults.mjs';

describe('authConfigDefaults', () => {
  it('returns default auth config with all role definitions', () => {
    const config = getDefaultAuthConfig();
    expect(config.roles.sysadmin.apps).toEqual(['*']);
    expect(config.roles.kiosk.apps).toContain('tv');
    expect(config.household_roles.default).toEqual(['kiosk']);
    expect(config.jwt.issuer).toBe('daylight-station');
    expect(config.jwt.algorithm).toBe('HS256');
  });

  it('generates a 64-byte hex JWT secret', () => {
    const secret = generateJwtSecret();
    expect(secret).toHaveLength(128); // 64 bytes = 128 hex chars
    expect(secret).toMatch(/^[0-9a-f]+$/);
  });

  it('generates unique secrets each time', () => {
    const a = generateJwtSecret();
    const b = generateJwtSecret();
    expect(a).not.toBe(b);
  });
});
