# Lifelog and Entropy Domain Design

## Overview

This document describes the refactoring of lifelog extractors into a proper `lifelog` domain and the creation of a new `entropy` domain for data freshness monitoring.

## Problem Statement

The lifelog extractors were placed in `journalist/extractors/` during Phase 10 migration, but this conflates concerns:

- **WeightExtractor**, **GarminExtractor**, etc. are about lifelog data, not journalist functionality
- Multiple consumers need lifelog data (health, fitness, journalist, entropy)
- The "journalist" domain should focus on AI chatbot concerns, not data extraction

## Data Architecture

Using a bronze/silver/gold data lakehouse pattern:

| Layer | Description | Example |
|-------|-------------|---------|
| **Bronze** | Raw harvested data in YAML files | `weight.yml`, `strava.yml`, `garmin.yml` |
| **Silver** | Aggregated/cleaned data by consumer domains | `health.yml` (merged health metrics) |
| **Gold** | Computed derivatives, final outputs | Journal entries, health trends |

**Data flow:**
```
Harvesters → Bronze (YAML files) → Lifelog extractors → Consumer domains → Silver/Gold
```

## Domain Structure

### Lifelog Domain

Foundational time-series personal data layer. "Lifelog" implies entries in time, useful for domains that process time-series data.

```
backend/src/1_domains/lifelog/
├── extractors/
│   ├── ILifelogExtractor.mjs     # Port interface with ExtractorCategory enum
│   ├── WeightExtractor.mjs       # Health: weight metrics
│   ├── GarminExtractor.mjs       # Health: Garmin data
│   ├── NutritionExtractor.mjs    # Health: nutrition data
│   ├── StravaExtractor.mjs       # Fitness: Strava activities
│   ├── FitnessExtractor.mjs      # Fitness: FitnessSyncer data
│   ├── CalendarExtractor.mjs     # Productivity: calendar events
│   ├── GithubExtractor.mjs       # Productivity: GitHub commits
│   ├── TodoistExtractor.mjs      # Productivity: Todoist tasks
│   ├── ClickupExtractor.mjs      # Productivity: ClickUp tasks
│   ├── GmailExtractor.mjs        # Productivity: email activity
│   ├── RedditExtractor.mjs       # Social: Reddit activity
│   ├── LastfmExtractor.mjs       # Social: Last.fm scrobbles
│   ├── CheckinsExtractor.mjs     # Social: Foursquare check-ins
│   ├── ShoppingExtractor.mjs     # Finance: shopping/purchases
│   ├── JournalistExtractor.mjs   # Journal: user journal entries
│   └── index.mjs                 # Registry with priority-ordered extractors
├── services/
│   └── LifelogAggregator.mjs     # Orchestrates extraction across sources
└── index.mjs
```

**Consumers:**
- **Health domain** - Reads bronze data for health metrics aggregation
- **Fitness domain** - Reads bronze data for workout analysis
- **Journalist domain** - Uses LifelogAggregator to build AI prompts
- **Entropy domain** - Reads timestamps for freshness monitoring

### Entropy Domain

Data freshness monitoring - "How stale is each data source?"

Entropy metaphor: high entropy = disorder/staleness, low entropy = fresh/ordered.

```
backend/src/1_domains/entropy/
├── entities/
│   └── EntropyItem.mjs
├── services/
│   └── EntropyService.mjs
├── ports/
│   └── IEntropyReader.mjs
└── index.mjs

backend/src/2_adapters/entropy/
└── YamlEntropyReader.mjs

backend/src/4_api/routers/entropy.mjs
```

## Entropy Domain Design

### EntropyItem Entity

```javascript
class EntropyItem {
  static MetricType = {
    DAYS_SINCE: 'days_since',
    COUNT: 'count'
  };

  static Direction = {
    LOWER_IS_BETTER: 'lower_is_better',  // default
    HIGHER_IS_BETTER: 'higher_is_better'
  };

  constructor({
    source, name, icon,
    metricType, value,
    thresholds, direction,
    lastUpdate, url
  }) {
    this.source = source;
    this.name = name;
    this.icon = icon;
    this.metricType = metricType;
    this.value = value;
    this.lastUpdate = lastUpdate;
    this.url = url;
    this.status = this.#calculateStatus(value, thresholds, direction);
    this.label = this.#formatLabel(metricType, value);
  }

  #calculateStatus(value, { green, yellow }, direction) {
    const lowerIsBetter = direction !== 'higher_is_better';

    if (lowerIsBetter) {
      if (value <= green) return 'green';
      if (value <= yellow) return 'yellow';
      return 'red';
    } else {
      if (value >= green) return 'green';
      if (value >= yellow) return 'yellow';
      return 'red';
    }
  }

  #formatLabel(metricType, value) {
    if (metricType === 'days_since') {
      return value === 0 ? 'Today' : `${value} day${value === 1 ? '' : 's'} ago`;
    }
    return `${value}`;
  }
}
```

