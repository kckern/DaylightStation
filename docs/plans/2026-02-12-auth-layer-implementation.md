# Auth Layer Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the auth layer from the v2 design doc — first-boot setup wizard, JWT auth, middleware pipeline, invite flow, and Admin app enhancements.

**Architecture:** Three middleware layers (networkTrust → tokenResolver → permissionGate) protect `/api/v1/*` routes. Auth state lives in YAML files (`auth.yml` for config, `login.yml` per user). Frontend uses localStorage JWT tokens. Setup wizard bootstraps the first user + household on fresh installs.

**Tech Stack:** Express 5 middleware, jsonwebtoken, bcrypt, js-yaml, React 18, Mantine 7, React Router 6

**Design Doc:** `docs/plans/2026-02-12-auth-layer-design-v2.md`

**Key codebase patterns:**
- Router factory: `export function createXRouter(config) { const router = express.Router(); ... return router; }`
- Import aliases: `#system/*`, `#api/*`, `#apps/*`, `#domains/*`, `#adapters/*`
- Test imports: `import { describe, it, expect, jest } from '@jest/globals';`
- Async routes: `router.get('/path', asyncHandler(async (req, res) => { ... }));`
- YAML I/O: `dataService.user.read('auth/login', username)` / `dataService.system.read('config/auth')`
- Logger: `logger.info('component.action', { key: value })`

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install bcrypt and jsonwebtoken**

```bash
npm install bcrypt jsonwebtoken
```

**Step 2: Verify installation**

```bash
node -e "require('bcrypt'); require('jsonwebtoken'); console.log('OK')"
```
Expected: `OK`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add bcrypt and jsonwebtoken dependencies"
```

---

### Task 2: Auth Config Seed File

**Files:**
- Create: `backend/src/0_system/auth/authConfigDefaults.mjs`
- Test: `tests/unit/suite/system/auth/authConfigDefaults.test.mjs`

**Step 1: Write the failing test**

```javascript
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
```

**Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/suite/system/auth/authConfigDefaults.test.mjs --no-cache
```
Expected: FAIL — module not found

**Step 3: Write the implementation**

```javascript
// backend/src/0_system/auth/authConfigDefaults.mjs
import crypto from 'crypto';

export function generateJwtSecret() {
  return crypto.randomBytes(64).toString('hex');
}

export function getDefaultAuthConfig() {
  return {
    roles: {
      sysadmin: { apps: ['*'] },
      admin: { apps: ['admin', 'finance', 'config', 'scheduler', 'devices', 'members'] },
      parent: { apps: ['fitness', 'finance', 'lifelog'] },
      member: { apps: ['fitness', 'lifelog'] },
      kiosk: { apps: ['tv', 'office', 'content', 'display', 'play', 'queue', 'stream', 'canvas', 'device'] }
    },
    household_roles: {
      default: ['kiosk']
    },
    app_routes: {
      admin: ['admin/*'],
      finance: ['finance/*'],
      config: ['config/*'],
      scheduler: ['scheduling/*'],
      fitness: ['fitness/*'],
      lifelog: ['lifelog/*'],
      tv: ['list/*', 'play/*', 'queue/*', 'stream/*'],
      office: ['display/*', 'canvas/*'],
      content: ['content/*'],
      device: ['device/*']
    },
    jwt: {
      issuer: 'daylight-station',
      expiry: '10y',
      algorithm: 'HS256'
    }
  };
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest tests/unit/suite/system/auth/authConfigDefaults.test.mjs --no-cache
```
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/0_system/auth/authConfigDefaults.mjs tests/unit/suite/system/auth/authConfigDefaults.test.mjs
git commit -m "feat(auth): add auth config defaults and JWT secret generator"
```

---

### Task 3: JWT Utilities

**Files:**
- Create: `backend/src/0_system/auth/jwt.mjs`
- Test: `tests/unit/suite/system/auth/jwt.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/system/auth/jwt.test.mjs
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
```

**Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/suite/system/auth/jwt.test.mjs --no-cache
```
Expected: FAIL — module not found

**Step 3: Write the implementation**

```javascript
// backend/src/0_system/auth/jwt.mjs
import jwt from 'jsonwebtoken';

export function signToken(payload, secret, options = {}) {
  return jwt.sign(payload, secret, options);
}

export function verifyToken(token, secret, options = {}) {
  try {
    return jwt.verify(token, secret, options);
  } catch {
    return null;
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest tests/unit/suite/system/auth/jwt.test.mjs --no-cache
```
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/0_system/auth/jwt.mjs tests/unit/suite/system/auth/jwt.test.mjs
git commit -m "feat(auth): add JWT sign and verify utilities"
```

---

### Task 4: Password Utilities

**Files:**
- Create: `backend/src/0_system/auth/password.mjs`
- Test: `tests/unit/suite/system/auth/password.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/system/auth/password.test.mjs
import { describe, it, expect } from '@jest/globals';
import { hashPassword, verifyPassword } from '#system/auth/password.mjs';

