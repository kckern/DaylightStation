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
| Health | 52 | 44 | 8 | 85% |
| Finance | 35 | 22 | 13 | 63% |
| Messaging | 2 | 2 | 0 | 100% |
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

## 3. Health Domain

### Legacy Files

| File | Path | Purpose |
|------|------|---------|
| health.mjs | `backend/_legacy/lib/health.mjs` | Daily health data aggregation |
| withings.mjs | `backend/_legacy/lib/withings.mjs` | Withings weight data integration |
| strava.mjs | `backend/_legacy/lib/strava.mjs` | Strava activity integration |
| garmin.mjs | `backend/_legacy/lib/garmin.mjs` | Garmin Connect integration |
| health.mjs (router) | `backend/_legacy/routers/health.mjs` | Health API router (bridge to DDD) |

### DDD Files

| File | Path | Purpose |
|------|------|---------|
| HealthMetric.mjs | `backend/src/1_domains/health/entities/HealthMetric.mjs` | Daily health metric entity |
| WorkoutEntry.mjs | `backend/src/1_domains/health/entities/WorkoutEntry.mjs` | Workout entry entity |
| HealthAggregationService.mjs | `backend/src/1_domains/health/services/HealthAggregationService.mjs` | Health data aggregation service |
| IHealthDataStore.mjs | `backend/src/1_domains/health/ports/IHealthDataStore.mjs` | Health data store interface |
| YamlHealthStore.mjs | `backend/src/2_adapters/persistence/yaml/YamlHealthStore.mjs` | YAML-based health persistence |
| StravaHarvester.mjs | `backend/src/2_adapters/harvester/fitness/StravaHarvester.mjs` | Strava data harvester |
| WithingsHarvester.mjs | `backend/src/2_adapters/harvester/fitness/WithingsHarvester.mjs` | Withings weight harvester |
| GarminHarvester.mjs | `backend/src/2_adapters/harvester/fitness/GarminHarvester.mjs` | Garmin data harvester |
| health.mjs | `backend/src/4_api/routers/health.mjs` | DDD Health API router |

---

### Legacy Functions: health.mjs (Lib)

| Function | Lines | Purpose | DDD Equivalent |
|----------|-------|---------|----------------|
| `getDefaultUsername()` | 14-17 | Get head of household username | `YamlHealthStore.#getDefaultUsername()` |
| `md5(string)` | 19-22 | Generate MD5 hash | Not needed in DDD |
| `dailyHealth(jobId, daysBack)` | 24-223 | Main aggregation function | `HealthAggregationService.aggregateDailyHealth()` |

**Total Legacy health.mjs (lib):** 3 functions

---

### Legacy Functions: withings.mjs

| Function | Lines | Purpose | DDD Equivalent |
|----------|-------|---------|----------------|
| `resolveSecrets()` | 28-34 | Load Withings OAuth credentials | `WithingsHarvester.#refreshAccessToken()` |
| `cleanErrorMessage(error)` | 41-63 | Extract clean error from HTML | `WithingsHarvester.#cleanErrorMessage()` |
| `isInCooldown()` | 69-79 | Check circuit breaker state | `WithingsHarvester.getStatus()` (via CircuitBreaker) |
| `recordFailure(error)` | 84-102 | Record failure for circuit breaker | `CircuitBreaker.recordFailure()` |
| `recordSuccess()` | 107-113 | Reset circuit breaker on success | `CircuitBreaker.recordSuccess()` |
| `getAccessToken(username, authData)` | 115-205 | OAuth token refresh with cache | `WithingsHarvester.#refreshAccessToken()` |
| `getWeightData(job_id)` | 207-316 | Main harvest function | `WithingsHarvester.harvest()` |
| `round(value, decimals)` | 322-324 | Round to decimal places | `WithingsHarvester.#round()` |
| `isWithingsInCooldown` (export) | 319 | Export cooldown check | `WithingsHarvester.getStatus()` |

**Total Legacy withings.mjs:** 9 functions

---

### Legacy Functions: strava.mjs

| Function | Lines | Purpose | DDD Equivalent |
|----------|-------|---------|----------------|
| `cleanErrorMessage(error)` | 25-48 | Extract clean error from HTML | `StravaHarvester.#cleanErrorMessage()` |
| `isInCooldown()` | 64-74 | Check circuit breaker state | `StravaHarvester.getStatus()` |
| `recordFailure(error)` | 81-101 | Record failure for circuit breaker | `CircuitBreaker.recordFailure()` |
| `recordSuccess()` | 106-112 | Reset circuit breaker on success | `CircuitBreaker.recordSuccess()` |
| `getAccessToken(logger, username)` | 114-157 | OAuth token refresh | `StravaHarvester.#refreshAccessToken()` |
| `reauthSequence()` | 159-165 | Generate reauth URL | **GAP** |
| `baseAPI(endpoint, logger)` | 167-200 | Strava API base request | `StravaHarvester (via stravaClient)` |
| `getActivities(logger, daysBack)` | 202-291 | Fetch activities with HR enrichment | `StravaHarvester.#fetchActivities()` + `#enrichWithHeartRate()` |
| `harvestActivities(logger, job_id, daysBack)` | 293-448 | Main harvest function | `StravaHarvester.harvest()` |
| `isStravaInCooldown` (export) | 451 | Export cooldown check | `StravaHarvester.getStatus()` |

**Total Legacy strava.mjs:** 10 functions

---

### Legacy Functions: garmin.mjs

| Function | Lines | Purpose | DDD Equivalent |
|----------|-------|---------|----------------|
| `cleanErrorMessage(error)` | 17-41 | Extract clean error from HTML | `GarminHarvester.#cleanErrorMessage()` |
| `getGarminClient(targetUsername)` | 63-87 | Lazy-load Garmin client | `GarminHarvester.#getAuthenticatedClient()` |
| `isInCooldown()` | 106-117 | Check circuit breaker state | `GarminHarvester.getStatus()` |
| `recordFailure(error)` | 123-143 | Record failure for circuit breaker | `CircuitBreaker.recordFailure()` |
| `recordSuccess()` | 148-154 | Reset circuit breaker on success | `CircuitBreaker.recordSuccess()` |
| `login()` | 156-164 | Login to Garmin Connect | `GarminHarvester.#getAuthenticatedClient()` |
| `getActivities(start, limit, activityType, subActivityType)` | 170-174 | Fetch activities | `GarminHarvester.harvest()` (via client) |
| `getActivityDetails(activityId)` | 176-180 | Get activity detail | **GAP** |
| `downloadActivityData(activityId, directoryPath)` | 182-186 | Download activity data | **GAP** |
| `uploadActivityFile(filePath)` | 188-192 | Upload activity file | **GAP** |
| `uploadActivityImage(activityId, imagePath)` | 194-199 | Upload activity image | **GAP** |
| `deleteActivityImage(activityId, imageId)` | 201-205 | Delete activity image | **GAP** |
| `getSteps(date)` | 207-211 | Get steps for date | **GAP** |
| `getHeartRate(date)` | 214-218 | Get heart rate for date | **GAP** |
| `harvestActivities()` | 220-268 | Main harvest function | `GarminHarvester.harvest()` |
| `simplifyActivity(activity)` | 272-302 | Transform activity to summary | `GarminHarvester.#simplifyActivity()` |
| `isGarminInCooldown` (export) | 304 | Export cooldown check | `GarminHarvester.getStatus()` |

