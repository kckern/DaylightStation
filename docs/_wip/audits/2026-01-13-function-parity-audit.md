# Function Parity Audit: Legacy vs DDD

**Date:** 2026-01-13
**Status:** In Progress
**Purpose:** Systematically document all functions in legacy code and their DDD equivalents to identify gaps and guide migration completion.

---

## Executive Summary

| Domain | Legacy Functions | DDD Equivalents | Gaps | Parity % |
|--------|------------------|-----------------|------|----------|
| Content | 66 | 54 | 12 | 82% |
| Fitness | 41 | 32 | 9 | 78% |
| Config | TBD | TBD | TBD | TBD |
| Playback | TBD | TBD | TBD | TBD |
| Scheduling | TBD | TBD | TBD | TBD |
| User | TBD | TBD | TBD | TBD |

---

## Content Domain

### Legacy Files

| File | Path | Purpose |
|------|------|---------|
| plex.mjs | `backend/_legacy/lib/plex.mjs` | Plex Media Server integration |
| mediaMemory.mjs | `backend/_legacy/lib/mediaMemory.mjs` | Watch state path utilities |
| mediaMemoryValidator.mjs | `backend/_legacy/lib/mediaMemoryValidator.mjs` | Orphan ID validation/backfill |

### DDD Files

| File | Path | Purpose |
|------|------|---------|
| Item.mjs | `backend/src/1_domains/content/entities/Item.mjs` | Base entity for all content items |
| WatchState.mjs | `backend/src/1_domains/content/entities/WatchState.mjs` | Watch state entity |
| Listable.mjs | `backend/src/1_domains/content/capabilities/Listable.mjs` | Listable capability |
| Playable.mjs | `backend/src/1_domains/content/capabilities/Playable.mjs` | Playable capability |
| Queueable.mjs | `backend/src/1_domains/content/capabilities/Queueable.mjs` | Queueable capability |
| IContentSource.mjs | `backend/src/1_domains/content/ports/IContentSource.mjs` | Content source interface |
| IWatchStateStore.mjs | `backend/src/1_domains/content/ports/IWatchStateStore.mjs` | Watch state store interface |
| ContentSourceRegistry.mjs | `backend/src/1_domains/content/services/ContentSourceRegistry.mjs` | Adapter registry service |
| QueueService.mjs | `backend/src/1_domains/content/services/QueueService.mjs` | Queue filtering/sorting service |
| PlexAdapter.mjs | `backend/src/2_adapters/content/media/plex/PlexAdapter.mjs` | Plex adapter |
| PlexClient.mjs | `backend/src/2_adapters/content/media/plex/PlexClient.mjs` | Low-level Plex API client |
| FilesystemAdapter.mjs | `backend/src/2_adapters/content/media/filesystem/FilesystemAdapter.mjs` | Filesystem media adapter |
| FolderAdapter.mjs | `backend/src/2_adapters/content/folder/FolderAdapter.mjs` | Custom folders/watchlists |
| LocalContentAdapter.mjs | `backend/src/2_adapters/content/local-content/LocalContentAdapter.mjs` | Local content (talks, scriptures) |

---

### Legacy Functions: plex.mjs (Plex class)

