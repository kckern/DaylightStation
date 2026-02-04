# Exist.io Adapter Design

> A multi-target adapter that feeds into multiple Life domain subdomains

**Last Updated:** 2026-02-04
**Status:** Design Complete, Ready for Implementation
**Depends On:** `2026-02-04-unified-life-domain-design.md`

---

## Overview

Exist.io is a **meta-aggregator** - it already pulls data from 20+ services and computes correlations. This makes it unique among DaylightStation adapters because:

1. **Gap-filler**: Brings data from services without native harvesters (Oura, RescueTime, Fitbit via Exist)
2. **Correlation source**: Exist's computed correlations can seed the belief discovery system
3. **Attribute bridge**: Exist's mood/custom tracking maps directly to Life domain attributes

**Multi-target architecture:**

```
                         ┌─────────────────────────────────────────┐
                         │           Exist.io API                  │
                         │                                         │
                         │  • Attributes (mood, custom tags)       │
                         │  • Averages (daily metrics)             │
                         │  • Correlations (discovered patterns)   │
                         │  • Integrations (connected services)    │
                         └───────────────┬─────────────────────────┘
                                         │
                                         ▼
                         ┌─────────────────────────────────────────┐
                         │         ExistAdapter                    │
                         │    (Multi-Target Harvester)             │
                         └───────────────┬─────────────────────────┘
                                         │
              ┌──────────────────────────┼──────────────────────────┐
              │                          │                          │
              ▼                          ▼                          ▼
    ┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
    │   life/log/     │       │   life/core/    │       │   life/plan/    │
    │                 │       │                 │       │                 │
    │ Gap-fill data:  │       │ Attributes:     │       │ Seed beliefs:   │
    │ • Oura sleep    │       │ • Mood scores   │       │ • Correlations  │
    │ • RescueTime    │       │ • Energy        │       │   as hypotheses │
    │ • Fitbit steps  │       │ • Custom tags   │       │                 │
    └─────────────────┘       └─────────────────┘       └─────────────────┘
```

**Why not a simple harvester?**

A standard harvester writes to a single lifelog file. But Exist.io's value is distributed:
- Raw metrics → `life/log/` (like other harvesters)
- Mood/attributes → `life/core/` (attribute system, not raw lifelog)
- Correlations → `life/plan/` (belief discovery, not lifelog)

This requires a specialized adapter that understands multiple target domains.

---

## What Exist.io Provides

Exist.io aggregates data from 20+ services:

| Category | Services | Native DS Harvester? |
|----------|----------|---------------------|
| **Sleep** | Oura, Fitbit, Withings, Garmin | Withings only |
| **Activity** | Fitbit, Garmin, Apple Health, Google Fit | Strava only |
| **Productivity** | RescueTime, Toggl | None |
| **Tasks** | Todoist, GitHub | Both native |
| **Location** | Swarm/Foursquare | Native |
| **Music** | Last.fm | Native |
| **Calendar** | Google, Apple iCloud | Native |
| **Weather** | Automatic | Native |
| **Custom** | Manual tags, mood | None (new in Life domain) |

**Gap-fill value:** Oura, RescueTime, Fitbit, Garmin data via Exist without building native harvesters.

---

## Data Mapping

**Exist.io API endpoints we'll use:**

| Endpoint | What it provides | Target in DaylightStation |
|----------|-----------------|---------------------------|
| `GET /api/2/accounts/` | User profile, timezone | Adapter config |
| `GET /api/2/attributes/` | Attribute definitions | `life/core/` Attribute entities |
| `GET /api/2/attributes/values/` | Daily attribute values | `life/core/` AttributeEntry |
| `GET /api/2/averages/` | Daily averages (steps, sleep, etc.) | `life/log/exist.yml` |
| `GET /api/2/correlations/` | Discovered correlations | `life/plan/` seed beliefs |
| `GET /api/2/integrations/` | Connected services list | Adapter routing logic |

**Attribute mapping:**

