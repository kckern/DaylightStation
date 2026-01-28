# Fitness Progress Classifier Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to create implementation plan from this design.

**Goal:** Create a fitness-specific media progress classifier that implements the Content domain's `IMediaProgressClassifier` interface, with backend as SSOT for "watched" status.

**Problem:** Currently, fitness watch thresholds are duplicated between frontend (`FitnessShow.jsx`) and have no backend equivalent. The frontend computes "watched" status locally, violating SSOT principles.

---

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| DDD approach | Fitness implements Content interface | Content is upstream, Fitness is downstream (customer-supplier) |
| Location | Domain service | Pure business rules, no external dependencies |
| Thresholds | Configurable with defaults | Tunable without code changes |
| Config source | Config file + hardcoded fallbacks | Flexible but safe |
| API response | Backend returns `isWatched` | Backend is SSOT |

---

## Architecture

```
Content Domain (upstream)              Fitness Domain (downstream)
┌─────────────────────────┐           ┌─────────────────────────────┐
│ IMediaProgressClassifier │◀──────────│ FitnessProgressClassifier   │
│ (interface)              │ implements│ (domain service)            │
├─────────────────────────┤           ├─────────────────────────────┤
│ classify(progress, meta) │           │ - shortThresholdPercent: 50 │
│ → 'unwatched'           │           │ - longThresholdPercent: 95  │
│ → 'in_progress'         │           │ - longDurationSeconds: 2700 │
│ → 'watched'             │           │ - minWatchTimeSeconds: 30   │
└─────────────────────────┘           └─────────────────────────────┘
```

**Data Flow:**
1. Fitness API loads config from `fitness/config.yml`
2. Creates `FitnessProgressClassifier` with config thresholds
3. When returning episodes, calls `classifier.classify(progress, {duration})`
4. Returns `isWatched: status === 'watched'` in API response
5. Frontend displays based on `isWatched` - no local computation

---

## Classification Logic

### Thresholds

| Content Type | Threshold | Rationale |
|--------------|-----------|-----------|
| Short (≤45 min) | 50% | Users often skip warmups/cooldowns but complete main workout |
| Long (>45 min) | 95% | Multi-session content (e.g., Mario Kart longplay, one cup per day) needs to preserve resume position |

### Anti-Seeking Protection

**Minimum 30 seconds of actual watchTime required.**

Prevents false "watched" status from:
- Accidental seeks
- Preview/browsing behavior
- Seeking to check a specific segment

Lower than standard (60s) because workout selection is intentional.

### Examples

```javascript
// 30-min workout, user at 85% (skipped cooldown)
classifier.classify({ playhead: 1530, percent: 85, watchTime: 1500 }, { duration: 1800 })
// => 'watched' (85% >= 50% short threshold)

// 2-hour longplay, user at 60% across multiple sessions
classifier.classify({ playhead: 4320, percent: 60, watchTime: 4000 }, { duration: 7200 })
// => 'in_progress' (60% < 95% long threshold, preserves resume position)

// User previewed workout by seeking, only 10s actual playback
classifier.classify({ playhead: 1620, percent: 90, watchTime: 10 }, { duration: 1800 })
// => 'in_progress' (watchTime 10s < 30s anti-seeking threshold)
```

---

## File Structure

```
backend/src/1_domains/fitness/
├── services/
│   └── FitnessProgressClassifier.mjs   # NEW
├── index.mjs                            # Add export
```

---

## Config Schema

**Location:** `data/households/{hid}/apps/fitness/config.yml`

```yaml
# Media progress classification thresholds
progressClassification:
  shortThresholdPercent: 50
  longThresholdPercent: 95
  longDurationSeconds: 2700  # 45 minutes
  minWatchTimeSeconds: 30
```

All values optional - hardcoded defaults used if not present.

---

## API Changes

**Endpoint:** `GET /api/v1/fitness/show/:id`

**Response addition:**

```javascript
{
  id: "plex:662039",
  title: "Week 1 Day 1: Lower Body",
  duration: 1800,

  // Existing progress fields (kept for resume functionality)
  watchProgress: 85,
  watchSeconds: 1530,
  watchedDate: "2026-01-28T...",

  // NEW: Backend-computed classification
  isWatched: true
}
```

---

## Frontend Changes

**File:** `frontend/src/modules/Fitness/FitnessShow.jsx`

```javascript
// BEFORE: Frontend computed threshold
const isEpisodeWatched = useCallback((episode) => {
  const watchProgress = normalizeNumber(episode?.watchProgress) ?? 0;
  const durationSeconds = normalizeNumber(episode?.duration) ?? 0;
  const threshold = durationSeconds > 45 * 60 ? 95 : 50;
  return watchProgress >= threshold;
}, []);

// AFTER: Trust backend
const isEpisodeWatched = useCallback((episode) => {
  return episode?.isWatched ?? false;
}, []);
```

---

## Implementation Notes

- Export `FitnessProgressClassifier` from `#domains/fitness`
- Classifier instantiated in fitness router with config
- Maintain backward compatibility: keep returning `watchProgress`, `watchSeconds` for resume functionality
- Frontend change is simplification only - no new behavior