**Total Legacy garmin.mjs:** 17 functions

---

### Legacy Router: health.mjs (Bridge)

| Method | Endpoint | Lines | Purpose | DDD Equivalent |
|--------|----------|-------|---------|----------------|
| GET | `/daily` | 86-110 | Get daily health data | `GET /health/daily` |
| GET | `/weight` | 115-132 | Get weight data | `GET /health/weight` |
| GET | `/workouts` | 137-154 | Get Strava workout data | `GET /health/workouts` |
| GET | `/fitness` | 159-176 | Get fitness tracking data | `GET /health/fitness` |
| GET | `/nutrition` | 181-205 | Get nutrition data | `GET /health/nutrition` |
| GET | `/coaching` | 210-227 | Get coaching data | `GET /health/coaching` |
| GET | `/nutrilist/:date` | 233-252 | Get nutrilist by date | `GET /health/nutrilist/:date` |
| GET | `/nutrilist` | 254-269 | Get today's nutrilist | `GET /health/nutrilist` |
| GET | `/nutrilist/item/:uuid` | 271-284 | Get nutrilist item | `GET /health/nutrilist/item/:uuid` |
| POST | `/nutrilist` | 286-323 | Create nutrilist item | `POST /health/nutrilist` |
| PUT | `/nutrilist/:uuid` | 325-356 | Update nutrilist item | `PUT /health/nutrilist/:uuid` |
| DELETE | `/nutrilist/:uuid` | 358-377 | Delete nutrilist item | `DELETE /health/nutrilist/:uuid` |
| GET | `/status` | 383-404 | Get router status | `GET /health/status` |

**Total Legacy Router Endpoints:** 13 endpoints

---

### DDD Functions: Domain Layer

#### HealthMetric.mjs (HealthMetric class)
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(data)` | 35-42 | Create health metric with fields |
| `getWorkoutSummary()` | 48-54 | Calculate workout summary |
| `hasWeight()` | 60-62 | Check if has weight data |
| `hasNutrition()` | 68-70 | Check if has nutrition data |
| `hasWorkouts()` | 76-78 | Check if has workouts |
| `toJSON()` | 84-98 | Serialize to plain object |
| `static fromJSON(data)` | 105-107 | Create from stored data |

**Total HealthMetric.mjs:** 7 methods

#### WorkoutEntry.mjs (WorkoutEntry class)
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(data)` | 38-54 | Create workout entry |
| `hasStrava()` | 60-62 | Check if includes Strava |
| `hasGarmin()` | 68-70 | Check if includes Garmin |
| `isMerged()` | 76-78 | Check if merged from sources |
| `toJSON()` | 84-102 | Serialize to plain object |
| `static fromJSON(data)` | 110-112 | Create from stored data |

**Total WorkoutEntry.mjs:** 6 methods

#### HealthAggregationService.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(config)` | 22-28 | Initialize with store |
| `aggregateDailyHealth(userId, daysBack)` | 36-82 | Main aggregation method |
| `getHealthForDate(userId, date)` | 90-94 | Get health for specific date |
| `getHealthForRange(userId, startDate, endDate)` | 103-114 | Get health for date range |
| `#generateDateRange(daysBack)` | 124-135 | Generate date array |
| `#aggregateDayMetrics(date, sources)` | 141-183 | Aggregate single day |
| `#mergeWorkouts(strava, garmin, fitness)` | 189-300 | Merge workouts from sources |
| `#mergeHealthData(existing, newData)` | 306-321 | Merge health data |

**Total HealthAggregationService.mjs:** 8 methods

#### IHealthDataStore.mjs (Interface)
| Method | Lines | Purpose |
|--------|-------|---------|
| `loadWeightData(userId)` | 18-20 | Load weight data |
| `loadStravaData(userId)` | 27-29 | Load Strava data |
| `loadGarminData(userId)` | 36-38 | Load Garmin data |
| `loadFitnessData(userId)` | 45-47 | Load fitness data |
| `loadNutritionData(userId)` | 54-56 | Load nutrition data |
| `loadHealthData(userId)` | 63-65 | Load aggregated health |
| `saveHealthData(userId, healthData)` | 72-74 | Save health data |
| `loadCoachingData(userId)` | 81-83 | Load coaching data |
| `saveCoachingData(userId, coachingData)` | 90-92 | Save coaching data |

**Total IHealthDataStore.mjs:** 9 methods

---

### DDD Functions: Adapter Layer

#### YamlHealthStore.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(config)` | 32-41 | Initialize with services |
| `#resolveUsername(userId)` | 51-56 | Resolve user ID to username |
| `#getDefaultUsername()` | 62-66 | Get default username |
| `#loadUserFile(userId, path)` | 72-76 | Load user lifelog file |
| `#saveUserFile(userId, path, data)` | 82-85 | Save user lifelog file |
| `loadWeightData(userId)` | 96-99 | Load weight data |
| `loadStravaData(userId)` | 106-109 | Load Strava data |
| `loadGarminData(userId)` | 116-119 | Load Garmin data |
| `loadFitnessData(userId)` | 126-129 | Load fitness data |
| `loadNutritionData(userId)` | 136-139 | Load nutrition data |
| `loadHealthData(userId)` | 146-149 | Load aggregated health |
| `saveHealthData(userId, healthData)` | 157-160 | Save health data |
| `loadCoachingData(userId)` | 167-170 | Load coaching data |
| `saveCoachingData(userId, coachingData)` | 178-181 | Save coaching data |
| `getWeightForDate(userId, date)` | 193-196 | Get weight for date |
| `getWorkoutsForDate(userId, date)` | 203-216 | Get workouts for date |
| `getHealthForRange(userId, startDate, endDate)` | 224-236 | Get health for range |

**Total YamlHealthStore.mjs:** 17 methods

#### StravaHarvester.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(config)` | 48-80 | Initialize harvester |
| `get serviceId()` | 82-84 | Return service ID |
| `get category()` | 86-88 | Return harvester category |
| `harvest(username, options)` | 99-183 | Main harvest method |
| `getStatus()` | 185-187 | Get circuit breaker status |
| `#refreshAccessToken(username)` | 193-223 | Refresh OAuth token |
| `#fetchActivities(username, daysBack)` | 229-248 | Fetch activities with pagination |
| `#enrichWithHeartRate(username, activities)` | 254-306 | Enrich with HR data |
| `#saveToArchives(username, activities)` | 312-331 | Save full data to archives |
| `#generateAndSaveSummary(username, activities)` | 337-374 | Generate and save summary |
| `#createSummaryObject(activity, type)` | 380-407 | Create summary object |
| `#cleanLegacyData(summary)` | 413-426 | Clean legacy data |
| `#sortByDate(summary)` | 432-443 | Sort by date |
| `#delay(ms)` | 449-451 | Delay helper |
| `#cleanErrorMessage(error)` | 457-469 | Clean error message |