```yaml
# Exist.io attribute → DaylightStation attribute
exist_attribute_mapping:
  # Built-in Exist attributes
  mood:
    target: life/core/attributes
    ds_attribute: mood
    type: scale_1_10  # Exist uses 1-9, we normalize to 1-10

  energy:
    target: life/core/attributes
    ds_attribute: energy
    type: scale_1_10

  stress:
    target: life/core/attributes
    ds_attribute: stress
    type: scale_1_10

  # Custom Exist tags become custom attributes
  custom_*:
    target: life/core/attributes
    ds_attribute: exist_{tag_name}
    type: boolean  # Tags are binary in Exist
```

**Averages mapping (gap-fill):**

```yaml
# Exist.io averages → DaylightStation lifelog
exist_average_mapping:
  # Sleep data (from Oura, Fitbit, etc. via Exist)
  sleep:
    target: life/log/exist
    fields:
      - sleep_total      → sleep_hours
      - sleep_start      → sleep_start
      - sleep_end        → sleep_end
      - time_in_bed      → time_in_bed

  # Activity data (from various trackers via Exist)
  activity:
    target: life/log/exist
    fields:
      - steps            → steps
      - steps_active_min → active_minutes
      - floors           → floors

  # Productivity (RescueTime via Exist)
  productivity:
    target: life/log/exist
    fields:
      - productive_min   → productive_minutes
      - distracting_min  → distracting_minutes
      - neutral_min      → neutral_minutes
      - productivity     → productivity_score  # -2 to +2 scale

  # Location (Swarm/Foursquare via Exist)
  location:
    target: life/log/exist
    fields:
      - checkins         → checkin_count
      - places           → unique_places

  # Media (Last.fm via Exist)
  media:
    target: life/log/exist
    fields:
      - tracks           → tracks_played
      - albums           → albums_played

  # Weather (automatic in Exist)
  weather:
    target: life/log/exist
    fields:
      - temp_max         → temp_high
      - temp_min         → temp_low
      - weather_icon     → conditions
```

**Correlation mapping:**

```yaml
# Exist.io correlations → DaylightStation beliefs
exist_correlation_mapping:
  target: life/plan/beliefs
  transform:
    # Exist format:
    #   { attribute: "mood", attribute2: "steps",
    #     stars: 4, positive: true, p: 0.001 }
    #
    # Becomes DaylightStation belief:
    #   { if: "steps > daily_average", then: "mood improves",
    #     confidence: 0.80, source: "exist_import", ... }
```

**Gap-fill logic:**

The adapter checks which services the user has connected in Exist.io and only imports data that doesn't have a native harvester:

```javascript
// Pseudo-code for gap-fill routing
const nativeHarvesters = ['strava', 'withings', 'todoist', 'github', ...];

async function determineImports(existIntegrations) {
  const imports = {
    averages: [],
    skipReasons: {}
  };

  for (const integration of existIntegrations) {
    if (nativeHarvesters.includes(integration.name)) {
      // Skip - we have native harvester
      imports.skipReasons[integration.name] = 'native_harvester_exists';
    } else {
      // Import via Exist - we don't have native support
      imports.averages.push(integration.name);
    }
  }

  // Always import these (Exist-only features):
  imports.correlations = true;  // No native equivalent
  imports.mood = true;          // Unless user tracks in DS already

  return imports;
}
```

---

## Adapter Architecture

**File structure:**

```
backend/src/1_adapters/harvester/meta/
├── ExistAdapter.mjs             # Main adapter (multi-target)
├── ExistClient.mjs              # API client with OAuth
├── ExistAttributeMapper.mjs     # Attribute normalization
├── ExistCorrelationMapper.mjs   # Correlation → Belief transform
└── ExistGapFillRouter.mjs       # Determines what to import

backend/src/1_adapters/harvester/ports/
└── IMultiTargetAdapter.mjs      # New interface for multi-target adapters
```

**New interface for multi-target adapters:**

