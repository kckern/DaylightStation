# Bootstrap Composition Root Cleanup

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate redundant adapter instantiation by enforcing app.mjs as the single composition root and bootstrap.mjs as a pure factory library with no fallback creation logic.

**Architecture:** app.mjs creates shared adapters once, passes them into bootstrap factory functions. Bootstrap factories become pure — they take deps in, return services out, never create fallback adapters. Dead code is removed.

**Tech Stack:** Node.js ESM, Express, DDD bootstrap pattern

---

## Context

### Current Problem

`bootstrap.mjs` is a factory library exporting ~40 functions. `app.mjs` is the composition root that calls them. But the boundary is violated in both directions:

1. **bootstrap.mjs makes composition decisions** — 8 fallback adapter creation patterns where factories create their own adapters when not provided
2. **app.mjs does inline wiring** — ProgressSyncService, scheduling, UPC gateway built directly instead of through bootstrap factories
3. **Dead code** — 8 exported functions never called, 6 dead imports in app.mjs
4. **Duplicate instances** — up to 4 OpenAIAdapters, 2 ProxyServices, 2 HomeAssistantAdapters at runtime

### Target State

- **app.mjs**: Creates shared adapters once, calls bootstrap factories, mounts routers
- **bootstrap.mjs**: Pure factory functions — receive deps, return services, no fallbacks
- **Zero duplicate adapter instances** at runtime

### Files

- **Modify:** `backend/src/0_system/bootstrap.mjs` (~3045 lines)
- **Modify:** `backend/src/app.mjs` (~1340 lines)

---

## Task 1: Remove Dead Imports from app.mjs

**Files:**
- Modify: `backend/src/app.mjs:30-79` (import block)

**Step 1: Remove 6 dead imports**

Remove these from the import block at `app.mjs:30-79`:
- `createExternalProxyApiRouter` (line 60)
- `createPrinterApiRouter` (line 57)
- `createTTSApiRouter` (line 58)
- `createMessagingApiRouter` (line 62)
- `getHouseholdAdapters` (line 34)
- `hasCapability` (line 35)

The import block should go from:
```javascript
import {
  // Integration system (config-driven adapter loading)
  initializeIntegrations,
  loadHouseholdIntegrations,
  getHouseholdAdapters,
  hasCapability,
  loadSystemBots,
  getMessagingAdapter,
  // Content domain
  createContentRegistry,
  createMediaProgressMemory,
  createApiRouters,
  createFitnessServices,
  createFitnessApiRouter,
  createFinanceServices,
  createFinanceApiRouter,
  createEntropyServices,
  createEntropyApiRouter,
  createHealthServices,
  createHealthApiRouter,
  createGratitudeServices,
  createGratitudeApiRouter,
  createHomeAutomationAdapters,
  createHomeAutomationApiRouter,
  createDeviceServices,
  createDeviceApiRouter,
  createHardwareAdapters,
  createPrinterApiRouter,
  createTTSApiRouter,
  createProxyService,
  createExternalProxyApiRouter,
  createMessagingServices,
  createMessagingApiRouter,
  createJournalistServices,
  createJournalistApiRouter,
  createHomebotServices,
  createHomebotApiRouter,
  createNutribotServices,
  createNutribotApiRouter,
  createLifelogServices,
  createLifelogApiRouter,
  createStaticApiRouter,
  createCalendarApiRouter,
  createEventBus,
  broadcastEvent,
  createHarvesterServices,
  createAgentsApiRouter,
  createCostServices,
  createCostApiRouter
} from './0_system/bootstrap.mjs';
```

