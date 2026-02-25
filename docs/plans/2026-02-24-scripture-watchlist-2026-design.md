# Scripture Watchlist 2026 — Design

## Overview

A 2026 Come Follow Me (Old Testament) watchlist with **version rotation**: chapters are played first in a preferred audio version (esv-music), then recycled in a secondary version (kjv-maxmclean) after all chapters have been heard at least once. The watchlist is version-agnostic — version selection happens at play time in the scripture resolver, not in the YAML.

---

## Watchlist YAML Format

**File**: `data/household/config/lists/watchlists/scriptures2026.yml`

```yaml
title: Come Follow Me 2026 — Old Testament
program: Come Follow Me 2026
metadata:
  versions:
    ot: [esv-music, kjv-maxmclean]
    pgp: [rex, lds-male]

items:
  # Week: Jan 5–11 — Moses 1; Abraham 3
  - title: Moses 1
    play: { contentId: "scriptures:41361" }
    wait_until: '2026-01-05'
    skip_after: '2026-01-11'

  - title: Abraham 3
    play: { contentId: "scriptures:41773" }
    wait_until: '2026-01-05'
    skip_after: '2026-01-11'

  # Week: Jan 12–18 — Genesis 1–2; Moses 2–3; Abraham 4–5
  - title: Genesis 1
    play: { contentId: "scriptures:1" }
    wait_until: '2026-01-12'
    skip_after: '2026-01-18'

  - title: Genesis 2
    play: { contentId: "scriptures:32" }
    wait_until: '2026-01-12'
    skip_after: '2026-01-18'

  # ... etc for all ~300 chapters
```

### Key decisions

- **`contentId: "scriptures:{verseId}"`** — version-agnostic. The verse ID is the canonical chapter identity (e.g., `1` = Genesis 1, `41361` = Moses 1). Volume inferred from VOLUME_RANGES.
- **`metadata.versions`** — per-volume ordered list of preferred audio versions. Generic `metadata` field — the list infrastructure passes it through opaquely; only the scripture resolver interprets it.
- **`program: Come Follow Me 2026`** — same for all items. Thematic grouping, not week labels.
- **`wait_until` / `skip_after`** — weekly scheduling window. `skip_after` is a soft priority signal: items past their window are deprioritized but still playable.

### Content sources

- **OT chapters** (Genesis–Malachi): verse IDs 1–23145, from `data/content/readalong/scripture/ot/`
- **PGP chapters** (Moses 1–8, Abraham 1–5): verse IDs 41361–41832, from `data/content/readalong/scripture/pgp/`

### Audio versions available

| Volume | Version Prefs | Text Dir | Audio Dir |
|--------|--------------|----------|-----------|
| OT | `esv-music` (primary) | `ot/esv` (derived via suffix-strip) | `ot/esv-music` |
| OT | `kjv-maxmclean` (secondary) | `ot/kjvf` (manifest default) | `ot/kjv-maxmclean` |
| PGP | `rex` (primary) | `pgp/readers` (manifest default) | `pgp/rex` |
| PGP | `lds-male` (secondary) | `pgp/lds` | `pgp/lds-male` |

---

## Selection Logic — Priority Cascade

### Three-state watch model

Each item has a watch state that considers ALL preferred versions:

| State | Definition | Selection priority |
|-------|-----------|-------------------|
| **unwatched** | No version watched (0% for all preferred versions) | Highest — play in version[0] |
| **partial** | Some versions watched, some not | Lower — only after all unwatched done |
| **complete** | All preferred versions watched | Lowest — true "watched", fallback cascade only |

### Selection order (both `play=` and `queue=`)

```
1. UNWATCHED items — current week      (within skip_after window, never played in any version)
2. UNWATCHED items — past weeks        (skip_after passed, never played in any version)
3. PARTIAL items — current week        (version rotation scoped to this week first)
4. PARTIAL items — past weeks          (only after ALL current week versions exhausted)
5. COMPLETE items                      (true fallback — all versions done everywhere)
```

Version recycling is **scoped to the current week** until all preferred versions for that week's chapters are exhausted. Only then do past weeks' partial items become eligible. This keeps the listener focused on the current curriculum before branching out.

`play=scriptures2026` picks the first item from this ordered list.
`queue=scriptures2026` queues all items from this ordered list, up to and including the current week's schedule (no items with `wait_until` > today).

### Example

Given `versions.ot: [esv-music, kjv-maxmclean]` and it's week of Feb 16:

```
Queue:
  1. Genesis 15  (unwatched, this week, → esv-music)
  2. Genesis 16  (unwatched, this week, → esv-music)
  3. Genesis 5   (unwatched, past week, → esv-music)      # catch-up
  4. Genesis 12  (partial, this week, → kjv-maxmclean)     # recycle current week first
  5. Genesis 13  (partial, this week, → kjv-maxmclean)     # recycle current week
  6. Genesis 1   (partial, past week, → kjv-maxmclean)     # past week recycled (only after
  7. Genesis 2   (partial, past week, → kjv-maxmclean)     #   all current week versions done)
```

---

## Resolver Changes

**File**: `backend/src/1_adapters/content/readalong/resolvers/scripture.mjs`

### New parameters

The `resolve()` method accepts optional version-rotation context:

