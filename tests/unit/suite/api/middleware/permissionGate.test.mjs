// tests/unit/suite/api/middleware/permissionGate.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
import { permissionGate, expandRolesToApps, resolveRouteApp } from '#api/middleware/permissionGate.mjs';

const roles = {
  sysadmin: { apps: ['*'] },
  parent: { apps: ['fitness', 'finance'] },
  kiosk: { apps: ['tv', 'content'] }
};

const appRoutes = {
  admin: ['admin/*'],
  fitness: ['fitness/*'],
  finance: ['finance/*'],
  tv: ['list/*', 'play/*', 'queue/*', 'stream/*'],
  content: ['content/*']
};

describe('expandRolesToApps', () => {
  it('expands sysadmin wildcard to all apps', () => {
    const apps = expandRolesToApps(['sysadmin'], roles);
    expect(apps).toContain('*');
  });

  it('expands parent role to specific apps', () => {
    const apps = expandRolesToApps(['parent'], roles);
    expect(apps).toEqual(expect.arrayContaining(['fitness', 'finance']));
  });

  it('merges multiple roles', () => {
    const apps = expandRolesToApps(['parent', 'kiosk'], roles);
    expect(apps).toEqual(expect.arrayContaining(['fitness', 'finance', 'tv', 'content']));
  });

  it('returns empty for unknown role', () => {
    const apps = expandRolesToApps(['unknown'], roles);
    expect(apps).toEqual([]);
  });
});

describe('resolveRouteApp', () => {
  it('matches admin/* route', () => {
    expect(resolveRouteApp('/admin/household', appRoutes)).toBe('admin');
  });

  it('matches fitness/* route', () => {
    expect(resolveRouteApp('/fitness/sessions', appRoutes)).toBe('fitness');
  });

  it('matches nested list/* route to tv app', () => {
    expect(resolveRouteApp('/list/menus', appRoutes)).toBe('tv');
  });

  it('returns null for unmapped route', () => {
    expect(resolveRouteApp('/ping', appRoutes)).toBeNull();
  });
});

describe('permissionGate middleware', () => {
  function mockReq(path, reqRoles = [], user = undefined) {
    return { path, roles: reqRoles, user };
  }
  function mockRes() {
    const res = { statusCode: null, body: null };
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (data) => { res.body = data; return res; };
    return res;
  }

  const gate = permissionGate({ roles, appRoutes });

  it('allows sysadmin to access any route', (done) => {
    const req = mockReq('/admin/household', ['sysadmin'], { sub: 'kckern' });
    gate(req, mockRes(), () => { done(); });
  });

  it('allows kiosk to access tv routes', (done) => {
    const req = mockReq('/list/menus', ['kiosk']);
    gate(req, mockRes(), () => { done(); });
  });

  it('blocks kiosk from admin routes with 401 (no user)', () => {
    const req = mockReq('/admin/household', ['kiosk']);
    const res = mockRes();
    const next = jest.fn();
    gate(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
  });

  it('blocks parent from admin routes with 403 (has user)', () => {
    const req = mockReq('/admin/household', ['parent'], { sub: 'kckern' });
    const res = mockRes();
    const next = jest.fn();
    gate(req, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('allows unmapped routes (no app mapping)', (done) => {
    const req = mockReq('/ping', []);
    gate(req, mockRes(), () => { done(); });
  });
});