**Total StravaHarvester.mjs:** 15 methods

#### WithingsHarvester.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(config)` | 55-90 | Initialize harvester |
| `get serviceId()` | 92-94 | Return service ID |
| `get category()` | 96-98 | Return harvester category |
| `harvest(username, options)` | 108-177 | Main harvest method |
| `getStatus()` | 179-181 | Get circuit breaker status |
| `#refreshAccessToken(username)` | 187-270 | Refresh OAuth token |
| `#fetchMeasurements(accessToken, yearsBack)` | 276-332 | Fetch measurements |
| `#round(value, decimals)` | 338-340 | Round to decimals |
| `#cleanErrorMessage(error)` | 346-358 | Clean error message |

**Total WithingsHarvester.mjs:** 9 methods

#### GarminHarvester.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(config)` | 34-62 | Initialize harvester |
| `get serviceId()` | 64-66 | Return service ID |
| `get category()` | 68-70 | Return harvester category |
| `harvest(username, options)` | 80-148 | Main harvest method |
| `getStatus()` | 150-152 | Get circuit breaker status |
| `#getAuthenticatedClient(username)` | 158-162 | Get authenticated client |
| `#simplifyActivity(activity)` | 168-216 | Simplify activity data |
| `#aggregateByDate(activities)` | 222-236 | Aggregate by date |
| `#mergeAndSort(data)` | 242-251 | Merge and sort data |
| `#cleanErrorMessage(error)` | 257-278 | Clean error message |

**Total GarminHarvester.mjs:** 10 methods

---

### DDD Router: health.mjs

| Method | Endpoint | Lines | Purpose |
|--------|----------|-------|---------|
| GET | `/daily` | 72-90 | Get daily health data |
| GET | `/date/:date` | 96-114 | Get health for specific date |
| GET | `/range` | 120-139 | Get health for date range |
| GET | `/weight` | 149-155 | Get weight data |
| GET | `/workouts` | 161-169 | Get Strava workout data |
| GET | `/fitness` | 175-183 | Get fitness tracking data |
| GET | `/nutrition` | 189-197 | Get nutrition data |
| GET | `/coaching` | 203-211 | Get coaching data |
| GET | `/status` | 221-243 | Get router status |
| GET | `/nutrilist` | 254-268 | Get today's nutrilist |
| GET | `/nutrilist/item/:uuid` | 274-290 | Get nutrilist item |
| GET | `/nutrilist/:date` | 296-314 | Get nutrilist by date |
| POST | `/nutrilist` | 320-358 | Create nutrilist item |
| PUT | `/nutrilist/:uuid` | 364-395 | Update nutrilist item |
| DELETE | `/nutrilist/:uuid` | 401-423 | Delete nutrilist item |

**Total DDD Router Endpoints:** 15 endpoints (includes 2 new: `/date/:date` and `/range`)

---

### Gap Analysis: Health Domain

| Legacy Function | DDD Status | Notes |
|-----------------|------------|-------|
| `reauthSequence()` (strava.mjs) | MISSING | Generate Strava reauth URL |
| `getActivityDetails(activityId)` (garmin.mjs) | MISSING | Get single activity detail |
| `downloadActivityData(activityId, directoryPath)` (garmin.mjs) | MISSING | Download activity data file |
| `uploadActivityFile(filePath)` (garmin.mjs) | MISSING | Upload activity file |
| `uploadActivityImage(activityId, imagePath)` (garmin.mjs) | MISSING | Upload activity image |
| `deleteActivityImage(activityId, imageId)` (garmin.mjs) | MISSING | Delete activity image |
| `getSteps(date)` (garmin.mjs) | MISSING | Get steps for specific date |
| `getHeartRate(date)` (garmin.mjs) | MISSING | Get heart rate for specific date |

**Summary:**
- Legacy health.mjs (lib) functions: 3
- Legacy withings.mjs functions: 9
- Legacy strava.mjs functions: 10
- Legacy garmin.mjs functions: 17
- Legacy router endpoints: 13
- **Total Legacy:** 52 functions/endpoints

- DDD domain layer methods: 30 (HealthMetric + WorkoutEntry + Service + Port)
- DDD adapter layer methods: 51 (YamlHealthStore + 3 Harvesters)
- DDD router endpoints: 15 (includes 2 new endpoints)
- **Total DDD:** 96 functions/methods

- Gaps: 8 (all in Garmin advanced features and Strava reauth)
- **Parity: 85%** (44 of 52 functions have DDD equivalents)

**Critical Gaps:**
None - all core functionality is present. The missing functions are advanced Garmin features not used in daily operations:
1. **Garmin Activity Management** - Upload/download/delete activity data (rarely used)
2. **Garmin Daily Metrics** - Steps and heart rate by date (can use harvest data)
3. **Strava Reauth** - OAuth reauthorization flow (admin feature)

**DDD Improvements Over Legacy:**
1. **New endpoints:** `/date/:date` and `/range` for flexible date queries
2. **Clean separation:** Domain entities (HealthMetric, WorkoutEntry) encapsulate business logic
3. **Testable:** All harvesters implement IHarvester interface with dependency injection
4. **Resilient:** CircuitBreaker class provides consistent rate limiting across all harvesters
5. **Consistent:** All harvesters use same pattern for error handling, logging, and status reporting

---

## 4. Finance Domain

### Legacy Files

| File | Path | Purpose |
|------|------|---------|
| buxfer.mjs | `backend/_legacy/lib/buxfer.mjs` | Buxfer API integration for transactions |
| budget.mjs | `backend/_legacy/lib/budget.mjs` | Budget compilation and mortgage processing |
| shopping.mjs | `backend/_legacy/lib/shopping.mjs` | Gmail receipt harvesting with AI extraction |
| build_budget.mjs | `backend/_legacy/lib/budgetlib/build_budget.mjs` | Budget building with surplus allocation |
| monthly_budget.mjs | `backend/_legacy/lib/budgetlib/monthly_budget.mjs` | Monthly budget calculations |
| transactions.mjs | `backend/_legacy/lib/budgetlib/transactions.mjs` | Transaction bucket classification |

### DDD Files

