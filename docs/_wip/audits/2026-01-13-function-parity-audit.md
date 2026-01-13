# Function Parity Audit: Legacy vs DDD

**Date:** 2026-01-13
**Status:** In Progress
**Purpose:** Systematically document all functions in legacy code and their DDD equivalents to identify gaps and guide migration completion.

---

## Executive Summary

| Domain | Legacy Functions | DDD Equivalents | Gaps | Parity % |
|--------|------------------|-----------------|------|----------|
| Content | 66 | 54 | 12 | 82% |
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

## Next Steps

1. **Task 1.2:** Audit Config domain
2. **Task 1.3:** Audit Playback domain
3. **Task 1.4:** Audit Scheduling domain
4. **Task 1.5:** Audit User domain
5. **Task 2.x:** Implement missing functions by priority
