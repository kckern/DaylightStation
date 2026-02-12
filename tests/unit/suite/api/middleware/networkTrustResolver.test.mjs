// tests/unit/suite/api/middleware/networkTrustResolver.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
import { networkTrustResolver } from '#api/middleware/networkTrustResolver.mjs';

function mockReq(ip, householdId = 'default') {
  return { ip, householdId, roles: [] };
}
function mockRes() {
  return {};
}

const householdRoles = { default: ['kiosk'] };

describe('networkTrustResolver', () => {
  it('assigns household roles for private IPv4 (192.168.x.x)', (done) => {
    const middleware = networkTrustResolver({ householdRoles });
    const req = mockReq('192.168.1.100');
    middleware(req, mockRes(), () => {
      expect(req.roles).toEqual(['kiosk']);
      expect(req.isLocal).toBe(true);
      done();
    });
  });

  it('assigns household roles for private IPv4 (10.x.x.x)', (done) => {
    const middleware = networkTrustResolver({ householdRoles });
    const req = mockReq('10.0.0.5');
    middleware(req, mockRes(), () => {
      expect(req.roles).toEqual(['kiosk']);
      done();
    });
  });

  it('assigns household roles for IPv6 loopback (::1)', (done) => {
    const middleware = networkTrustResolver({ householdRoles });
    const req = mockReq('::1');
    middleware(req, mockRes(), () => {
      expect(req.roles).toEqual(['kiosk']);
      done();
    });
  });

  it('assigns household roles for IPv4-mapped IPv6 (::ffff:127.0.0.1)', (done) => {
    const middleware = networkTrustResolver({ householdRoles });
    const req = mockReq('::ffff:127.0.0.1');
    middleware(req, mockRes(), () => {
      expect(req.roles).toEqual(['kiosk']);
      done();
    });
  });

  it('assigns household roles for IPv4-mapped private (::ffff:192.168.1.1)', (done) => {
    const middleware = networkTrustResolver({ householdRoles });
    const req = mockReq('::ffff:192.168.1.1');
    middleware(req, mockRes(), () => {
      expect(req.roles).toEqual(['kiosk']);
      done();
    });
  });

  it('assigns empty roles for public IP', (done) => {
    const middleware = networkTrustResolver({ householdRoles });
    const req = mockReq('8.8.8.8');
    middleware(req, mockRes(), () => {
      expect(req.roles).toEqual([]);
      expect(req.isLocal).toBe(false);
      done();
    });
  });

  it('uses householdId to look up roles', (done) => {
    const roles = { default: ['kiosk'], other: ['kiosk', 'member'] };
    const middleware = networkTrustResolver({ householdRoles: roles });
    const req = mockReq('192.168.1.1', 'other');
    middleware(req, mockRes(), () => {
      expect(req.roles).toEqual(['kiosk', 'member']);
      done();
    });
  });

  it('assigns empty roles if household not in config', (done) => {
    const middleware = networkTrustResolver({ householdRoles });
    const req = mockReq('192.168.1.1', 'unknown');
    middleware(req, mockRes(), () => {
      expect(req.roles).toEqual([]);
      done();
    });
  });
});
