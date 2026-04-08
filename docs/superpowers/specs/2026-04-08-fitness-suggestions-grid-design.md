# Fitness Suggestions Grid — Design Spec

## Overview

Replace the current right panel of the fitness home screen (weight, upnext, nutrition, coach widgets) with a unified suggestions grid. The grid always fills two rows of cards, each suggesting content to play next. Five suggestion categories fill the grid in priority order, with discovery cards expanding to absorb remaining slots.

## Suggestion Categories

### 1. Next Up (type: `next_up`)

- **Source:** Recent sessions (configurable lookback, default 10 days) → extract distinct shows → resolve next unwatched episode per show via `FitnessPlayableService.getPlayableEpisodes()`
- **Max:** 4 (hard cap, configurable as `next_up_max`)
- **Sort:** Most recently done program first
- **Action:** `play` — clicking starts the fitness player immediately
- **Display:** Episode thumbnail (landscape), show title, episode title, duration, "X days ago"
- **Next episode logic:** First episode in show order where `isWatched === false`. If all episodes are watched, the show is excluded (completed program).

### 2. Resume (type: `resume`)

- **Source:** Episodes with partial playhead (`isInProgress()`) on shows labeled `Resumable` in Plex
- **Max:** No hard cap (naturally limited by what exists)
- **Action:** `play` — clicking starts the fitness player at the saved position
- **Display:** Episode thumbnail, show title, episode title, progress bar with percentage and remaining time
- **Constraint:** Only include if the show has been done within the lookback window (same as next_up) to avoid surfacing stale partial watches

### 3. Favorites (type: `favorite`)

- **Source:** Show IDs listed in `fitness.yml` under `suggestions.favorites`
- **Max:** Number of configured favorites
- **Action:** `browse` — clicking navigates to the show's episode browser (FitnessShow)
- **Display:** Show poster (portrait orientation), show title, "Browse episodes →"
- **Dedup:** If a favorite show already has a `next_up` or `resume` card, the favorite card is skipped

### 4. Memorable (type: `memorable`)

- **Source:** Sessions within a configurable lookback (default 90 days), ranked by a pluggable metric
- **Initial metric:** Highest Strava suffer score
- **Max:** 2 (configurable as `memorable_max`)
- **Action:** `play` — clicking starts the fitness player
- **Display:** Episode thumbnail, show title, episode title, metric badge (e.g., "Suffer: 180 — Mar 12")
- **Extensibility:** Ranking is abstracted as a strategy interface. Future rankers can use max HR, average HR, duration, voice memo sentiment, etc. The orchestrator can later rotate or randomize which ranker is used.

### 5. Discovery (type: `discovery`)

- **Source:** Weighted random selection from the full fitness library
  - 70% weight (configurable): shows done before but not within `discovery_lapsed_days` (default 30 days)
  - 30% weight: true random from shows never done or done long ago
- **Max:** Fills all remaining grid slots after other categories
- **Action:** `play` — resolves a specific episode (first unwatched, or random if all watched)
- **Display:** Episode thumbnail, show title, episode title, "Last done X days ago" or "New to you"
- **Dedup:** No show already represented by another card type

## API Contract

### `GET /api/v1/fitness/suggestions?gridSize=8`

Query parameter `gridSize` tells the backend how many total cards to return (default from config: 8, representing 2 rows of 4).

Response:

```json
{
  "suggestions": [
    {
      "type": "next_up",
      "action": "play",
      "contentId": "plex:674227",
      "showId": "plex:12345",
      "title": "Episode 8: Total Body",
      "showTitle": "Dig Deeper 30",
      "thumbnail": "/api/v1/display/plex/674227",
      "poster": "/api/v1/display/plex/12345",
      "durationMinutes": 30,
      "orientation": "landscape",
      "lastSessionDate": "2026-04-06"
    },
    {
      "type": "resume",
      "action": "play",
      "contentId": "plex:674300",
      "showId": "plex:12346",
      "title": "Ep 14: Mario Kart DLC",
      "showTitle": "Video Game Cycling",
      "thumbnail": "/api/v1/display/plex/674300",
      "poster": "/api/v1/display/plex/12346",
      "durationMinutes": 90,
      "orientation": "portrait",
      "lastSessionDate": "2026-04-05",
      "progress": { "percent": 55, "remaining": "47:32" }
    },
    {
      "type": "favorite",
      "action": "browse",
      "contentId": "plex:12346",
      "showId": "plex:12346",
      "title": "Video Game Cycling",
      "showTitle": "Video Game Cycling",
      "thumbnail": "/api/v1/display/plex/12346",
      "poster": "/api/v1/display/plex/12346",
      "orientation": "portrait"
    },
    {
      "type": "memorable",
      "action": "play",
      "contentId": "plex:674400",
      "showId": "plex:12350",
      "title": "Ep 3: Sweat Fest",
      "showTitle": "Insanity Max",
      "thumbnail": "/api/v1/display/plex/674400",
      "poster": "/api/v1/display/plex/12350",
      "durationMinutes": 40,
      "orientation": "landscape",
      "metric": { "label": "Suffer Score", "value": 180 },
      "reason": "Highest suffer score — Mar 12"
    },
    {
      "type": "discovery",
      "action": "play",
      "contentId": "plex:674500",
      "showId": "plex:12360",
      "title": "Ep 1: Chest & Tris",
      "showTitle": "Body Beast",
      "thumbnail": "/api/v1/display/plex/674500",
      "poster": "/api/v1/display/plex/12360",
      "durationMinutes": 35,
      "orientation": "landscape",
      "reason": "Last done 45 days ago"
    }
  ]
}
```

