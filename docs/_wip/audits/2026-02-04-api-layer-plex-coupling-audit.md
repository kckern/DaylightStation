# API Layer Plex Coupling Audit

**Date:** 2026-02-04
**Scope:** `backend/src/4_api/v1/routers/` - Plex-specific code in API layer
**Status:** Violations identified, remediation needed

---

## Executive Summary

The API layer contains multiple DDD violations related to Plex coupling. These include:
- **2 forbidden imports** (direct adapter and domain imports)
- **6 files** with Plex-specific business logic
- **15+ locations** where API layer has adapter-specific knowledge

These violations break the "thin layer" principle: the API layer should only translate HTTP requests to use case calls, not contain business logic or adapter-specific code.

---

## Violations by Severity

### Critical: Forbidden Imports

Per `docs/reference/core/layers-of-abstraction/api-layer-guidelines.md`:

> **FORBIDDEN imports in `4_api/`:**
> - `2_adapters/*` - Webhook handlers, parsers are injected
> - `1_domains/*` - API has no domain knowledge

| File | Line | Import | Type |
|------|------|--------|------|
| `test.mjs` | 11-15 | `#adapters/proxy/PlexProxyAdapter.mjs` | Adapter import |
| `fitness.mjs` | 29 | `#domains/fitness/index.mjs` | Domain import |

#### test.mjs:11-15

```javascript
import {
  enablePlexShutoff,
  disablePlexShutoff,
  getPlexShutoffStatus
} from '#adapters/proxy/PlexProxyAdapter.mjs';
```

**Impact:** API layer directly coupled to adapter implementation. Changes to PlexProxyAdapter require API layer changes.

**Fix:** Inject shutoff controls via factory params:

```javascript
// Bootstrap wires:
const plexShutoffControls = {
  enable: enablePlexShutoff,
  disable: disablePlexShutoff,
  getStatus: getPlexShutoffStatus
};
createTestRouter({ plexShutoffControls, logger });

// Router receives:
export function createTestRouter({ plexShutoffControls, logger }) {
  // Use plexShutoffControls.enable(), etc.
}
```

#### fitness.mjs:29

```javascript
import { FitnessProgressClassifier } from '#domains/fitness/index.mjs';
```

**Impact:** API layer instantiates domain logic directly, violating separation of concerns.

**Fix:** Receive classifier via container or service:

```javascript
// Option A: Container provides it
const classifier = fitnessContainer.getProgressClassifier();

// Option B: Use case returns classified data
const result = await classifyProgressUseCase.execute({ items, config });
```

---

### High: Hardcoded Adapter Selection

The API layer should not know which specific adapter to use. This should be determined by configuration or abstracted behind a service.

| File | Lines | Code |
|------|-------|------|
| `fitness.mjs` | 167 | `contentRegistry.get('plex')` |
| `fitness.mjs` | 206 | `contentRegistry.get('plex')` |
| `fitness.mjs` | 306 | `contentRegistry.get('plex')` |
| `play.mjs` | 145 | `registry.get('plex')` |
| `play.mjs` | 235 | `registry.get('plex')` |
| `proxy.mjs` | 197 | `registry.get('plex')` |

**Impact:**
- Cannot swap content providers without API layer changes
- Tight coupling between HTTP routes and specific adapters
- Comments claim "fitness content is always from plex" but this should be config, not code

**Fix:** Use configuration-driven adapter selection:

```javascript
// Bootstrap determines the adapter based on config
const fitnessContentAdapter = contentRegistry.get(fitnessConfig.contentSource || 'plex');
createFitnessRouter({ fitnessContentAdapter, ... });

// Router is adapter-agnostic
router.get('/governed-content', asyncHandler(async (req, res) => {
  const items = await fitnessContentAdapter.getItemsByLabel(labels, opts);
  // ...
}));
```

---

### Medium: Adapter Protocol Knowledge

The API layer contains knowledge of how specific adapters work internally.

#### proxy.mjs:188-260 - Plex Proxy Implementation

```javascript
router.use('/plex', async (req, res) => {
  // API layer knows:
  // 1. How to extract host/token from adapter
  const host = adapter.host;
  const token = adapter.token || adapter.client?.token || '';

  // 2. Plex authentication header name
  if (!targetUrl.searchParams.has('X-Plex-Token')) {
    targetUrl.searchParams.set('X-Plex-Token', token);
  }

  // 3. URL construction for Plex API
  const targetUrl = new URL(req.url, host);
  // ...
});
```

**Impact:** Protocol changes in Plex require API layer changes. Authentication logic is duplicated outside adapter.

**Fix:** Adapter should handle proxy logic:

