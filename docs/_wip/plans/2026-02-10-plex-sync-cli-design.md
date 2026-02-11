# Plex Sync CLI — Design Document

**Date:** 2026-02-10
**Status:** Draft

## Overview

A CLI tool (`cli/plex-sync.cli.mjs`) that provides bi-directional metadata synchronization between a Plex Media Server and local YML files stored alongside media on the filesystem. Primary use case: persist Plex labels, collections, and metadata locally so content can be fully restored if a library is rebuilt.

Also includes a one-time `migrate` command to convert ~3,200 existing `nfo.json` files to YML.

### YML Filenames by Type

| Plex library type | YML filename | Determined by |
|---|---|---|
| `show` | `show.yml` | Plex library type (pull), has `seasons[]` (migrate) |
| `movie` | `movie.yml` | Plex library type (pull), no seasons/no music fields (migrate) |
| `artist` | `artist.yml` | Plex library type (pull), music-specific fields (migrate) |

## Commands

```
plex-sync migrate [--dir <path>] [--dry-run]
plex-sync pull --library <id> [--filter <regex>] [--force] [--dry-run]
plex-sync push --library <id> [--filter <regex>] [--force] [--dry-run]
```

### Safety: `--force` flag

Without `--force`, both `pull` and `push` only write to **blank/empty** fields. Populated data is never overwritten.

| Command | No flag | `--force` |
|---------|---------|-----------|
| `pull`  | Only fill blank fields in {type}.yml | Plex wins — overwrite {type}.yml |
| `push`  | Only fill blank fields in Plex | YML wins — overwrite Plex |

`--dry-run` shows what would change without writing anything.

## Configuration

- **`PLEX_MOUNT`** env var — local mount root (e.g., `/Volumes/Media`)
- **Plex host + token** — reused from existing config (`data/household/auth/plex.yml`) via ConfigService, same as `plex.cli.mjs`

### Path Mapping

Plex reports each item's `Location` as a server-side path (e.g., `/data/Fitness/10 Rounds`). The tool auto-detects the server prefix from the Plex library's `Location` entries, strips it, and prepends `PLEX_MOUNT`.

Example: `/data/Fitness/10 Rounds` → `/Volumes/Media/Fitness/10 Rounds`

## {type}.yml Schema

Single filename (`{type}.yml`) for all content types. Schema adapts based on content:

### TV Shows / Series (Fitness, TV Shows, Education, Lectures, etc.)

```yaml
title: 21 Day Fix
titleSort: Fix
studio: Beachbody
summary: "Want amazing results in 21 days? ..."
year: 2013
originallyAvailableAt: "2013-01-01"
director: Autumn Calabrese
cast: Autumn Calabrese

# Plex-specific metadata (disaster recovery fields)
labels:
  - fitness
  - beginner
collections:
  - Strength
genres:
  - Fitness

# Plex identity (needed for push-back)
ratingKey: "54321"

seasons:
  - index: 1
    title: 21 Day Fix
    summary: "Want amazing results in 21 days? ..."
  - index: 2
    title: 21 Day Fix Extreme
    summary: "21 Day Fix Extreme gives you everything..."
```

### Movies (Movies, Documentaries, Stage)

```yaml
title: "Free Solo"
year: 2018
summary: "Alex Honnold attempts to free solo climb..."
studio: National Geographic
director: Jimmy Chin, Elizabeth Chai Vasarhelyi

labels:
  - documentary
  - adventure
collections:
  - Nature
genres:
  - Documentary

ratingKey: "12345"
```

### Music Artists (Music, Children's Music, Industrial, Ambient)

```yaml
title: Two Steps From Hell
titleSort: Two Steps From Hell
summary: "Epic orchestral music duo..."

labels:
  - epic
  - orchestral
collections:
  - Trailer Music
genres:
  - Soundtrack
  - Orchestral

ratingKey: "67890"
```

## Pull Flow

```
plex-sync pull --library 14 [--filter "10 Rounds"] [--force] [--dry-run]
```