| File | Path | Purpose |
|------|------|---------|
| Account.mjs | `backend/src/1_domains/finance/entities/Account.mjs` | Account entity |
| Budget.mjs | `backend/src/1_domains/finance/entities/Budget.mjs` | Budget entity |
| Mortgage.mjs | `backend/src/1_domains/finance/entities/Mortgage.mjs` | Mortgage entity |
| Transaction.mjs | `backend/src/1_domains/finance/entities/Transaction.mjs` | Transaction entity |
| BudgetService.mjs | `backend/src/1_domains/finance/services/BudgetService.mjs` | Budget CRUD operations |
| MortgageService.mjs | `backend/src/1_domains/finance/services/MortgageService.mjs` | Mortgage management |
| MortgageCalculator.mjs | `backend/src/1_domains/finance/services/MortgageCalculator.mjs` | Mortgage projection calculations |
| TransactionClassifier.mjs | `backend/src/1_domains/finance/services/TransactionClassifier.mjs` | Transaction bucket classification |
| ITransactionSource.mjs | `backend/src/1_domains/finance/ports/ITransactionSource.mjs` | Transaction source interface |
| BuxferAdapter.mjs | `backend/src/2_adapters/finance/BuxferAdapter.mjs` | Buxfer API adapter |
| BudgetCompilationService.mjs | `backend/src/3_applications/finance/BudgetCompilationService.mjs` | Budget compilation orchestrator |
| FinanceHarvestService.mjs | `backend/src/3_applications/finance/FinanceHarvestService.mjs` | Finance data harvest orchestrator |
| TransactionCategorizationService.mjs | `backend/src/3_applications/finance/TransactionCategorizationService.mjs` | AI transaction categorization |
| finance.mjs | `backend/src/4_api/routers/finance.mjs` | Finance API router |

---

### Legacy Functions: buxfer.mjs

| Function | Lines | Purpose | DDD Equivalent |
|----------|-------|---------|----------------|
| `getCredentials()` | 18-42 | Load Buxfer credentials from config/secrets | `BuxferAdapter.getCredentials()` (via constructor) |
| `getToken()` | 44-63 | Authenticate and get API token | `BuxferAdapter.getToken()` |
| `getTransactions(options)` | 64-98 | Fetch transactions with pagination | `BuxferAdapter.getTransactions()` |
| `deleteTransactions(options)` | 102-121 | Batch delete transactions by match string | **GAP** |
| `deleteTransaction(id)` | 123-133 | Delete single transaction | `BuxferAdapter.deleteTransaction()` |
| `processMortgageTransactions(options)` | 135-143 | Fetch mortgage transactions | `FinanceHarvestService.#fetchMortgageTransactions()` |
| `getAccountBalances(options)` | 146-154 | Get account balances | `BuxferAdapter.getAccountBalances()` |
| `processTransactions(options)` | 157-208 | Fetch and auto-categorize transactions | `FinanceHarvestService.harvest()` + `TransactionCategorizationService` |
| `updateTransaction(id, description, tags, memo)` | 210-224 | Update transaction details | `BuxferAdapter.updateTransaction()` |
| `addTransaction(options)` | 226-239 | Add new transaction | `BuxferAdapter.addTransaction()` |

**Total Legacy buxfer.mjs:** 10 functions

---

### Legacy Functions: budget.mjs

| Function | Lines | Purpose | DDD Equivalent |
|----------|-------|---------|----------------|
| `payrollSyncJob(key, req)` | 25 | Payroll sync cron job | **GAP** (separate job) |
| `processMortgagePaymentPlans(plans, balance, rate, minPmt, capital)` | 27-122 | Calculate payment plan projections | `MortgageCalculator.calculatePaymentPlans()` |
| `processMortgage(mortgage, accountBalances, transactions)` | 124-189 | Full mortgage status calculation | `MortgageCalculator.calculateMortgageStatus()` |
| `compileBudget()` | 191-222 | Main budget compilation function | `BudgetCompilationService.compile()` |
| `refreshFinancialData(noDL)` | 224-258 | Full data refresh + compile | `FinanceHarvestService.harvest()` |

**Total Legacy budget.mjs:** 5 functions

---

### Legacy Functions: budgetlib/build_budget.mjs

| Function | Lines | Purpose | DDD Equivalent |
|----------|-------|---------|----------------|
| `buildBudget(config, transactions)` | 6-133 | Build complete budget with allocations | `BudgetCompilationService.#compileBudgetPeriod()` |

**Total Legacy build_budget.mjs:** 1 function

---

### Legacy Functions: budgetlib/monthly_budget.mjs

| Function | Lines | Purpose | DDD Equivalent |
|----------|-------|---------|----------------|
| `getMonthlyBudget(config, transactions)` | 6-41 | Calculate monthly budget breakdown | `BudgetCompilationService.#getMonthlyBudget()` |
| `futureMonthlyBudget(options)` | 43-148 | Calculate future month projections | `BudgetCompilationService.#futureMonthlyBudget()` |
| `currentMonthlyBudget(options)` | 149-253 | Calculate current month (hybrid actual + anticipated) | `BudgetCompilationService.#currentMonthlyBudget()` |
| `pastMonthlyBudget(options)` | 256-324 | Calculate past month (actual data) | `BudgetCompilationService.#pastMonthlyBudget()` |
| `dayToDayBudgetReducer(acc, month, monthlyBudget, config)` | 327-437 | Build day-to-day budget with daily balances | `BudgetCompilationService.#buildDayToDayBudget()` |
| `transferTransactionsReducer(acc, month, monthlyBudget)` | 439-448 | Build transfer transaction summary | `BudgetCompilationService.#buildTransferSummary()` |
| `shortTermBudgetReducer(acc, month, monthlyBudget, config)` | 449-481 | Build short-term bucket allocations | `BudgetCompilationService.#buildShortTermBuckets()` |

**Total Legacy monthly_budget.mjs:** 7 functions

---

### Legacy Functions: budgetlib/transactions.mjs

| Function | Lines | Purpose | DDD Equivalent |
|----------|-------|---------|----------------|
| `findBucket(buckets, transaction)` | 1-51 | Classify transaction into budget bucket | `TransactionClassifier.classify()` |

**Total Legacy transactions.mjs:** 1 function

---

### Legacy Functions: shopping.mjs

| Function | Lines | Purpose | DDD Equivalent |
|----------|-------|---------|----------------|
| `loadShoppingConfig(username)` | 137-152 | Load shopping config for household | **GAP** |
| `buildReceiptQuery(options)` | 163-193 | Build Gmail search query | **GAP** |
| `extractHeader(message, headerName)` | 201-205 | Extract header from Gmail message | **GAP** |
| `extractBody(message)` | 212-258 | Extract email body as text | **GAP** |
| `parseEmailContent(message)` | 265-275 | Parse email for processing | **GAP** |
| `identifyRetailer(email, retailers)` | 283-295 | Match email to retailer config | **GAP** |
| `extractReceiptData(email, retailerName, logger)` | 304-358 | AI extraction of receipt data | **GAP** |
| `generateReceiptId(source, date, orderId)` | 367-370 | Generate unique receipt ID | **GAP** |
| `mergeReceipts(existing, incoming)` | 378-384 | Merge and dedupe receipts | **GAP** |
| `formatLocalTimestamp(date, timezone)` | 393-403 | Format timestamp in user timezone | **GAP** |
| `harvestShopping(logger, guidId, req)` | 412-654 | Main harvest function | **GAP** |

