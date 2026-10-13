# Scroll Config (`scroll.yml`) Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Define a per-user YAML config that controls the feed assembly algorithm — interleaving, spacing, and distribution of content in the boonscrolling feed.

**Architecture:** `scroll.yml` lives at the user level (`data/users/{username}/config/scroll.yml`) and controls *how* feed items are mixed. It does NOT define *what* sources exist — that's handled by household-level query YAMLs (`data/household/config/lists/queries/*.yml`). FeedAssemblyService reads scroll.yml at request time and applies its rules during interleaving.

---

## Separation of Concerns

| File | Level | Purpose |
|------|-------|---------|
| `queries/*.yml` | Household | Adapter wiring — which sources to fetch, connection params (subreddits, API keys, parentIds), fetch limits |
| `scroll.yml` | User | Feed recipe — algorithm params, spacing rules, per-source distribution caps |

Query YAMLs answer: *"What data can we pull?"*
scroll.yml answers: *"How should my feed look?"*

---

## Config Structure

```yaml
# data/users/{username}/config/scroll.yml

batch_size: 15

# Default feed algorithm — controls grounding/external interleaving
algorithm:
  grounding_ratio: 5        # 1 grounding card per N external cards
  decay_rate: 0.85           # ratio decays as session lengthens (0-1)
  min_ratio: 2               # floor — never fewer than 1-in-N

# Focus mode — overrides when user drills into a single source/subsource
focus_mode:
  grounding_ratio: 8         # more breathing room when deep-diving
  decay_rate: 0.9
  min_ratio: 3

# Global spacing rules
spacing:
  max_consecutive: 1         # no two cards from same source back-to-back

# Per-source distribution rules
# Source names map to query YAML filenames (without .yml)
# Omitting a source = disabled for this user
sources:
  headlines:
    max_per_batch: 8
    subsources:
      max_per_batch: 3       # no single news outlet more than 3
      min_spacing: 3
  news:
    max_per_batch: 4
  reddit:
    max_per_batch: 5
    min_spacing: 2
    subsources:
      max_per_batch: 2       # no single subreddit more than 2
      min_spacing: 4
  entropy:
    max_per_batch: 3
  health:
    max_per_batch: 1
  weather:
    max_per_batch: 1
  gratitude:
    max_per_batch: 1
  fitness:
    max_per_batch: 1
  tasks:
    max_per_batch: 3
  photos:
    max_per_batch: 2
    min_spacing: 5
  plex:
    max_per_batch: 2
    min_spacing: 4
  plex-music:
    max_per_batch: 1
```

---

## Field Reference

### Top-level

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `batch_size` | int | 15 | Number of cards returned per API call |

### `algorithm`

Controls interleaving of external (news, reddit, RSS) and grounding (health, weather, tasks) content.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `grounding_ratio` | int | 5 | Insert 1 grounding card every N external cards |
| `decay_rate` | float | 0.85 | Multiplier applied per 5-minute session interval. Lower = grounding appears more frequently over time |
| `min_ratio` | int | 2 | Floor for decay — ratio never drops below this |

**Formula:** `ratio = max(min_ratio, floor(grounding_ratio * decay_rate ^ (session_minutes / 5)))`

As session lengthens, grounding content appears more frequently — nudging the user toward real-world data the longer they scroll.

### `focus_mode`

Same fields as `algorithm`. Applied when the user drills into a single source or subsource (e.g., viewing only r/science). External content is filtered to the focused source; grounding content continues per these rules.

Activated via API: `GET /api/v1/feed/scroll?focus=reddit:science`

### `spacing`

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_consecutive` | int | 1 | Max cards from the same source in a row. `1` = no back-to-back from same source |

### `sources.{name}`

Each key maps to a query YAML filename (without `.yml`). Sources not listed are disabled for this user.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_per_batch` | int | unlimited | Hard cap on cards from this source per batch |
| `min_spacing` | int | 0 | Minimum cards between two cards from this source |
| `subsources` | object | — | Same rules applied per subsource identity |

### `sources.{name}.subsources`

Applied per subsource — individual subreddit, news outlet, RSS feed title, etc.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `max_per_batch` | int | unlimited | Hard cap per individual subsource per batch |
| `min_spacing` | int | 0 | Minimum cards between two cards from same subsource |

**Subsource identity** is derived from existing item metadata:

| Source | Subsource key |
|--------|--------------|
| reddit | subreddit name (`item.meta.subreddit`) |
| headlines | source ID (`item.meta.sourceId`) |
| news (freshrss) | feed title (`item.meta.feedTitle`) |
| plex | search category or library |

---

## Algorithm Behavior

### 1. Fetch Phase
FeedAssemblyService loads all query YAMLs for sources listed in scroll.yml. Sources omitted from scroll.yml are skipped entirely (not fetched).

### 2. Classification
Items are split into **external** (sorted by timestamp desc) and **grounding** (sorted by priority desc), per `feed_type` in the query YAML.

### 3. Interleaving
External and grounding items are interleaved using the grounding ratio. Every N external cards, 1 grounding card is inserted.

### 4. Spacing Enforcement
After interleaving, a spacing pass enforces:
1. `spacing.max_consecutive` — swap or defer cards that violate the global consecutive rule
2. `sources.{name}.max_per_batch` — drop excess cards beyond the source cap
3. `sources.{name}.min_spacing` — reposition cards that are too close to another from the same source
4. `sources.{name}.subsources.*` — same rules at the subsource level

### 5. Focus Mode
When `focus` query param is present:
- External content filtered to matching source (and optionally subsource)
- `focus_mode` algorithm params replace default `algorithm` params
- Grounding content and its spacing rules remain unchanged

---

## Defaults

If no `scroll.yml` exists for a user, FeedAssemblyService uses hardcoded defaults equivalent to:

```yaml
batch_size: 15
algorithm:
  grounding_ratio: 5
  decay_rate: 0.85
  min_ratio: 2
spacing:
  max_consecutive: 1
sources: {}   # all household sources enabled, no per-source caps
```

---

## Data Flow

```
User opens feed
    │
    ▼
GET /api/v1/feed/scroll?session=...&focus=reddit:science
    │
    ▼
FeedAssemblyService.getNextBatch(username, options)
    │
    ├── Load scroll.yml from user config (or use defaults)
    ├── Filter query configs to sources listed in scroll.yml
    ├── Fan out to adapters in parallel
    ├── Classify: external vs grounding
    ├── Select algorithm params (focus_mode if focus param present)
    ├── Interleave with grounding ratio
    ├── Enforce spacing rules
    └── Return batch
```