```javascript
// PlexAdapter exposes:
class PlexAdapter {
  async proxyRequest(req, res) {
    // All Plex protocol knowledge here
  }
}

// API layer just delegates:
router.use('/plex', async (req, res) => {
  if (proxyService?.isConfigured?.('plex')) {
    await proxyService.proxy('plex', req, res);
  } else {
    await adapter.proxyRequest(req, res);
  }
});
```

#### play.mjs:143-162 - Library Path Construction

```javascript
if (type === 'plex') {
  const plexAdapter = registry.get('plex');
  if (plexAdapter && typeof plexAdapter.getItem === 'function') {
    const item = await plexAdapter.getItem(`plex:${assetId}`);
    if (item?.metadata?.librarySectionID) {
      const libraryId = item.metadata.librarySectionID;
      const libraryName = (item.metadata.librarySectionTitle || 'media')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
      storagePath = `plex/${libraryId}_${libraryName}`;
    }
  }
}
```

**Impact:** API layer knows Plex metadata structure and storage path conventions.

**Fix:** Move to adapter or service:

```javascript
// Adapter provides storage path
const storagePath = await adapter.getStoragePath(assetId);

// Or use a service
const storagePath = await mediaProgressService.getStoragePath(type, assetId);
```

#### play.mjs:230-263 - MPD URL Resolution

```javascript
router.get('/plex/mpd/:id', async (req, res) => {
  // API knows which methods adapter might have
  if (typeof plexAdapter.getMediaUrl === 'function') {
    mediaUrl = await plexAdapter.getMediaUrl(id, 0, opts);
  } else if (typeof plexAdapter.loadMediaUrl === 'function') {
    mediaUrl = await plexAdapter.loadMediaUrl(id, 0, opts);
  }

  // API knows how to transform Plex URLs to proxy URLs
  const proxyUrl = mediaUrl.replace(/https?:\/\/[^\/]+/, '/api/v1/proxy/plex');
});
```

**Impact:** API layer checks for adapter method existence and knows URL transformation logic.

**Fix:** Standardize adapter interface:

```javascript
// All content adapters implement:
interface IContentAdapter {
  getMediaUrl(id: string, partIndex: number, opts?: object): Promise<string>;
  getProxiedMediaUrl(id: string, opts?: object): Promise<string>;
}

// API layer:
const proxyUrl = await adapter.getProxiedMediaUrl(id, opts);
res.redirect(proxyUrl);
```

---

### Low: Config Structure Knowledge

The API layer knows about Plex-specific configuration structure.

#### fitness.mjs:103-125

```javascript
const playlists = hydratedData?.plex?.music_playlists;
const contentSource = hydratedData?.content_source || 'plex';
```

#### fitness.mjs:147-156

```javascript
const plex = fitnessData.plex || {};
const governedLabels = governance.governed_labels || plex.governed_labels || [];
const governedTypes = governance.governed_types || plex.governed_types || [];
```

**Impact:** Config schema changes require API layer changes.

**Fix:** Normalize config in service layer:

```javascript
// FitnessConfigService normalizes config
const normalizedConfig = fitnessConfigService.getNormalizedConfig(householdId);
// Returns: { playlists, governedLabels, governedTypes, contentSource }

// API layer uses normalized structure
const { playlists, governedLabels } = normalizedConfig;
```

---

## Files Summary

| File | Violations | Priority |
|------|------------|----------|
| `test.mjs` | 1 forbidden import | Critical |
| `fitness.mjs` | 1 forbidden import, 3 hardcoded adapters, config coupling | Critical |
| `proxy.mjs` | Protocol knowledge, 1 hardcoded adapter | High |
| `play.mjs` | Protocol knowledge, 2 hardcoded adapters | High |
| `list.mjs` | Minor - Plex-specific response fields | Low |
| `item.mjs` | Minor - Plex-specific response fields | Low |
| `content.mjs` | Minor - Plex ID format in docs | Low |

---

## Remediation Plan

### Phase 1: Remove Forbidden Imports (Critical)

1. **test.mjs**: Inject `plexShutoffControls` via factory
2. **fitness.mjs**: Move `FitnessProgressClassifier` to container/service

### Phase 2: Abstract Adapter Selection (High)

1. Create config-driven adapter resolution in bootstrap
2. Pass resolved adapters to routers, not registries
3. Remove hardcoded `registry.get('plex')` calls

### Phase 3: Move Protocol Logic to Adapters (High)

1. Add `proxyRequest()` method to PlexAdapter
2. Add `getStoragePath()` method to adapters
3. Standardize `getProxiedMediaUrl()` interface

### Phase 4: Normalize Config (Low)

1. Create `FitnessConfigService.getNormalizedConfig()`
2. Move Plex-specific config parsing out of API layer

---

## Related Documents

- `docs/reference/core/layers-of-abstraction/api-layer-guidelines.md`
- `docs/reference/core/backend-architecture.md`
- `docs/_wip/audits/2026-01-27-4_api-layer-audit.md`