| Function | Lines | Purpose | DDD Equivalent |
|----------|-------|---------|----------------|
| `constructor()` | 22-32 | Initialize Plex client with config | `PlexAdapter.constructor()` |
| `fetch(paramString)` | 33-45 | Generic Plex API fetch | `PlexClient.request()` |
| `requestTranscodeDecision(key, opts)` | 77-205 | Request transcode decision from Plex | `PlexAdapter.requestTranscodeDecision()` |
| `loadmedia_url(itemData, attempt, opts)` | 207-310 | Generate streaming URL | `PlexAdapter.loadMediaUrl()` |
| `_buildTranscodeUrl(...)` | 316-337 | Build transcode URL | `PlexAdapter._buildTranscodeUrl()` |
| `loadMeta(plex, type)` | 339-350 | Load item metadata | `PlexClient.getMetadata()` |
| `loadChildrenFromKey(plex, playable, shuffle)` | 351-362 | Load container with children | `PlexAdapter.getContainerWithChildren()` |
| `loadListFromKey(plex, playable, shuffle)` | 364-379 | Load list from container key | `PlexAdapter.getList()` |
| `loadListKeys(input, path)` | 381-431 | Load list of item keys with metadata | `PlexAdapter._toListableItem()` |
| `loadImgFromKey(plex)` | 432-438 | Get thumbnail URLs for item | **GAP** |
| `loadListFromAlbum(plex)` | 440-442 | Load tracks from album | `PlexAdapter.getList()` (via type detection) |
| `loadListFromSeason(plex)` | 443-445 | Load episodes from season | `PlexAdapter.getList()` (via type detection) |
| `loadListFromCollection(plex, playable)` | 446-466 | Load items from collection | `PlexAdapter.getList()` (via type detection) |
| `loadListFromShow(plex, playable)` | 467-469 | Load seasons/episodes from show | `PlexAdapter.getList()` (via type detection) |
| `loadListFromArtist(plex, playable)` | 470-472 | Load albums/tracks from artist | `PlexAdapter.getList()` (via type detection) |
| `loadListFromPlaylist(plex)` | 473-513 | Load items from playlist | `PlexAdapter.getList()` (via type detection) |
| `loadListKeysFromPlaylist(plex)` | 514-517 | Load just keys from playlist | **GAP** (not needed - use getList) |
| `determinemedia_type(type)` | 519-525 | Determine media type from item type | `PlexAdapter._determineMediaType()` |
| `buildPlayableObject(itemData, parentKey, ...)` | 530-577 | Build playable item object | `PlexAdapter._toPlayableItem()` |
| `loadPlayableItemFromKey(key, shuffle, opts)` | 580-602 | Load single playable with smart selection | `PlexAdapter.loadPlayableItemFromKey()` |
| `isPlayableType(type)` | 604-608 | Check if type is directly playable | Inline in `_toPlayableItem()` |
| `loadPlayableQueueFromKey(key, shuffle)` | 611-633 | Load queue of playable items | `PlexAdapter.loadPlayableQueueFromKey()` |
| `getMediaArray(item)` | 635-638 | Normalize media array | Not needed in DDD |
| `loadSingleFromCollection(key, shuffle)` | 640-645 | Select single item from collection | `PlexAdapter.selectKeyToPlay()` |
| `loadSingleFromArtist(key, shuffle)` | 647-652 | Select single track from artist | `PlexAdapter.selectKeyToPlay()` |
| `loadSingleFromAlbum(key, shuffle)` | 654-659 | Select single track from album | `PlexAdapter.selectKeyToPlay()` |
| `loadSingleFromSeason(key, shuffle)` | 661-666 | Select single episode from season | `PlexAdapter.selectKeyToPlay()` |
| `loadSingleFromPlaylist(key, shuffle)` | 668-674 | Select single item from playlist | `PlexAdapter.selectKeyToPlay()` |
| `loadSingleFromShow(key, shuffle)` | 676-681 | Select single episode from show | `PlexAdapter.selectKeyToPlay()` |
| `selectKeyToPlay(keys, shuffle)` | 682-699 | Select next item using watch history | `PlexAdapter.selectKeyToPlay()` |
| `loadPlexViewingHistory()` | 701-721 | Load viewing history from files | `PlexAdapter._loadViewingHistory()` |
| `selectEpisodeByPriority(...)` | 723-750 | Select episode by priority rules | `PlexAdapter._selectEpisodeByPriority()` |
| `loadSingleFromWatchlist(watchlist)` | 752-809 | Select item from watchlist | `PlexAdapter.loadSingleFromWatchlist()` |
| `loadEpisode(key)` | 811-817 | Load single episode | `PlexAdapter.getItem()` |
| `loadMovie(key)` | 819-825 | Load single movie | `PlexAdapter.getItem()` |
| `loadAudioTrack(key)` | 827-837 | Load single audio track | `PlexAdapter.getItem()` |
| `loadShow(key)` | 839-877 | Load show with seasons | `PlexAdapter.getContainerInfo()` |
| `artUrl(item, id, type)` | 879-882 | Build art URL | Inline in adapters |
| `thumbUrl(paramString)` | 883-892 | Build thumbnail URL | Inline in adapters (proxy path) |
| `pruneArray(arr, blacklist)` | 894-899 | Remove keys from object | Not needed |
| `pickArray(array, whitelist)` | 901-910 | Pick keys from object | Not needed |
| `flattenTags(items, leaf)` | 912-920 | Flatten tag arrays to string | Not needed |
| `loadSinglePlayableItem(metadataId)` | 922-928 | Load playable item by type | `PlexAdapter.getItem()` |
| `loadArtistAlbums(metadataId)` | 930-933 | Load albums for artist | `PlexAdapter.getList()` |
| `loadArtist(metadataId)` | 935-941 | Load artist with tracks | `PlexAdapter.getItem()` + `getList()` |
| `loadTrack(track, artistId)` | 943-962 | Transform track metadata | `PlexAdapter._toPlayableItem()` |
| `loadTracks(tracks, artistId)` | 964-971 | Transform multiple tracks | `PlexAdapter._toPlayableItem()` |

**Total Legacy plex.mjs:** 47 functions/methods

---

### Legacy Functions: mediaMemory.mjs

| Function | Lines | Purpose | DDD Equivalent |
|----------|-------|---------|----------------|
| `sanitizeForYAML(str)` | 23-39 | Sanitize string for YAML | **GAP** |
| `sanitizeObjectForYAML(obj)` | 46-64 | Recursively sanitize object | **GAP** |
| `getMediaMemoryPath(category, householdId)` | 72-79 | Get relative path for media memory | `FilesystemAdapter._loadWatchState()` (implicit) |
| `getMediaMemoryDir(householdId)` | 86-98 | Get absolute dir path for media memory | `FilesystemAdapter._loadWatchState()` (implicit) |
| `parseLibraryFilename(filename)` | 105-112 | Parse library ID from filename | `PlexAdapter._loadHistoryFromFiles()` (implicit) |
| `buildLibraryFilename(libraryId, libraryName)` | 120-123 | Build library filename | **GAP** |
| `getMediaMemoryFiles(householdId)` | 130-146 | Get all media memory files | `PlexAdapter._loadHistoryFromFiles()` (implicit) |

