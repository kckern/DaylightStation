# Household Directory Structure Design

**Date:** 2026-01-27
**Status:** Design
**Scope:** Simplify household directory structure and add subdomain routing

---

## Problem Statement

Current structure is unnecessarily deep:
```
data/households/default/
data/households/jones/
```

Goal: Flatten to a simpler convention:
```
data/household/           # Primary
data/household-jones/     # Secondary
```

Additionally, support subdomain-based household selection for multi-household deployments.

---

## Directory Structure

### New Layout

```
data/
├── household/              # Primary (no suffix)
│   ├── household.yml       # Household metadata
│   ├── config.yml          # App settings
│   ├── apps/               # App-specific data
│   │   ├── fitness/
│   │   ├── finances/
│   │   └── chatbots.yml
│   └── auth/               # Secrets per service
│       ├── plex.yml
│       ├── openai.yml
│       └── home_assistant.yml
│
├── household-jones/        # Secondary household
│   ├── household.yml
│   ├── config.yml
│   ├── apps/
│   └── auth/
│
├── household-test/         # Another secondary
│   └── ...
│
└── users/                  # Stays separate (not household-scoped)
    ├── kckern/
    ├── elizabeth/
    └── guest-abc/          # Guests may span households
```

### Discovery Logic

```javascript
function discoverHouseholds(dataPath) {
  const dirs = glob.sync('household*/', { cwd: dataPath })
    .map(d => d.replace(/\/$/, ''));  // Remove trailing slash

  // Primary: 'household/' if exists, else first alphabetically
  const primary = dirs.includes('household')
    ? 'household'
    : dirs.sort()[0];

  return {
    primary,
    all: dirs,
    secondary: dirs.filter(d => d !== primary)
  };
}
```

### ID Mapping

| Folder | Household ID |
|--------|--------------|
| `household/` | `default` |
| `household-jones/` | `jones` |
| `household-test/` | `test` |

```javascript
function parseHouseholdId(folderName) {
  if (folderName === 'household') return 'default';
  return folderName.replace(/^household-/, '');
}

function toFolderName(householdId) {
  if (householdId === 'default') return 'household';
  return `household-${householdId}`;
}
```

### household.yml

```yaml
# data/household/household.yml
household_id: default        # Optional - derived from folder if omitted
name: "The Kern Family"
head: kckern

users:
  - kckern
  - elizabeth
  - felix

integrations:
  media:
    - provider: plex
      host: "192.168.1.100"
      port: 32400
  # ... (see config-driven-bootstrap-design.md)

apps:
  fitness:
    enabled: true
    primary_users: [kckern, felix]
  nutribot:
    enabled: true
```

---

## Subdomain Routing

### Domain Mapping

Explicit mapping with pattern fallback:

```yaml
# backend/config/domains.yml

domain_mapping:
  # Explicit mappings (checked first)
  "daylight.example.com": default
  "daylight-jones.example.com": jones
  "smithfamily.example.com": smith
  "localhost:3112": default
  "localhost:3111": default

# Fallback patterns (checked if no explicit match)
patterns:
  - regex: "^daylight-(?<household>\\w+)\\."
    # daylight-jones.example.com → jones
  - regex: "^(?<household>\\w+)\\.daylight\\."
    # jones.daylight.example.com → jones
```

### Middleware

```javascript
// backend/src/4_api/middleware/householdResolver.mjs

export function householdResolver({ domainConfig, configService }) {
  const explicitMap = domainConfig.domain_mapping || {};
  const patterns = domainConfig.patterns || [];

  return (req, res, next) => {
    const host = req.headers.host || '';

    // 1. Check explicit mapping
    if (explicitMap[host]) {
      req.householdId = explicitMap[host];
    }
    // 2. Try pattern matching
    else {
      req.householdId = matchPatterns(host, patterns) || 'default';
    }

    // 3. Validate household exists
    if (!configService.householdExists(req.householdId)) {
      return res.status(404).json({
        error: 'Household not found',
        household: req.householdId
      });
    }

    // 4. Attach household context
    req.household = configService.getHousehold(req.householdId);

    next();
  };
}

function matchPatterns(host, patterns) {
  for (const { regex } of patterns) {
    const match = host.match(new RegExp(regex));
    if (match?.groups?.household) {
      return match.groups.household;
    }
  }
  return null;
}
```