**Total Legacy shopping.mjs:** 11 functions

---

### DDD Functions: Domain Layer

#### Account.mjs (Account class)
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(data)` | 6-24 | Create account with fields |
| `isAsset()` | 29-31 | Check if account is asset type |
| `isLiability()` | 36-38 | Check if account is liability type |
| `updateBalance(newBalance)` | 43-46 | Update account balance |
| `applyTransaction(amount)` | 51-54 | Apply transaction to balance |
| `getAbsoluteBalance()` | 59-61 | Get absolute balance value |
| `toJSON()` | 63-74 | Serialize to plain object |
| `static fromJSON(data)` | 76-78 | Create from stored data |

**Total Account.mjs:** 8 methods

#### Budget.mjs (Budget class)
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(data)` | 6-22 | Create budget with fields |
| `getRemaining()` | 27-29 | Get remaining budget amount |
| `getPercentSpent()` | 34-37 | Get percentage spent |
| `isOverBudget()` | 42-44 | Check if over budget |
| `addSpending(amount)` | 49-51 | Add spending to budget |
| `reset()` | 56-58 | Reset spent amount |
| `isAtWarningLevel()` | 63-65 | Check if at warning level (>80%) |
| `toJSON()` | 67-78 | Serialize to plain object |
| `static fromJSON(data)` | 80-82 | Create from stored data |

**Total Budget.mjs:** 9 methods

#### Mortgage.mjs (Mortgage class)
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(data)` | 6-26 | Create mortgage with fields |
| `calculateMonthlyPayment()` | 31-44 | Calculate P&I payment |
| `getTotalMonthlyPayment()` | 49-52 | Get total with escrow |
| `getPayoffDate()` | 57-61 | Calculate payoff date |
| `getRemainingMonths()` | 66-72 | Get remaining term |
| `getLTV(homeValue)` | 77-79 | Get loan-to-value ratio |
| `getTotalInterest()` | 84-88 | Calculate total interest |
| `makePayment(principalAmount)` | 93-96 | Apply payment to balance |
| `toJSON()` | 98-109 | Serialize to plain object |
| `static fromJSON(data)` | 111-113 | Create from stored data |

**Total Mortgage.mjs:** 10 methods

#### Transaction.mjs (Transaction class)
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(data)` | 6-26 | Create transaction with fields |
| `isExpense()` | 31-33 | Check if expense type |
| `isIncome()` | 38-40 | Check if income type |
| `isTransfer()` | 45-47 | Check if transfer type |
| `getSignedAmount()` | 52-54 | Get signed amount |
| `getDateString()` | 59-61 | Get date as YYYY-MM-DD |
| `addTag(tag)` | 66-70 | Add tag to transaction |
| `removeTag(tag)` | 75-77 | Remove tag from transaction |
| `toJSON()` | 79-90 | Serialize to plain object |
| `static fromJSON(data)` | 92-94 | Create from stored data |

**Total Transaction.mjs:** 10 methods

#### BudgetService.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(config)` | 8-11 | Initialize with stores |
| `getAllBudgets()` | 16-19 | Get all budgets |
| `getBudget(id)` | 24-27 | Get budget by ID |
| `createBudget(data)` | 32-36 | Create new budget |
| `updateBudget(id, updates)` | 41-48 | Update existing budget |
| `deleteBudget(id)` | 53-55 | Delete budget |
| `syncBudgetSpending(budgetId, startDate, endDate)` | 60-77 | Sync spending from transactions |
| `getBudgetSummary()` | 82-98 | Get budget summary |
| `getBudgetsByCategory(category)` | 103-106 | Get budgets by category |

**Total BudgetService.mjs:** 9 methods

#### MortgageService.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(config)` | 8-10 | Initialize with store |
| `getMortgage(id)` | 15-18 | Get mortgage by ID |
| `getAllMortgages()` | 23-26 | Get all mortgages |
| `createMortgage(data)` | 31-36 | Create new mortgage |
| `updateBalance(id, newBalance)` | 41-48 | Update mortgage balance |
| `recordPayment(id, principalPaid)` | 53-60 | Record payment |
| `calculateAmortizationSchedule(mortgage, numPayments)` | 65-86 | Generate amortization schedule |
| `getMortgageSummary(id)` | 91-104 | Get mortgage summary |

**Total MortgageService.mjs:** 8 methods

#### MortgageCalculator.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `calculatePaymentPlans(params)` | 85-108 | Calculate payment plan projections |
| `calculateMortgageStatus(params)` | 125-199 | Calculate full mortgage status |
| `#calculateSinglePlan(params)` | 205-326 | Calculate single plan projection |
| `#findPayoffRange(paymentPlans)` | 332-352 | Find earliest/latest payoff |
| `#monthsDiff(start, end)` | 358-363 | Calculate months between dates |
| `#formatYearMonth(date)` | 369-374 | Format date as YYYY-MM |
| `#formatPayoffDate(ym)` | 380-387 | Format payoff as "Month YYYY" |
| `#parsePayoffDate(payoffStr)` | 393-409 | Parse payoff date string |
| `#round(num)` | 415-417 | Round to 2 decimal places |

**Total MortgageCalculator.mjs:** 9 methods

#### TransactionClassifier.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(config)` | 51-77 | Initialize with bucket config |
| `classify(transaction)` | 84-118 | Classify single transaction |
| `classifyAll(transactions)` | 125-141 | Classify multiple transactions |
| `groupByLabel(transactions, bucketType)` | 149-163 | Group by labels within bucket |
| `getConfiguredLabels()` | 169-174 | Get all configured labels |
| `#isTransfer(txnType, mainTag)` | 180-182 | Check if transfer |
| `#normalizeTags(tagNames)` | 188-191 | Normalize tags to array |
| `#arraysOverlap(a, b)` | 197-199 | Check array overlap |

**Total TransactionClassifier.mjs:** 8 methods

---

### DDD Functions: Adapter Layer

