# Routing Toggle Design

**Created:** 2026-01-11
**Status:** Draft

## Overview

A configuration-driven routing system that switches individual endpoint paths between legacy and new DDD implementations. Enables incremental migration with easy rollback and schema shimming for backwards compatibility.

## Goals

1. Route requests to legacy or new implementation based on config
2. Support schema shims for backwards-compatible responses on legacy paths
3. Log shim usage to know when they're safe to remove
4. Fail fast on config errors at startup
5. Require server restart for config changes (simplicity over hot reload)

## Non-Goals

- Hot reload of routing config
- Percentage-based traffic splitting
- Per-request routing decisions beyond path matching

---

## Config Format

**File:** `backend/config/routing.yml`

```yaml
# Routing configuration
# Loaded at server startup, restart required for changes

default: legacy  # Unlisted paths go here

routing:
  # Finance domain - fully migrated
  /api/v2/finance: new              # New schema, no shim
  /api/finance:                      # Legacy path with shim
    target: new
    shim: finance-data-v1
  /data/budget:
    target: new
    shim: finance-data-v1
  /harvest/budget: new               # No schema change, no shim needed

  # Content domain - fully migrated
  /api/v2/content: new
  /api/content:
    target: new
    shim: content-list-v1
  /data/list:
    target: new
    shim: content-list-v1
  /data/play: new
  /local: new

  # Not yet migrated (explicit for documentation)
  /api/fitness: legacy
  /api/health: legacy
```

**Shorthand rules:**
- `path: new` — route to new implementation, no shim
- `path: legacy` — route to legacy implementation
- `path: { target: new, shim: name }` — route to new with shim applied

**Path matching:** Longest prefix wins. `/api/finance/special` matches `/api/finance` if no more specific rule exists.

---

## Architecture

### Request Flow

```
Request → RoutingMiddleware → [Legacy OR New Implementation]
                                      ↓ (if shimmed path)
                                   ShimLayer → Response
```

### Routing Middleware

**File:** `backend/src/0_infrastructure/routing/RoutingMiddleware.mjs`

```javascript
export function createRoutingMiddleware({ config, legacyApp, newApp, shims, logger }) {
  const routingTable = buildRoutingTable(config.routing);

  return (req, res, next) => {
    const route = matchRoute(req.path, routingTable);

    if (route.target === 'new') {
      if (route.shim) {
        wrapResponseWithShim(res, route.shim, logger);
      }
      newApp.handle(req, res, next);
    } else {
      legacyApp.handle(req, res, next);
    }
  };
}
```

The middleware matches the incoming path against the routing table, then forwards to either the legacy Express router or the new one. If the path has an active shim, it wraps the response object to transform output before sending.

---

## Shim Layer

Shims transform new implementation responses to legacy schema format. They live in a dedicated directory for easy discovery and removal.

**File:** `backend/src/4_api/shims/finance.mjs`

```javascript
export const financeShims = {
  '/api/finance/data': {
    name: 'finance-data-v1',
    transform: (newResponse) => ({
      budgets: transformBudgets(newResponse.budgets),
      mortgage: transformMortgage(newResponse.mortgage),
    }),
  },

  '/api/finance/data/daytoday': {
    name: 'finance-daytoday-v1',
    transform: (newResponse) => ({
      spending: newResponse.current.spending,
      budget: newResponse.current.allocated,
      remaining: newResponse.current.balance,
    }),
  },
};
```

**File:** `backend/src/4_api/shims/index.mjs`

```javascript
import { financeShims } from './finance.mjs';
import { contentShims } from './content.mjs';

export const allShims = {
  ...financeShims,
  ...contentShims,
};
```

### Schema Migration Path

1. Frontend uses `/api/finance` (legacy path, shimmed)
2. Update frontend to use `/api/v2/finance` (new schema)
3. Monitor shim logs until legacy path traffic drops to zero
4. Delete shim entry from config and shim file

---

## Logging and Metrics

Every shimmed request gets logged. Metrics track when it's safe to remove shims.

**Log entry:**

```javascript
logger.info('shim.applied', {
  shim: route.shim.name,        // 'finance-data-v1'
  path: req.path,               // '/api/finance/data'
  method: req.method,           // 'GET'
  userAgent: req.headers['user-agent'],
  timestamp: Date.now(),
});
```

**File:** `backend/src/0_infrastructure/routing/ShimMetrics.mjs`

```javascript
class ShimMetrics {
  constructor() {
    this.counts = {};  // { 'finance-data-v1': { total: 0, lastSeen: null } }
  }

  record(shimName) {
    if (!this.counts[shimName]) {
      this.counts[shimName] = { total: 0, lastSeen: null };
    }
    this.counts[shimName].total++;
    this.counts[shimName].lastSeen = new Date().toISOString();
  }

  getReport() {
    return Object.entries(this.counts).map(([name, data]) => ({
      shim: name,
      totalRequests: data.total,
      lastSeen: data.lastSeen,
      daysSinceLastUse: daysSince(data.lastSeen),
    }));
  }
}
```

**Admin endpoint:** `GET /admin/shims/report`

```json
{
  "shims": [
    { "shim": "finance-data-v1", "totalRequests": 1423, "lastSeen": "2026-01-11T14:32:00Z", "daysSinceLastUse": 0 },
    { "shim": "content-list-v1", "totalRequests": 89, "lastSeen": "2026-01-08T09:15:00Z", "daysSinceLastUse": 3 }
  ]
}
```

When `daysSinceLastUse` exceeds 7 days, the shim is safe to remove.

---

## Error Handling

### Config Validation at Startup

**File:** `backend/src/0_infrastructure/routing/ConfigLoader.mjs`