### Usage in Handlers

```javascript
// All handlers receive household context via req
app.get('/api/v1/fitness', (req, res) => {
  const { householdId, household } = req;
  const fitnessConfig = household.apps?.fitness;
  // ...
});

app.get('/api/v1/content/plex/:id', (req, res) => {
  const plexConfig = req.household.integrations?.media
    ?.find(m => m.provider === 'plex');
  // ...
});
```

---

## ConfigService Updates

```javascript
// backend/src/0_system/config/ConfigService.mjs

class ConfigService {
  #dataPath;
  #households;  // Map<id, folder>
  #primaryId;

  async initialize() {
    await this.#discoverHouseholds();
  }

  async #discoverHouseholds() {
    const dirs = await glob('household*/', { cwd: this.#dataPath });

    this.#households = new Map();
    for (const dir of dirs) {
      const folder = dir.replace(/\/$/, '');
      const id = this.#parseId(folder);
      this.#households.set(id, folder);
    }

    // Primary: 'household' if exists, else first alphabetically
    this.#primaryId = this.#households.has('default')
      ? 'default'
      : [...this.#households.keys()].sort()[0];
  }

  #parseId(folder) {
    return folder === 'household' ? 'default' : folder.replace(/^household-/, '');
  }

  // ─── Path Resolution ──────────────────────────────────────

  getHouseholdPath(householdId = null) {
    const id = householdId ?? this.#primaryId;
    const folder = this.#households.get(id);
    if (!folder) throw new Error(`Household not found: ${id}`);
    return path.join(this.#dataPath, folder);
  }

  getHouseholdConfigPath(householdId) {
    return path.join(this.getHouseholdPath(householdId), 'household.yml');
  }

  getHouseholdAuthPath(householdId, service) {
    return path.join(this.getHouseholdPath(householdId), 'auth', `${service}.yml`);
  }

  getHouseholdAppPath(householdId, appName) {
    return path.join(this.getHouseholdPath(householdId), 'apps', appName);
  }

  // ─── Queries ──────────────────────────────────────────────

  householdExists(householdId) {
    return this.#households.has(householdId);
  }

  getPrimaryHouseholdId() {
    return this.#primaryId;
  }

  getAllHouseholdIds() {
    return [...this.#households.keys()];
  }

  getHousehold(householdId) {
    // Returns parsed household.yml + integrations + apps
    const configPath = this.getHouseholdConfigPath(householdId);
    return this.#loadYaml(configPath);
  }
}
```

---

## Migration

**Safe migration - copy, don't move:**

```bash
#!/bin/bash
# migrate-households.sh

DATA_PATH="${1:-/path/to/data}"
cd "$DATA_PATH"

# Copy default household to new location
if [ -d "households/default" ]; then
  echo "Copying households/default → household/"
  cp -r households/default household
fi

# Copy secondary households
for dir in households/*/; do
  name=$(basename "$dir")
  if [ "$name" != "default" ]; then
    echo "Copying households/$name → household-$name/"
    cp -r "$dir" "household-$name"
  fi
done

echo ""
echo "Migration complete. New structure:"
ls -d household*/ 2>/dev/null
echo ""
echo "Old 'households/' left intact."
echo "After deploy verified, run: rm -rf $DATA_PATH/households/"
```

**Result after migration:**
```
data/
├── households/           # OLD - kept until verified
│   ├── default/
│   └── example/
├── household/            # NEW - primary
├── household-example/    # NEW - secondary
└── users/
```

---

## File Changes Summary

### New Files
- `backend/config/domains.yml` - Domain → household mapping
- `backend/src/4_api/middleware/householdResolver.mjs` - Subdomain routing

### Modified Files
- `backend/src/0_system/config/ConfigService.mjs` - New path resolution + discovery
- `backend/src/0_system/bootstrap.mjs` - Use req.householdId
- `backend/src/4_api/v1/app.mjs` - Add householdResolver middleware
- Any hardcoded `households/` references

### Data Migration
- Copy `data/households/*` to `data/household*`
- Keep old structure until deploy verified

---

## Related Documents

- `docs/plans/2026-01-27-config-driven-bootstrap-design.md` - Integration config per household