```javascript
// IMultiTargetAdapter.mjs
// Extends IHarvester for adapters that write to multiple domains

import { IHarvester } from './IHarvester.mjs';

export class IMultiTargetAdapter extends IHarvester {
  /**
   * Returns list of domains this adapter writes to
   * @returns {string[]} e.g., ['life/log', 'life/core', 'life/plan']
   */
  get targetDomains() {
    throw new Error('IMultiTargetAdapter.targetDomains must be implemented');
  }

  /**
   * Harvest and route to multiple targets
   * @param {Object} options
   * @returns {Object} Results keyed by target domain
   */
  async harvestAll(options) {
    throw new Error('IMultiTargetAdapter.harvestAll must be implemented');
  }
}
```

**ExistAdapter implementation:**

```javascript
// ExistAdapter.mjs
import { IMultiTargetAdapter } from '../ports/IMultiTargetAdapter.mjs';
import { ExistClient } from './ExistClient.mjs';
import { ExistAttributeMapper } from './ExistAttributeMapper.mjs';
import { ExistCorrelationMapper } from './ExistCorrelationMapper.mjs';
import { ExistGapFillRouter } from './ExistGapFillRouter.mjs';

export class ExistAdapter extends IMultiTargetAdapter {
  #client;
  #attributeMapper;
  #correlationMapper;
  #gapFillRouter;
  #stores;  // { lifelog, attributes, beliefs }
  #logger;

  constructor({
    existClient,
    lifelogStore,
    attributeStore,
    beliefStore,
    nativeHarvesters = [],
    logger = console,
  }) {
    super();
    this.#client = existClient;
    this.#attributeMapper = new ExistAttributeMapper();
    this.#correlationMapper = new ExistCorrelationMapper();
    this.#gapFillRouter = new ExistGapFillRouter(nativeHarvesters);
    this.#stores = { lifelog: lifelogStore, attributes: attributeStore, beliefs: beliefStore };
    this.#logger = logger;
  }

  get serviceId() { return 'exist'; }
  get category() { return 'meta'; }  // New category for meta-aggregators
  get targetDomains() { return ['life/log', 'life/core', 'life/plan']; }

  /**
   * Main harvest method - routes to all targets
   */
  async harvestAll({ username, dateRange, options = {} }) {
    const results = {
      'life/log': { success: false, records: 0 },
      'life/core': { success: false, records: 0 },
      'life/plan': { success: false, records: 0 },
    };

    try {
      // 1. Get user's connected integrations
      const integrations = await this.#client.getIntegrations();
      const importPlan = this.#gapFillRouter.plan(integrations);

      this.#logger.info('exist.harvest.plan', {
        importing: importPlan.averages,
        skipping: Object.keys(importPlan.skipReasons),
      });

      // 2. Import averages → life/log (gap-fill only)
      if (importPlan.averages.length > 0) {
        results['life/log'] = await this.#harvestAverages(username, dateRange, importPlan);
      }

      // 3. Import attributes → life/core
      results['life/core'] = await this.#harvestAttributes(username, dateRange, options);

      // 4. Import correlations → life/plan (as seed beliefs)
      if (options.importCorrelations !== false) {
        results['life/plan'] = await this.#harvestCorrelations(username, options);
      }

      return results;

    } catch (error) {
      this.#logger.error('exist.harvest.failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Gap-fill: Import averages for services without native harvesters
   */
  async #harvestAverages(username, dateRange, importPlan) {
    const averages = await this.#client.getAverages(dateRange);

    // Filter to only gap-fill services
    const filtered = this.#gapFillRouter.filter(averages, importPlan.averages);

    // Write to lifelog
    let records = 0;
    for (const [date, data] of Object.entries(filtered)) {
      await this.#stores.lifelog.merge(username, 'exist', date, data);
      records++;
    }

    return { success: true, records };
  }

  /**
   * Import mood and custom attributes → life/core
   */
  async #harvestAttributes(username, dateRange, options) {
    // Get attribute definitions
    const existAttrs = await this.#client.getAttributes();
    const attrDefs = this.#attributeMapper.mapDefinitions(existAttrs);

    // Ensure attributes exist in DS
    for (const attr of attrDefs) {
      await this.#stores.attributes.ensureAttribute(username, attr);
    }

    // Get attribute values
    const values = await this.#client.getAttributeValues(dateRange);
    const mapped = this.#attributeMapper.mapValues(values);

    // Write entries
    let records = 0;
    for (const entry of mapped) {
      await this.#stores.attributes.recordEntry(username, entry);
      records++;
    }

    return { success: true, records, attributes: attrDefs.length };
  }

  /**
   * Import correlations as seed beliefs → life/plan
   */
  async #harvestCorrelations(username, options) {
    const correlations = await this.#client.getCorrelations();

    // Filter to strong correlations only
    const strong = correlations.filter(c =>
      c.stars >= 3 &&           // Exist's confidence indicator
      c.second_person !== true  // Not relationship data
    );

    // Map to belief format
    const seedBeliefs = this.#correlationMapper.toBeliefs(strong);

    // Add as hypothesized beliefs (user must promote)
    let records = 0;
    for (const belief of seedBeliefs) {
      const exists = await this.#stores.beliefs.findBySignature(username, belief.signature);
      if (!exists) {
        await this.#stores.beliefs.addSeedBelief(username, {
          ...belief,
          source: 'exist_import',
          state: 'hypothesized',
          confidence: this.#correlationMapper.starsToConfidence(belief.stars),
        });
        records++;
      }
    }

    return { success: true, records, skipped: seedBeliefs.length - records };
  }

  /**
   * Standard harvest method (for compatibility)
   * Delegates to harvestAll
   */
  async harvest(options) {
    return this.harvestAll(options);
  }
}
```

