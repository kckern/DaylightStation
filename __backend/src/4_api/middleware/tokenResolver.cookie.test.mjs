import { describe, it, expect } from 'vitest';
import { signToken } from '#system/auth/jwt.mjs';
import { tokenResolver, SESSION_COOKIE } from './tokenResolver.mjs';

const SECRET = 'test-secret';
const CONFIG = { issuer: 'daylight-station', algorithm: 'HS256' };
const token = (roles = ['admin']) => signToken({ sub: 'kckern', hid: 'default', roles }, SECRET,
  { issuer: CONFIG.issuer, algorithm: CONFIG.algorithm, expiresIn: '1h' });

const run = (headers, priorRoles = []) => {
  const req = { headers, roles: [...priorRoles] };
  let nexted = false;
  tokenResolver({ jwtSecret: SECRET, jwtConfig: CONFIG })(req, {}, () => { nexted = true; });
  return { req, nexted };
};

describe('tokenResolver — cookie transport', () => {
  it('accepts the session cookie, which is what makes one sign-in cover every adult app', () => {
    // A browser cannot attach an Authorization header to an ordinary
    // navigation, so a bearer-only resolver left each app to store and send
    // the token itself — which is why there was no single login.
    const { req, nexted } = run({ cookie: `${SESSION_COOKIE}=${token()}` });
    expect(nexted).toBe(true);
    expect(req.user.sub).toBe('kckern');
    expect(req.roles).toContain('admin');
  });

  it('still prefers the Authorization header, for CLIs and the agent mounts', () => {
    const headerToken = token(['sysadmin']);
    const { req } = run({ authorization: `Bearer ${headerToken}`, cookie: `${SESSION_COOKIE}=${token(['member'])}` });
    expect(req.roles).toContain('sysadmin');
    expect(req.roles).not.toContain('member');
  });

  it('merges token roles onto whatever network trust already granted', () => {
    const { req } = run({ cookie: `${SESSION_COOKIE}=${token(['admin'])}` }, ['kiosk']);
    expect(req.roles.sort()).toEqual(['admin', 'kiosk']);
  });

  it('picks its own cookie out of a jar that holds others', () => {
    // The teacher cookie shares this header, and so does anything else the
    // browser is carrying for the origin.
    const { req } = run({ cookie: `daylight_teacher_session=abc; ${SESSION_COOKIE}=${token()}; other=1` });
    expect(req.user?.sub).toBe('kckern');
  });

  it('passes an anonymous request through untouched rather than refusing it', () => {
    // This middleware resolves identity; it does not gate. permissionGate
    // decides, and on a trusted LAN an anonymous request is still legitimate.
    const { req, nexted } = run({});
    expect(nexted).toBe(true);
    expect(req.user).toBeUndefined();
  });

  it('ignores a forged or expired cookie instead of trusting its claims', () => {
    const forged = signToken({ sub: 'attacker', roles: ['sysadmin'] }, 'wrong-secret',
      { issuer: CONFIG.issuer, algorithm: CONFIG.algorithm });
    const { req, nexted } = run({ cookie: `${SESSION_COOKIE}=${forged}` }, ['kiosk']);
    expect(nexted).toBe(true);
    expect(req.user).toBeUndefined();
    expect(req.roles).toEqual(['kiosk']);
  });
});