#### BuxferAdapter.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(config)` | 12-26 | Initialize adapter |
| `getToken()` | 32-69 | Get/refresh API token |
| `request(endpoint, params, method)` | 79-101 | Make authenticated request |
| `findByCategory(category, startDate, endDate)` | 112-119 | Find transactions by category |
| `findInRange(startDate, endDate)` | 128-131 | Find transactions in range |
| `findByAccount(accountName)` | 138-143 | Find transactions by account |
| `getTransactions(options)` | 156-201 | Fetch transactions with pagination |
| `getAccounts()` | 207-210 | Get all accounts |
| `getAccountBalances(accountNames)` | 217-233 | Get account balances |
| `updateTransaction(id, updates)` | 241-255 | Update transaction |
| `addTransaction(data)` | 262-294 | Add new transaction |
| `deleteTransaction(id)` | 301-310 | Delete transaction |
| `mapToTransaction(raw)` | 319-335 | Map to Transaction entity |
| `inferTransactionType(raw)` | 342-346 | Infer transaction type |
| `mapAccountType(buxferType)` | 353-364 | Map account type |
| `getDefaultStartDate()` | 370-374 | Get default start date |
| `getDefaultEndDate()` | 380-382 | Get default end date |
| `getMetrics()` | 388-404 | Get adapter metrics |
| `formatDuration(ms)` | 411-416 | Format duration |
| `isConfigured()` | 422-425 | Check if configured |

**Total BuxferAdapter.mjs:** 20 methods

---

### DDD Functions: Application Layer

#### BudgetCompilationService.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(deps)` | 28-35 | Initialize with dependencies |
| `compile(householdId)` | 43-88 | Main compilation method |
| `#compileBudgetPeriod(config, transactions)` | 97-128 | Compile single budget period |
| `#getMonthlyBudget(config, transactions, classifier)` | 133-162 | Get monthly breakdown |
| `#futureMonthlyBudget(month, config)` | 167-213 | Calculate future projections |
| `#pastMonthlyBudget(month, config, transactions, classifier)` | 218-301 | Calculate past actuals |
| `#currentMonthlyBudget(month, config, transactions, classifier)` | 306-401 | Calculate current hybrid |
| `#buildDayToDayBudget(monthList, monthlyBudget, config)` | 406-470 | Build day-to-day budget |
| `#calculateDailyBalances(month, transactions, budget)` | 475-518 | Calculate daily balances |
| `#buildTransferSummary(monthList, monthlyBudget)` | 523-539 | Build transfer summary |
| `#buildShortTermBuckets(monthList, monthlyBudget, config)` | 544-586 | Build short-term buckets |
| `#allocateSurplus(monthlyBudget, shortTermBuckets, config)` | 591-683 | Allocate surplus to flex buckets |
| `#calculateShortTermStatus(shortTermBuckets)` | 688-702 | Calculate short-term totals |
| `#compileMortgage(config, accountBalances, transactions)` | 707-719 | Compile mortgage status |
| `#loadAllTransactions(budgetStartDates, householdId)` | 725-734 | Load all transactions |
| `#calculateTotalBudget(monthlyBudget)` | 736-744 | Calculate total budget |
| `#calculateMonthlyCategories(monthly, month, cutoff, paycheckCount)` | 746-778 | Calculate monthly categories |
| `#getExtraIncomeForMonth(extraConfig, month, cutoff)` | 780-791 | Get extra income |
| `#generatePaycheckDates(firstPaycheckDate, count, frequencyDays)` | 793-802 | Generate paycheck dates |
| `#generateMonthList(firstMonth, lastMonth)` | 804-822 | Generate month list |
| `#getCurrentMonth()` | 824-827 | Get current month |
| `#getEndOfMonth(month)` | 829-833 | Get end of month date |
| `#getDaysInMonth(month)` | 835-838 | Get days in month |
| `#toDateString(date)` | 840-842 | Convert to date string |
| `#round(num)` | 844-846 | Round to 2 decimals |
| `#log(level, message, data)` | 848-852 | Log helper |

**Total BudgetCompilationService.mjs:** 26 methods

#### FinanceHarvestService.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(deps)` | 33-51 | Initialize with dependencies |
| `harvest(householdId, options)` | 62-162 | Main harvest method |
| `refreshPeriod(startDate, endDate, accounts, householdId)` | 173-180 | Refresh single period |
| `refreshBalances(accounts, householdId)` | 189-193 | Refresh account balances |
| `refreshMortgage(accounts, startDate, householdId)` | 203-207 | Refresh mortgage transactions |
| `categorizeAll(householdId)` | 215-226 | Run categorization on all |
| `#fetchTransactions(startDate, endDate, accounts)` | 235-246 | Fetch transactions |
| `#fetchAccountBalances(accounts)` | 251-261 | Fetch balances |
| `#fetchMortgageTransactions(accounts, startDate)` | 266-275 | Fetch mortgage transactions |
| `#runCategorization(householdId, budgets)` | 280-312 | Run categorization |
| `#toDateString(date)` | 314-316 | Convert to date string |
| `#getCurrentDate()` | 318-320 | Get current date |
| `#log(level, message, data)` | 322-326 | Log helper |

**Total FinanceHarvestService.mjs:** 13 methods

#### TransactionCategorizationService.mjs
| Function | Lines | Purpose |
|----------|-------|---------|
| `constructor(deps)` | 39-53 | Initialize with dependencies |
| `categorize(transactions, householdId)` | 62-152 | Main categorization method |
| `preview(transactions, householdId)` | 162-206 | Preview categorization (dry-run) |
| `#needsCategorization(transaction)` | 214-218 | Check if needs categorization |
| `#hasRawDescription(description)` | 226-229 | Check for raw patterns |
| `#categorizeTransaction(transaction, validTags, chatTemplate)` | 239-294 | Categorize single transaction |
| `addRawDescriptionPatterns(patterns)` | 301-303 | Add custom patterns |
| `getUncategorized(transactions)` | 311-313 | Get uncategorized list |
| `#log(level, message, data)` | 315-319 | Log helper |

**Total TransactionCategorizationService.mjs:** 9 methods

---

### DDD Router: finance.mjs

| Method | Endpoint | Lines | Purpose |
|--------|----------|-------|---------|
| GET | `/` | 63-84 | Get finance config overview |
| GET | `/data` | 94-108 | Get compiled finances (legacy compat) |
| GET | `/data/daytoday` | 114-141 | Get current day-to-day budget |
| GET | `/accounts` | 150-176 | Get account balances |
| GET | `/transactions` | 185-225 | Get transactions |
| POST | `/transactions/:id` | 230-249 | Update transaction |
| GET | `/budgets` | 258-284 | Get all budgets |
| GET | `/budgets/:budgetId` | 289-313 | Get specific budget |
| GET | `/mortgage` | 322-339 | Get mortgage data |
| POST | `/refresh` | 349-382 | Trigger full refresh |
| POST | `/compile` | 387-413 | Trigger compilation only |
| POST | `/categorize` | 418-463 | Trigger AI categorization |
| POST | `/memos/:transactionId` | 472-484 | Save transaction memo |
| GET | `/memos` | 489-499 | Get all memos |
| GET | `/metrics` | 508-522 | Get adapter metrics |

**Total DDD Router Endpoints:** 15 endpoints

---

### Gap Analysis: Finance Domain