**Correlation → Belief transformation:**

```javascript
// ExistCorrelationMapper.mjs
export class ExistCorrelationMapper {

  /**
   * Convert Exist correlation to DaylightStation belief
   */
  toBeliefs(correlations) {
    return correlations.map(c => ({
      // Signature for deduplication
      signature: `${c.attribute}:${c.attribute2}:${c.positive ? 'pos' : 'neg'}`,

      // Human-readable if/then
      if: this.#attributeToCondition(c.attribute),
      then: this.#attributeToOutcome(c.attribute2, c.positive),

      // Metadata
      source: 'exist_import',
      exist_stars: c.stars,
      exist_p_value: c.p,
      imported_at: new Date().toISOString(),

      // Will be set on import
      state: 'hypothesized',
      confidence: this.starsToConfidence(c.stars),
    }));
  }

  starsToConfidence(stars) {
    // Exist uses 1-5 stars, map to 0.5-0.9 confidence
    const mapping = { 1: 0.50, 2: 0.60, 3: 0.70, 4: 0.80, 5: 0.90 };
    return mapping[stars] || 0.50;
  }

  #attributeToCondition(attr) {
    const conditions = {
      steps: 'I walk more than usual',
      sleep: 'I sleep 7+ hours',
      productive_min: 'I have productive work time',
      workouts: 'I exercise',
      tracks: 'I listen to music',
    };
    return conditions[attr] || `${attr} is above average`;
  }

  #attributeToOutcome(attr, positive) {
    const outcomes = {
      mood: positive ? 'my mood is better' : 'my mood is worse',
      energy: positive ? 'I have more energy' : 'I have less energy',
      stress: positive ? 'I feel more stressed' : 'I feel less stressed',
    };
    return outcomes[attr] || `${attr} is ${positive ? 'higher' : 'lower'}`;
  }
}
```

---

## OAuth & API Client

**OAuth flow:**

Exist.io uses OAuth2. The adapter needs to handle token refresh automatically.