describe('password utilities', () => {
  it('hashes a password and returns a bcrypt string', async () => {
    const hash = await hashPassword('test-password');
    expect(hash).toMatch(/^\$2[aby]\$\d{2}\$/);
  });

  it('verifies correct password returns true', async () => {
    const hash = await hashPassword('test-password');
    const result = await verifyPassword('test-password', hash);
    expect(result).toBe(true);
  });

  it('verifies wrong password returns false', async () => {
    const hash = await hashPassword('test-password');
    const result = await verifyPassword('wrong-password', hash);
    expect(result).toBe(false);
  });

  it('produces different hashes for same password (salted)', async () => {
    const hash1 = await hashPassword('test-password');
    const hash2 = await hashPassword('test-password');
    expect(hash1).not.toBe(hash2);
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/suite/system/auth/password.test.mjs --no-cache
```
Expected: FAIL — module not found

**Step 3: Write the implementation**

```javascript
// backend/src/0_system/auth/password.mjs
import bcrypt from 'bcrypt';

const SALT_ROUNDS = 12;

export async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

export async function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash);
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest tests/unit/suite/system/auth/password.test.mjs --no-cache
```
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/0_system/auth/password.mjs tests/unit/suite/system/auth/password.test.mjs
git commit -m "feat(auth): add password hash and verify utilities"
```

---

### Task 5: networkTrustResolver Middleware

**Files:**
- Create: `backend/src/4_api/middleware/networkTrustResolver.mjs`
- Test: `tests/unit/suite/api/middleware/networkTrustResolver.test.mjs`

**Step 1: Write the failing test**

```javascript
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
```

**Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/suite/api/middleware/networkTrustResolver.test.mjs --no-cache
```
Expected: FAIL — module not found

**Step 3: Write the implementation**

```javascript
// backend/src/4_api/middleware/networkTrustResolver.mjs

const PRIVATE_IP_PATTERNS = [
  /^10\./,                          // 10.0.0.0/8
  /^172\.(1[6-9]|2\d|3[01])\./,    // 172.16.0.0/12
  /^192\.168\./,                    // 192.168.0.0/16
  /^127\./,                         // 127.0.0.0/8
  /^::1$/,                          // IPv6 loopback
  /^::ffff:127\./,                  // IPv4-mapped loopback
  /^::ffff:10\./,                   // IPv4-mapped 10.x
  /^::ffff:172\.(1[6-9]|2\d|3[01])\./, // IPv4-mapped 172.16-31.x
  /^::ffff:192\.168\./              // IPv4-mapped 192.168.x
];

function isPrivateIp(ip) {
  return PRIVATE_IP_PATTERNS.some(pattern => pattern.test(ip));
}

export function networkTrustResolver({ householdRoles }) {
  return (req, res, next) => {
    const ip = req.ip || '';
    const local = isPrivateIp(ip);
    req.isLocal = local;

    if (local && req.householdId) {
      req.roles = [...(householdRoles[req.householdId] || [])];
    } else {
      req.roles = [];
    }

    next();
  };
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest tests/unit/suite/api/middleware/networkTrustResolver.test.mjs --no-cache
```
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/4_api/middleware/networkTrustResolver.mjs tests/unit/suite/api/middleware/networkTrustResolver.test.mjs
git commit -m "feat(auth): add networkTrustResolver middleware"
```

---

### Task 6: tokenResolver Middleware

**Files:**
- Create: `backend/src/4_api/middleware/tokenResolver.mjs`
- Test: `tests/unit/suite/api/middleware/tokenResolver.test.mjs`

**Step 1: Write the failing test**

```javascript
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
```

**Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/suite/api/middleware/tokenResolver.test.mjs --no-cache
```
Expected: FAIL — module not found

**Step 3: Write the implementation**

```javascript
// backend/src/4_api/middleware/tokenResolver.mjs
import { verifyToken } from '#system/auth/jwt.mjs';

export function tokenResolver({ jwtSecret, jwtConfig }) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.slice(7);
    const payload = verifyToken(token, jwtSecret, {
      issuer: jwtConfig.issuer,
      algorithms: [jwtConfig.algorithm]
    });

    if (!payload) {
      return next();
    }

    req.user = {
      sub: payload.sub,
      hid: payload.hid,
      roles: payload.roles || []
    };

    // Merge token roles into existing roles (from networkTrustResolver), deduplicated
    const merged = new Set([...(req.roles || []), ...req.user.roles]);
    req.roles = [...merged];

    next();
  };
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest tests/unit/suite/api/middleware/tokenResolver.test.mjs --no-cache
```
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/4_api/middleware/tokenResolver.mjs tests/unit/suite/api/middleware/tokenResolver.test.mjs
git commit -m "feat(auth): add tokenResolver middleware"
```

---

### Task 7: permissionGate Middleware

**Files:**
- Create: `backend/src/4_api/middleware/permissionGate.mjs`
- Test: `tests/unit/suite/api/middleware/permissionGate.test.mjs`

**Step 1: Write the failing test**

```javascript
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
```

**Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/suite/api/middleware/permissionGate.test.mjs --no-cache
```
Expected: FAIL — module not found

**Step 3: Write the implementation**

```javascript
// backend/src/4_api/middleware/permissionGate.mjs

export function expandRolesToApps(userRoles, roleDefinitions) {
  const apps = new Set();
  for (const role of userRoles) {
    const def = roleDefinitions[role];
    if (!def) continue;
    for (const app of def.apps) {
      apps.add(app);
    }
  }
  return [...apps];
}

export function resolveRouteApp(routePath, appRoutes) {
  // Strip leading slash for matching
  const path = routePath.replace(/^\//, '');
  for (const [app, patterns] of Object.entries(appRoutes)) {
    for (const pattern of patterns) {
      // Convert 'admin/*' to regex that matches 'admin/anything'
      const prefix = pattern.replace(/\/\*$/, '');
      if (path === prefix || path.startsWith(prefix + '/')) {
        return app;
      }
    }
  }
  return null;
}

export function permissionGate({ roles, appRoutes }) {
  return (req, res, next) => {
    const app = resolveRouteApp(req.path, appRoutes);

    // Unmapped routes are unrestricted
    if (!app) return next();

    const userApps = expandRolesToApps(req.roles || [], roles);

    // Wildcard access (sysadmin)
    if (userApps.includes('*')) return next();

    // Check if user has access to this app
    if (userApps.includes(app)) return next();

    // Denied — 401 if no user identity, 403 if authenticated but insufficient
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.status(403).json({ error: 'Insufficient permissions' });
  };
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest tests/unit/suite/api/middleware/permissionGate.test.mjs --no-cache
```
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/4_api/middleware/permissionGate.mjs tests/unit/suite/api/middleware/permissionGate.test.mjs
git commit -m "feat(auth): add permissionGate middleware with role expansion"
```

---

### Task 8: Auth Service

Business logic for setup detection, user creation, invite management, and login.

**Files:**
- Create: `backend/src/3_applications/auth/AuthService.mjs`
- Test: `tests/unit/suite/applications/auth/AuthService.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/applications/auth/AuthService.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { AuthService } from '#apps/auth/AuthService.mjs';

describe('AuthService', () => {
  let service;
  let mockDataService;
  let mockConfigService;

  beforeEach(() => {
    mockDataService = {
      user: {
        read: jest.fn().mockReturnValue(null),
        write: jest.fn(),
        resolvePath: jest.fn().mockReturnValue('/data/users/test/auth/login.yml')
      },
      system: {
        read: jest.fn().mockReturnValue(null),
        write: jest.fn()
      },
      household: {
        read: jest.fn().mockReturnValue(null),
        write: jest.fn()
      }
    };
    mockConfigService = {
      getHouseholdUsers: jest.fn().mockReturnValue([]),
      getAllUserProfiles: jest.fn().mockReturnValue(new Map()),
      getDefaultHouseholdId: jest.fn().mockReturnValue('default')
    };

    service = new AuthService({
      dataService: mockDataService,
      configService: mockConfigService,
      logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
    });
  });

  describe('needsSetup', () => {
    it('returns true when no users have login.yml', () => {
      mockConfigService.getAllUserProfiles.mockReturnValue(new Map());
      expect(service.needsSetup()).toBe(true);
    });

    it('returns false when a user has a password_hash', () => {
      mockConfigService.getAllUserProfiles.mockReturnValue(
        new Map([['kckern', { username: 'kckern' }]])
      );
      mockDataService.user.read.mockReturnValue({ password_hash: '$2b$12$...' });
      expect(service.needsSetup()).toBe(false);
    });
  });

  describe('setup', () => {
    it('creates user profile, login.yml, household config, and auth config', async () => {
      const result = await service.setup({
        username: 'admin',
        password: 'test-password',
        householdName: 'Test Family'
      });

      // User profile written
      expect(mockDataService.user.write).toHaveBeenCalledWith(
        'profile',
        expect.objectContaining({
          username: 'admin',
          roles: ['sysadmin'],
          type: 'owner',
          household_id: 'default'
        }),
        'admin'
      );

      // Login written with bcrypt hash
      expect(mockDataService.user.write).toHaveBeenCalledWith(
        'auth/login',
        expect.objectContaining({
          password_hash: expect.stringMatching(/^\$2[aby]\$/),
          invite_token: null,
          invited_by: null
        }),
        'admin'
      );

      // Household config written
      expect(mockDataService.household.write).toHaveBeenCalledWith(
        'config/household',
        expect.objectContaining({
          name: 'Test Family',
          head: 'admin',
          users: ['admin']
        })
      );

      // Auth config written
      expect(mockDataService.system.write).toHaveBeenCalledWith(
        'config/auth',
        expect.objectContaining({
          roles: expect.any(Object),
          jwt: expect.objectContaining({ secret: expect.any(String) })
        })
      );

      expect(result).toHaveProperty('username', 'admin');
      expect(result).toHaveProperty('roles', ['sysadmin']);
      expect(result).toHaveProperty('householdId', 'default');
    });
  });

  describe('login', () => {
    it('returns user data when credentials are valid', async () => {
      // Pre-hash a known password
      const bcrypt = await import('bcrypt');
      const hash = await bcrypt.default.hash('correct-password', 4);

      mockDataService.user.read
        .mockReturnValueOnce({ username: 'kckern', household_id: 'default', roles: ['sysadmin'] }) // profile
        .mockReturnValueOnce({ password_hash: hash }); // login

      const result = await service.login('kckern', 'correct-password');
      expect(result).toHaveProperty('username', 'kckern');
      expect(result).toHaveProperty('roles', ['sysadmin']);
    });

    it('returns null for wrong password', async () => {
      const bcrypt = await import('bcrypt');
      const hash = await bcrypt.default.hash('correct-password', 4);

      mockDataService.user.read
        .mockReturnValueOnce({ username: 'kckern', household_id: 'default', roles: ['sysadmin'] })
        .mockReturnValueOnce({ password_hash: hash });

      const result = await service.login('kckern', 'wrong-password');
      expect(result).toBeNull();
    });

    it('returns null for nonexistent user', async () => {
      mockDataService.user.read.mockReturnValue(null);
      const result = await service.login('nobody', 'password');
      expect(result).toBeNull();
    });
  });

  describe('generateInvite', () => {
    it('generates a token and writes login.yml', async () => {
      mockDataService.user.read.mockReturnValue({ username: 'elizabeth' });
      const result = await service.generateInvite('elizabeth', 'kckern');
      expect(result).toHaveProperty('token');
      expect(result.token).toHaveLength(64);
      expect(mockDataService.user.write).toHaveBeenCalledWith(
        'auth/login',
        expect.objectContaining({
          invite_token: result.token,
          invited_by: 'kckern'
        }),
        'elizabeth'
      );
    });

    it('throws if user profile does not exist', async () => {
      mockDataService.user.read.mockReturnValue(null);
      await expect(service.generateInvite('nobody', 'kckern'))
        .rejects.toThrow();
    });
  });

  describe('acceptInvite', () => {
    it('sets password and clears invite token', async () => {
      mockDataService.user.read
        .mockReturnValueOnce(null) // first call: scan for token match — will be handled by implementation
        .mockReturnValue({ invite_token: 'abc123', password_hash: null });

      // We need to mock the token lookup — implementation will scan users
      mockConfigService.getAllUserProfiles.mockReturnValue(
        new Map([['elizabeth', { username: 'elizabeth', household_id: 'default', roles: ['member'] }]])
      );
      // When scanning, read login.yml for elizabeth
      mockDataService.user.read.mockImplementation((path, username) => {
        if (path === 'auth/login' && username === 'elizabeth') {
          return { invite_token: 'abc123', password_hash: null, invited_by: 'kckern' };
        }
        if (path === 'profile' && username === 'elizabeth') {
          return { username: 'elizabeth', household_id: 'default', roles: ['member'], display_name: 'Liz' };
        }
        return null;
      });

      const result = await service.acceptInvite('abc123', {
        password: 'new-password',
        displayName: 'Elizabeth'
      });

      expect(result).toHaveProperty('username', 'elizabeth');
      expect(mockDataService.user.write).toHaveBeenCalledWith(
        'auth/login',
        expect.objectContaining({
          password_hash: expect.stringMatching(/^\$2[aby]\$/),
          invite_token: null
        }),
        'elizabeth'
      );
    });
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/suite/applications/auth/AuthService.test.mjs --no-cache
```
Expected: FAIL — module not found

**Step 3: Write the implementation**

```javascript
// backend/src/3_applications/auth/AuthService.mjs
import crypto from 'crypto';
import { hashPassword, verifyPassword } from '#system/auth/password.mjs';
import { getDefaultAuthConfig, generateJwtSecret } from '#system/auth/authConfigDefaults.mjs';

export class AuthService {
  #dataService;
  #configService;
  #logger;

  constructor({ dataService, configService, logger = console }) {
    this.#dataService = dataService;
    this.#configService = configService;
    this.#logger = logger;
  }

  needsSetup() {
    const users = this.#configService.getAllUserProfiles();
    for (const [username] of users) {
      const login = this.#dataService.user.read('auth/login', username);
      if (login?.password_hash) return false;
    }
    return true;
  }

  async setup({ username, password, householdName }) {
    const householdId = 'default';

    // Create user profile
    this.#dataService.user.write('profile', {
      username,
      household_id: householdId,
      roles: ['sysadmin'],
      type: 'owner',
      group: 'primary'
    }, username);

    // Create login credentials
    const passwordHash = await hashPassword(password);
    this.#dataService.user.write('auth/login', {
      password_hash: passwordHash,
      invite_token: null,
      invited_by: null,
      invited_at: null,
      last_login: new Date().toISOString()
    }, username);

    // Create household config
    this.#dataService.household.write('config/household', {
      household_id: householdId,
      name: householdName,
      head: username,
      users: [username]
    });

    // Create auth config with generated JWT secret
    const authConfig = getDefaultAuthConfig();
    authConfig.jwt.secret = generateJwtSecret();
    this.#dataService.system.write('config/auth', authConfig);

    this.#logger.info('auth.setup.complete', { username, householdId });

    return { username, roles: ['sysadmin'], householdId };
  }

  async login(username, password) {
    const profile = this.#dataService.user.read('profile', username);
    if (!profile) return null;

    const login = this.#dataService.user.read('auth/login', username);
    if (!login?.password_hash) return null;

    const valid = await verifyPassword(password, login.password_hash);
    if (!valid) return null;

    // Update last login
    this.#dataService.user.write('auth/login', {
      ...login,
      last_login: new Date().toISOString()
    }, username);

    this.#logger.info('auth.login.success', { username });

    return {
      username: profile.username,
      householdId: profile.household_id || this.#configService.getDefaultHouseholdId(),
      roles: profile.roles || []
    };
  }

  async generateInvite(username, invitedBy) {
    const profile = this.#dataService.user.read('profile', username);
    if (!profile) throw new Error(`User not found: ${username}`);

    const token = crypto.randomBytes(32).toString('hex');
    const existing = this.#dataService.user.read('auth/login', username) || {};

    this.#dataService.user.write('auth/login', {
      ...existing,
      invite_token: token,
      invited_by: invitedBy,
      invited_at: new Date().toISOString(),
      password_hash: null  // Reset password on re-invite
    }, username);

    this.#logger.info('auth.invite.generated', { username, invitedBy });

    return { token };
  }

  resolveInviteToken(token) {
    const users = this.#configService.getAllUserProfiles();
    for (const [username] of users) {
      const login = this.#dataService.user.read('auth/login', username);
      if (login?.invite_token === token) {
        const profile = this.#dataService.user.read('profile', username);
        return { username, displayName: profile?.display_name || '' };
      }
    }
    return null;
  }

  async acceptInvite(token, { password, displayName }) {
    const resolved = this.resolveInviteToken(token);
    if (!resolved) throw new Error('Invalid invite token');

    const { username } = resolved;
    const profile = this.#dataService.user.read('profile', username);
    const login = this.#dataService.user.read('auth/login', username);

    // Set password and clear invite token
    const passwordHash = await hashPassword(password);
    this.#dataService.user.write('auth/login', {
      ...login,
      password_hash: passwordHash,
      invite_token: null,
      last_login: new Date().toISOString()
    }, username);

    // Update display name if provided
    if (displayName && displayName !== profile.display_name) {
      this.#dataService.user.write('profile', {
        ...profile,
        display_name: displayName
      }, username);
    }

    this.#logger.info('auth.invite.accepted', { username });

    return {
      username,
      householdId: profile.household_id || this.#configService.getDefaultHouseholdId(),
      roles: profile.roles || []
    };
  }

  getAuthConfig() {
    return this.#dataService.system.read('config/auth');
  }
}
```

**Step 4: Run test to verify it passes**

```bash
npx jest tests/unit/suite/applications/auth/AuthService.test.mjs --no-cache
```
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/3_applications/auth/AuthService.mjs tests/unit/suite/applications/auth/AuthService.test.mjs
git commit -m "feat(auth): add AuthService with setup, login, and invite flows"
```

---

### Task 9: Auth Router

**Files:**
- Create: `backend/src/4_api/v1/routers/auth.mjs`
- Test: `tests/unit/suite/api/auth.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/suite/api/auth.test.mjs
import { describe, it, expect, jest } from '@jest/globals';
import { createAuthRouter } from '#api/v1/routers/auth.mjs';

describe('Auth Router', () => {
  it('creates a router with required dependencies', () => {
    const mockAuthService = {
      needsSetup: jest.fn(),
      setup: jest.fn(),
      login: jest.fn(),
      generateInvite: jest.fn(),
      resolveInviteToken: jest.fn(),
      acceptInvite: jest.fn(),
      getAuthConfig: jest.fn()
    };

    const router = createAuthRouter({
      authService: mockAuthService,
      jwtSecret: 'test-secret',
      jwtConfig: { issuer: 'daylight-station', expiry: '10y', algorithm: 'HS256' },
      configService: { getDefaultHouseholdId: jest.fn() },
      dataService: { household: { read: jest.fn() } },
      logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
    });

    expect(router).toBeDefined();
    expect(typeof router.get).toBe('function');
    expect(typeof router.post).toBe('function');
  });
});
```

**Step 2: Run test to verify it fails**

```bash
npx jest tests/unit/suite/api/auth.test.mjs --no-cache
```
Expected: FAIL

**Step 3: Write the implementation**

```javascript
// backend/src/4_api/v1/routers/auth.mjs
import express from 'express';
import { signToken } from '#system/auth/jwt.mjs';
import { asyncHandler } from '#system/http/middleware/index.mjs';

export function createAuthRouter({ authService, jwtSecret, jwtConfig, configService, dataService, logger = console }) {
  const router = express.Router();

  function issueToken(user) {
    return signToken(
      { sub: user.username, hid: user.householdId, roles: user.roles },
      jwtSecret,
      { issuer: jwtConfig.issuer, expiresIn: jwtConfig.expiry, algorithm: jwtConfig.algorithm }
    );
  }

  // GET /auth/setup-status
  router.get('/setup-status', (req, res) => {
    res.json({ needsSetup: authService.needsSetup() });
  });

  // POST /auth/setup — first-boot wizard
  router.post('/setup', asyncHandler(async (req, res) => {
    if (!authService.needsSetup()) {
      return res.status(403).json({ error: 'System already configured' });
    }

    const { username, password, householdName } = req.body;
    if (!username || !password || !householdName) {
      return res.status(400).json({ error: 'Missing required fields: username, password, householdName' });
    }

    const user = await authService.setup({ username, password, householdName });

    // Re-read auth config to get the generated JWT secret for signing
    const authConfig = authService.getAuthConfig();
    const token = signToken(
      { sub: user.username, hid: user.householdId, roles: user.roles },
      authConfig.jwt.secret,
      { issuer: authConfig.jwt.issuer, expiresIn: authConfig.jwt.expiry, algorithm: authConfig.jwt.algorithm }
    );

    logger.info('auth.setup.complete', { username });
    res.json({ token });
  }));

  // POST /auth/token — login
  router.post('/token', asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Missing required fields: username, password' });
    }

    const user = await authService.login(username, password);
    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = issueToken(user);
    logger.info('auth.token.issued', { username });
    res.json({ token });
  }));

  // GET /auth/context — public household info for login screen
  router.get('/context', (req, res) => {
    const householdId = req.householdId || configService.getDefaultHouseholdId();
    const household = dataService.household.read('config/household');

    res.json({
      householdId,
      householdName: household?.name || 'DaylightStation',
      authMethod: 'password',
      isLocal: req.isLocal || false
    });
  });

  // POST /auth/invite — generate invite link (requires admin access, enforced by permissionGate on /admin/*)
  router.post('/invite', asyncHandler(async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { username } = req.body;
    if (!username) {
      return res.status(400).json({ error: 'Missing required field: username' });
    }

    const { token } = await authService.generateInvite(username, req.user.sub);
    logger.info('auth.invite.created', { username, invitedBy: req.user.sub });
    res.json({ inviteUrl: `/invite/${token}` });
  }));

  // GET /auth/invite/:token — validate invite
  router.get('/invite/:token', (req, res) => {
    const result = authService.resolveInviteToken(req.params.token);
    if (!result) {
      return res.status(404).json({ error: 'Invalid or expired invite' });
    }
    res.json(result);
  });

  // POST /auth/invite/:token/accept — set password via invite
  router.post('/invite/:token/accept', asyncHandler(async (req, res) => {
    const { password, displayName } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Missing required field: password' });
    }

    try {
      const user = await authService.acceptInvite(req.params.token, { password, displayName });
      const token = issueToken(user);
      logger.info('auth.invite.accepted', { username: user.username });
      res.json({ token });
    } catch (err) {
      return res.status(404).json({ error: 'Invalid or expired invite' });
    }
  }));

  return router;
}