**Total Legacy mediaMemory.mjs:** 7 functions

---

### Legacy Functions: mediaMemoryValidator.mjs

| Function | Lines | Purpose | DDD Equivalent |
|----------|-------|---------|----------------|
| `PlexClient.constructor()` | 30-37 | Initialize validator client | **GAP** (separate validator client) |
| `PlexClient.fetch(endpoint)` | 39-50 | Fetch from Plex | `PlexClient.request()` |
| `PlexClient.checkConnectivity()` | 52-59 | Check Plex server reachability | **GAP** |
| `PlexClient.verifyId(plexId)` | 61-64 | Verify Plex ID exists | **GAP** |
| `PlexClient.hubSearch(query, libraryId)` | 66-84 | Search Plex hub | **GAP** |
| `calculateConfidence(stored, result)` | 86-111 | Calculate match confidence | **GAP** |
| `findBestMatch(plex, entry)` | 113-139 | Find best match for orphan | **GAP** |
| `selectEntriesToCheck(entries)` | 141-163 | Select entries for validation | **GAP** |
| `validateMediaMemory(guidId)` | 165-278 | Main validation function | **GAP** |

**Total Legacy mediaMemoryValidator.mjs:** 9 functions (all exported as cron job)

---

### DDD Functions: Domain Layer

#### Item.mjs (Item class)
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(props)` | 32-47 | Create item with required fields |
| `getLocalId()` | 53-56 | Extract local ID from compound ID |
| `get plex()` | 62-67 | Get plex rating key |
| `get label()` | 73-75 | Get display label |
| `get media_key()` | 81-83 | Get media key for logging |
| `isPlayable()` | 89-91 | Check if item is playable (base returns false) |

**Total Item.mjs:** 6 methods

#### WatchState.mjs (WatchState class)
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(props)` | 20-29 | Create watch state |
| `get percent()` | 35-38 | Calculate percentage watched |
| `isWatched()` | 44-46 | Check if >= 90% watched |
| `isInProgress()` | 52-54 | Check if started but not finished |
| `toJSON()` | 60-70 | Convert to plain object |
| `static fromJSON(data)` | 77-79 | Create from persisted data |

**Total WatchState.mjs:** 6 methods

#### Listable.mjs (ListableItem class)
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(props)` | 26-32 | Create listable item |
| `isContainer()` | 38-40 | Check if item has children |

**Total Listable.mjs:** 2 methods

#### Playable.mjs (PlayableItem class)
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(props)` | 34-50 | Create playable item |
| `get watchProgress()` | 57-63 | Get watch progress percentage |
| `get watchSeconds()` | 69-71 | Alias for resumePosition |
| `getProgress()` | 77-82 | Get progress as percentage |
| `isPlayable()` | 88-90 | Check if playable (returns true) |

**Total Playable.mjs:** 5 methods

#### Queueable.mjs (QueueableItem class)
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(props)` | 21-25 | Create queueable item |

**Total Queueable.mjs:** 1 method

#### ContentSourceRegistry.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor()` | 9-15 | Initialize maps |
| `register(adapter)` | 21-33 | Register an adapter |
| `get(source)` | 40-42 | Get adapter by source name |
| `resolveFromPrefix(prefix, value)` | 50-56 | Resolve from prefix |
| `resolve(compoundId)` | 63-82 | Resolve compound ID to adapter |
| `getRegisteredPrefixes()` | 88-90 | List all prefixes |
| `canResolve(compoundId)` | 97-99 | Check if ID can be resolved |

**Total ContentSourceRegistry.mjs:** 7 methods

#### QueueService.mjs (static methods + instance)
| Function | Lines | Purpose |
|----------|-------|---------|
| `static sortByPriority(items)` | 60-86 | Sort by priority |
| `static filterBySkipAfter(items, now)` | 96-102 | Filter past deadlines |
| `static applyUrgency(items, now)` | 112-124 | Mark items as urgent |
| `static filterByWaitUntil(items, now)` | 135-144 | Filter future wait dates |
| `static filterByHold(items)` | 153-155 | Filter held items |
| `static filterByWatched(items)` | 164-170 | Filter watched items |
| `static filterByDayOfWeek(items, now)` | 183-199 | Filter by day |
| `static applyFilters(items, options)` | 212-247 | Apply all filters |
| `static buildQueue(items, options)` | 255-268 | Build prioritized queue |
| `constructor(config)` | 274-276 | Initialize with watch store |
| `async getNextPlayable(items, storagePath)` | 286-307 | Get next playable item |
| `async getAllPlayables(items)` | 315-317 | Get all playables |
| `_withResumePosition(item, state)` | 323-339 | Apply resume position |

**Total QueueService.mjs:** 13 methods

---

### DDD Functions: Adapter Layer

#### PlexClient.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(config)` | 14-22 | Initialize client |
| `async request(path, options)` | 31-50 | Make authenticated request |
| `buildUrl(path)` | 57-60 | Build URL with token |
| `async getLibrarySections()` | 66-68 | Get library sections |
| `async getContainer(key)` | 75-77 | Get container by key |
| `async getMetadata(ratingKey)` | 84-86 | Get item metadata |

