# Media Folder Reorganization

## Overview

Consolidate the media folder from 17 top-level folders to 5 categories: `audio`, `video`, `img`, `fonts`, `apps`.

## Target Structure

```
media/
├── audio/
│   ├── 365Daily/
│   ├── ambient/
│   ├── poetry/
│   ├── scripture/
│   ├── sfx/
│   └── songs/
├── video/
│   ├── clips/
│   ├── news/
│   ├── program/
│   ├── spot/
│   └── talks/
├── img/
│   ├── art/
│   ├── buttons/
│   ├── bw/
│   ├── covers/
│   ├── entropy/
│   └── cache/
├── fonts/
└── apps/
    └── fitness/
        └── households/
            └── default/
                └── sessions/
```

## Execution Strategy

**Update code first, then move files.** Brief downtime expected between deploy and file migration.

---

## Phase 1: Code Updates

Update all hardcoded media paths in the codebase before moving files.

### backend/routers/fetch.mjs

| Line | Current | New |
|------|---------|-----|
| 215 | `${mediaPath}/talks/` | `${mediaPath}/video/talks/` |
| 217 | `/media/talks/` | `/media/video/talks/` |
| 357 | `${mediaPath}/scripture/` | `${mediaPath}/audio/scripture/` |
| 359 | `/media/scripture/` | `/media/audio/scripture/` |
| 388 | `${mediaPath}/songs/` | `${mediaPath}/audio/songs/` |
| 393 | `/media/songs/` | `/media/audio/songs/` |

### backend/routers/media.mjs

| Line | Current | New |
|------|---------|-----|
| 787 | `${mediaPath}/cache/plex` | `${mediaPath}/img/cache/plex` |

### backend/lib/youtube.mjs

| Line | Current | New |
|------|---------|-----|
| 34 | `path.join(..., 'news')` | `path.join(..., 'video', 'news')` |
| 192 | `${process.env.path.media}/news` | `${process.env.path.media}/video/news` |

### frontend/src/modules/ContentScroller/ContentScroller.jsx

| Line | Current | New |
|------|---------|-----|
| 411 | `media/ambient/` | `media/audio/ambient/` |
| 803 | `media/ambient/` | `media/audio/ambient/` |

### backend/routers/fitness.mjs

| Line | Current | New |
|------|---------|-----|
| 440 | `households/${hid}/fitness/sessions/` | `apps/fitness/households/${hid}/sessions/` |
| 441 | `path.join(mediaRoot, 'households', hid, 'fitness', ...)` | `path.join(mediaRoot, 'apps', 'fitness', 'households', hid, ...)` |

---

## Phase 2: Deploy

1. Commit code changes
2. Run `./deploy.sh`
3. Verify container restarts successfully

---

## Phase 3: File Migration

Run via SSH to avoid macOS permission issues:

```bash
ssh homeserver.local 'bash -s' << 'EOF'
cd /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media

# Create new directory structure
mkdir -p audio video apps/fitness

# Move audio folders
mv 365Daily audio/
mv ambient audio/
mv poetry audio/
mv scripture audio/
mv songs audio/

# Merge sfx (audio/sfx exists, top-level sfx exists)
mv sfx/* audio/sfx/ 2>/dev/null || true
rmdir sfx 2>/dev/null || true

# Move video folders
mv clips video/
mv news video/
mv program video/
mv spot video/
mv talks video/

# Move cache into img
mv cache img/

# Move fitness app media
mv fitness/* apps/fitness/
rmdir fitness 2>/dev/null || true

# Move households into fitness
mv households apps/fitness/

# Verify
ls -la
ls -la audio/
ls -la video/
ls -la img/
ls -la apps/fitness/
EOF
```

---

## Phase 4: Verify

1. Check prod logs: `ssh homeserver.local 'docker logs daylight-station -f'`
2. Test affected features:
   - Scripture audio playback
   - Hymn/song playback
   - General Conference talks (video)
   - Ambient music in ContentScroller
   - Plex image caching
   - Fitness session screenshots

---

## Folders Summary

### Moved to `audio/`
- 365Daily, ambient, poetry, scripture, sfx (merged), songs

### Moved to `video/`
- clips, news, program, spot, talks

### Moved to `img/`
- cache (moved inside existing img/)

### Moved to `apps/`
- fitness, households (nested under fitness)

### Unchanged
- img/ (stays at top level)
- fonts/ (stays at top level)
