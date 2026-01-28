# Media Progress Phase 2 Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create implementation plan from this design.

**Goal:** Rename WatchStore → MediaProgressMemory, remove legacy file-based history loading from all adapters, and add domain service for watch status classification.

**Problem:** Current naming is confusing ("WatchStore" sounds like e-commerce), legacy `historyPath` code paths remain in adapters, and watch/unwatched/in-progress logic is scattered across the codebase.

---

## Design Decisions

| Decision | Choice |
|----------|--------|
| Naming | `MediaProgressMemory` (matches `media_memory/` directory) |
| Legacy removal | Remove all `historyPath`, `_loadHistoryFromFiles()`, `setHistoryLoader()` |
| Classification logic | Domain service with interface for overrides |
| Override pattern | `IMediaProgressClassifier` interface + `DefaultMediaProgressClassifier` |

---

## Rename Mapping

| Current | New |
|---------|-----|
| `YamlWatchStateDatastore.mjs` | `YamlMediaProgressMemory.mjs` |
| `IWatchStateDatastore.mjs` | `IMediaProgressMemory.mjs` |
| `WatchState.mjs` | `MediaProgress.mjs` |
| `watchStore` (variable) | `mediaProgressMemory` |
| `watchStatePath` (variable) | `mediaProgressPath` |
| `createWatchStore()` | `createMediaProgressMemory()` |

---

## File Structure After

```
backend/src/
├── 1_domains/content/
│   ├── entities/
│   │   └── MediaProgress.mjs              # renamed from WatchState.mjs
│   └── services/
│       ├── IMediaProgressClassifier.mjs   # new interface
│       └── DefaultMediaProgressClassifier.mjs  # new default impl
├── 2_adapters/persistence/yaml/
│   └── YamlMediaProgressMemory.mjs        # renamed from YamlWatchStateDatastore.mjs
├── 3_applications/content/ports/
│   └── IMediaProgressMemory.mjs           # renamed from IWatchStateDatastore.mjs
```

---

## Legacy Code Removal

### PlexAdapter - Remove:
- `historyPath` config option
- `_loadHistoryFromFiles()` method
- `_clearHistoryFromFiles()` method
- `_historyLoader` / `_historyClearer` properties
- `setHistoryLoader()` / `setHistoryClearer()` methods

### FilesystemAdapter - Remove:
- `historyPath` config option
- `_loadWatchState()` method

### LocalContentAdapter - Remove:
- `historyPath` config option
- `_loadWatchState()` method

### FolderAdapter - Remove:
- `historyPath` config option
- `_loadWatchState()` method
- `_loadPlexWatchState()` method

### bootstrap.mjs - Remove:
- `mediaMemoryPath` from config (no longer needed)
- Only pass `mediaProgressMemory` to adapters

---

## Domain Service: MediaProgressClassifier

### Interface (Domain Layer)

```javascript
// backend/src/1_domains/content/services/IMediaProgressClassifier.mjs
export class IMediaProgressClassifier {
  /**
   * Classify media progress status
   * @param {MediaProgress} progress - The progress record
   * @param {Object} contentMeta - Content metadata (duration, type, etc.)
   * @returns {'unwatched' | 'in_progress' | 'watched'}
   */
  classify(progress, contentMeta) {
    throw new Error('Not implemented');
  }
}
```

### Default Implementation (Domain Layer)

```javascript
// backend/src/1_domains/content/services/DefaultMediaProgressClassifier.mjs
export class DefaultMediaProgressClassifier extends IMediaProgressClassifier {
  constructor(config = {}) {
    super();
    this.config = {
      watchedPercentThreshold: 90,      // Consider watched if >= 90%
      minWatchTimeSeconds: 60,          // Must watch at least 60s to count
      shortformDurationSeconds: 900,    // < 15min = shortform
      shortformPercentThreshold: 95,    // Shortform needs higher %
      remainingSecondsThreshold: 120,   // < 2min remaining = watched
      ...config
    };
  }

  classify(progress, contentMeta = {}) {
    const { playhead, duration, percent, watchTime } = progress;
    const { watchedPercentThreshold, minWatchTimeSeconds,
            shortformDurationSeconds, shortformPercentThreshold,
            remainingSecondsThreshold } = this.config;

    // No progress = unwatched
    if (!playhead || playhead === 0) {
      return 'unwatched';
    }

    // Insufficient actual watch time (anti-seeking protection)
    if (watchTime < minWatchTimeSeconds) {
      return 'in_progress';
    }

    // Check if shortform content (stricter threshold)
    const isShortform = duration && duration < shortformDurationSeconds;
    const percentThreshold = isShortform ? shortformPercentThreshold : watchedPercentThreshold;

    // Check remaining time
    const remaining = duration ? duration - playhead : Infinity;

    // Watched conditions:
    // 1. Percent threshold met AND minimum watch time met
    // 2. OR less than threshold seconds remaining
    if (percent >= percentThreshold || remaining < remainingSecondsThreshold) {
      return 'watched';
    }

    return 'in_progress';
  }
}
```

### Override Example (Application Layer)

```javascript
// Fitness app might want stricter rules
export class FitnessProgressClassifier extends IMediaProgressClassifier {
  classify(progress, contentMeta) {
    // Workouts must be 95% complete and watched for real
    if (progress.percent >= 95 && progress.watchTime >= progress.duration * 0.8) {
      return 'watched';
    }
    return progress.playhead > 0 ? 'in_progress' : 'unwatched';
  }
}
```

---

## Wiring (Bootstrap)

```javascript
// bootstrap.mjs
import { DefaultMediaProgressClassifier } from '#domains/content/services/DefaultMediaProgressClassifier.mjs';

export function createMediaProgressMemory(config) {
  return new YamlMediaProgressMemory({ basePath: config.mediaProgressPath });
}

export function createContentRegistry(config, deps = {}) {
  const { httpClient, mediaProgressMemory, classifier } = deps;

  // Use default classifier if none provided
  const progressClassifier = classifier || new DefaultMediaProgressClassifier();

  // Pass to adapters
  registry.register(new PlexAdapter({
    host: config.plex.host,
    token: config.plex.token,
    mediaProgressMemory,
    classifier: progressClassifier
  }, { httpClient }));
}
```

---

## Migration Notes

- No data migration needed (file format unchanged, just renamed)
- Update all imports after file renames
- Search/replace variable names
- Run tests to catch any missed references