**Total PlexClient.mjs:** 6 methods

#### PlexAdapter.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(config)` | 23-40 | Initialize adapter |
| `_loadHistoryFromFiles()` | 47-68 | Load viewing history |
| `_clearHistoryFromFiles(keys)` | 75-104 | Clear watch history |
| `get source()` | 110-112 | Return source name |
| `get prefixes()` | 118-120 | Return prefixes |
| `async getMetadata(ratingKey)` | 127-135 | Get raw metadata |
| `async getItem(id)` | 142-171 | Get single item |
| `async getList(id)` | 178-218 | Get list of items |
| `async resolvePlayables(id)` | 225-268 | Resolve to playables |
| `_toListableItem(item)` | 276-300 | Convert to ListableItem |
| `_toPlayableItem(item)` | 308-404 | Convert to PlayableItem |
| `async getStoragePath(id)` | 411-413 | Get storage path |
| `_generateSessionIds(clientSession)` | 425-431 | Generate session IDs |
| `async requestTranscodeDecision(key, opts)` | 445-540 | Request transcode decision |
| `_buildTranscodeUrl(key, ...)` | 552-574 | Build transcode URL |
| `async loadMediaUrl(itemData, opts)` | 588-662 | Generate streaming URL |
| `async getContainerWithChildren(id)` | 669-681 | Get container with children |
| `async getContainerInfo(id)` | 689-731 | Get extended container metadata |
| `setHistoryLoader(loader)` | 742-744 | Set history loader |
| `setHistoryClearer(clearer)` | 751-753 | Set history clearer |
| `_loadViewingHistory()` | 758-763 | Load viewing history |
| `_clearWatchedItems(keys)` | 770-774 | Clear watched items |
| `_isWatched(item, threshold)` | 783-793 | Check if watched |
| `_categorizeByWatchStatus(keys, log)` | 802-823 | Categorize by watch status |
| `_selectEpisodeByPriority(...)` | 835-859 | Select by priority |
| `selectKeyToPlay(keys, shuffle)` | 869-885 | Select key to play |
| `async loadPlayableItemFromKey(key, opts)` | 896-938 | Load playable with smart selection |
| `async loadPlayableQueueFromKey(key, opts)` | 947-975 | Load queue of playables |
| `async loadSingleFromWatchlist(watchlistData)` | 992-1083 | Select from watchlist |
| `_determineMediaType(type)` | 1117-1123 | Determine media type |
| `async loadmedia_url(...)` | 1387-1389 | Alias for loadMediaUrl |
| `async getMediaUrl(id, startOffset, opts)` | 1398-1401 | Convenience method |

**Total PlexAdapter.mjs:** 32 methods

#### FilesystemAdapter.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(config)` | 47-56 | Initialize adapter |
| `_loadWatchState()` | 64-96 | Load watch state from YAML |
| `_getWatchState(mediaKey)` | 104-108 | Get watch state for key |
| `async _parseAudioMetadata(filePath)` | 115-131 | Parse ID3 tags |
| `get source()` | 133-135 | Return source name |
| `get prefixes()` | 137-143 | Return prefixes |
| `resolvePath(mediaKey)` | 150-194 | Resolve media key to path |
| `getMimeType(ext)` | 201-203 | Get MIME type |
| `getMediaType(ext)` | 210-216 | Get media type category |
| `async getItem(id)` | 222-278 | Get item by ID |
| `async getList(id)` | 284-335 | Get list of items |
| `async resolvePlayables(id)` | 341-358 | Resolve to playables |
| `async getStoragePath(id)` | 364-366 | Get storage path |

**Total FilesystemAdapter.mjs:** 13 methods

#### FolderAdapter.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(config)` | 18-25 | Initialize adapter |
| `get source()` | 27-29 | Return source name |
| `get prefixes()` | 31-33 | Return prefixes |
| `canResolve(id)` | 35-37 | Check if can resolve |
| `getStoragePath(id)` | 39-42 | Get storage path |
| `_loadWatchlist()` | 44-54 | Load watchlist YAML |
| `_loadWatchState(category)` | 61-79 | Load watch state |
| `_loadPlexWatchState()` | 85-108 | Load Plex watch state |
| `_isWatched(watchState)` | 115-131 | Check if watched |
| `_calculatePriority(item, watchState)` | 138-159 | Calculate priority |
| `_shouldSkipItem(item, watchState, options)` | 168-195 | Check if should skip |
| `_parseInput(input)` | 202-208 | Parse input string |
| `async getList(id, options)` | 215-335 | Get list with enrichment |
| `async getItem(id)` | 337-347 | Get folder item |
| `async resolvePlayables(id)` | 349-361 | Resolve to playables |

**Total FolderAdapter.mjs:** 15 methods