```javascript
resolve(input, dataPath, {
  mediaPath, defaults, audioDefaults,
  versionPrefs,      // string[] — from metadata.versions[volume]
  watchedVersions,   // string[] — versions where this chapter is watched (>=90%)
})
```

### Version selection (bare verse ID path)

When input is a bare verse ID (1-segment) and `versionPrefs` is provided:

```javascript
// Pick first unwatched version from prefs
const nextVersion = versionPrefs.find(v => !watchedVersions?.includes(v))
  || versionPrefs[0];  // all watched → cycle back to first

// Smart detection: is nextVersion a text dir or audio-only dir?
if (isAudioDir(mediaPath, volume, nextVersion) && !isTextDir(dataPath, volume, nextVersion)) {
  // Audio-only slug (esv-music, kjv-dramatized, etc.)
  audioRecording = nextVersion;
  textVersion = deriveTextFromAudio(nextVersion, dataPath, volume)
    || volumeDefaults.text;
} else {
  // Text dir → treat as version
  textVersion = nextVersion;
  audioRecording = resolveAudioAlias(audioDefaults, nextVersion, volume);
}
```

### Text derivation from audio slug

Convention-based with config override:

```javascript
function deriveTextFromAudio(audioSlug, dataPath, volume, textDefaults) {
  // Explicit mapping wins (if we add textDefaults to manifest)
  if (textDefaults?.[audioSlug]) return textDefaults[audioSlug];
  // Convention: strip common suffixes (-music, -dramatized)
  const base = audioSlug.replace(/-(music|dramatized)$/, '');
  if (base !== audioSlug && isTextDir(dataPath, volume, base)) return base;
  // Fallback to volume defaults
  return null;
}
```

`esv-music` → strip `-music` → `esv` → text dir exists → use ESV text.

### Backward compatibility

- Existing 3-segment paths (`dc/rex/37707`) hit the full-path passthrough — unchanged.
- Existing 1-segment paths without `versionPrefs` use manifest defaults — unchanged.
- New 1-segment paths with `versionPrefs` use the new version selection logic.

---

## ListAdapter Plumbing

**File**: `backend/src/1_adapters/content/list/ListAdapter.mjs`

### Reading metadata.versions

In `_buildListItems()`, read `config.metadata.versions` from the normalized list config. This is the per-volume version preference map.

### Querying per-version watch state

For each item with a version-agnostic content ID (`scriptures:{verseId}`):

1. Resolve verse ID → volume (via VOLUME_RANGES)
2. Get `versionPrefs` from `metadata.versions[volume]`
3. Construct versioned storage keys: `readalong:scripture/{volume}/{version}/{verseId}` for each version in prefs
4. Batch-query MediaProgressMemory for all constructed keys
5. Build `watchedVersions` = versions where percent >= 90%
6. Pass `versionPrefs` + `watchedVersions` to resolver

### Watch-state storage keys

Existing format, no changes needed:

```
readalong:scripture/ot/esv-music/1       → { percent: 98, playCount: 1 }
readalong:scripture/ot/kjv-maxmclean/1   → { percent: 0 }
```

The keys are already version-specific because the resolver produces versioned paths that flow through to the progress tracker.

### Determining item watch state for filtering

```
watchedVersions.length === 0                    → unwatched
watchedVersions.length < versionPrefs.length    → partial
watchedVersions.length === versionPrefs.length  → complete
```

This three-state classification drives the selection priority cascade.

---

## DDD Layer Summary

| Concern | Layer | Component | Responsibility |
|---------|-------|-----------|---------------|
| "What chapter today?" | Domain | ItemSelectionService | Scheduling, priority, watched filter |
| "What version/voice?" | Adapter | ScriptureResolver | Version selection from prefs + watch history |
| "Which versions are watched?" | Application | ListAdapter | Query MediaProgressMemory, construct watchedVersions |
| "Version preferences" | Config | Watchlist YAML `metadata.versions` | Opaque to list infra, interpreted by scripture adapter |
| "Watch state storage" | Adapter | MediaProgressMemory | Stores by resolved (versioned) content path |

Separation of concerns:
- The watchlist items know WHAT chapter to play (verse ID) and WHEN (scheduling window)
- The scripture resolver knows HOW to play it (which version/voice)
- The list infrastructure doesn't know about versions at all — it just passes `metadata` through

---

## Scope of Code Changes

### Must change

1. **ScriptureResolver** (`backend/src/1_adapters/content/readalong/resolvers/scripture.mjs`) — add `versionPrefs`/`watchedVersions` params to `resolve()`, version selection logic, `deriveTextFromAudio()` helper
2. **ListAdapter** (`backend/src/1_adapters/content/list/ListAdapter.mjs`) — read `metadata.versions`, query per-version watch state, pass context to resolver, classify items as unwatched/partial/complete
3. **New watchlist YAML** — generate `scriptures2026.yml` with ~300 chapter entries

### May need adjustment

4. **ItemSelectionService** or **QueueService** — the three-state watch model (unwatched → partial → complete) may require a new filter or sort that understands the cascade priority
5. **listConfigNormalizer** — ensure `metadata.versions` survives normalization/serialization round-trip

### No changes needed

- MediaProgressMemory (storage keys already version-specific)
- Frontend renderers (they receive resolved content, version-agnostic)
- Play API / Queue API (they call ListAdapter which handles everything)
- Manifest (`manifest.yml` — no changes, text derivation uses convention)