export default createAuthRouter;
```

**Step 4: Run test to verify it passes**

```bash
npx jest tests/unit/suite/api/auth.test.mjs --no-cache
```
Expected: PASS

**Step 5: Commit**

```bash
git add backend/src/4_api/v1/routers/auth.mjs tests/unit/suite/api/auth.test.mjs
git commit -m "feat(auth): add auth router with setup, login, invite, and context endpoints"
```

---

### Task 10: Wire Auth into app.mjs

**Files:**
- Modify: `backend/src/app.mjs` (lines ~50, ~180, ~1160, ~1197)
- Modify: `backend/src/4_api/v1/routers/api.mjs` (add auth route bypass)

**Step 1: Add imports to app.mjs**

At the top of `app.mjs`, add after existing imports (~line 17):

```javascript
// Auth system
import { AuthService } from '#apps/auth/AuthService.mjs';
import { networkTrustResolver } from '#api/middleware/networkTrustResolver.mjs';
import { tokenResolver } from '#api/middleware/tokenResolver.mjs';
import { permissionGate } from '#api/middleware/permissionGate.mjs';
```

**Step 2: Create AuthService instance after config is loaded**

After the rootLogger creation and config setup section (~line 180), add:

```javascript
// Auth service
const authService = new AuthService({ dataService, configService, logger: rootLogger.child({ module: 'auth' }) });
const authConfig = dataService.system.read('config/auth') || {};
const jwtSecret = authConfig?.jwt?.secret || '';
const jwtConfig = authConfig?.jwt || { issuer: 'daylight-station', expiry: '10y', algorithm: 'HS256' };
```

**Step 3: Wire auth middleware into the pipeline**

After the WebSocket skip middleware (~line 159) and before router setup, add:

```javascript
// Auth middleware pipeline — runs on all /api/v1/* except /api/v1/auth/*
app.use('/api/v1', (req, res, next) => {
  // Skip auth middleware for auth endpoints
  if (req.path.startsWith('/auth')) return next();
  next('route');
});