#### LocalContentAdapter.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(config)` | 18-23 | Initialize adapter |
| `get source()` | 25-27 | Return source name |
| `get prefixes()` | 29-37 | Return prefixes |
| `canResolve(id)` | 44-47 | Check if can resolve |
| `getStoragePath(id)` | 53-61 | Get storage path |
| `async getItem(id)` | 68-93 | Get item by ID |
| `async getList(id)` | 100-109 | Get list of items |
| `async resolvePlayables(id)` | 116-130 | Resolve to playables |
| `_validatePath(localId, subdir)` | 137-151 | Validate path containment |
| `async _getTalk(localId)` | 156-187 | Get talk item |
| `async _getScripture(localId)` | 195-258 | Get scripture item |
| `async _getTalkFolder(folderId)` | 266-300 | Get talk folder |
| `async _getSong(collection, number)` | 309-345 | Get song item |
| `async _getPoem(localId)` | 353-386 | Get poem item |

**Total LocalContentAdapter.mjs:** 14 methods

---

### Gap Analysis: Content Domain

| Legacy Function | DDD Status | Notes |
|-----------------|------------|-------|
| `loadImgFromKey(plex)` | MISSING | Returns thumbnail URLs for item hierarchy |
| `loadListKeysFromPlaylist(plex)` | COVERED | Use `getList()` instead |
| `sanitizeForYAML(str)` | MISSING | Needed for safe YAML writes |
| `sanitizeObjectForYAML(obj)` | MISSING | Needed for safe YAML writes |
| `buildLibraryFilename(libraryId, libraryName)` | MISSING | Needed for library file management |
| `PlexClient.checkConnectivity()` | MISSING | Health check for Plex server |
| `PlexClient.verifyId(plexId)` | MISSING | Validate Plex ID exists |
| `PlexClient.hubSearch(query, libraryId)` | MISSING | Search functionality |
| `calculateConfidence(stored, result)` | MISSING | Match scoring for validator |
| `findBestMatch(plex, entry)` | MISSING | Orphan backfill logic |
| `selectEntriesToCheck(entries)` | MISSING | Validator sampling logic |
| `validateMediaMemory(guidId)` | MISSING | Full validator cron job |

**Summary:**
- Legacy functions: 66
- DDD equivalents: 54
- Gaps: 12
- **Parity: 82%**

**Critical Gaps:**
1. **Media Memory Validator** - Entire cron job for orphan ID backfill is not in DDD
2. **YAML Sanitization** - Unicode/control character sanitization utilities
3. **Plex Health Check** - Connectivity verification
4. **Plex Hub Search** - Search functionality for validator

**Low Priority Gaps:**
- `loadImgFromKey` - Can be composed from existing methods
- `loadListKeysFromPlaylist` - Redundant with `getList()`
- `buildLibraryFilename` - Only needed for validator

---

## 2. Fitness Domain

### Legacy Files

| File | Path | Purpose |
|------|------|---------|
| fitsync.mjs | `backend/_legacy/lib/fitsync.mjs` | FitnessSyncer API integration for Garmin data |
| fitness.mjs | `backend/_legacy/routers/fitness.mjs` | Fitness API router with session management |

### DDD Files

| File | Path | Purpose |
|------|------|---------|
| Session.mjs | `backend/src/1_domains/fitness/entities/Session.mjs` | Session entity |
| Participant.mjs | `backend/src/1_domains/fitness/entities/Participant.mjs` | Participant entity |
| Zone.mjs | `backend/src/1_domains/fitness/entities/Zone.mjs` | Heart rate zone entity |
| SessionService.mjs | `backend/src/1_domains/fitness/services/SessionService.mjs` | Session CRUD operations |
| TimelineService.mjs | `backend/src/1_domains/fitness/services/TimelineService.mjs` | Timeline encoding/decoding |
| ZoneService.mjs | `backend/src/1_domains/fitness/services/ZoneService.mjs` | Zone resolution service |
| ISessionStore.mjs | `backend/src/1_domains/fitness/ports/ISessionStore.mjs` | Session storage interface |
| IZoneLedController.mjs | `backend/src/1_domains/fitness/ports/IZoneLedController.mjs` | Zone LED controller interface |
| AmbientLedAdapter.mjs | `backend/src/2_adapters/fitness/AmbientLedAdapter.mjs` | Ambient LED controller implementation |
| VoiceMemoTranscriptionService.mjs | `backend/src/2_adapters/fitness/VoiceMemoTranscriptionService.mjs` | Voice memo transcription |
| transcriptionContext.mjs | `backend/src/2_adapters/fitness/transcriptionContext.mjs` | Whisper context builder |
| fitness.mjs | `backend/src/4_api/routers/fitness.mjs` | DDD Fitness API router |

---

### Legacy Functions: fitsync.mjs