To:
```javascript
import {
  // Integration system (config-driven adapter loading)
  initializeIntegrations,
  loadHouseholdIntegrations,
  loadSystemBots,
  getMessagingAdapter,
  // Content domain
  createContentRegistry,
  createMediaProgressMemory,
  createApiRouters,
  createFitnessServices,
  createFitnessApiRouter,
  createFinanceServices,
  createFinanceApiRouter,
  createEntropyServices,
  createEntropyApiRouter,
  createHealthServices,
  createHealthApiRouter,
  createGratitudeServices,
  createGratitudeApiRouter,
  createHomeAutomationAdapters,
  createHomeAutomationApiRouter,
  createDeviceServices,
  createDeviceApiRouter,
  createHardwareAdapters,
  createProxyService,
  createMessagingServices,
  createJournalistServices,
  createJournalistApiRouter,
  createHomebotServices,
  createHomebotApiRouter,
  createNutribotServices,
  createNutribotApiRouter,
  createLifelogServices,
  createLifelogApiRouter,
  createStaticApiRouter,
  createCalendarApiRouter,
  createEventBus,
  broadcastEvent,
  createHarvesterServices,
  createAgentsApiRouter,
  createCostServices,
  createCostApiRouter
} from './0_system/bootstrap.mjs';
```

**Step 2: Verify no runtime errors**

Run: `node -e "import('./backend/src/app.mjs')" 2>&1 | head -5`
Expected: No "is not a function" or "is not defined" errors (import-time check only)

**Step 3: Commit**

```bash
git add backend/src/app.mjs
git commit -m "chore: remove 6 dead imports from app.mjs composition root"
```

---

## Task 2: Delete Dead Bootstrap Functions

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`

**Step 1: Remove dead functions and their associated imports**

Remove these 8 exported functions from bootstrap.mjs (none are called anywhere in the codebase):

| Function | Lines | Why dead |
|----------|-------|----------|
| `createNutritionServices` | 1828–1847 | Superseded by nutribot |
| `createNutritionApiRouter` | 1856–1867 | Superseded by nutribot |
| `createJournalingServices` | 1776–1795 | Superseded by journalist |
| `createJournalingApiRouter` | 1804–1815 | Superseded by journalist |
| `createNutribotDDDServices` | 2367–2403 | Alternate DDD version, unused |
| `createMediaKeyResolver` | 648–650 | Never called |
| `createFitnessSyncerAdapter` | 944–962 | Never called |
| `getSystemBotLoader` | 400–402 | Never called |

Also remove imports that become unused after deleting these functions:
- `FoodLogService` (line 131) — only used by `createNutritionServices`
- `YamlFoodLogDatastore` (line 132) — only used by `createNutritionServices`
- `JournalService` (line 126) — only used by `createJournalingServices`
- `YamlJournalDatastore` (line 127) — only used by `createJournalingServices`
- `createNutritionRouter` (line 133) — only used by `createNutritionApiRouter`
- `createJournalingRouter` (line 128) — only used by `createJournalingApiRouter`
- `YamlNutriLogDatastore` (line 161) — only used by `createNutribotDDDServices`
- `TelegramMessagingAdapter` (line 162) — only used by `createNutribotDDDServices`
- `OpenAIFoodParserAdapter` (line 165) — only used by `createNutribotDDDServices`
- `NutritionixAdapter` (line 166) — only used by `createNutribotDDDServices`

**IMPORTANT:** Before removing each import, grep the rest of bootstrap.mjs to confirm it's truly only used by the dead function. The `TelegramWebhookParser` import (line 163) is NOT dead — it's used by `createJournalistApiRouter`, `createHomebotApiRouter`, and `createNutribotApiRouter`.

**Step 2: Verify bootstrap still loads**

Run: `node -e "import('./backend/src/0_system/bootstrap.mjs')" 2>&1 | head -5`
Expected: Clean import, no errors

**Step 3: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "chore: remove 8 dead bootstrap functions and unused imports"
```

---

## Task 3: Eliminate Duplicate ProxyService

**Files:**
- Modify: `backend/src/app.mjs:400-685`

