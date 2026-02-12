import { describe, it, expect } from '@jest/globals';
import { signToken, verifyToken } from '#system/auth/jwt.mjs';

const TEST_SECRET = 'a'.repeat(128);

describe('JWT utilities', () => {
  it('signs a token with user payload', () => {
    const token = signToken(
      { sub: 'kckern', hid: 'default', roles: ['sysadmin'] },
      TEST_SECRET,
      { issuer: 'daylight-station', expiresIn: '10y', algorithm: 'HS256' }
    );
    expect(typeof token).toBe('string');
    expect(token.split('.')).toHaveLength(3);
  });

  it('verifies a valid token and returns payload', () => {
    const token = signToken(
      { sub: 'kckern', hid: 'default', roles: ['sysadmin'] },
      TEST_SECRET,
      { issuer: 'daylight-station', expiresIn: '10y', algorithm: 'HS256' }
    );
    const payload = verifyToken(token, TEST_SECRET, {
      issuer: 'daylight-station',
      algorithms: ['HS256']
    });
    expect(payload.sub).toBe('kckern');
    expect(payload.hid).toBe('default');
    expect(payload.roles).toEqual(['sysadmin']);
  });

  it('returns null for invalid token', () => {
    const payload = verifyToken('garbage.token.here', TEST_SECRET, {
      issuer: 'daylight-station',
      algorithms: ['HS256']
    });
    expect(payload).toBeNull();
  });

  it('returns null for wrong secret', () => {
    const token = signToken(
      { sub: 'kckern', hid: 'default', roles: ['sysadmin'] },
      TEST_SECRET,
      { issuer: 'daylight-station', expiresIn: '10y', algorithm: 'HS256' }
    );
    const payload = verifyToken(token, 'wrong-secret', {
      issuer: 'daylight-station',
      algorithms: ['HS256']
    });
    expect(payload).toBeNull();
  });
});