| Function | Lines | Purpose | DDD Equivalent |
|----------|-------|---------|----------------|
| `cleanErrorMessage(error)` | 25-47 | Extract clean error from HTML responses | **GAP** |
| `isInCooldown()` | 62-72 | Check circuit breaker cooldown state | `AmbientLedAdapter` (internal logic) |
| `recordFailure(error)` | 77-95 | Record failure for circuit breaker | `AmbientLedAdapter` (internal logic) |
| `recordSuccess()` | 100-106 | Reset circuit breaker on success | `AmbientLedAdapter` (internal logic) |
| `getDefaultUsername()` | 109-112 | Get head of household username | **GAP** (config lookup) |
| `getAccessToken()` | 117-215 | Refresh OAuth token for FitnessSyncer | **GAP** |
| `baseAPI(endpoint)` | 217-246 | FitnessSyncer API base request | **GAP** |
| `setSourceId(sourceKey)` | 251-256 | Find source ID by provider type | **GAP** |
| `getSourceId(sourceKey)` | 258-263 | Find source ID by provider type | **GAP** |
| `getActivities()` | 265-336 | Fetch activities from Garmin via FitnessSyncer | **GAP** |
| `harvestActivities(job_id)` | 338-417 | Main harvest function with circuit breaker | **GAP** |
| `isFitsyncInCooldown` (export) | 419 | Export cooldown check function | **GAP** |

**Total Legacy fitsync.mjs:** 12 functions

---

### Legacy Router Endpoints: fitness.mjs

| Method | Endpoint | Lines | Purpose | DDD Equivalent |
|--------|----------|-------|---------|----------------|
| GET | `/` | 293-305 | Get fitness config (hydrated) | `GET /api/fitness` |
| GET | `/sessions/dates` | 308-317 | List all session dates | `GET /api/fitness/sessions/dates` |
| GET | `/sessions` | 320-330 | List sessions for a date | `GET /api/fitness/sessions` |
| GET | `/sessions/:sessionId` | 333-345 | Get session detail | `GET /api/fitness/sessions/:sessionId` |
| POST | `/save_session` | 348-390 | Save session data | `POST /api/fitness/save_session` |
| POST | `/save_screenshot` | 405-489 | Save session screenshot | `POST /api/fitness/save_screenshot` |
| POST | `/voice_memo` | 494-595 | Transcribe voice memo | `POST /api/fitness/voice_memo` |
| POST | `/zone_led` | 724-885 | Sync ambient LED state | `POST /api/fitness/zone_led` |
| GET | `/zone_led/status` | 891-908 | Get LED controller status | `GET /api/fitness/zone_led/status` |
| GET | `/zone_led/metrics` | 914-963 | Get LED controller metrics | `GET /api/fitness/zone_led/metrics` |
| POST | `/zone_led/reset` | 984-1002 | Reset LED controller state | `POST /api/fitness/zone_led/reset` |

**Total Legacy Router Endpoints:** 11 endpoints

---

### Legacy Functions: fitness.mjs (Router Helpers)

| Function | Lines | Purpose | DDD Equivalent |
|----------|-------|---------|----------------|
| `parseToUnixMs(value, timezone)` | 31-38 | Parse timestamp to unix ms | `TimelineService.parseToUnixMs()` |
| `deriveSessionDate(sessionId)` | 40-43 | Derive date from session ID | `Session.getDate()` |
| `resolveMediaRoot()` | 45-50 | Get media root path | `SessionService.getStoragePaths()` |
| `resolveHouseholdId(explicit)` | 52 | Resolve household ID | `SessionService.resolveHouseholdId()` |
| `isAllNullSeriesJson(parsed)` | 64-76 | Check if series is all nulls | `TimelineService.isAllNullSeries()` |
| `decodeSeries(series)` | 78-125 | Decode RLE series | `TimelineService.decodeSeries()` |
| `listSessionsForDate(date, householdId)` | 127-150 | List sessions for a date | `SessionService.listSessionsByDate()` |
| `loadSessionDetail(sessionId, householdId)` | 152-203 | Load full session detail | `SessionService.getSession()` |
| `listSessionDates(householdId)` | 205-211 | List all session dates | `SessionService.listDates()` |
| `getSessionStoragePaths(sessionId)` | 213-236 | Get storage paths for session | `SessionService.getStoragePaths()` |
| `ensureDirectory(dirPath)` | 238-243 | Create directory if missing | Inline in router |
| `loadFitnessConfig(householdId)` | 255-289 | Load fitness config | `createFitnessRouter.loadFitnessConfig()` |
| `sanitizeSessionId(value)` | 399-403 | Sanitize session ID | `Session.sanitizeSessionId()` |
| `normalizeZoneId(zoneId)` | 640-644 | Normalize zone ID | `AmbientLedAdapter.normalizeZoneId()` |
| `isAmbientLedEnabled(fitnessConfig)` | 651-660 | Check if LED feature enabled | `AmbientLedAdapter.#isEnabled()` |
| `resolveSceneFromConfig(sceneConfig, zoneKey)` | 667-686 | Resolve scene with fallback | `AmbientLedAdapter.#resolveSceneFromConfig()` |
| `resolveTargetScene(zones, sessionEnded, sceneConfig)` | 693-717 | Resolve target scene | `AmbientLedAdapter.#resolveTargetScene()` |
| `formatDuration(ms)` | 968-978 | Format duration human-readable | `AmbientLedAdapter.formatDuration()` |

**Total Legacy Router Helpers:** 18 functions

---

### DDD Functions: Domain Layer

