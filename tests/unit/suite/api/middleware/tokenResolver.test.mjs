// tests/unit/suite/api/middleware/tokenResolver.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
import { tokenResolver } from '#api/middleware/tokenResolver.mjs';
import { signToken } from '#system/auth/jwt.mjs';

const SECRET = 'a'.repeat(128);
const JWT_CONFIG = { issuer: 'daylight-station', algorithm: 'HS256' };

function mockReq(authHeader = null, existingRoles = []) {
  return {
    headers: authHeader ? { authorization: authHeader } : {},
    roles: [...existingRoles]
  };
}
function mockRes() { return {}; }

describe('tokenResolver', () => {
  it('merges token roles into existing roles', (done) => {
    const token = signToken(
      { sub: 'kckern', hid: 'default', roles: ['parent'] },
      SECRET, { issuer: JWT_CONFIG.issuer, expiresIn: '10y', algorithm: JWT_CONFIG.algorithm }
    );
    const middleware = tokenResolver({ jwtSecret: SECRET, jwtConfig: JWT_CONFIG });
    const req = mockReq(`Bearer ${token}`, ['kiosk']);
    middleware(req, mockRes(), () => {
      expect(req.roles).toEqual(expect.arrayContaining(['kiosk', 'parent']));
      expect(req.user).toEqual({ sub: 'kckern', hid: 'default', roles: ['parent'] });
      done();
    });
  });

  it('no-ops when no authorization header present', (done) => {
    const middleware = tokenResolver({ jwtSecret: SECRET, jwtConfig: JWT_CONFIG });
    const req = mockReq(null, ['kiosk']);
    middleware(req, mockRes(), () => {
      expect(req.roles).toEqual(['kiosk']);
      expect(req.user).toBeUndefined();
      done();
    });
  });

  it('no-ops when token is invalid', (done) => {
    const middleware = tokenResolver({ jwtSecret: SECRET, jwtConfig: JWT_CONFIG });
    const req = mockReq('Bearer invalid.token.here', ['kiosk']);
    middleware(req, mockRes(), () => {
      expect(req.roles).toEqual(['kiosk']);
      expect(req.user).toBeUndefined();
      done();
    });
  });

  it('deduplicates merged roles', (done) => {
    const token = signToken(
      { sub: 'kckern', hid: 'default', roles: ['kiosk', 'parent'] },
      SECRET, { issuer: JWT_CONFIG.issuer, expiresIn: '10y', algorithm: JWT_CONFIG.algorithm }
    );
    const middleware = tokenResolver({ jwtSecret: SECRET, jwtConfig: JWT_CONFIG });
    const req = mockReq(`Bearer ${token}`, ['kiosk']);
    middleware(req, mockRes(), () => {
      expect(req.roles.filter(r => r === 'kiosk')).toHaveLength(1);
      done();
    });
  });
});