### Metric Types and Threshold Direction

**days_since** - Time since last entry (most common)
```yaml
strava:
  metric: days_since
  thresholds: { green: 2, yellow: 7 }
```

**count** - Current count (inbox, tasks)
```yaml
gmail:
  metric: count
  countField: unreadCount
  thresholds: { green: 5, yellow: 20 }
```

**higher_is_better** - Inverse threshold (days since accident)
```yaml
safety:
  metric: days_since
  direction: higher_is_better
  thresholds: { green: 30, yellow: 7 }
```

### EntropyService

```javascript
class EntropyService {
  #entropyReader;
  #configService;
  #logger;

  constructor({ entropyReader, configService, logger }) { ... }

  async getReport(username) {
    const config = this.#configService.getAppConfig('entropy');
    if (!config?.sources) {
      return { items: [], summary: { green: 0, yellow: 0, red: 0 } };
    }

    const items = await Promise.all(
      Object.entries(config.sources).map(([sourceId, sourceConfig]) =>
        this.#evaluateSource(username, sourceId, sourceConfig)
      )
    );

    const summary = items.reduce(
      (acc, item) => { acc[item.status]++; return acc; },
      { green: 0, yellow: 0, red: 0 }
    );

    return { items, summary };
  }
}
```

### IEntropyReader Port

```javascript
class IEntropyReader {
  async getLastUpdated(username, dataPath, options) {
    throw new Error('Not implemented');
  }

  async getCount(username, dataPath, options) {
    throw new Error('Not implemented');
  }
}
```

### YamlEntropyReader Adapter

Lightweight reader that:
- Uses ArchiveService fast path where available
- Handles date-keyed objects (`{ '2025-01-01': {...} }`)
- Handles arrays with date fields
- Handles nested list properties (`{ messages: [...] }`)
- Supports filtering (`{ field: 'action', operator: 'eq', value: 'completed' }`)

## Migration Plan

### Files to Create

```
backend/src/1_domains/lifelog/
├── extractors/           # Move all 16 files from journalist/extractors/
├── services/
│   └── LifelogAggregator.mjs   # Move from 2_adapters/journalist/
└── index.mjs

backend/src/1_domains/entropy/
├── entities/
│   └── EntropyItem.mjs
├── services/
│   └── EntropyService.mjs
├── ports/
│   └── IEntropyReader.mjs
└── index.mjs

backend/src/2_adapters/entropy/
└── YamlEntropyReader.mjs

backend/src/4_api/routers/entropy.mjs
```

### Files to Delete

```
backend/src/1_domains/journalist/extractors/   # Entire directory
backend/src/2_adapters/journalist/LifelogAggregator.mjs
```

### Files to Update

```
backend/src/1_domains/journalist/index.mjs     # Remove extractors export
backend/src/0_infrastructure/bootstrap.mjs     # Add entropy bootstrap functions
backend/_legacy/routers/home.mjs               # Update entropy endpoint to use new service
```

### Import Updates

Any file importing from `journalist/extractors/` or `LifelogAggregator`:

```javascript
// Before
import { extractors } from '../journalist/extractors/index.mjs';
import { LifelogAggregator } from '../../2_adapters/journalist/LifelogAggregator.mjs';

// After
import { extractors, LifelogAggregator } from '../lifelog/index.mjs';
```

## API Endpoints

### Entropy Router

```
GET /entropy              # Full entropy report
GET /entropy/source/:id   # Single source entropy
```

Response format:
```json
{
  "items": [
    {
      "source": "strava",
      "name": "Strava",
      "icon": "strava.svg",
      "status": "green",
      "value": 1,
      "label": "1 day ago",
      "lastUpdate": "2026-01-11",
      "url": "https://strava.com/..."
    }
  ],
  "summary": { "green": 8, "yellow": 3, "red": 1 }
}
```

## Bootstrap Integration

```javascript
// In bootstrap.mjs

export function createEntropyServices(config) {
  const { userDataService, archiveService, configService, logger } = config;

  const entropyReader = new YamlEntropyReader({
    userDataService, archiveService, logger
  });

  const entropyService = new EntropyService({
    entropyReader, configService, logger
  });

  return { entropyReader, entropyService };
}

export function createEntropyApiRouter(config) {
  const { entropyServices, configService, logger } = config;
  return createEntropyRouter({
    entropyService: entropyServices.entropyService,
    configService,
    logger
  });
}
```

## Related Code

- Legacy entropy: `backend/_legacy/lib/entropy.mjs`
- Frontend widget: `frontend/src/modules/Entropy/EntropyPanel.jsx`
- Health domain: `backend/src/1_domains/health/`
- Journalist domain: `backend/src/1_domains/journalist/`