## Backend Architecture

### Layer Placement

- **Application layer** (`backend/src/3_applications/fitness/`): `FitnessSuggestionService` — the orchestrator
- **Application layer** (`backend/src/3_applications/fitness/suggestions/`): Individual strategy classes
- **API layer** (`backend/src/4_api/v1/routers/fitness.mjs`): New route handler for `GET /suggestions`

### FitnessSuggestionService (Orchestrator)

Responsibilities:
1. Accept `gridSize` and `householdId`
2. Build a shared context object (recent sessions, fitness config, content adapter references)
3. Run strategies in priority order, passing remaining slot count to each
4. Deduplicate by show ID across all results (earlier strategy wins)
5. Return the unified sorted array

### Strategy Interface

Each strategy implements:

```javascript
class SuggestionStrategy {
  /** @returns {Promise<Suggestion[]>} */
  async suggest(context, remainingSlots) { }
}
```

The `context` object contains:
- `recentSessions` — sessions within `lookback_days`, with media metadata
- `fitnessConfig` — full fitness.yml config
- `householdId`
- `contentAdapter` — for resolving episodes and watch state
- `contentQueryService` — for watch state enrichment
- `fitnessPlayableService` — for episode resolution
- `sessionDatastore` — for historical session queries (memorable)

### Grid Fill Algorithm

```
slots = gridSize (e.g., 8)
results = []

1. NextUpStrategy    → append up to min(4, slots - len(results))
2. ResumeStrategy    → append up to min(available, slots - len(results))
3. FavoriteStrategy  → append up to min(configured, slots - len(results))
   - skip any show already in results
4. MemorableStrategy → append up to min(2, slots - len(results))
   - skip any episode already in results
5. DiscoveryStrategy → append up to (slots - len(results))
   - skip any show already in results

return results
```

### Dependencies

Existing services reused (no new adapters needed):
- `FitnessPlayableService` — episode resolution + watch state
- `SessionService` / `YamlSessionDatastore` — session history queries
- `ContentQueryService` — watch state enrichment
- `FitnessConfigService` — config access

## Config Additions

New `suggestions` block in `fitness.yml`:

```yaml
suggestions:
  grid_size: 8                  # total cards (2 rows × 4)
  lookback_days: 10             # recent program window
  next_up_max: 4                # hard cap on next-up cards
  memorable_lookback_days: 90   # window for memorable episodes
  memorable_max: 2              # max memorable cards
  discovery_lapsed_days: 30     # "haven't done in X days" threshold
  discovery_lapsed_weight: 0.7  # 70% lapsed, 30% true random
  favorites:
    - 12345                     # Video Game Cycling (Plex show ID)
```

## Frontend Changes

### Screen Config Update

Replace the current right-area layout in the fitness home screen config. The right area becomes a single `fitness:suggestions` widget that consumes data from a new `suggestions` data source.

Data source addition:
```yaml
data:
  suggestions:
    source: /api/v1/fitness/suggestions?gridSize=8
    refresh: 300
```

Layout change — right area becomes:
```yaml
- id: right-area
  basis: "66%"
  widget: "fitness:suggestions"
```

### FitnessSuggestionsWidget (new)

Replaces `FitnessUpNextWidget`. Registered as `fitness:suggestions` in the widget registry.

- Consumes `useScreenData('suggestions')`
- Renders a CSS Grid: `grid-template-columns: repeat(4, 1fr)` with 2 rows
- Each card is a `SuggestionCard` component that renders based on `type`:
  - Badge color/label varies by type (blue=next_up, amber=resume, gray=favorite, red=memorable, green=discovery)
  - Thumbnail area uses `orientation` field to set aspect ratio (landscape: 16:9, portrait: 2:3)
  - Progress bar shown for `resume` type
  - Metric badge shown for `memorable` type
  - "Browse episodes →" for `favorite` type
- Click handler:
  - `action: "play"` → calls `onPlay()` from `useFitnessScreen()` with episode details
  - `action: "browse"` → calls `onNavigate()` to open the show's episode browser
- Loading state: skeleton grid (8 skeleton cards matching the grid layout)

### Widgets Removed from Right Panel

- `fitness:weight` — removed from home screen layout (still registered, usable elsewhere)
- `fitness:nutrition` — removed from home screen layout
- `fitness:coach` — removed from home screen layout
- `fitness:upnext` — replaced by `fitness:suggestions`

### Portrait vs Landscape Thumbnails

Cards with `orientation: "portrait"` display the show poster in a taller aspect ratio (2:3). Cards with `orientation: "landscape"` display the episode thumbnail in a wider aspect ratio (~16:9). The grid handles mixed orientations — portrait cards are the same grid cell width but the image area is taller.

**How orientation is determined:** `favorite` cards always use `portrait` (they show the program poster). All other types default to `landscape` (episode thumbnail). The backend sets this field based on card type — no Plex metadata inspection needed.

## Edge Cases

- **No recent sessions:** NextUp and Resume produce nothing. Favorites still show. Memorable draws from full lookback. Discovery fills remaining slots. Grid is always full.
- **All episodes watched in a program:** That program is excluded from NextUp. May appear in Discovery if it hasn't been done recently.
- **Favorite show also has a next_up episode:** The next_up card wins; the favorite card is suppressed to avoid duplication.
- **Fewer than gridSize suggestions available across all strategies:** Discovery should always be able to fill from the full library. If the library itself has fewer shows than grid slots, allow duplicate shows with different episodes.
- **Strava data missing for memorable:** Sessions without suffer scores are skipped by the suffer score ranker. If no sessions have scores, memorable produces no cards and discovery fills those slots.