// Household resolver sets req.householdId (existing middleware, now wired globally)
app.use('/api/v1', householdResolver({ domainConfig: domainConfig || {}, configService }));

// Network trust resolver — assigns household roles for LAN requests
app.use('/api/v1', networkTrustResolver({ householdRoles: authConfig?.household_roles || {} }));

// Token resolver — parses JWT, merges roles
app.use('/api/v1', tokenResolver({ jwtSecret, jwtConfig }));

// Permission gate — enforces role-based access
app.use('/api/v1', permissionGate({
  roles: authConfig?.roles || {},
  appRoutes: authConfig?.app_routes || {}
}));
```

> **Important:** The auth middleware must be wired BEFORE the API router mount at line 1254 but AFTER the config guard at line 167. The exact location depends on what other middleware/setup exists between those lines. The implementing agent should read `app.mjs` carefully and place the middleware pipeline after line ~167 (config guard) and before the router creation section (~line 500+).

> **Also important:** The auth endpoints (`/api/v1/auth/*`) must bypass permissionGate. This is handled by the skip middleware above. Verify this works by checking that `/api/v1/auth/setup-status` is accessible without any roles.

**Step 4: Create and mount the auth router**

Near the other v1Router assignments (~line 1160), add:

```javascript
// Auth router — must be mounted BEFORE permissionGate so auth endpoints are accessible
v1Routers.auth = createAuthRouter({
  authService,
  jwtSecret,
  jwtConfig,
  configService,
  dataService,
  logger: rootLogger.child({ module: 'auth-api' })
});
```

**Step 5: Add auth route mapping to api.mjs**

In `backend/src/4_api/v1/routers/api.mjs`, add to the routeMap object:

```javascript
'/auth': 'auth',
```

**Step 6: Import createAuthRouter in app.mjs**

Add to the bootstrap imports section:

```javascript
import { createAuthRouter } from '#api/v1/routers/auth.mjs';
```

**Step 7: Verify the dev server starts without errors**

```bash
node -e "import('#backend/src/app.mjs').then(() => console.log('Import OK')).catch(e => console.error(e.message))"
```

**Step 8: Commit**

```bash
git add backend/src/app.mjs backend/src/4_api/v1/routers/api.mjs
git commit -m "feat(auth): wire auth middleware pipeline and router into app"
```

---

### Task 11: Frontend Auth Utilities

**Files:**
- Create: `frontend/src/lib/auth.js`

**Step 1: Write the implementation**

```javascript
// frontend/src/lib/auth.js

const TOKEN_KEY = 'ds_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export function getUser() {
  const token = getToken();
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload;
  } catch {
    return null;
  }
}

export function getUserApps(roleDefinitions = {}) {
  const user = getUser();
  if (!user) return [];
  const apps = new Set();
  for (const role of user.roles || []) {
    const def = roleDefinitions[role];
    if (!def) continue;
    for (const app of def.apps || []) {
      apps.add(app);
    }
  }
  return [...apps];
}

export function hasApp(appName, roleDefinitions = {}) {
  const apps = getUserApps(roleDefinitions);
  return apps.includes('*') || apps.includes(appName);
}
```

**Step 2: Commit**

```bash
git add frontend/src/lib/auth.js
git commit -m "feat(auth): add frontend auth utilities (token, user, roles)"
```

---

### Task 12: Add Bearer Token to API Wrapper

**Files:**
- Modify: `frontend/src/lib/api.mjs` (~line 23, inside options construction)

**Step 1: Add token header**

In `frontend/src/lib/api.mjs`, modify the options construction (~line 21) to include the auth header:

Before:
```javascript
const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
};
```

After:
```javascript
const token = localStorage.getItem('ds_token');
const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'Authorization': `Bearer ${token}` } : {})
    },
};
```

**Step 2: Commit**

```bash
git add frontend/src/lib/api.mjs
git commit -m "feat(auth): add Bearer token to API fetch wrapper"
```

---

### Task 13: Setup Wizard Component

**Files:**
- Create: `frontend/src/modules/Auth/SetupWizard.jsx`
- Create: `frontend/src/modules/Auth/Auth.scss`

**Step 1: Write the SetupWizard component**

```jsx
// frontend/src/modules/Auth/SetupWizard.jsx
import { useState } from 'react';
import { Stack, TextInput, PasswordInput, Button, Text, Title, Paper, Stepper, Group } from '@mantine/core';
import { DaylightAPI } from '../../lib/api.mjs';
import { setToken } from '../../lib/auth.js';
import './Auth.scss';

export default function SetupWizard({ onComplete }) {
  const [step, setStep] = useState(0);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [householdName, setHouseholdName] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  const canAdvance = () => {
    if (step === 0) return true; // Welcome
    if (step === 1) return username.length >= 2 && password.length >= 8 && password === confirmPassword;
    if (step === 2) return householdName.length >= 1;
    return false;
  };

  const handleFinish = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI('/api/v1/auth/setup', { username, password, householdName }, 'POST');
      setToken(result.token);
      setStep(3);
    } catch (err) {
      setError(err.message || 'Setup failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <Paper className="auth-card" p="xl" radius="md">
        <Stepper active={step} size="sm" mb="xl">
          <Stepper.Step label="Welcome" />
          <Stepper.Step label="Account" />
          <Stepper.Step label="Household" />
          <Stepper.Step label="Done" />
        </Stepper>

        {step === 0 && (
          <Stack align="center" gap="lg">
            <Title order={2}>DaylightStation</Title>
            <Text c="dimmed" ta="center">Welcome to your new station. Let's get you set up.</Text>
            <Button onClick={() => setStep(1)} size="lg">Get Started</Button>
          </Stack>
        )}

        {step === 1 && (
          <Stack gap="md">
            <Title order={3}>Create Admin Account</Title>
            <TextInput
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
              placeholder="admin"
            />
            <PasswordInput
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              placeholder="At least 8 characters"
            />
            <PasswordInput
              label="Confirm Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.currentTarget.value)}
              error={confirmPassword && password !== confirmPassword ? 'Passwords do not match' : null}
            />
            {error && <Text c="red" size="sm">{error}</Text>}
            <Group justify="flex-end">
              <Button onClick={() => setStep(2)} disabled={!canAdvance()}>Next</Button>
            </Group>
          </Stack>
        )}

        {step === 2 && (
          <Stack gap="md">
            <Title order={3}>Name Your Household</Title>
            <TextInput
              label="Household Name"
              value={householdName}
              onChange={(e) => setHouseholdName(e.currentTarget.value)}
              placeholder="The Smith Family"
            />
            {error && <Text c="red" size="sm">{error}</Text>}
            <Group justify="space-between">
              <Button variant="subtle" onClick={() => setStep(1)}>Back</Button>
              <Button onClick={handleFinish} loading={loading} disabled={!canAdvance()}>Finish Setup</Button>
            </Group>
          </Stack>
        )}

        {step === 3 && (
          <Stack align="center" gap="lg">
            <Title order={3}>Your station is ready.</Title>
            <Text c="dimmed" ta="center">
              You can add members, devices, and configure apps from the Admin panel.
            </Text>
            <Button onClick={onComplete} size="lg">Go to Station</Button>
          </Stack>
        )}
      </Paper>
    </div>
  );
}
```

**Step 2: Write the Auth stylesheet**

```scss
// frontend/src/modules/Auth/Auth.scss
.auth-container {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  background: var(--ds-bg-base, #0C0E14);
  padding: var(--ds-space-4, 16px);
}

.auth-card {
  width: 100%;
  max-width: 440px;
  background: var(--ds-bg-surface, #12141C);
  border: 1px solid var(--ds-border, #2A2E3D);
}
```

**Step 3: Commit**

```bash
git add frontend/src/modules/Auth/SetupWizard.jsx frontend/src/modules/Auth/Auth.scss
git commit -m "feat(auth): add SetupWizard component for first-boot onboarding"
```

---

### Task 14: Login Screen and AuthGate

**Files:**
- Create: `frontend/src/modules/Auth/LoginScreen.jsx`
- Create: `frontend/src/modules/Auth/methods/PasswordInput.jsx`
- Create: `frontend/src/modules/Auth/AuthGate.jsx`

**Step 1: Write PasswordInput (auth method component)**

```jsx
// frontend/src/modules/Auth/methods/PasswordInput.jsx
import { PasswordInput as MantinePasswordInput } from '@mantine/core';

export default function PasswordInput({ value, onChange }) {
  return (
    <MantinePasswordInput
      label="Password"
      value={value}
      onChange={(e) => onChange(e.currentTarget.value)}
      placeholder="Enter your password"
    />
  );
}
```

**Step 2: Write LoginScreen**

```jsx
// frontend/src/modules/Auth/LoginScreen.jsx
import { useState, useEffect } from 'react';
import { Stack, TextInput, Button, Text, Title, Paper, Alert } from '@mantine/core';
import { DaylightAPI } from '../../lib/api.mjs';
import { setToken } from '../../lib/auth.js';
import PasswordInput from './methods/PasswordInput.jsx';
import './Auth.scss';

export default function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [context, setContext] = useState(null);

  useEffect(() => {
    DaylightAPI('/api/v1/auth/context')
      .then(setContext)
      .catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await DaylightAPI('/api/v1/auth/token', { username, password }, 'POST');
      setToken(result.token);
      onLogin?.();
    } catch {
      setError('Invalid username or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <Paper className="auth-card" p="xl" radius="md">
        <form onSubmit={handleSubmit}>
          <Stack gap="md" align="center">
            <Title order={3}>{context?.householdName || 'DaylightStation'}</Title>
            <Text c="dimmed" size="sm">DaylightStation</Text>

            <TextInput
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.currentTarget.value)}
              w="100%"
            />
            <div style={{ width: '100%' }}>
              <PasswordInput value={password} onChange={setPassword} />
            </div>

            {error && <Alert color="red" w="100%">{error}</Alert>}

            <Button type="submit" loading={loading} fullWidth disabled={!username || !password}>
              Sign In
            </Button>
          </Stack>
        </form>
      </Paper>
    </div>
  );
}
```

**Step 3: Write AuthGate**

```jsx
// frontend/src/modules/Auth/AuthGate.jsx
import { useState, useCallback } from 'react';
import { getUser } from '../../lib/auth.js';
import LoginScreen from './LoginScreen.jsx';

export default function AuthGate({ app, children }) {
  const [, setRefresh] = useState(0);

  const user = getUser();
  const hasAccess = user && (
    (user.roles || []).some(r => r === 'sysadmin') ||
    app === undefined
    // Full role→app expansion would need auth config from backend.
    // For now, any authenticated user with a token passes the gate.
    // The backend permissionGate is the real enforcer.
  );

  const handleLogin = useCallback(() => {
    setRefresh(n => n + 1);
  }, []);

  if (!user) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  return children;
}
```

**Step 4: Commit**

```bash
git add frontend/src/modules/Auth/LoginScreen.jsx frontend/src/modules/Auth/methods/PasswordInput.jsx frontend/src/modules/Auth/AuthGate.jsx
git commit -m "feat(auth): add LoginScreen, PasswordInput, and AuthGate components"
```

---

### Task 15: Invite Accept Page

**Files:**
- Create: `frontend/src/modules/Auth/InviteAccept.jsx`

**Step 1: Write the component**

```jsx
// frontend/src/modules/Auth/InviteAccept.jsx
import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Stack, TextInput, Button, Text, Title, Paper, Alert, Loader, Center } from '@mantine/core';
import { PasswordInput } from '@mantine/core';
import { DaylightAPI } from '../../lib/api.mjs';
import { setToken } from '../../lib/auth.js';
import './Auth.scss';

export default function InviteAccept() {
  const { token } = useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [invalid, setInvalid] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    DaylightAPI(`/api/v1/auth/invite/${token}`)
      .then((data) => {
        setInvite(data);
        setDisplayName(data.displayName || '');
        setLoading(false);
      })
      .catch(() => {
        setInvalid(true);
        setLoading(false);
      });
  }, [token]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await DaylightAPI(`/api/v1/auth/invite/${token}/accept`, {
        password,
        displayName
      }, 'POST');
      setToken(result.token);
      navigate('/');
    } catch {
      setError('Failed to accept invite. The link may have expired.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="auth-container">
        <Center><Loader /></Center>
      </div>
    );
  }

  if (invalid) {
    return (
      <div className="auth-container">
        <Paper className="auth-card" p="xl" radius="md">
          <Stack align="center" gap="md">
            <Title order={3}>Invalid Invite</Title>
            <Text c="dimmed">This invite link is invalid or has already been used.</Text>
          </Stack>
        </Paper>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <Paper className="auth-card" p="xl" radius="md">
        <form onSubmit={handleSubmit}>
          <Stack gap="md">
            <Title order={3}>Welcome, {invite.username}</Title>
            <Text c="dimmed" size="sm">Set up your account to get started.</Text>

            <TextInput
              label="Display Name"
              value={displayName}
              onChange={(e) => setDisplayName(e.currentTarget.value)}
            />
            <PasswordInput
              label="Password"
              value={password}
              onChange={(e) => setPassword(e.currentTarget.value)}
              placeholder="At least 8 characters"
            />
            <PasswordInput
              label="Confirm Password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.currentTarget.value)}
              error={confirmPassword && password !== confirmPassword ? 'Passwords do not match' : null}
            />

            {error && <Alert color="red">{error}</Alert>}

            <Button
              type="submit"
              loading={submitting}
              disabled={!password || password.length < 8 || password !== confirmPassword}
              fullWidth
            >
              Create Account
            </Button>
          </Stack>
        </form>
      </Paper>
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add frontend/src/modules/Auth/InviteAccept.jsx
git commit -m "feat(auth): add InviteAccept component for invite link onboarding"
```

---

### Task 16: Frontend Routing Updates

**Files:**
- Modify: `frontend/src/main.jsx` (~lines 82-99)

**Step 1: Add imports and routes**

Add imports at the top of `main.jsx`:

```javascript
import SetupWizard from './modules/Auth/SetupWizard.jsx';
import InviteAccept from './modules/Auth/InviteAccept.jsx';
```

Add routes inside `<Routes>` before the catch-all:

```jsx
<Route path="/setup" element={<SetupWizard onComplete={() => window.location.href = '/'} />} />
<Route path="/invite/:token" element={<InviteAccept />} />
```

**Step 2: Add setup redirect logic**

Add a `SetupCheck` wrapper component in `main.jsx` that checks `/api/v1/auth/setup-status` on mount and redirects to `/setup` if `needsSetup` is true. Wrap the `<Routes>` with it:

```jsx
function SetupCheck({ children }) {
  const [checked, setChecked] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);
  const location = useLocation();

  useEffect(() => {
    // Skip check on setup and invite pages
    if (location.pathname === '/setup' || location.pathname.startsWith('/invite/')) {
      setChecked(true);
      return;
    }
    fetch('/api/v1/auth/setup-status')
      .then(r => r.json())
      .then(data => {
        setNeedsSetup(data.needsSetup);
        setChecked(true);
      })
      .catch(() => setChecked(true));
  }, [location.pathname]);

  if (!checked) return null;
  if (needsSetup && location.pathname !== '/setup') {
    return <Navigate to="/setup" replace />;
  }
  return children;
}
```

Add `useState, useEffect` to React import and `Navigate, useLocation` to react-router-dom import.

**Step 3: Commit**

```bash
git add frontend/src/main.jsx
git commit -m "feat(auth): add setup redirect, invite route, and setup route to frontend"
```

---

### Task 17: Wrap AdminApp with AuthGate

**Files:**
- Modify: `frontend/src/Apps/AdminApp.jsx`

**Step 1: Import AuthGate**

Add import at top:

```javascript
import AuthGate from '../modules/Auth/AuthGate.jsx';
```

**Step 2: Wrap the MantineProvider with AuthGate**

In the AdminApp component return, wrap the outer `<MantineProvider>` with `<AuthGate app="admin">`:

```jsx
return (
  <AuthGate app="admin">
    <MantineProvider theme={theme} defaultColorScheme="dark">
      {/* ... existing content ... */}
    </MantineProvider>
  </AuthGate>
);
```

**Step 3: Commit**

```bash
git add frontend/src/Apps/AdminApp.jsx
git commit -m "feat(auth): wrap AdminApp with AuthGate"
```

---

### Task 18: Admin Member Editor — Roles and Invite

**Files:**
- Modify: `frontend/src/modules/Admin/Household/MemberEditor.jsx`
- Modify: `frontend/src/hooks/admin/useAdminHousehold.js`

**Step 1: Add invite API to the admin hook**

In `useAdminHousehold.js`, add:

```javascript
const generateInvite = useCallback(async (username) => {
  const result = await DaylightAPI(`${API_BASE}/../auth/invite`, { username }, 'POST');
  return result;
}, []);
```

Add `generateInvite` to the returned object.

**Step 2: Add roles and auth status to MemberEditor**

In `MemberEditor.jsx`, add a new tab panel after the existing tabs:

**Roles section** (new tab "Auth"):
- `MultiSelect` component populated from a fetch to `/api/v1/auth/context` or hardcoded role names (since roles are config-file only, a simple list works)
- Binds to `profile.roles`
- Uses `updateField('roles', value)`

**Auth status display:**
- Fetch `login.yml` data via a new API endpoint or embed it in the member GET response
- Show: has password (yes/no badge), invited at, invited by, last login
- "Generate Invite Link" button that calls `generateInvite(username)`
- Display the invite URL in a copyable text field when generated

> **Note:** The admin household router (`backend/src/4_api/v1/routers/admin/household.mjs`) will need a small addition to include auth status in the member GET response. Add reading of `dataService.user.read('auth/login', username)` in the `GET /members/:username` handler, returning `authStatus: { hasPassword, invitedAt, invitedBy, lastLogin }` alongside the existing `member` data.

**Step 3: Commit**

```bash
git add frontend/src/modules/Admin/Household/MemberEditor.jsx frontend/src/hooks/admin/useAdminHousehold.js backend/src/4_api/v1/routers/admin/household.mjs
git commit -m "feat(auth): add role assignment and invite management to MemberEditor"
```

---

### Task 19: Integration Test — Full Auth Flow

**Files:**
- Create: `tests/live/api/auth/auth-flow.test.mjs`

**Step 1: Write the integration test**

This test runs against a live server. It exercises the full auth lifecycle:

```javascript
// tests/live/api/auth/auth-flow.test.mjs
import { test, expect } from '@playwright/test';

