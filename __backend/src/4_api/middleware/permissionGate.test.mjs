import { describe, it, expect } from 'vitest';
import express from 'express';
import request from 'supertest';
import { permissionGate, resolveRouteApp } from './permissionGate.mjs';

const roles = { parent: { apps: ['fitness'] }, sysadmin: { apps: ['*'] } };
const appRoutes = { admin: ['admin/*'], fitness: ['fitness/*'] };

function build(userRoles) {
  const app = express();
  app.use((req, res, next) => { req.roles = userRoles; req.user = { id: 'u' }; next(); });
  app.use('/api/v1', permissionGate({ roles, appRoutes }));
  const admin = express.Router();
  admin.get('/secret', (req, res) => res.json({ ok: true }));
  app.use('/api/v1/admin', admin);
  app.get('/api/v1/fitness/x', (req, res) => res.json({ ok: true }));
  return app;
}

describe('permissionGate: the route a path reaches is the route it is checked as', () => {
  it('resolves the app in any spelling Express routes the same way', () => {
    for (const path of ['/admin/x', '/ADMIN/x', '/Admin/', '//admin/x', '/%61dmin/x', '/admin./x']) {
      expect(resolveRouteApp(path, appRoutes), path).toBe('admin');
    }
    expect(resolveRouteApp('/administrator', appRoutes)).toBeNull();
  });

  it('matches a pattern written in any case', () => {
    expect(resolveRouteApp('/fitness/x', { fitness: ['Fitness/*'] })).toBe('fitness');
  });

  it('refuses a parent who changes the case to reach the admin router', async () => {
    for (const path of ['/api/v1/admin/secret', '/api/v1/ADMIN/secret', '/API/V1/Admin/secret']) {
      const res = await request(build(['parent'])).get(path);
      expect(res.status, path).toBe(403);
    }
    expect((await request(build(['parent'])).get('/api/v1/fitness/x')).status).toBe(200);
    expect((await request(build(['sysadmin'])).get('/api/v1/ADMIN/secret')).status).toBe(200);
  });
});