```javascript
// ExistClient.mjs
export class ExistClient {
  #baseUrl = 'https://exist.io/api/2';
  #accessToken;
  #refreshToken;
  #authStore;
  #clientId;
  #clientSecret;
  #username;

  constructor({ authStore, clientId, clientSecret }) {
    this.#authStore = authStore;
    this.#clientId = clientId;
    this.#clientSecret = clientSecret;
  }

  async initialize(username) {
    this.#username = username;
    const tokens = await this.#authStore.getTokens(username, 'exist');
    if (!tokens) {
      throw new Error('Exist.io not connected. Run OAuth flow first.');
    }
    this.#accessToken = tokens.access_token;
    this.#refreshToken = tokens.refresh_token;
  }

  async #fetch(endpoint, options = {}) {
    const response = await fetch(`${this.#baseUrl}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.#accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (response.status === 401) {
      // Token expired, refresh and retry
      await this.#refreshAccessToken();
      return this.#fetch(endpoint, options);
    }

    if (!response.ok) {
      throw new Error(`Exist API error: ${response.status}`);
    }

    return response.json();
  }

  async #refreshAccessToken() {
    const response = await fetch('https://exist.io/oauth2/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: this.#refreshToken,
        client_id: this.#clientId,
        client_secret: this.#clientSecret,
      }),
    });

    const tokens = await response.json();
    this.#accessToken = tokens.access_token;
    this.#refreshToken = tokens.refresh_token;

    // Persist new tokens
    await this.#authStore.saveTokens(this.#username, 'exist', tokens);
  }

  // API methods
  async getIntegrations() {
    return this.#fetch('/integrations/');
  }

  async getAttributes() {
    return this.#fetch('/attributes/');
  }

  async getAttributeValues({ from, to }) {
    return this.#fetch(`/attributes/values/?date_min=${from}&date_max=${to}`);
  }

  async getAverages({ from, to }) {
    return this.#fetch(`/averages/?date_min=${from}&date_max=${to}`);
  }

  async getCorrelations() {
    return this.#fetch('/correlations/');
  }
}
```

---

## Configuration

**Secrets configuration:**

```yaml
# data/system/secrets/secrets.yml
exist:
  client_id: "your_exist_client_id"
  client_secret: "your_exist_client_secret"

  # Per-user tokens stored separately in auth.yml after OAuth flow
```

**User-level configuration:**

```yaml
# data/household[-{hid}]/users/{uid}/life/config.yml
exist:
  enabled: true

  sync:
    # How often to sync (cron expression)
    schedule: "0 6 * * *"  # Daily at 6 AM

    # Date range for sync
    lookback_days: 7  # Re-sync last 7 days each run

  import:
    # What to import
    attributes: true      # Mood, energy, custom tags
    averages: true        # Gap-fill metrics
    correlations: true    # Seed beliefs

    # Gap-fill behavior
    gap_fill_only: true   # Skip data we have native harvesters for

    # Correlation import threshold
    min_correlation_stars: 3  # Only import 3+ star correlations

  attribute_mapping:
    # Override default attribute mapping
    mood:
      enabled: true
      ds_attribute: mood  # Map to this DS attribute
    energy:
      enabled: true
      ds_attribute: energy
    # Disable specific imports
    stress:
      enabled: false      # Don't import stress, I track differently

  # Services to explicitly skip even if no native harvester
  skip_services:
    - "some_service_i_dont_want"
```

---

## Sync Strategy

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        SYNC STRATEGY                                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  INITIAL IMPORT (one-time)                                              │
│  ─────────────────────────                                              │
│  • Import all historical data (up to Exist's limits, ~1 year)           │
│  • Import all correlations as seed beliefs                              │
│  • User reviews seed beliefs, promotes or dismisses                     │
│                                                                         │
│  DAILY SYNC (scheduled)                                                 │
│  ────────────────────────                                               │
│  • Re-sync last N days (configurable, default 7)                        │
│  • Merge new attribute values                                           │
│  • Update gap-fill averages                                             │
│  • Check for new correlations (monthly)                                 │
│                                                                         │
│  CONFLICT RESOLUTION                                                    │
│  ────────────────────                                                   │
│  • Exist data marked with source: 'exist_import'                        │
│  • If same date has manual entry AND exist entry:                       │
│    - Attributes: manual wins (user explicitly entered)                  │
│    - Averages: exist wins (more precise from device)                    │
│  • Correlations: never overwrite promoted beliefs                       │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

**Sync service:**

```javascript
// ExistSyncService.mjs (in 3_applications/life/services/)
export class ExistSyncService {
  #adapter;
  #config;
  #logger;