#### Session.mjs (Session class)
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(props)` | 10-30 | Create session with all fields |
| `getDurationMs()` | 37-43 | Get session duration |
| `getDurationMinutes()` | 48-51 | Get duration in minutes |
| `isActive()` | 56-58 | Check if session is active |
| `isCompleted()` | 63-65 | Check if session is completed |
| `getParticipant(name)` | 70-72 | Get participant by name |
| `getPrimaryParticipant()` | 77-79 | Get primary participant |
| `getRosterCount()` | 84-86 | Get roster count |
| `addParticipant(participant)` | 91-95 | Add participant to roster |
| `removeParticipant(name)` | 100-102 | Remove participant |
| `end(endTime)` | 107-110 | End the session |
| `addHeartRate(participantName, value)` | 115-119 | Add HR value to series |
| `addEvent(type, data)` | 124-130 | Add timeline event |
| `addSnapshot(capture)` | 135-142 | Add snapshot/screenshot |
| `getDate()` | 147-150 | Get session date (YYYY-MM-DD) |
| `toSummary()` | 155-163 | Create session summary |
| `toJSON()` | 168-180 | Serialize to plain object |
| `static fromJSON(data)` | 185-192 | Create from plain object |
| `static generateSessionId(date)` | 198-209 | Generate session ID |
| `static isValidSessionId(id)` | 214-218 | Validate session ID format |
| `static sanitizeSessionId(id)` | 223-227 | Sanitize session ID |

**Total Session.mjs:** 21 methods

#### Participant.mjs (Participant class)
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(props)` | 7-18 | Create participant |
| `hasHrDevice()` | 24-26 | Check if has HR device |
| `setAsPrimary()` | 31-33 | Set as primary participant |
| `setAsGuest(isGuest)` | 38-40 | Set guest status |
| `assignHrDevice(deviceId)` | 45-47 | Assign HR device |
| `removeHrDevice()` | 52-54 | Remove HR device |
| `toJSON()` | 59-66 | Serialize to object |
| `static fromJSON(data)` | 71-73 | Create from object |

**Total Participant.mjs:** 8 methods

#### Zone.mjs (Zone class + utilities)
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(props)` | 17-31 | Create zone with bounds |
| `getPriority()` | 36-38 | Get zone priority |
| `containsHeartRate(hr)` | 43-45 | Check if HR in zone |
| `isHigherThan(otherZone)` | 50-52 | Compare zones |
| `isLowerThan(otherZone)` | 54-56 | Compare zones |
| `toJSON()` | 61-68 | Serialize to object |
| `static fromJSON(data)` | 73-75 | Create from object |
| `resolveZone(hr, thresholds)` | 84-91 | Resolve zone for HR |
| `getHigherZone(zone1, zone2)` | 96-98 | Get higher priority zone |
| `createDefaultZones(maxHr)` | 103-111 | Create default zones |

**Total Zone.mjs:** 10 methods

#### SessionService.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(config)` | 12-15 | Initialize with store |
| `resolveHouseholdId(explicit)` | 20-22 | Resolve household ID |
| `async createSession(data, householdId)` | 29-45 | Create new session |
| `async getSession(sessionId, householdId, options)` | 53-70 | Get session by ID |
| `async listDates(householdId)` | 77-80 | List all session dates |
| `async listSessionsByDate(date, householdId)` | 87-94 | List sessions by date |
| `async listSessionsInRange(startDate, endDate, householdId)` | 102-106 | List sessions in range |
| `async saveSession(sessionData, householdId)` | 113-140 | Save/update session |
| `async endSession(sessionId, householdId, endTime)` | 148-158 | End a session |
| `async addParticipant(sessionId, participant, householdId)` | 166-175 | Add participant |
| `async addSnapshot(sessionId, capture, householdId)` | 183-204 | Add snapshot |
| `async getActiveSessions(householdId)` | 210-214 | Get active sessions |
| `async deleteSession(sessionId, householdId)` | 221-224 | Delete session |
| `getStoragePaths(sessionId, householdId)` | 231-236 | Get storage paths |

**Total SessionService.mjs:** 14 methods

#### TimelineService.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `isPlainObject(value)` | 14-16 | Check if plain object |
| `isAllNullSeries(parsed)` | 23-35 | Check if all null series |
| `decodeSingleSeries(encoded)` | 42-70 | Decode single RLE series |
| `decodeSeries(series)` | 77-97 | Decode all series |
| `encodeToRLE(arr)` | 105-132 | Encode array to RLE |
| `encodeSingleSeries(arr)` | 139-142 | Encode single series to JSON |
| `encodeSeries(series)` | 149-161 | Encode all series |
| `parseToUnixMs(value, timezone)` | 170-189 | Parse timestamp |
| `formatTimestamp(ms, timezone)` | 197-201 | Format unix ms |
| `prepareTimelineForApi(timeline, timezone)` | 209-230 | Prepare for API response |
| `prepareTimelineForStorage(timeline)` | 237-246 | Prepare for file storage |

**Total TimelineService.mjs:** 11 methods

#### ZoneService.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(config)` | 8-10 | Initialize with config |
| `resolveZone(hr, thresholds)` | 17-20 | Resolve zone for HR |
| `getGroupZone(heartRates, thresholds)` | 27-35 | Get max zone from group |
| `getZonePriority(zoneName)` | 40-42 | Get zone priority |
| `compareZones(zone1, zone2)` | 47-51 | Compare two zones |
| `getDefaultThresholds(maxHr)` | 56-64 | Get default thresholds |
| `createZonesForDisplay(maxHr)` | 69-71 | Create zones for display |
| `getZoneColor(zoneName)` | 76-85 | Get zone color |