```javascript
export function loadRoutingConfig(configPath, availableShims) {
  const config = yaml.load(fs.readFileSync(configPath));

  const errors = [];

  for (const [path, rule] of Object.entries(config.routing)) {
    const shimName = typeof rule === 'object' ? rule.shim : null;

    if (shimName && !availableShims[shimName]) {
      errors.push(`Path "${path}" references unknown shim "${shimName}"`);
    }

    const target = typeof rule === 'string' ? rule : rule.target;
    if (!['new', 'legacy'].includes(target)) {
      errors.push(`Path "${path}" has invalid target "${target}"`);
    }
  }

  if (errors.length > 0) {
    throw new Error(`Routing config invalid:\n${errors.join('\n')}`);
  }

  return config;
}
```

Server refuses to start with invalid config. Fail fast with clear error message.

### Shim Transform Failures

```javascript
const originalJson = res.json.bind(res);
res.json = (data) => {
  try {
    const transformed = shim.transform(data);
    logger.info('shim.applied', { shim: shim.name, path: req.path });
    return originalJson(transformed);
  } catch (error) {
    logger.error('shim.failed', {
      shim: shim.name,
      path: req.path,
      error: error.message
    });
    // Return original data untransformed - better than 500
    return originalJson(data);
  }
};
```

If a shim fails, log the error and return the untransformed response. Frontend may see unexpected schema, but gets data instead of a 500.

---

## Testing Strategy

### Unit Tests for Shim Transforms

```javascript
// tests/unit/api/shims/finance.test.mjs
describe('finance-data-v1 shim', () => {
  const shim = financeShims['/api/finance/data'];

  it('transforms new budget format to legacy format', () => {
    const newFormat = {
      budgets: [{ periodStart: '2025-01-01', allocated: 5000 }],
      mortgage: { balance: 250000 }
    };

    const legacy = shim.transform(newFormat);

    expect(legacy.budgets['2025-01-01']).toBeDefined();
    expect(legacy.mortgage.balance).toBe(250000);
  });
});
```

### Integration Tests for Routing Middleware

```javascript
// tests/integration/routing/routing-middleware.test.mjs
describe('RoutingMiddleware', () => {
  it('routes to new implementation when config says new', async () => {
    const config = { routing: { '/api/finance': 'new' } };
    const app = createTestApp(config);

    const res = await request(app).get('/api/finance/data');

    expect(res.headers['x-served-by']).toBe('new');
  });

  it('applies shim when configured', async () => {
    const config = { routing: { '/api/finance': { target: 'new', shim: 'finance-data-v1' } } };
    const app = createTestApp(config);

    const res = await request(app).get('/api/finance/data');

    expect(res.headers['x-shim-applied']).toBe('finance-data-v1');
  });

  it('defaults to legacy for unlisted paths', async () => {
    const config = { routing: {} };
    const app = createTestApp(config);

    const res = await request(app).get('/api/unknown');

    expect(res.headers['x-served-by']).toBe('legacy');
  });
});
```

### Golden Master Tests for Shim Correctness

```javascript
// tests/integration/routing/shim-parity.test.mjs
describe('Shim parity with legacy', () => {
  it('/api/finance/data shimmed response matches legacy response structure', async () => {
    const legacyRes = await request(legacyApp).get('/data/budget');
    const newRes = await request(newAppWithShim).get('/api/finance/data');

    expect(Object.keys(newRes.body)).toEqual(Object.keys(legacyRes.body));
    expect(Object.keys(newRes.body.budgets)).toEqual(Object.keys(legacyRes.body.budgets));
  });
});
```

---

## File Structure

```
backend/
├── config/
│   └── routing.yml                          # Routing configuration
│
└── src/
    ├── 0_infrastructure/
    │   └── routing/
    │       ├── RoutingMiddleware.mjs        # Main routing logic
    │       ├── ConfigLoader.mjs             # Load & validate config
    │       └── ShimMetrics.mjs              # Usage tracking
    │
    └── 4_api/
        ├── shims/
        │   ├── index.mjs                    # Shim registry
        │   ├── finance.mjs                  # Finance transforms
        │   └── content.mjs                  # Content transforms
        │
        └── routers/
            └── admin/
                └── shims.mjs                # GET /admin/shims/report
```

---

## Integration with Legacy Index

**File:** `backend/_legacy/index.js`

```javascript
// At the top, before any route mounting
import { createRoutingMiddleware } from '../src/0_infrastructure/routing/RoutingMiddleware.mjs';
import { loadRoutingConfig } from '../src/0_infrastructure/routing/ConfigLoader.mjs';
import { allShims } from '../src/4_api/shims/index.mjs';

const routingConfig = loadRoutingConfig('./config/routing.yml', allShims);

const legacyApp = express.Router();
const newApp = express.Router();

// Mount all legacy routes on legacyApp instead of app
// Mount all new routes on newApp instead of app

app.use(createRoutingMiddleware({
  config: routingConfig,
  legacyApp,
  newApp,
  shims: allShims,
  logger: rootLogger.child({ module: 'routing' }),
}));
```

---

## Migration Checklist

For each endpoint migration:

1. [ ] Implement new endpoint in DDD structure
2. [ ] Write shim if schema changed (or skip if schema unchanged)
3. [ ] Add routing entry: `path: { target: new, shim: name }` or `path: new`
4. [ ] Add `/api/v2/path` entry for new schema access
5. [ ] Deploy and monitor shim logs
6. [ ] Update frontend to use `/api/v2/path`
7. [ ] Monitor until legacy path traffic reaches zero
8. [ ] Remove shim entry from config
9. [ ] Delete shim transform code