  async runSync(username, options = {}) {
    const userConfig = await this.#config.get(username, 'life', 'exist');

    if (!userConfig?.enabled) {
      this.#logger.info('exist.sync.disabled', { username });
      return { skipped: true, reason: 'disabled' };
    }

    const dateRange = this.#calculateDateRange(userConfig, options);

    this.#logger.info('exist.sync.start', {
      username,
      from: dateRange.from,
      to: dateRange.to,
    });

    const results = await this.#adapter.harvestAll({
      username,
      dateRange,
      options: {
        importCorrelations: options.includeCorrelations ?? false,
        minCorrelationStars: userConfig.import?.min_correlation_stars ?? 3,
        gapFillOnly: userConfig.import?.gap_fill_only ?? true,
      },
    });

    this.#logger.info('exist.sync.complete', { username, results });
    return results;
  }

  #calculateDateRange(config, options) {
    const to = options.to || new Date().toISOString().split('T')[0];
    const lookback = config.sync?.lookback_days || 7;
    const from = options.from || moment(to).subtract(lookback, 'days').format('YYYY-MM-DD');
    return { from, to };
  }
}
```

---

## Integration Points

**Integration with Life domain:**

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     EXIST ADAPTER INTEGRATION POINTS                     │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌─────────────────┐                                                    │
│  │  ExistAdapter   │                                                    │
│  └────────┬────────┘                                                    │
│           │                                                             │
│           ├──────────────────────────────────────────────────────────┐  │
│           │                                                          │  │
│           ▼                                                          │  │
│  ┌─────────────────┐    Writes to:                                   │  │
│  │  life/log/      │    • lifelog/exist.yml (gap-fill metrics)       │  │
│  │                 │                                                 │  │
│  │  ExistExtractor │◄── New extractor for LifelogAggregator         │  │
│  └─────────────────┘                                                 │  │
│           │                                                          │  │
│           ▼                                                          │  │
│  ┌─────────────────┐    Writes to:                                   │  │
│  │  life/core/     │    • attributes.yml (definitions)               │  │
│  │                 │    • attributes/{date}.yml (daily values)       │  │
│  │  AttributeStore │                                                 │  │
│  └─────────────────┘                                                 │  │
│           │                                                          │  │
│           ▼                                                          │  │
│  ┌─────────────────┐    Writes to:                                   │  │
│  │  life/plan/     │    • plan.yml beliefs[] (as hypothesized)       │  │
│  │                 │                                                 │  │
│  │  BeliefStore    │    Seed beliefs enter belief loop:              │  │
│  │                 │    hypothesized → testing → confirmed/refuted   │  │
│  └─────────────────┘                                                 │  │
│                                                                      │  │
└──────────────────────────────────────────────────────────────────────┴──┘
```

**New ExistExtractor for LifelogAggregator:**

```javascript
// life/log/extractors/ExistExtractor.mjs
import { ILifelogExtractor, ExtractorCategory } from './ILifelogExtractor.mjs';

export class ExistExtractor extends ILifelogExtractor {
  get source() { return 'exist'; }
  get category() { return ExtractorCategory.HEALTH; }  // Primary category
  get filename() { return 'exist'; }

  extractForDate(data, date) {
    const dayData = data?.[date];
    if (!dayData) return null;

    return {
      // Sleep (from Oura/Fitbit via Exist)
      sleep: dayData.sleep_hours ? {
        hours: dayData.sleep_hours,
        start: dayData.sleep_start,
        end: dayData.sleep_end,
      } : null,

      // Activity (from various trackers)
      activity: dayData.steps ? {
        steps: dayData.steps,
        activeMinutes: dayData.active_minutes,
      } : null,

      // Productivity (from RescueTime)
      productivity: dayData.productive_minutes ? {
        productiveMinutes: dayData.productive_minutes,
        distractingMinutes: dayData.distracting_minutes,
        score: dayData.productivity_score,
      } : null,

      // Weather
      weather: dayData.temp_high ? {
        high: dayData.temp_high,
        low: dayData.temp_low,
        conditions: dayData.conditions,
      } : null,
    };
  }

  summarize(entry) {
    if (!entry) return null;

    const parts = [];

    if (entry.sleep) {
      parts.push(`Sleep: ${entry.sleep.hours.toFixed(1)} hours`);
    }
    if (entry.activity) {
      parts.push(`Steps: ${entry.activity.steps.toLocaleString()}`);
    }
    if (entry.productivity) {
      const score = entry.productivity.score > 0 ? '+' : '';
      parts.push(`Productivity: ${score}${entry.productivity.score.toFixed(1)}`);
    }
    if (entry.weather) {
      parts.push(`Weather: ${entry.weather.conditions}, ${entry.weather.high}°/${entry.weather.low}°`);
    }

    if (parts.length === 0) return null;

    return `EXIST.IO DATA:\n  ${parts.join('\n  ')}`;
  }
}

export const existExtractor = new ExistExtractor();
```