1. Connect to Plex via PlexClient (host/token from config)
2. Fetch library sections, find target library
3. For each item in library:
   - Apply `--filter` regex against title (skip non-matches)
   - Fetch full metadata: title, summary, year, labels, collections, genres, etc.
   - Get item's Location path → strip server prefix → prepend `PLEX_MOUNT`
   - Check if `{type}.yml` exists at that path
   - If exists and no `--force`: merge only into blank fields
   - If exists and `--force`: overwrite all fields
   - If not exists: write fresh {type}.yml
   - For shows: fetch season children for the seasons array
4. **Poster download** (always, regardless of `--force`):
   - Shows: `show.jpg` if missing, `season{N}.jpg` per season if missing
   - Movies: `poster.jpg` if missing
   - Artists: `artist.jpg` if missing
5. Log per-item: `⬇️ pull` / `🔵 skip (no changes)` / `⚠️ skip (has data, use --force)`

## Push Flow

```
plex-sync push --library 14 [--filter "10 Rounds"] [--force] [--dry-run]
```

1. Scan `PLEX_MOUNT` filesystem for `{type}.yml` files (scoped to library subfolder)
2. For each {type}.yml found:
   - Apply `--filter` regex against title
   - Read `ratingKey` from {type}.yml — required for targeting the Plex item
   - If no ratingKey: log warning, skip
   - Fetch current Plex metadata for that ratingKey
   - Compare pushable fields: labels, collections, genres, summary, title, studio, year, director
   - Without `--force`: only push where Plex field is blank/empty
   - With `--force`: YML wins, overwrite Plex
   - For shows: push season title/summary with same logic
3. Log per-item: `⬆️ push (labels, collections)` / `🔵 skip (Plex populated)` / `⚠️ skip (use --force)`

### Plex Write API

Uses PUT to `/library/metadata/{ratingKey}` with URL-encoded tag parameters:
- Labels: `label[0].tag.tag=fitness&label[1].tag.tag=beginner`
- Collections: `collection[0].tag.tag=Strength`
- Genres: `genre[0].tag.tag=Fitness`
- Simple fields: `title.value=...&summary.value=...`

Requires adding a `put()` method to PlexClient.

## Migrate Flow

```
plex-sync migrate [--dir /Volumes/Media/Fitness] [--dry-run]
```

One-time offline conversion of existing nfo.json → {type}.yml.

1. Recursively scan `--dir` (or `PLEX_MOUNT`) for `nfo.json` files
2. For each nfo.json:
   - Skip if `{type}.yml` already exists in same directory
   - Parse JSON
   - Normalize quirky fields:
     - `genre[0].tag.tag: "Fitness"` → `genres: [Fitness]`
     - `collection: "Strength"` (string) → `collections: [Strength]`
     - Season `index` strings → integers
   - Drop duplicate season summaries (many nfo.json files repeat the show summary verbatim for every season)
   - No `ratingKey` — migrate is offline. Filled on next `pull`
   - Write `{type}.yml`
3. Do NOT delete original nfo.json (user cleans up after verifying)

## Existing nfo.json Inventory (~3,200 files)

| Library | Count | Type |
|---------|-------|------|
| Movies | 1,846 | movie |
| Music | 724 | artist |
| Fitness | 198 | show |
| TV Shows | 193 | show |
| Stage | 79 | movie |
| Lectures | 41 | show |
| Education | 35 | show |
| Church Series | 34 | show |
| Children's Stories | 21 | show |
| Scripture | 16 | show |
| Children's Music | 13 | artist |
| Ambient | 12 | artist |
| Industrial | 11 | artist |
| Speech | 9 | show |

## Implementation Scope

**v1 focus**: TV shows (Fitness library specifically) for all three commands.

**Architecture**: Instantiates PlexClient directly (not the full PlexAdapter) because we need raw Plex metadata fields (Location, Label, Collection, Genre) that the adapter normalizes away. For push, adds `put()` to PlexClient.

**Dependencies**: ConfigService (auth), PlexClient (API), js-yaml (YML I/O), node:fs/path (filesystem), axios or node:fetch (poster downloads).