| Legacy Function | DDD Status | Notes |
|-----------------|------------|-------|
| `deleteTransactions(options)` | MISSING | Batch delete by match string (admin/cleanup) |
| `payrollSyncJob(key, req)` | MISSING | Separate payroll sync cron job |
| `loadShoppingConfig(username)` | MISSING | Shopping receipt harvest config |
| `buildReceiptQuery(options)` | MISSING | Gmail query builder |
| `extractHeader(message, headerName)` | MISSING | Gmail parsing |
| `extractBody(message)` | MISSING | Gmail body extraction |
| `parseEmailContent(message)` | MISSING | Gmail message parsing |
| `identifyRetailer(email, retailers)` | MISSING | Retailer matching |
| `extractReceiptData(email, retailerName)` | MISSING | AI receipt extraction |
| `generateReceiptId(source, date, orderId)` | MISSING | Receipt ID generation |
| `mergeReceipts(existing, incoming)` | MISSING | Receipt deduplication |
| `formatLocalTimestamp(date, timezone)` | MISSING | Timestamp formatting |
| `harvestShopping(logger, guidId, req)` | MISSING | Main shopping harvest cron |

**Summary:**
- Legacy buxfer.mjs functions: 10
- Legacy budget.mjs functions: 5
- Legacy budgetlib functions: 9
- Legacy shopping.mjs functions: 11
- **Total Legacy:** 35 functions

- DDD domain entities methods: 37 (Account + Budget + Mortgage + Transaction)
- DDD domain services methods: 34 (BudgetService + MortgageService + MortgageCalculator + TransactionClassifier)
- DDD adapter methods: 20 (BuxferAdapter)
- DDD application services methods: 48 (BudgetCompilationService + FinanceHarvestService + TransactionCategorizationService)
- DDD router endpoints: 15
- **Total DDD:** 154 functions/methods

- Gaps: 13 (primarily shopping.mjs entire module + 2 admin functions)
- **Parity: 63%** (22 of 35 core functions have DDD equivalents)

**Critical Gaps:**
1. **Shopping Receipt Harvester** - Entire Gmail receipt harvesting module not in DDD (11 functions)
   - Gmail integration
   - AI receipt extraction
   - Receipt deduplication

2. **Admin Functions** - Less critical batch operations
   - `deleteTransactions()` - Batch delete for cleanup
   - `payrollSyncJob()` - Payroll sync cron job

**Analysis:**
The core finance functionality (Buxfer integration, budget compilation, mortgage calculations) is fully implemented in DDD with proper separation of concerns. The DDD architecture actually provides MORE functionality than legacy through:
- Proper domain entities with validation
- Application services for orchestration
- Clean adapter interfaces

The gap is entirely in the **shopping.mjs** module which is a Gmail-based receipt harvesting feature. This is an optional cron job feature that:
- Scans Gmail for shopping receipts
- Uses AI to extract itemized data
- Saves structured YAML for budget analysis

This feature could be implemented as:
- A `ShoppingHarvester` adapter in `backend/src/2_adapters/harvester/finance/`
- An `IEmailSource` port for Gmail integration

**Parity Calculation Note:**
While raw parity is 63%, the DDD implementation provides significantly more functionality:
- 154 DDD methods vs 35 legacy functions
- Better testability through dependency injection
- Clean separation between domain logic and infrastructure
- Comprehensive API with 15 endpoints

---

## 5. Messaging Domain

### Legacy Files

| File | Path | Purpose |
|------|------|---------|
| gmail.mjs | `backend/_legacy/lib/gmail.mjs` | Gmail integration (email harvesting for lifelog) |

**Note:** The legacy gmail.mjs has been refactored to be a bridge file that delegates to the new GmailAdapter architecture. The original codebase did not have dedicated Telegram/chatbot adapters in the legacy lib folder - those are DDD-only additions.

### DDD Files

| File | Path | Purpose |
|------|------|---------|
| Message.mjs | `backend/src/1_domains/messaging/entities/Message.mjs` | Message entity with factory methods |
| Conversation.mjs | `backend/src/1_domains/messaging/entities/Conversation.mjs` | Conversation entity |
| Notification.mjs | `backend/src/1_domains/messaging/entities/Notification.mjs` | Notification entity |
| IMessagingGateway.mjs | `backend/src/1_domains/messaging/ports/IMessagingGateway.mjs` | Messaging platform interface |
| IConversationStore.mjs | `backend/src/1_domains/messaging/ports/IConversationStore.mjs` | Conversation persistence interface |
| INotificationChannel.mjs | `backend/src/1_domains/messaging/ports/INotificationChannel.mjs` | Notification channel interface |
| IConversationStateStore.mjs | `backend/src/1_domains/messaging/ports/IConversationStateStore.mjs` | Conversation state persistence interface |
| ConversationService.mjs | `backend/src/1_domains/messaging/services/ConversationService.mjs` | Conversation management service |
| NotificationService.mjs | `backend/src/1_domains/messaging/services/NotificationService.mjs` | Notification management service |
| GmailAdapter.mjs | `backend/src/2_adapters/messaging/GmailAdapter.mjs` | Gmail API adapter |
| TelegramAdapter.mjs | `backend/src/2_adapters/messaging/TelegramAdapter.mjs` | Telegram Bot API adapter |
| YamlConversationStateStore.mjs | `backend/src/2_adapters/messaging/YamlConversationStateStore.mjs` | YAML-based state persistence |

---

### Legacy Functions: gmail.mjs

| Function | Lines | Purpose | DDD Equivalent | Status |
|----------|-------|---------|----------------|--------|
| `createGmailClient(username)` | 29-46 | Create Google OAuth2 client | `GmailAdapter.getClient()` | ✅ |
| `listMails(logger, job_id, targetUsername)` | 57-114 | Harvest emails for lifelog | `GmailAdapter.harvestEmails()` | ✅ |

---

### DDD-Only Functions: GmailAdapter.mjs

| Function | Lines | Purpose | Notes |
|----------|-------|---------|-------|
| `constructor()` | 7-18 | Initialize with auth factory | New architecture |
| `getClient()` | 23-28 | Get Gmail API client | Replaces createGmailClient |
| `send(notification)` | 35-62 | Send email notification | Implements INotificationChannel |
| `getInboxMessages(options)` | 69-99 | Fetch inbox messages | Refactored from legacy |
| `getSentMessages(options)` | 104-135 | Fetch sent messages | Refactored from legacy |
| `getUnreadCount()` | 140-150 | Get unread email count | New |
| `markAsRead(messageId)` | 155-165 | Mark message as read | New |
| `archiveMessage(messageId)` | 170-180 | Archive a message | New |
| `formatMessage(data)` | 187-211 | Format Gmail message | Refactored from legacy |
| `createMessage(to, subject, body)` | 216-230 | Create raw email message | New |
| `sanitize(text)` | 235-240 | Sanitize text | Helper |
| `getDateDaysAgo(days)` | 245-249 | Calculate date N days ago | Helper |
| `mergeByDate(existing, newMessages)` | 254-271 | Merge messages by date | Refactored from legacy |
| `harvestEmails(existingData)` | 276-309 | Main harvest function | Replaces listMails core logic |
| `getMetrics()` | 314-326 | Get adapter metrics | New |
| `formatDuration(ms)` | 331-336 | Format duration string | Helper |
| `isConfigured()` | 341-343 | Check if configured | New |