**Telegram integration for attribute prompts:**

```javascript
// When Exist imports mood attribute, Telegram bot can prompt for it
// if user hasn't logged today

// In TelegramBot message handler:
async function checkAttributePrompts(username) {
  const pendingAttributes = await attributeStore.getPendingForToday(username);

  for (const attr of pendingAttributes) {
    if (attr.source_preference === 'telegram' || attr.imported_from === 'exist') {
      await sendAttributePrompt(username, attr);
      // "How's your mood today? (1-10)"
    }
  }
}
```

---

## Implementation Phases

| Phase | Focus | Deliverables |
|-------|-------|--------------|
| **1. OAuth & Client** | ExistClient with token refresh | OAuth flow, API client, token storage |
| **2. Gap-fill import** | Averages → life/log | ExistAdapter (averages only), ExistExtractor, gap-fill router |
| **3. Attribute sync** | Attributes → life/core | AttributeMapper, attribute sync, Telegram prompts |
| **4. Correlation import** | Correlations → life/plan | CorrelationMapper, seed belief creation |
| **5. Scheduling** | Automated sync | Cron job, sync service, conflict resolution |
| **6. UI** | Settings & review | Exist connection UI, seed belief review screen |

**Phase 1 checklist:**

```
□ Register DaylightStation as Exist.io OAuth app
□ Create ExistClient.mjs with OAuth2 flow
□ Create OAuth callback route /api/v1/auth/exist/callback
□ Store tokens in auth.yml
□ Add exist config to secrets.yml.example
□ Test token refresh flow
```

**Phase 2 checklist:**

```
□ Create IMultiTargetAdapter interface
□ Create ExistAdapter.mjs (harvestAll method)
□ Create ExistGapFillRouter.mjs
□ Create ExistExtractor.mjs for LifelogAggregator
□ Register existExtractor in extractors/index.mjs
□ Test gap-fill import for Oura/RescueTime data
```

**Phase 3 checklist:**

```
□ Create ExistAttributeMapper.mjs
□ Extend AttributeStore for exist imports
□ Handle conflict resolution (manual vs import)
□ Add Telegram prompts for imported attributes
□ Test mood/energy sync
```

**Phase 4 checklist:**

```
□ Create ExistCorrelationMapper.mjs
□ Add seedBelief method to BeliefStore
□ Create correlation review UI
□ Test correlation → belief flow
□ Ensure promoted beliefs aren't overwritten
```

**Phase 5 checklist:**

```
□ Create ExistSyncService.mjs
□ Register sync job in TaskRegistry
□ Add user config schema for exist sync
□ Test scheduled sync
□ Test conflict resolution
```

**Phase 6 checklist:**

```
□ Create Exist connection UI (OAuth initiation)
□ Create seed belief review screen
□ Create sync status/history view
□ Add exist settings to LifeApp settings
```

---

## Dependencies

| Dependency | Purpose |
|------------|---------|
| Unified Life Domain | Target for all three data streams |
| OAuth infrastructure | Token storage and refresh |
| LifelogAggregator | ExistExtractor registration |
| AttributeStore | Core attribute system (from life/core) |
| BeliefStore | Seed belief creation (from life/plan) |
| TaskRegistry | Scheduled sync jobs |
| Telegram adapter | Attribute prompt delivery |

**Prerequisite:** The Unified Life Domain design should be implemented first (at least Phase 1-2) before starting on the Exist adapter.