const BASE = 'http://localhost:3111';

test.describe('Auth flow', () => {
  test('GET /api/v1/auth/setup-status returns needsSetup', async ({ request }) => {
    const res = await request.get(`${BASE}/api/v1/auth/setup-status`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty('needsSetup');
    expect(typeof body.needsSetup).toBe('boolean');
  });

  test('GET /api/v1/auth/context returns household info', async ({ request }) => {
    const res = await request.get(`${BASE}/api/v1/auth/context`);
    expect(res.ok()).toBe(true);
    const body = await res.json();
    expect(body).toHaveProperty('householdId');
    expect(body).toHaveProperty('authMethod', 'password');
  });

  test('POST /api/v1/auth/token with invalid credentials returns 401', async ({ request }) => {
    const res = await request.post(`${BASE}/api/v1/auth/token`, {
      data: { username: 'nonexistent', password: 'wrong' }
    });
    expect(res.status()).toBe(401);
  });
});
```

> **Note:** Full setup/invite flow tests require a clean data directory. These should be run against a test environment, not the dev server with real data. The implementing agent should use the `getAppPort()` helper from `tests/_lib/configHelper.mjs` for the port instead of hardcoding 3111.

**Step 2: Run the test**

```bash
npx playwright test tests/live/api/auth/auth-flow.test.mjs --reporter=line
```
Expected: PASS (assuming dev server is running)

**Step 3: Commit**

```bash
git add tests/live/api/auth/auth-flow.test.mjs
git commit -m "test(auth): add live API tests for auth endpoints"
```

---

### Task 20: Run All Unit Tests and Fix Regressions

**Step 1: Run all existing unit tests**

```bash
npx jest tests/unit/ --no-cache
```

Expected: All existing tests PASS plus new auth tests PASS.

**Step 2: Run the dev server and smoke test manually**

```bash
# Check if dev server is running
lsof -i :3111

# If not running, start it
npm run dev &

# Test setup-status endpoint
curl http://localhost:3111/api/v1/auth/setup-status

# Test context endpoint
curl http://localhost:3111/api/v1/auth/context
```

**Step 3: Fix any regressions found**

If middleware breaks existing routes (e.g., routes that were previously unrestricted now get blocked by permissionGate), check that `app_routes` in `auth.yml` only maps routes that should be restricted. Unmapped routes pass through freely.

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix(auth): resolve integration issues from auth middleware wiring"
```

---

## Implementation Order Summary

| Task | Component | Dependencies |
|------|-----------|-------------|
| 1 | Install bcrypt + jsonwebtoken | None |
| 2 | Auth config defaults | None |
| 3 | JWT utilities | Task 1 |
| 4 | Password utilities | Task 1 |
| 5 | networkTrustResolver | None |
| 6 | tokenResolver | Task 3 |
| 7 | permissionGate | None |
| 8 | AuthService | Tasks 2, 3, 4 |
| 9 | Auth router | Tasks 3, 8 |
| 10 | Wire into app.mjs | Tasks 5, 6, 7, 9 |
| 11 | Frontend auth utilities | None |
| 12 | API wrapper Bearer token | Task 11 |
| 13 | SetupWizard | Task 12 |
| 14 | LoginScreen + AuthGate | Task 12 |
| 15 | InviteAccept | Task 12 |
| 16 | Frontend routing | Tasks 13, 15 |
| 17 | Wrap AdminApp | Task 14 |
| 18 | MemberEditor enhancements | Tasks 9, 17 |
| 19 | Integration tests | Task 10 |
| 20 | Regression sweep | All |

**Parallelizable groups:**
- Tasks 2, 3, 4, 5 can run in parallel (no interdependencies)
- Tasks 11, 12 can run in parallel with backend tasks
- Tasks 13, 14, 15 can run in parallel with each other