**Problem:** app.mjs creates two ProxyService instances:
1. `contentProxyService` (line 400) — plex + immich + audiobookshelf
2. `mediaLibProxyService` (line 676) — plex only (subset of #1)

**Step 1: Reuse contentProxyService for media lib proxy handler**

Replace lines 672-685:
```javascript
  // Media library proxy service (for thumbnail transcoding, etc.)
  let mediaLibProxyHandler = null;

  if (mediaLibConfig?.host && mediaLibConfig?.token) {
    const mediaLibProxyService = createProxyService({
      plex: mediaLibConfig,  // Bootstrap key stays 'plex' for now
      logger: rootLogger.child({ module: 'media-proxy' })
    });
    mediaLibProxyHandler = async (req, res) => {
      await mediaLibProxyService.proxy('plex', req, res);
    };
  } else {
    rootLogger.warn('mediaLibProxy.disabled', { reason: 'Missing host or token' });
  }
```

With:
```javascript
  // Media library proxy handler (reuses contentProxyService — no separate instance needed)
  let mediaLibProxyHandler = null;

  if (mediaLibConfig?.host && mediaLibConfig?.token) {
    mediaLibProxyHandler = async (req, res) => {
      await contentProxyService.proxy('plex', req, res);
    };
  } else {
    rootLogger.warn('mediaLibProxy.disabled', { reason: 'Missing host or token' });
  }
```

**Step 2: Verify the plex proxy still works**

The `contentProxyService` at line 400 already registers a plex proxy adapter with the same config. The `.proxy('plex', req, res)` call routes to the same `PlexProxyAdapter`. No behavioral change.

**Step 3: Commit**

```bash
git add backend/src/app.mjs
git commit -m "refactor: reuse contentProxyService instead of creating duplicate for media lib proxy"
```

---

## Task 4: Consolidate OpenAI Adapter to Single Instance

**Files:**
- Modify: `backend/src/app.mjs:920-948, 628`

**Problem:** Up to 4 OpenAIAdapter instances with the same API key:
1. `sharedAiGateway` in app.mjs:929
2. `openaiForTranscription` in app.mjs:938
3. Inside `createFitnessServices` (bootstrap:839) — another one for voice memos
4. Inside `createHarvesterServices` IIFE (bootstrap:2765) — because app.mjs passes `aiGateway: null`

**Step 1: Reuse sharedAiGateway for voice transcription**

Replace the separate OpenAI instance for transcription (app.mjs lines 935-948):

```javascript
  // Create shared voice transcription service (used by all bot TelegramAdapters)
  // ALWAYS use OpenAI for transcription (requires Whisper API support)
  let voiceTranscriptionService = null;
  if (openaiApiKey) {
    const { OpenAIAdapter } = await import('#adapters/ai/OpenAIAdapter.mjs');
    const openaiForTranscription = new OpenAIAdapter(
      { apiKey: openaiApiKey },
      { httpClient: axios, logger: rootLogger.child({ module: 'openai-transcription' }) }
    );
    const { TelegramVoiceTranscriptionService } = await import('#adapters/messaging/TelegramVoiceTranscriptionService.mjs');
    const voiceHttpClient = new HttpClient({ logger: rootLogger.child({ module: 'voice-http' }) });
    voiceTranscriptionService = new TelegramVoiceTranscriptionService(
      { openaiAdapter: openaiForTranscription },
      { httpClient: voiceHttpClient, logger: rootLogger.child({ module: 'voice-transcription' }) }
    );
  }
```

With:
```javascript
  // Create shared voice transcription service (used by all bot TelegramAdapters)
  // Reuses sharedAiGateway (same OpenAI adapter) for Whisper API transcription
  let voiceTranscriptionService = null;
  if (sharedAiGateway) {
    const { TelegramVoiceTranscriptionService } = await import('#adapters/messaging/TelegramVoiceTranscriptionService.mjs');
    const voiceHttpClient = new HttpClient({ logger: rootLogger.child({ module: 'voice-http' }) });
    voiceTranscriptionService = new TelegramVoiceTranscriptionService(
      { openaiAdapter: sharedAiGateway },
      { httpClient: voiceHttpClient, logger: rootLogger.child({ module: 'voice-transcription' }) }
    );
  }
```

**Step 2: Pass sharedAiGateway to harvesterServices**

Change app.mjs line 628 from:
```javascript
    aiGateway: null, // AI gateway created later in app initialization
```

To:
```javascript
    aiGateway: sharedAiGateway, // Shared OpenAI adapter (created above)
```

This requires moving the `sharedAiGateway` creation block (lines 926-931) ABOVE the harvester services block (line 621). Currently `sharedAiGateway` is created at ~926 and harvesters at ~621.

**Step 3: Move sharedAiGateway creation earlier in app.mjs**

Move the shared AI gateway block (lines 922-931) to just after the `householdAdapters` section (~line 233), before any service creation that needs it. The block to move:

```javascript
  // Create shared AI adapter (used by all bots)
  const openaiApiKey = configService.getSecret('OPENAI_API_KEY') || '';
  let sharedAiGateway = householdAdapters?.has?.('ai') ? householdAdapters.get('ai') : null;
  if (!sharedAiGateway && openaiApiKey) {
    const { OpenAIAdapter } = await import('#adapters/ai/OpenAIAdapter.mjs');
    sharedAiGateway = new OpenAIAdapter({ apiKey: openaiApiKey }, { httpClient: axios, logger: rootLogger.child({ module: 'shared-ai' }) });
    rootLogger.debug('ai.adapter.fallback', { reason: 'Using hardcoded OpenAI adapter creation' });
  }
```

Then remove the later `const openaiApiKey = ...` at line 921 (it would be a duplicate).

**Step 4: Commit**

```bash
git add backend/src/app.mjs
git commit -m "refactor: consolidate 4 OpenAI adapter instances into single shared instance"
```

---

## Task 5: Remove Fallback Adapter Creation from Bootstrap Factories

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs`

**Problem:** 8 fallback patterns in bootstrap.mjs where factories create adapters when not provided. The composition root (app.mjs) should be the only place adapters are created.

### Step 1: Remove HomeAssistantAdapter fallback from createFitnessServices

In `createFitnessServices` (lines 809-821), replace:
```javascript
  // Home automation gateway - prefer pre-loaded adapter, fall back to config-based creation
  let haGateway = preloadedHaGateway ?? null;
  let ambientLedController = null;

  if (!haGateway && homeAssistant?.baseUrl && homeAssistant?.token && httpClient) {
    haGateway = new HomeAssistantAdapter(
      {
        baseUrl: homeAssistant.baseUrl,
        token: homeAssistant.token
      },
      { httpClient, logger }
    );
    logger.debug?.('fitness.haGateway.fallback', { reason: 'Using config-based HA adapter creation' });
  }
```

With:
```javascript
  // Home automation gateway (provided by composition root)
  const haGateway = preloadedHaGateway ?? null;
  let ambientLedController = null;
```

Also remove `homeAssistant` from the destructured config params (line 789) and remove the `HomeAssistantAdapter` usage from this function's scope. The import at line 77 stays because `createHomeAutomationAdapters` still uses it (for now — see step 3).

Update `createFitnessServices` JSDoc to remove `@param {Object} [config.homeAssistant]` and its children (lines 776-778).

### Step 2: Remove BuxferAdapter fallback from createFinanceServices

In `createFinanceServices` (lines 1066-1073), replace:
```javascript
  // Buxfer adapter - prefer pre-loaded adapter, fall back to config-based creation
  let buxferAdapter = preloadedBuxferAdapter ?? null;
  if (!buxferAdapter && buxfer?.email && buxfer?.password && httpClient) {
    buxferAdapter = new BuxferAdapter(
      { email: buxfer.email, password: buxfer.password },
      { httpClient, logger }
    );
    logger.debug?.('finance.buxferAdapter.fallback', { reason: 'Using config-based Buxfer adapter creation' });
  }
```

With:
```javascript
  // Buxfer adapter (provided by composition root)
  const buxferAdapter = preloadedBuxferAdapter ?? null;
```

Remove `buxfer` and `httpClient` from the destructured config params (lines 1053, 1055). Update JSDoc to remove `@param {Object} [config.buxfer]` and children.

### Step 3: Remove HomeAssistantAdapter fallback from createHomeAutomationAdapters

In `createHomeAutomationAdapters` (lines 1367-1379), replace:
```javascript
  // Home Assistant gateway - prefer pre-loaded adapter, fall back to config-based creation
  let haGateway = preloadedHaGateway ?? null;
  let tvAdapter = null;

  if (!haGateway && config.homeAssistant?.baseUrl && config.homeAssistant?.token && httpClient) {
    haGateway = new HomeAssistantAdapter(
      {
        baseUrl: config.homeAssistant.baseUrl,
        token: config.homeAssistant.token
      },
      { httpClient, logger }
    );
    logger.debug?.('homeAutomation.haGateway.fallback', { reason: 'Using config-based HA adapter creation' });
  }
```

With:
```javascript
  // Home Assistant gateway (provided by composition root)
  const haGateway = preloadedHaGateway ?? null;
  let tvAdapter = null;
```

Remove `config.homeAssistant` from JSDoc (lines 1341-1343).

### Step 4: Remove OpenAIAdapter fallback from createHarvesterServices

In `createHarvesterServices` (lines 2762-2766), replace:
```javascript
  // Create AI gateway if not provided (for Shopping harvester)
  const effectiveAiGateway = aiGateway || (() => {
    const openaiKey = configService.getSecret('OPENAI_API_KEY');
    if (!openaiKey || !httpClient) return null;
    return new OpenAIAdapter({ apiKey: openaiKey }, { httpClient, logger });
  })();
```

With:
```javascript
  // AI gateway (provided by composition root)
  const effectiveAiGateway = aiGateway ?? null;
```

### Step 5: Remove BuxferAdapter fallback from createHarvesterServices

In `createHarvesterServices` (lines 2936-2946), replace:
```javascript
  // Buxfer - prefer pre-loaded adapter, fall back to config-based creation
  let buxferAdapter = preloadedBuxferAdapter ?? null;
  if (!buxferAdapter && httpClient) {
    const buxferAuth = configService?.getHouseholdAuth?.('buxfer') || configService?.getUserAuth?.('buxfer');
    if (buxferAuth?.email && buxferAuth?.password) {
      buxferAdapter = new BuxferAdapter(
        { email: buxferAuth.email, password: buxferAuth.password },
        { httpClient, logger }
      );
      logger.debug?.('harvester.buxferAdapter.fallback', { reason: 'Using config-based Buxfer adapter creation' });
    }
  }
```

With:
```javascript
  // Buxfer adapter (provided by composition root)
  const buxferAdapter = preloadedBuxferAdapter ?? null;
```

### Step 6: Clean up now-unused imports from bootstrap.mjs

After removing fallbacks, check which imports are now unused:
- `HomeAssistantAdapter` (line 77) — still used by `createHomeAutomationAdapters`? No, we removed the fallback there too. But wait — app.mjs may still need it. **Check:** grep for `HomeAssistantAdapter` usage remaining in bootstrap.mjs. If none, remove the import.
- `BuxferAdapter` (line 106) — check if any remaining usage. After removing both fallbacks, the import may be dead in bootstrap.mjs. **Check and remove if dead.**
- `OpenAIAdapter` (line 69) — check remaining usage after removing IIFE. The `createFitnessServices` function still creates one at line 839 for voice transcription. **Keep if still used.**

**IMPORTANT:** Run grep on bootstrap.mjs for each import before removing to avoid breaking remaining functions.

### Step 7: Update app.mjs to pass HA adapter creation result to fitness

App.mjs currently passes the same `householdAdapters.get('home_automation')` to both `createFitnessServices` (as `haGateway`) and `createHomeAutomationAdapters` (as `haGateway`). With fallbacks removed, if neither provides an adapter, these functions gracefully get `null`. That's correct — no app.mjs changes needed here because the current app.mjs already creates HA from the integration system.

However, verify that the legacy `homeAssistant: { baseUrl, token }` params passed to `createFitnessServices` (app.mjs:512-515) are no longer read. Remove them:

```javascript
  // Before:
  const fitnessServices = createFitnessServices({
    configService,
    mediaRoot: mediaBasePath,
    defaultHouseholdId: householdId,
    haGateway: householdAdapters?.has?.('home_automation') ? householdAdapters.get('home_automation') : null,
    homeAssistant: {
      baseUrl: haBaseUrl,
      token: haAuth.token || ''
    },
    loadFitnessConfig,
    openaiApiKey: configService.getSecret('OPENAI_API_KEY') || '',
    httpClient: axios,
    logger: rootLogger.child({ module: 'fitness' })
  });

  // After:
  const fitnessServices = createFitnessServices({
    configService,
    mediaRoot: mediaBasePath,
    defaultHouseholdId: householdId,
    haGateway: householdAdapters?.has?.('home_automation') ? householdAdapters.get('home_automation') : null,
    loadFitnessConfig,
    openaiApiKey: configService.getSecret('OPENAI_API_KEY') || '',
    httpClient: axios,
    logger: rootLogger.child({ module: 'fitness' })
  });
```

Similarly, remove `homeAssistant` from `createHomeAutomationAdapters` call (app.mjs:838-841).

### Step 8: Commit

```bash
git add backend/src/0_system/bootstrap.mjs backend/src/app.mjs
git commit -m "refactor: remove fallback adapter creation from bootstrap factories

Composition root (app.mjs) is now the single place where adapters
are created. Bootstrap factories are pure: deps in, services out."
```

---

## Task 6: Verify No Regressions

**Step 1: Run the dev server and check for startup errors**

Run: `cd /root/Code/DaylightStation && node backend/index.js 2>&1 | head -30`

Look for:
- No `TypeError: X is not a function` errors
- No `ReferenceError: X is not defined` errors
- Services still initialize (look for `integrations.loaded`, `hardware.initialized`, etc.)

**Step 2: Spot-check key API endpoints**

If dev server starts successfully, verify a few endpoints:
```bash
curl -s http://localhost:3112/api/v1/status | head -5
curl -s http://localhost:3112/api/v1/fitness/config | head -5
```

**Step 3: Check for any remaining duplicate instantiation**

Run a final grep to confirm no duplicate adapter creation:
```bash
grep -n "new OpenAIAdapter" backend/src/app.mjs
grep -n "new HomeAssistantAdapter" backend/src/0_system/bootstrap.mjs
grep -n "new BuxferAdapter" backend/src/0_system/bootstrap.mjs
```

Expected: OpenAIAdapter appears once in app.mjs (the shared instance), HomeAssistantAdapter and BuxferAdapter appear zero times in bootstrap.mjs.

---

## Out of Scope (Future Work)

These were identified in the audit but are separate concerns:

1. **Move inline wiring to bootstrap functions** — ProgressSyncService, scheduling domain, UPC gateway, and media job executor are wired directly in app.mjs instead of through bootstrap factories. This is a separate refactor.
2. **Consolidate YamlNutriListDatastore** — Created separately by nutribot and health services. Would require a shared nutrilist store passed to both.
3. **Remove StravaClientAdapter/YamlAuthDatastore/YamlWeatherDatastore fallbacks** — These harvester-internal fallbacks are less problematic (they provide reasonable defaults for optional deps within a single factory).
