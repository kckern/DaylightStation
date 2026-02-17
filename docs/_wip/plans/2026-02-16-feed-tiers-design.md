# Feed Tier System Design

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the two-tier feed assembly model (external/grounding) with a four-tier system that properly categorizes content by consumption pattern.

**Architecture:** Each tier has its own selection strategy (filter → sort → pick) and fixed batch allocation. Tiers are interleaved with spacing enforcement. The current `FeedAssemblyService` delegates to a new `TierAssemblyService` that handles per-tier selection and cross-tier interleaving.

**Tech Stack:** Node.js/ESM, YAML config, existing adapter pattern

---

## Tier Definitions

| Tier | Code Key | Content | Sort | Selection |
|------|----------|---------|------|-----------|
| **Wire** | `wire` | reddit, RSS, headlines, youtube, google news | timestamp desc | Recency-driven, source diversity |
| **Library** | `library` | komga, educational plex | random | Unread/unconsumed, no timestamp bias |
| **Scrapbook** | `scrapbook` | photos, journal | random | Anniversary-weighted, recently-shown filter |
| **Compass** | `compass` | health, weather, tasks, entropy, fitness, gratitude | priority | Staleness filter, freshness-preferred |

## Source-to-Tier Mapping

| Source | Current `feed_type` | New Tier |
|--------|-------------------|----------|
| reddit | external | wire |
| news (RSS) | external | wire |
| headlines | external | wire |
| youtube | external | wire |
| googlenews | external | wire |
| komga | external | library |
| plex (educational) | grounding | library |
| photos | grounding | scrapbook |
| journal | grounding | scrapbook |
| health | grounding | compass |
| weather | grounding | compass |
| tasks | grounding | compass |
| entropy | grounding | compass |
| fitness | grounding | compass |
| gratitude | grounding | compass |
| plex-music | grounding | compass |

## Config Structure (feed.yml)

```yaml
scroll:
  batch_size: 50

  tiers:
    wire:
      selection:
        sort: timestamp_desc
        filter: [read_status]
        diversity: source
      sources:
        reddit:
          max_per_batch: 5
          min_spacing: 2
          subsources:
            max_per_batch: 2
            min_spacing: 4
        headlines:
          max_per_batch: 8
        youtube:
          max_per_batch: 5
          min_spacing: 3
        googlenews:
          max_per_batch: 8
          min_spacing: 2
        news:
          max_per_batch: 4

    library:
      allocation: 2
      selection:
        sort: random
        filter: [read_status]
        freshness: false
      sources:
        komga:
          max_per_batch: 1
        plex:
          max_per_batch: 1
          min_spacing: 4

    scrapbook:
      allocation: 3
      selection:
        sort: random
        filter: [recently_shown]
        prefer: anniversary
      sources:
        photos:
          max_per_batch: 2
          min_spacing: 5
        journal:
          max_per_batch: 2
          min_spacing: 4

    compass:
      allocation: 8
      selection:
        sort: priority
        filter: [staleness]
        freshness: true
      sources:
        entropy:
          max_per_batch: 3
        tasks:
          max_per_batch: 3
        health:
          max_per_batch: 1
        weather:
          max_per_batch: 1
        fitness:
          max_per_batch: 1
        gratitude:
          max_per_batch: 1
        plex-music:
          max_per_batch: 1

  spacing:
    max_consecutive: 1
```

## Assembly Algorithm

### Level 1: Batch Distribution
1. Each non-wire tier gets its fixed `allocation` slots
2. Wire fills remaining slots (batch_size - sum of allocations)
3. Non-wire items interleaved into wire backbone with spacing enforcement

### Level 2: Within-Tier Selection
For each tier, given N available slots:
1. **Filter** — apply tier-specific filters (read_status, staleness, recently_shown)
2. **Sort** — apply tier sort strategy (timestamp_desc, random, priority)
3. **Pick** — fill slots respecting per-source `max_per_batch` caps
4. **Diversity** — enforce source diversity within tier (wire only)

### Interleaving
```
wire, wire, wire, compass, wire, wire, library, wire, wire, wire,
compass, wire, wire, scrapbook, wire, wire, compass, wire, wire, wire
```
Non-wire items spaced evenly across the batch. No two non-wire items adjacent.

## Query Config Changes

Each query YAML (`data/household/config/lists/queries/*.yml`) replaces `feed_type: external|grounding` with `tier: wire|library|scrapbook|compass`.

## Key Files

| File | Change |
|------|--------|
| `backend/src/3_applications/feed/services/TierAssemblyService.mjs` | NEW — tier selection + interleaving |
| `backend/src/3_applications/feed/services/FeedAssemblyService.mjs` | Delegates to TierAssemblyService |
| `backend/src/3_applications/feed/services/ScrollConfigLoader.mjs` | Reads new tier config structure |
| `data/users/*/config/feed.yml` | New tier-based config structure |
| `data/household/config/lists/queries/*.yml` | `feed_type` → `tier` |
| `backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs` | Adapter interface adds `tier` |