**Total ZoneService.mjs:** 8 methods

---

### DDD Functions: Adapter Layer

#### AmbientLedAdapter.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `formatDuration(ms)` | 22-32 | Format duration (utility) |
| `constructor(config)` | 44-82 | Initialize adapter |
| `normalizeZoneId(zoneId)` | 87-91 | Normalize zone ID |
| `#isEnabled(fitnessConfig)` | 97-106 | Check if enabled |
| `#resolveSceneFromConfig(sceneConfig, zoneKey)` | 112-130 | Resolve scene |
| `#resolveTargetScene(zones, sessionEnded, sceneConfig)` | 136-158 | Resolve target scene |
| `async syncZone(params)` | 163-321 | Main sync method |
| `getStatus(householdId)` | 326-342 | Get current status |
| `getMetrics()` | 347-395 | Get detailed metrics |
| `reset()` | 400-415 | Reset controller state |

**Total AmbientLedAdapter.mjs:** 10 methods

#### VoiceMemoTranscriptionService.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(config)` | 21-27 | Initialize with OpenAI adapter |
| `async transcribeVoiceMemo(params)` | 41-124 | Main transcription method |
| `#resolveExtension(mimeType)` | 130-138 | Resolve file extension |
| `isConfigured()` | 143-145 | Check if service configured |

**Total VoiceMemoTranscriptionService.mjs:** 4 methods

#### transcriptionContext.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `buildTranscriptionContext(sessionData)` | 18-72 | Build Whisper prompt |

**Total transcriptionContext.mjs:** 1 function

---

### DDD Router: fitness.mjs

| Method | Endpoint | Lines | Purpose |
|--------|----------|-------|---------|
| GET | `/` | 68-81 | Get fitness config (hydrated) |
| GET | `/sessions/dates` | 86-98 | List all session dates |
| GET | `/sessions` | 103-119 | List sessions for a date |
| GET | `/sessions/:sessionId` | 124-142 | Get session detail |
| POST | `/save_session` | 147-166 | Save session data |
| POST | `/save_screenshot` | 171-238 | Save session screenshot |
| POST | `/voice_memo` | 243-285 | Transcribe voice memo |
| POST | `/zone_led` | 294-315 | Sync ambient LED state |
| GET | `/zone_led/status` | 320-326 | Get LED controller status |
| GET | `/zone_led/metrics` | 331-336 | Get LED controller metrics |
| POST | `/zone_led/reset` | 341-348 | Reset LED controller state |

**Total DDD Router Endpoints:** 11 endpoints (100% parity with legacy)

---

### Gap Analysis: Fitness Domain

| Legacy Function | DDD Status | Notes |
|-----------------|------------|-------|
| `cleanErrorMessage(error)` | MISSING | Error message extraction from HTML |
| `getDefaultUsername()` | MISSING | Get head of household (use configService) |
| `getAccessToken()` | MISSING | FitnessSyncer OAuth token refresh |
| `baseAPI(endpoint)` | MISSING | FitnessSyncer API client |
| `setSourceId(sourceKey)` | MISSING | FitnessSyncer source lookup |
| `getSourceId(sourceKey)` | MISSING | FitnessSyncer source lookup |
| `getActivities()` | MISSING | Fetch Garmin activities |
| `harvestActivities(job_id)` | MISSING | Main harvest cron job |
| `isFitsyncInCooldown` | MISSING | Cooldown check export |

**Summary:**
- Legacy fitsync.mjs functions: 12
- DDD equivalents: 3 (circuit breaker logic in AmbientLedAdapter)
- Gaps: 9
- **fitsync.mjs Parity: 25%**

- Legacy router endpoints: 11
- DDD router endpoints: 11
- **Router Parity: 100%**

- Legacy router helpers: 18
- DDD equivalents: 18
- **Router Helpers Parity: 100%**

- **Overall Fitness Domain Parity: 78%** (32 of 41 functions)

**Critical Gaps:**
1. **FitnessSyncer Integration** - Entire Garmin data harvest pipeline not in DDD
   - OAuth token management
   - API client
   - Activity harvesting
   - Incremental merge logic

**Analysis:**
The router layer has achieved 100% parity - all endpoints exist in DDD with equivalent functionality. The domain layer (Session, Participant, Zone entities and services) is complete and well-structured with proper separation of concerns.

The gap is entirely in the **fitsync.mjs** library which handles FitnessSyncer/Garmin integration. This is a cron job dependency rather than a core API feature. The DDD architecture could benefit from:
- A `FitnessSyncerAdapter` in `backend/src/2_adapters/fitness/`
- An `IFitnessDataSource` port for external fitness data providers

---

## Next Steps

1. **Task 1.3:** Audit Playback domain
2. **Task 1.4:** Audit Scheduling domain
3. **Task 1.5:** Audit User domain
4. **Task 1.6:** Audit Config domain
5. **Task 2.x:** Implement missing functions by priority