---

### DDD-Only Functions: TelegramAdapter.mjs

| Function | Lines | Purpose | Notes |
|----------|-------|---------|-------|
| `constructor()` | 9-26 | Initialize with token | New (no legacy equivalent) |
| `callApi(method, params, httpMethod)` | 31-62 | Make Telegram API request | Core infrastructure |
| `sendMessage(chatId, text, options)` | 69-99 | Send text message | IMessagingGateway |
| `sendImage(chatId, imageSource, caption, options)` | 104-138 | Send image | IMessagingGateway |
| `updateMessage(chatId, messageId, updates)` | 143-175 | Edit existing message | IMessagingGateway |
| `updateKeyboard(chatId, messageId, choices)` | 180-186 | Update keyboard on message | IMessagingGateway |
| `deleteMessage(chatId, messageId)` | 191-196 | Delete a message | IMessagingGateway |
| `transcribeVoice(fileId)` | 201-208 | Transcribe voice message | IMessagingGateway |
| `getFileUrl(fileId)` | 213-216 | Get file download URL | IMessagingGateway |
| `send(notification)` | 223-237 | Send notification | INotificationChannel |
| `getBotInfo()` | 244-249 | Get bot information | Bot management |
| `setWebhook(url, options)` | 254-272 | Set webhook URL | Bot management |
| `deleteWebhook(options)` | 277-283 | Delete webhook | Bot management |
| `getWebhookInfo()` | 288-290 | Get webhook info | Bot management |
| `setCommands(commands)` | 295-302 | Set bot commands | Bot management |
| `buildKeyboard(choices, inline)` | 309-329 | Build keyboard markup | Helper |
| `parseUpdate(update)` | 334-361 | Parse incoming update | Helper |
| `answerCallbackQuery(callbackQueryId, options)` | 366-372 | Answer callback query | Helper |
| `getMetrics()` | 377-389 | Get adapter metrics | New |
| `formatDuration(ms)` | 394-399 | Format duration string | Helper |
| `isConfigured()` | 404-406 | Check if configured | New |

---

### DDD-Only Functions: YamlConversationStateStore.mjs

| Function | Lines | Purpose | Notes |
|----------|-------|---------|-------|
| `constructor(config)` | 35-41 | Initialize with basePath | New (no legacy equivalent) |
| `get(conversationId, messageId)` | 113-127 | Get conversation state | IConversationStateStore |
| `set(conversationId, state, messageId)` | 135-161 | Set conversation state | IConversationStateStore |
| `delete(conversationId, messageId)` | 168-204 | Delete conversation state | IConversationStateStore |
| `clear(conversationId)` | 210-212 | Clear all state | IConversationStateStore |

---

### Domain Entity Methods

#### Message.mjs (17 methods)
- `constructor()`, `isText()`, `isVoice()`, `isImage()`, `isCallback()`, `getText()`, `getAgeMs()`, `getAgeMinutes()`, `isFrom()`, `isRecent()`, `toJSON()`, `fromJSON()`, `createText()`, `createVoice()`, `createImage()`, `createCallback()`, `generateId()`

#### Conversation.mjs (9 methods)
- `constructor()`, `addMessage()`, `getMessageCount()`, `getMessagesByParticipant()`, `getLatestMessage()`, `hasParticipant()`, `addParticipant()`, `toJSON()`, `fromJSON()`

#### Notification.mjs (8 methods)
- `constructor()`, `isSent()`, `isRead()`, `markSent()`, `markRead()`, `isHighPriority()`, `toJSON()`, `fromJSON()`

---

### Domain Service Methods

#### ConversationService.mjs (12 methods)
- `constructor()`, `createConversation()`, `getConversation()`, `getOrCreateConversation()`, `getConversationsForParticipant()`, `getActiveConversations()`, `addMessage()`, `getMessages()`, `getRecentMessages()`, `getConversationSummary()`, `archiveConversation()`, `deleteConversation()`, `getStatistics()`, `generateConversationId()`

#### NotificationService.mjs (8 methods)
- `constructor()`, `send()`, `getNotification()`, `getNotificationsForRecipient()`, `getUnreadNotifications()`, `markRead()`, `markAllRead()`, `registerChannel()`, `generateId()`

---

### Gaps Analysis

**Legacy Functions with DDD Equivalents:** 2/2 (100%)

| Legacy Function | Status | DDD Equivalent | Notes |
|-----------------|--------|----------------|-------|
| `createGmailClient()` | ✅ | `GmailAdapter.getClient()` | Refactored to use factory pattern |
| `listMails()` | ✅ | `GmailAdapter.harvestEmails()` | Core logic moved to adapter |

**Missing from DDD:** None

**DDD-Only Additions (not in legacy):**
- Complete TelegramAdapter (21 methods) - New messaging channel
- YamlConversationStateStore (5 methods) - State persistence for multi-turn conversations
- Enhanced GmailAdapter (15 additional methods vs legacy)
- Domain entities: Message, Conversation, Notification
- Domain services: ConversationService, NotificationService
- Port interfaces: IMessagingGateway, IConversationStore, INotificationChannel, IConversationStateStore

---

### Parity Summary: Messaging Domain

| Metric | Value |
|--------|-------|
| Legacy Exported Functions | 2 |
| DDD Equivalent Functions | 2 |
| Functions Missing from DDD | 0 |
| **Parity Percentage** | **100%** |

**Key Findings:**

1. **Full Parity Achieved:** All legacy Gmail functions have DDD equivalents
2. **Significant Enhancement:** DDD adds 63+ new methods across adapters, entities, and services
3. **New Capabilities:**
   - Telegram integration (IMessagingGateway implementation)
   - Conversation state management (YamlConversationStateStore)
   - Domain-driven entities (Message, Conversation, Notification)
   - Multi-channel notification support (INotificationChannel)
4. **Architecture Improvement:** Legacy was Gmail-only; DDD provides a unified messaging abstraction supporting multiple channels

**Parity Calculation Note:**
While raw parity is 100%, the DDD implementation provides substantially more functionality:
- 63+ DDD methods vs 2 legacy functions
- Multi-channel support (Gmail, Telegram, extensible to SMS/Push)
- Clean domain model with entities, ports, and services
- State persistence for complex conversation flows

---

## Next Steps

1. **Task 1.6:** Audit Playback domain
2. **Task 1.7:** Audit Scheduling domain
3. **Task 1.8:** Audit User domain
4. **Task 1.9:** Audit Config domain
5. **Task 2.x:** Implement missing functions by priority
