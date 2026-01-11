# Unified Domain-Driven Backend Architecture

## Executive Summary

Refactor the existing backend into a clean Domain-Driven Design (DDD) architecture. The current system splits "data" (filesystem) and "media" (Plex wrapper/files) across separate routers. The new architecture abstracts these into a unified, technology-agnostic domain model.

This model serves as a universal gateway, enabling the frontend to List, Open, Queue, and Play content from diverse integrations (Plex, Immich, Audiobookshelf, Home Assistant, etc.) without knowledge of the underlying source.

**Key Decisions:**
- **Migration approach:** Big bang with backward compatibility shim
- **Language:** TypeScript for interface enforcement
- **Core adapters:** Plex (remote API), Filesystem (raw files), LocalContent (enriched YAML+media)
- **LocalContent:** Unified adapter for songs, poetry, talks, scripture (replaces separate endpoints)
- **Queue logic:** Centralized QueueService (not per-adapter)
- **URL path separator:** Tilde (`~`) with smart resolution

**Scope:**

| In Scope | Out of Scope |
|----------|--------------|
| Media playback (video, audio, photos) | Finance/Budget endpoints |
| Content discovery (list, search) | Home automation control |
| Queue management & heuristics | User authentication |
| Watch state tracking | Chatbot/AI endpoints |
| LocalContent (hymns, talks, scripture) | Fitness tracking |

**Out-of-scope domains remain in existing routers** (`finance.mjs`, `fitness.mjs`, etc.) and should NOT be migrated into this architecture. They may be refactored separately with their own domain models.

**Related Documents:**
- [API Consumer Inventory](./2026-01-10-api-consumer-inventory.md) - Frontend files affected by migration

---

## 1. Core Concepts: Play vs Queue

### 1.1 The Critical Distinction

The system has two fundamentally different actions on a Queueable item:

| Action | Behavior | Use Case |
|--------|----------|----------|
| **Play** | Resolve to SINGLE next-up item | Daily programming |
| **Queue** | Resolve to ALL items, add to playback queue | Binge watching |

This distinction is crucial for daily programming:

```
play(show)   → Get next unwatched episode → play it → done
queue(show) → Get ALL episodes → play them all sequentially
```

### 1.2 The Daily Programming Pattern

For a "Morning Program" with multiple content sources:

```yaml
Morning Program (folder):
  - News Queue      → play() → ONE news clip
  - Scripture       → play() → ONE chapter
  - Crash Course    → play() → ONE episode
  - General Conf    → play() → ONE talk
```

Each `play()` returns the "next up" item based on heuristics. Tomorrow, each queue advances to its next item. This creates **variety and rotation** rather than exhausting one source before moving to the next.

If you `queue()` the Morning Program instead, you'd watch ALL news clips, then ALL scripture chapters, then ALL episodes... that's not a morning program, that's a week-long binge.

### 1.3 Composite Queues (Folders)

A **folder** in the system is a composite queue - a collection of other queueables:

```yaml
# lists.yml - items grouped by folder
- input: 'media: sfx/intro'
  folder: Morning Program
- input: 'media: news/cnn'
  folder: Morning Program
- input: 'scripture: cfm'
  folder: Morning Program
- input: 'plex: 375839'      # Crash Course Kids (a show)
  folder: Morning Program
- input: 'talk: ldsgc'
  folder: Morning Program
- input: 'app: wrapup'
  action: Open
  folder: Morning Program
```

When you "Queue" the Morning Program, it iterates through each child and executes `play()` on each, yielding ONE item from each source.

### 1.4 Reference Syntax

The folder itself can be referenced:

```yaml
- input: morning+program    # References "Morning Program" folder
  action: Queue
  label: Morning Program
  folder: TVApp             # This item appears in TVApp menu
```

---

## 2. Input Prefix Pattern (Source References)

### 2.1 Prefix Types

All content references use a prefix pattern that maps to adapters:

| Prefix | Adapter | Resolved ID | Example |
|--------|---------|-------------|---------|
| `plex:` | Plex | `{id}` | `plex: 12345` |
| `media:` | Filesystem | `{path}` | `media: news/cnn` |
| `hymn:` | LocalContent | `song/hymn/{id}` | `hymn: 113` |
| `primary:` | LocalContent | `song/primary/{id}` | `primary: 228` |
| `poem:` | LocalContent | `poetry/{path}` | `poem: remedy/01` |
| `talk:` | LocalContent | `talk/{path}` | `talk: ldsgc202510/11` |
| `scripture:` | LocalContent | `scripture/{path}` | `scripture: cfm` |
| `watchlist:` | Watchlist | `{folder}` | `watchlist: parenting` |
| `list:` | Folder | `{name}` | `list: FHE` |
| `queue:` | Folder | `{name}` | `queue: Music Queue` |
| `app:` | App | `{name}` | `app: wrapup` |
| `immich:` | Immich *(future)* | `{asset-id}` | `immich: abc-123` |
| `audiobook:` | Audiobookshelf *(future)* | `{book-id}` | `audiobook: 456` |
| `podcast:` | Audiobookshelf *(future)* | `{episode-id}` | `podcast: 789` |
| `rss:` | FreshRSS *(future)* | `{feed-id}` | `rss: tech-news` |

### 2.2 Adapter Categories

**Remote API (implemented):**
- `plex:` - Plex server (metadata + media via API)

**Local Filesystem (implemented):**
- `media:` - Raw files, no structured metadata

**LocalContent (implemented):**
- `hymn:`, `primary:` - Songs with lyrics (YAML + audio)
- `poem:` - Poetry with verses (YAML + audio)
- `talk:` - Talks with transcript (YAML + video)
- `scripture:` - Scripture with verses (YAML + audio)

**Future (not yet implemented):**
- `immich:` - Photo/video library (Immich API)
- `audiobook:`, `podcast:` - Audiobooks and podcasts (Audiobookshelf API)
- `rss:` - RSS feed articles (FreshRSS API)

**Internal:**
- `watchlist:`, `list:`, `queue:` - Curation/grouping layers
- `app:` - Openable applications

### 2.3 Input Grammar Specification

The input string syntax is more complex than simple `prefix: value`. This section defines the **complete formal grammar** based on the current implementation in `nav.mjs:processListItem()` and `fetch.mjs`.

#### 2.3.1 EBNF Grammar

```ebnf
(* Top-level input structure *)
input           = primary_input { ";" modifier } ;

(* Primary input: the main content reference *)
primary_input   = folder_ref | prefixed_ref | bare_path ;
folder_ref      = WORD { "+" WORD } ;                  (* morning+program → "morning program" *)
prefixed_ref    = prefix ":" value_list ;             (* plex: 12345, media: path/to/file *)
bare_path       = PATH ;                              (* path/to/file - implicit filesystem *)

(* Modifiers after semicolon *)
modifier        = key_value | version_special | boolean_flag ;
key_value       = KEY ":" value_list ;                (* overlay: 461309 *)
version_special = "version" WHITESPACE VERSION_ID ;   (* version redc *)
boolean_flag    = FLAG_NAME ;                         (* shuffle, playable *)

(* Values can be single or comma-separated lists *)
value_list      = value { "," value } ;               (* 12345 or 12345,67890 *)
value           = PATH | NUMBER | WORD ;

(* Multiple sources with pipe *)
multi_source    = value { "|" value } ;               (* folder1|folder2|folder3 *)

(* Terminals *)
prefix          = WORD ;
KEY             = WORD ;
FLAG_NAME       = "shuffle" | "continuous" | "playable" | "recent_on_top" ;
PATH            = ? any valid path segment ? ;
NUMBER          = DIGIT { DIGIT } ;
WORD            = LETTER { LETTER | DIGIT | "_" } ;
VERSION_ID      = WORD ;
```

#### 2.3.2 Examples (Real Config)

```yaml
# Simple prefixed reference
input: 'plex: 663035'

# With overlay modifier (video overlay during playback)
input: 'plex: 663035; overlay: 461309'

# With version modifier (scripture version)
input: 'scripture: bom; version redc'

# With boolean flags
input: 'media: music/ambient; shuffle; continuous'

# Multiple sources (pipe-separated)
input: 'media: news/world_az|news/cnn'

# Folder reference (plus becomes space)
input: 'morning+program'

# Complex: multiple modifiers
input: 'plex: 375839; shuffle; volume: 0.8; playbackrate: 1.25'

# Array value (comma-separated)
input: 'plex: 12345,67890,11111'
```

#### 2.3.3 Item-Level Properties

In addition to inline modifiers, items can have YAML-level properties that merge into the parsed input:

```yaml
- input: 'plex: 375839'
  shuffle: true          # Merged into input object
  continuous: true       # Merged into input object
  volume: 0.8            # Merged into input object
  playbackrate: 1.25     # Merged into input object
  playable: true         # Merged into input object
  days: 'Weekdays'       # Day filter (separate handling)
  active: true           # Enable/disable filter
  folder: Morning Program
```

**Inheritable properties** (from parent containers to children):
- `volume`, `shuffle`, `continuous`, `image`, `rate`, `playbackrate`

#### 2.3.4 Day Filtering

Items can be restricted to specific days:

```yaml
- input: 'plex: 12345'
  days: 'Weekdays'       # Monday-Friday only
```

| Days Value | Weekdays |
|------------|----------|
| `Monday` | 1 |
| `Tuesday` | 2 |
| `Wednesday` | 3 |
| `Thursday` | 4 |
| `Friday` | 5 |
| `Saturday` | 6 |
| `Sunday` | 7 |
| `Weekdays` | 1,2,3,4,5 |
| `Weekend` | 6,7 |
| `M•W•F` | 1,3,5 |
| `T•Th` | 2,4 |
| `M•W` | 1,3 |

### 2.4 InputParser Implementation

The InputParser must handle the complete grammar. **No hardcoded prefix mappings** - adapters self-register their prefixes (Open/Closed principle).

```typescript
interface ParsedInput {
  sources: SourceReference[];     // Primary input (can be multiple via pipe)
  modifiers: Map<string, string | string[] | true>;  // Semicolon-separated modifiers
  itemProperties: ItemProperties; // Merged from YAML-level properties
}

interface SourceReference {
  adapter: Adapter;
  localId: string;
}

interface ItemProperties {
  shuffle?: boolean;
  continuous?: boolean;
  volume?: number;
  playbackRate?: number;
  playable?: boolean;
  days?: string;
  active?: boolean;
}

class InputParser {
  constructor(private registry: AdapterRegistry) {}

  parse(inputString: string, itemProperties: ItemProperties = {}): ParsedInput {
    // 1. Split on semicolons to separate primary input from modifiers
    const parts = inputString.split(/[;]/).map(p => p.trim());
    const [primaryPart, ...modifierParts] = parts;

    // 2. Parse primary input (handles folder refs, prefixes, pipes)
    const sources = this.parsePrimaryInput(primaryPart);

    // 3. Parse modifiers
    const modifiers = this.parseModifiers(modifierParts);

    // 4. Merge item-level properties
    return { sources, modifiers, itemProperties };
  }

  private parsePrimaryInput(input: string): SourceReference[] {
    // Handle folder reference: "morning+program" → folder adapter
    if (input.includes('+') && !input.includes(':')) {
      return [{
        adapter: this.registry.get('folder'),
        localId: input.replace(/\+/g, ' ')
      }];
    }

    // Handle prefix: "plex: 12345" or "media: path1|path2"
    const match = input.match(/^(\w+):\s*(.+)$/);
    if (match) {
      const [, prefix, valuesPart] = match;

      // Handle pipe-separated multiple sources
      const values = valuesPart.split('|').map(v => v.trim());

      return values.map(value => {
        const resolved = this.registry.resolveFromPrefix(prefix, value);
        if (!resolved) {
          logger.warn('input.unknown_prefix', { prefix, value });
          return null;
        }
        return resolved;
      }).filter(Boolean);
    }

    // Default: bare path → filesystem
    return [{
      adapter: this.registry.get('filesystem'),
      localId: input
    }];
  }

  private parseModifiers(parts: string[]): Map<string, string | string[] | true> {
    const modifiers = new Map();

    for (const part of parts) {
      if (!part) continue;

      // Handle "key: value" format
      const kvMatch = part.match(/^(\w+):\s*(.+)$/);
      if (kvMatch) {
        const [, key, value] = kvMatch;
        // Handle comma-separated arrays
        if (value.includes(',')) {
          modifiers.set(key, value.split(',').map(v => v.trim()));
        } else {
          modifiers.set(key, value.trim());
        }
        continue;
      }

      // Handle special "version X" format (no colon)
      if (part.startsWith('version ')) {
        modifiers.set('version', part.replace('version ', '').trim());
        continue;
      }

      // Boolean flag (just the key name)
      modifiers.set(part, true);
    }

    return modifiers;
  }
}
```

### 2.5 Config Path Modifiers

Endpoints can receive additional configuration via URL path segments:

```
GET /media/plex/info/12345/shuffle
GET /api/list/filesystem/music/playable,recent_on_top
```

| Modifier | Effect |
|----------|--------|
| `shuffle` | Randomize order |
| `playable` | Only return playable items (skip containers) |
| `recent_on_top` | Sort by menu memory (recently accessed first) |

These are parsed from the URL and merged with parsed input modifiers.

**Adding new prefixes requires only adapter changes** (Open/Closed principle):
- Add new adapter → registers its prefixes → InputParser automatically supports them
- No core code modifications needed

---

## 3. Two Granularity Levels

### 3.1 Container-Level References

Most items in `lists.yml` reference containers:

```yaml
- input: 'plex: 375839'     # A show - resolves to episodes
  label: Crash Course Kids
  folder: Morning Program
```

The system traverses to playable leaves automatically.

### 3.2 Item-Level Curation (Watchlist)

The `watchlist.yml` pattern is for fine-grained control:

```yaml
- media_key: '225728'           # Specific Plex episode ID
  program: Yale - New Testament # Series grouping
  index: 1                      # Position in series
  progress: 100                 # Watch progress
  watched: true
  priority: Medium
  folder: Bible
  title: "Introduction - Why Study the New Testament"
  summary: "This course approaches the New Testament not as scripture..."
```

This is **enriched metadata** beyond what Plex provides:
- User-defined grouping (`folder`, `program`)
- Manual ordering (`index`)
- Custom scheduling (`priority`)
- Rich descriptions

### 3.3 Watchlist as Curation Layer

The watchlist is effectively a **user-defined adapter** - it wraps items from any source with additional metadata and unified tracking:

```typescript
interface WatchlistItem extends Item {
  // Source reference
  mediaKey: string;           // Original source ID

  // Curation metadata
  program?: string;           // Series/collection name
  index?: number;             // Position in series

  // Enrichment
  title: string;              // Can override source title
  summary?: string;           // Can add custom description

  // Scheduling
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  skipAfter?: string;
  waitUntil?: string;

  // Watch state
  progress?: number;
  watched?: boolean;
}
```

---

## 4. Core Domain Types

### 4.1 Base Item

Every object in the system inherits from `Item`:

```typescript
interface Item {
  id: string;              // Compound: "plex:12345" or "filesystem:audio~music~song.mp3"
  source: string;          // "plex" | "filesystem" | "immich" | etc.
  title: string;
  thumbnail?: string;      // Proxied URL: "/proxy/plex/thumb/12345"
  description?: string;
  metadata?: Record<string, unknown>;
}
```

### 4.2 Capability Interfaces

Items implement one or more capabilities:

```typescript
interface Listable extends Item {
  itemType: 'container' | 'leaf';
  childCount?: number;
  sortOrder?: number;
}

interface Playable extends Item {
  mediaType: 'audio' | 'video' | 'live' | 'composite';
  mediaUrl: string;
  duration?: number;        // undefined for live streams
  resumable: boolean;       // false for tracks, clips, live
  resumePosition?: number;  // only if resumable AND in-progress
  playbackRate?: number;
}

interface Openable extends Item {
  openType: 'iframe' | 'native' | 'external';
  openUrl: string;
}

interface Queueable extends Item {
  traversalMode: 'sequential' | 'shuffle' | 'heuristic';
  isContainer: boolean;     // true = needs resolution to leaves
}
```

### 4.3 Polymorphism

An item can implement multiple interfaces:
- **Plex Season:** `Listable` (browse episodes) + `Queueable` (play through)
- **Album Track:** `Listable` (appears in lists) + `Playable` (renders audio)
- **Plex Show:** `Listable` + `Queueable` with `isContainer: true` (resolves to episodes)

### 4.4 Resumable vs Ephemeral

Not all media needs watch state tracking:

```typescript
type ResumablePlayable = Playable & { resumable: true; duration: number };
type EphemeralPlayable = Playable & { resumable: false };
```

**Resumable:** Movies, episodes, audiobooks
**Ephemeral:** Music tracks, clips, trailers, live streams

---

## 5. Adapter Pattern

### 5.1 Adapter Interface

Every integration implements a common interface:

```typescript
interface Adapter {
  readonly source: string;

  // Prefix registration (adapters declare their own prefixes)
  readonly prefixes: PrefixMapping[];

  // Discovery & Navigation
  getItem(id: string): Promise<Item | null>;
  getList(id: string): Promise<Listable[]>;

  // Resolution (for Queueables)
  resolvePlayables(id: string): Promise<Playable[]>;

  // Storage path for watch state
  getStoragePath?(id: string): Promise<string>;

  // Search (optional)
  search?(query: string): Promise<Item[]>;

  // Proxy support
  proxy?: ProxyHandler;
}

interface PrefixMapping {
  prefix: string;           // e.g., "hymn", "plex", "media"
  idTransform?: (value: string) => string;  // Optional: "hymn" → "song/hymn/{value}"
}

interface ProxyHandler {
  stream(id: string, req: Request, res: Response): Promise<void>;
  thumbnail(id: string, req: Request, res: Response): Promise<void>;
}
```

### 5.2 Adapter Registry

Central registry for adapter lookup. **Prefix map is built dynamically from adapters** (Open/Closed principle):

```typescript
class AdapterRegistry {
  private adapters: Map<string, Adapter> = new Map();
  private prefixMap: Map<string, { adapter: Adapter; transform?: (v: string) => string }> = new Map();

  register(adapter: Adapter): void {
    this.adapters.set(adapter.source, adapter);

    // Build prefix map from adapter's declared prefixes
    for (const mapping of adapter.prefixes) {
      this.prefixMap.set(mapping.prefix, {
        adapter,
        transform: mapping.idTransform
      });
    }
  }

  get(source: string): Adapter {
    return this.adapters.get(source);
  }

  // Resolve "hymn: 113" → { adapter: LocalContentAdapter, localId: "song/hymn/113" }
  resolveFromPrefix(prefix: string, value: string): { adapter: Adapter; localId: string } | null {
    const entry = this.prefixMap.get(prefix);
    if (!entry) return null;

    const localId = entry.transform ? entry.transform(value) : value;
    return { adapter: entry.adapter, localId };
  }

  // List all registered prefixes (for validation/docs)
  getRegisteredPrefixes(): string[] {
    return Array.from(this.prefixMap.keys());
  }

  /**
   * Resolve a compound ID to adapter + localId.
   * Compound IDs use format: "source:localId" (e.g., "plex:12345", "filesystem:audio/music/song.mp3")
   *
   * This differs from resolveFromPrefix():
   * - resolveFromPrefix("hymn", "113") → uses prefix mapping → LocalContentAdapter
   * - resolve("plex:12345") → uses source name directly → PlexAdapter
   */
  resolve(compoundId: string): { adapter: Adapter; localId: string } | null {
    const colonIndex = compoundId.indexOf(':');
    if (colonIndex === -1) {
      // No colon - treat as filesystem path (default adapter)
      const defaultAdapter = this.adapters.get('filesystem');
      return defaultAdapter ? { adapter: defaultAdapter, localId: compoundId } : null;
    }

    const source = compoundId.substring(0, colonIndex);
    const localId = compoundId.substring(colonIndex + 1);

    // First try exact source match (e.g., "plex", "filesystem", "folder")
    const adapter = this.adapters.get(source);
    if (adapter) {
      return { adapter, localId };
    }

    // Fall back to prefix resolution (e.g., "hymn" → LocalContentAdapter)
    return this.resolveFromPrefix(source, localId);
  }

  /**
   * Check if a compound ID can be resolved
   */
  canResolve(compoundId: string): boolean {
    return this.resolve(compoundId) !== null;
  }
}
```

### 5.3 Example: PlexAdapter

```typescript
class PlexAdapter implements Adapter {
  source = 'plex';

  // Plex registers its own prefix
  prefixes = [
    { prefix: 'plex' }  // No transform needed: "plex: 12345" → "12345"
  ];

  async getItem(id: string): Promise<Item> {
    const meta = await this.client.loadMeta(id);
    return this.toItem(meta);
  }

  async resolvePlayables(id: string): Promise<Playable[]> {
    // Traverses show → seasons → episodes
    // Returns only leaf nodes (episodes, tracks, movies)
  }

  async getStoragePath(id: string): Promise<string> {
    const meta = await this.client.loadMeta(id);
    const libraryId = meta.librarySectionID;
    const libraryName = slugify(meta.librarySectionTitle);
    return `${libraryId}_${libraryName}`;  // "1_movies"
  }
}
```

### 5.4 FilesystemAdapter

**FilesystemAdapter** handles raw media files on the local filesystem - audio, video, and images without structured metadata (unlike LocalContent which couples YAML data with media).

#### 5.4.1 Capabilities

| Capability | Support | Notes |
|------------|---------|-------|
| Listable | ✅ | Browse directories |
| Playable | ✅ | Stream audio/video files |
| Queueable | ✅ | Resolve folder to playable children |
| Openable | ❌ | Not applicable |

#### 5.4.2 Prefix Registration

```typescript
class FilesystemAdapter implements Adapter {
  source = 'filesystem';

  prefixes = [
    { prefix: 'media' },      // media: path/to/file
    { prefix: 'file' },       // file: path/to/file (alias)
    { prefix: 'fs' },         // fs: path/to/file (alias)
  ];

  constructor(
    private mediaBasePath: string,        // e.g., /media
    private imgBasePath: string,          // e.g., /media/img
    private watchStateStore: WatchStateStore,
    private dirCache: DirectoryCache
  ) {}
}
```

#### 5.4.3 Path Resolution with Fallbacks

The filesystem adapter supports legacy path patterns with prefix fallbacks:

```typescript
// Fallback prefixes for legacy path support
private readonly MEDIA_PREFIXES = ['', 'audio', 'video', 'img'];

private readonly ALLOWED_EXTENSIONS = {
  audio: ['.mp3', '.m4a', '.wav', '.flac', '.ogg'],
  video: ['.mp4', '.webm', '.mkv', '.avi'],
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg']
};

/**
 * Resolve a media key to an actual filesystem path.
 * Tries each prefix in order: root, audio/, video/, img/
 */
private resolvePath(mediaKey: string): ResolvedPath | null {
  // Security: sanitize path first (see Section 10)
  const sanitized = sanitizePath(mediaKey, this.mediaBasePath);
  if (!sanitized) return null;

  // Try direct path first
  if (this.dirCache.exists(sanitized)) {
    return { path: sanitized, prefix: '' };
  }

  // Try each prefix fallback
  for (const prefix of this.MEDIA_PREFIXES) {
    if (!prefix) continue;
    const candidate = `${this.mediaBasePath}/${prefix}/${mediaKey}`;
    const safePath = sanitizePath(candidate, this.mediaBasePath);
    if (safePath && this.dirCache.exists(safePath)) {
      return { path: safePath, prefix };
    }
  }

  return null;
}

/**
 * Find file with extension detection.
 * If no extension provided, try common media extensions.
 */
private findFile(mediaKey: string): ResolvedFile | null {
  const hasExtension = /\.[^/.]+$/.test(mediaKey);

  if (hasExtension) {
    const resolved = this.resolvePath(mediaKey);
    if (resolved) {
      return this.buildResolvedFile(resolved.path);
    }
    return null;
  }

  // No extension - try each media type's extensions
  const allExtensions = [
    ...this.ALLOWED_EXTENSIONS.audio,
    ...this.ALLOWED_EXTENSIONS.video
  ];

  for (const ext of allExtensions) {
    const resolved = this.resolvePath(`${mediaKey}${ext}`);
    if (resolved) {
      return this.buildResolvedFile(resolved.path);
    }
  }

  return null;
}

private buildResolvedFile(filePath: string): ResolvedFile {
  const stats = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();

  return {
    path: filePath,
    size: stats.size,
    extension: ext,
    mimeType: this.getMimeType(ext),
    mediaType: this.getMediaType(ext)
  };
}

private getMimeType(ext: string): string {
  const mimeTypes: Record<string, string> = {
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/mp4',
    '.wav': 'audio/wav',
    '.mp4': 'video/mp4',
    '.webm': 'video/webm',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml'
  };
  return mimeTypes[ext] ?? 'application/octet-stream';
}

private getMediaType(ext: string): 'audio' | 'video' | 'image' {
  if (this.ALLOWED_EXTENSIONS.audio.includes(ext)) return 'audio';
  if (this.ALLOWED_EXTENSIONS.video.includes(ext)) return 'video';
  return 'image';
}
```

#### 5.4.4 Core Adapter Methods

```typescript
async getItem(id: string): Promise<FilesystemItem | null> {
  const file = this.findFile(id);
  if (!file) return null;

  // Extract metadata from file (ID3 tags, etc.)
  const fileMeta = await this.extractFileMetadata(file.path);

  // Get config overrides from media_config.yml
  const configMeta = await this.getConfigMetadata(id);

  return {
    id: `filesystem:${id}`,
    source: 'filesystem',
    title: configMeta.title ?? fileMeta.title ?? path.basename(id, file.extension),
    thumbnail: configMeta.image ?? this.extractEmbeddedArt(file.path),
    mediaUrl: `/proxy/filesystem/stream/${id}`,
    mediaType: file.mediaType,
    duration: fileMeta.duration,
    resumable: file.mediaType === 'video',  // Videos resumable, audio not
    metadata: {
      ...fileMeta,
      ...configMeta,
      fileSize: file.size,
      mimeType: file.mimeType
    }
  };
}

async getList(id: string): Promise<Listable[]> {
  const dirPath = this.resolvePath(id);
  if (!dirPath || !this.dirCache.isDirectory(dirPath.path)) {
    return [];
  }

  const entries = await fs.promises.readdir(dirPath.path, { withFileTypes: true });
  const items: Listable[] = [];

  for (const entry of entries) {
    const childId = `${id}/${entry.name}`;

    if (entry.isDirectory()) {
      items.push({
        id: `filesystem:${childId}`,
        source: 'filesystem',
        title: entry.name,
        itemType: 'container',
        childCount: await this.countChildren(childId)
      });
    } else {
      const ext = path.extname(entry.name).toLowerCase();
      if (this.isMediaFile(ext)) {
        const item = await this.getItem(childId);
        if (item) {
          items.push({
            ...item,
            itemType: 'leaf'
          });
        }
      }
    }
  }

  // Apply menu memory sorting (recently accessed first)
  return this.sortByMenuMemory(items);
}

async resolvePlayables(id: string): Promise<Playable[]> {
  const file = this.findFile(id);

  // Single file - return it directly
  if (file && !this.dirCache.isDirectory(file.path)) {
    const item = await this.getItem(id);
    return item ? [item] : [];
  }

  // Directory - get all playable children recursively
  const list = await this.getList(id);
  const playables: Playable[] = [];

  for (const item of list) {
    if (item.itemType === 'leaf') {
      playables.push(item as Playable);
    } else if (item.itemType === 'container') {
      // Recurse into subdirectories
      const localId = item.id.replace('filesystem:', '');
      const children = await this.resolvePlayables(localId);
      playables.push(...children);
    }
  }

  return playables;
}

async getStoragePath(id: string): Promise<string> {
  // All filesystem items share one watch state file
  return 'media';
}
```

#### 5.4.5 Metadata Extraction

```typescript
import { parseFile } from 'music-metadata';

private async extractFileMetadata(filePath: string): Promise<FileMetadata> {
  try {
    const metadata = await parseFile(filePath);
    return {
      title: metadata.common.title,
      artist: metadata.common.artist,
      album: metadata.common.album,
      year: metadata.common.year,
      track: metadata.common.track?.no,
      genre: metadata.common.genre?.[0],
      duration: metadata.format.duration
    };
  } catch {
    return {};
  }
}

private async extractEmbeddedArt(filePath: string): Promise<string | null> {
  try {
    const metadata = await parseFile(filePath);
    const picture = metadata.common.picture?.[0];
    if (picture) {
      // Return data URL or cache and return proxy URL
      return `/proxy/filesystem/art/${encodeURIComponent(filePath)}`;
    }
  } catch {
    // No embedded art
  }
  return null;
}

private async getConfigMetadata(mediaKey: string): Promise<ConfigMetadata> {
  // Load from media_config.yml
  const mediaConfig = await this.loadMediaConfig();
  return mediaConfig.find(c => c.media_key === mediaKey) ?? {};
}
```

#### 5.4.6 Proxy Handler

```typescript
class FilesystemProxyHandler implements ProxyHandler {
  constructor(
    private adapter: FilesystemAdapter,
    private mediaBasePath: string
  ) {}

  async stream(id: string, req: Request, res: Response): Promise<void> {
    const file = this.adapter.findFile(id);
    if (!file) {
      res.status(404).json({ error: 'File not found', mediaKey: id });
      return;
    }

    // Set headers
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.size);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', 'public, max-age=31536000');

    // Handle range requests for seeking
    const range = req.headers.range;
    if (range) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : file.size - 1;

      if (start >= file.size || end >= file.size) {
        res.status(416).send('Requested range not satisfiable');
        return;
      }

      const chunkSize = end - start + 1;
      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${file.size}`);
      res.setHeader('Content-Length', chunkSize);

      fs.createReadStream(file.path, { start, end }).pipe(res);
    } else {
      res.status(200);
      fs.createReadStream(file.path).pipe(res);
    }
  }

  async thumbnail(id: string, req: Request, res: Response): Promise<void> {
    // Try to find image file or extract embedded art
    const imgPath = `${this.mediaBasePath}/img/${id}`;

    // Check for image file with various extensions
    const exts = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];
    for (const ext of exts) {
      const candidate = imgPath.endsWith(ext) ? imgPath : `${imgPath}${ext}`;
      if (fs.existsSync(candidate)) {
        const mimeType = this.adapter.getMimeType(ext);
        res.setHeader('Content-Type', mimeType);
        res.setHeader('Cache-Control', 'public, max-age=31536000');
        fs.createReadStream(candidate).pipe(res);
        return;
      }
    }

    // Try to extract embedded art from media file
    const file = this.adapter.findFile(id);
    if (file) {
      try {
        const metadata = await parseFile(file.path);
        const picture = metadata.common.picture?.[0];
        if (picture) {
          res.setHeader('Content-Type', picture.format);
          res.setHeader('Content-Length', picture.data.length);
          res.status(200).send(Buffer.from(picture.data));
          return;
        }
      } catch {
        // No embedded art
      }
    }

    // Return 404 or placeholder
    res.status(404).json({ error: 'Thumbnail not found' });
  }
}
```

#### 5.4.7 Types

```typescript
interface ResolvedPath {
  path: string;
  prefix: string;
}

interface ResolvedFile {
  path: string;
  size: number;
  extension: string;
  mimeType: string;
  mediaType: 'audio' | 'video' | 'image';
}

interface FileMetadata {
  title?: string;
  artist?: string;
  album?: string;
  year?: number;
  track?: number;
  genre?: string;
  duration?: number;
}

interface ConfigMetadata {
  title?: string;
  image?: string;
  playbackRate?: number;
  volume?: number;
  shuffle?: boolean;
  continuous?: boolean;
}

interface FilesystemItem extends Item, Playable {
  metadata: FileMetadata & ConfigMetadata & {
    fileSize: number;
    mimeType: string;
  };
}
```

---

### 5.5 LocalContentAdapter

**LocalContent** is enriched local content that couples:
- **YAML data files** (`data/content/`) - structured metadata, display content (lyrics, transcript)
- **Media files** (`media/`) - audio or video files

This distinguishes from:
- **Plex** - remote API provides both metadata and media
- **Filesystem** - raw media files with no structured metadata

#### 5.4.1 Content Type Configuration

```typescript
interface LocalContentConfig {
  dataPath: string;                    // Path under data/content/
  mediaPath: string;                   // Path under media/
  mediaType: 'audio' | 'video';
  displayType: 'verses' | 'paragraphs';
  resumable: boolean;
}

const LOCAL_CONTENT_TYPES: Record<string, LocalContentConfig> = {
  song: {
    dataPath: 'content/songs',         // hymn/, primary/, childrenssongbook/
    mediaPath: 'audio/songs',
    mediaType: 'audio',
    displayType: 'verses',
    resumable: false                   // Songs don't need resume
  },
  poetry: {
    dataPath: 'content/poetry',        // remedy/
    mediaPath: 'audio/poetry',
    mediaType: 'audio',
    displayType: 'verses',
    resumable: false
  },
  talk: {
    dataPath: 'content/talks',         // ldsgc202510/
    mediaPath: 'video/talks',
    mediaType: 'video',
    displayType: 'paragraphs',
    resumable: true                    // Talks are long, need resume
  },
  scripture: {
    dataPath: 'content/scripture',     // bofm/, dc/, nt/, ot/
    mediaPath: 'audio/scripture',
    mediaType: 'audio',
    displayType: 'verses',
    resumable: false
  }
};
```

#### 5.4.2 LocalContentAdapter Implementation

```typescript
class LocalContentAdapter implements Adapter {
  source = 'local-content';

  // LocalContent registers ALL its prefixes with transforms
  prefixes = [
    { prefix: 'hymn',      idTransform: (v: string) => `song/hymn/${v}` },
    { prefix: 'primary',   idTransform: (v: string) => `song/primary/${v}` },
    { prefix: 'poem',      idTransform: (v: string) => `poetry/${v}` },
    { prefix: 'poetry',    idTransform: (v: string) => `poetry/${v}` },
    { prefix: 'talk',      idTransform: (v: string) => `talk/${v}` },
    { prefix: 'scripture', idTransform: (v: string) => `scripture/${v}` },
  ];

  constructor(
    private dataBasePath: string,      // e.g., /data
    private mediaBasePath: string      // e.g., /media
  ) {}

  async getItem(id: string): Promise<LocalContentItem> {
    // id format: "song/hymn/113" or "talk/ldsgc202510/11"
    const [contentType, ...pathParts] = id.split('/');
    const config = LOCAL_CONTENT_TYPES[contentType];

    const dataPath = `${this.dataBasePath}/${config.dataPath}/${pathParts.join('/')}.yaml`;
    const data = await this.loadYaml(dataPath);

    const mediaUrl = this.resolveMediaUrl(config, pathParts);

    return {
      id: `local-content:${id}`,
      source: 'local-content',
      title: data.title,
      mediaUrl,
      mediaType: config.mediaType,
      displayType: config.displayType,
      displayContent: data.verses || data.content,
      resumable: config.resumable,
      metadata: data  // author, speaker, condition, etc.
    };
  }

  async resolvePlayables(id: string): Promise<Playable[]> {
    const [contentType, ...pathParts] = id.split('/');
    const config = LOCAL_CONTENT_TYPES[contentType];

    // If path points to a folder, list all items
    const fullPath = `${this.dataBasePath}/${config.dataPath}/${pathParts.join('/')}`;
    if (await this.isDirectory(fullPath)) {
      const files = await this.listYamlFiles(fullPath);
      return Promise.all(files.map(f => this.getItem(`${contentType}/${pathParts.join('/')}/${f}`)));
    }

    // Single item
    return [await this.getItem(id)];
  }

  private resolveMediaUrl(config: LocalContentConfig, pathParts: string[]): string {
    const ext = config.mediaType === 'video' ? 'mp4' : 'mp3';
    return `/proxy/local-content/stream/${config.mediaPath}/${pathParts.join('/')}.${ext}`;
  }
}
```

#### 5.4.3 Input Prefix to LocalContent Mapping

The input prefix pattern maps to LocalContent IDs:

| Input Prefix | LocalContent ID | Notes |
|--------------|-----------------|-------|
| `hymn: 113` | `song/hymn/113` | Hymn #113 |
| `primary: 228` | `song/primary/228` | Primary song #228 |
| `poem: remedy` | `poetry/remedy/{next}` | Next poem from remedy collection |
| `poem: remedy/01` | `poetry/remedy/01` | Specific poem |
| `talk: ldsgc202510` | `talk/ldsgc202510/{next}` | Next talk from conference |
| `talk: ldsgc202510/11` | `talk/ldsgc202510/11` | Specific talk |
| `scripture: cfm` | `scripture/cfm/{next}` | Next scripture from Come Follow Me |

```typescript
function mapInputToLocalContent(prefix: string, value: string): string {
  const mappings: Record<string, string> = {
    'hymn': 'song/hymn',
    'primary': 'song/primary',
    'poem': 'poetry',
    'poetry': 'poetry',
    'talk': 'talk',
    'scripture': 'scripture'
  };

  const contentPath = mappings[prefix];
  if (!contentPath) return null;  // Not a local-content prefix

  return `local-content:${contentPath}/${value}`;
}
```

#### 5.4.4 Display Content Types

LocalContent items carry display content for the ContentScroller UI:

```typescript
interface LocalContentItem extends Playable {
  displayType: 'verses' | 'paragraphs';
  displayContent: string[][] | string[];  // Verses (stanzas) or paragraphs
  metadata: {
    // Song-specific
    hymn_num?: number;

    // Poetry-specific
    author?: string;
    condition?: string;
    also_suitable_for?: string[];

    // Talk-specific
    speaker?: string;

    // Scripture-specific
    reference?: string;
    headings?: { title: string; subtitle?: string };
  };
}
```

### 5.6 Future: ImmichAdapter (Placeholder)

**Status:** Not yet implemented

**Purpose:** Photo/video library management via Immich API

```typescript
class ImmichAdapter implements Adapter {
  source = 'immich';

  // Capabilities:
  // - Listable: Albums, folders, timeline views
  // - Playable: Slideshows, video playback
  // - Queueable: Photo sequences, album playback

  // TODO: Implement when Immich integration is prioritized
}
```

**Input prefix:** `immich: {album-id}` or `immich: {asset-id}`

**Data sources:**
- Immich API for metadata and media
- No local YAML needed (API-complete like Plex)

---

### 5.7 Future: AudiobookshelfAdapter (Placeholder)

**Status:** Not yet implemented

**Purpose:** Audiobook and podcast library via Audiobookshelf API

```typescript
class AudiobookshelfAdapter implements Adapter {
  source = 'audiobookshelf';

  // Capabilities:
  // - Listable: Library, series, authors
  // - Playable: Audio (resumable), chapters
  // - Queueable: Book chapters, podcast episodes
  // - Openable: eBook reader (if supported)

  // TODO: Implement when Audiobookshelf integration is prioritized
}
```

**Input prefix:** `audiobook: {book-id}` or `podcast: {episode-id}`

**Key considerations:**
- Resumable long-form audio (similar to Plex movies)
- Chapter-level navigation
- Sync with Audiobookshelf progress tracking

---

### 5.8 FolderAdapter

**FolderAdapter** is a meta-adapter that manages collections of items from any source. Folders are defined in `lists.yml` and group items by folder name. Unlike other adapters that wrap external sources, FolderAdapter orchestrates other adapters.

#### 5.8.1 Capabilities

| Capability | Support | Notes |
|------------|---------|-------|
| Listable | ✅ | Browse folder contents |
| Playable | ❌ | Folders are containers, not playable |
| Queueable | ✅ | Resolve to playable items from children |
| Openable | ❌ | Not applicable |

#### 5.8.2 Prefix Registration

```typescript
class FolderAdapter implements Adapter {
  source = 'folder';

  prefixes = [
    { prefix: 'list' },           // list: FHE
    { prefix: 'queue' },          // queue: Music Queue
    { prefix: 'folder' },         // folder: Morning Program
  ];

  constructor(
    private registry: AdapterRegistry,
    private inputParser: InputParser,
    private queueService: QueueService,
    private configPath: string           // Path to lists.yml
  ) {}
}
```

#### 5.8.3 Folder Data Model

Folders are defined in `lists.yml`:

```yaml
# lists.yml
_schemaVersion: 1

# Each item belongs to a folder
- input: 'media: sfx/intro'
  folder: Morning Program

- input: 'scripture: cfm'
  folder: Morning Program
  shuffle: false

- input: 'plex: 375839'
  folder: Morning Program
  label: Crash Course Kids

- input: 'talk: ldsgc'
  folder: Morning Program

- input: 'app: wrapup'
  action: Open
  folder: Morning Program

# Folder can reference another folder
- input: morning+program
  folder: TVApp
  label: Morning Program
  action: Queue

# Folder with day filtering
- input: 'plex: 409169'
  folder: Kids Shows
  days: 'Weekend'
  shuffle: true
```

#### 5.8.4 Types

```typescript
interface FolderItem {
  input: string;                    // Raw input string: 'plex: 12345'
  folder: string;                   // Folder name this item belongs to
  label?: string;                   // Display label (overrides source title)
  action?: 'play' | 'queue' | 'open';  // Default: 'play'

  // Playback modifiers
  shuffle?: boolean;
  continuous?: boolean;
  volume?: number;
  playbackRate?: number;

  // Scheduling
  days?: string;                    // 'Weekdays', 'Weekend', 'M•W•F', etc.
  active?: boolean;                 // Enable/disable item

  // Display
  image?: string;
  folder_color?: string;            // Used for folder-level styling
}

interface Folder extends Item, Queueable {
  name: string;
  items: FolderItem[];
  itemCount: number;
}

interface ResolvedFolderItem extends Item {
  sourceItem: FolderItem;           // Original config
  resolvedAdapter: Adapter;         // Which adapter handles this
  resolvedId: string;               // ID within that adapter
  action: 'play' | 'queue' | 'open';
}
```

#### 5.8.5 Core Adapter Methods

```typescript
private folderCache: Map<string, FolderItem[]> = new Map();

/**
 * Load and cache folder definitions from lists.yml
 */
private async loadFolders(): Promise<Map<string, FolderItem[]>> {
  if (this.folderCache.size > 0) {
    return this.folderCache;
  }

  const listItems: FolderItem[] = await this.loadListsYaml();

  // Group by folder name (case-insensitive)
  for (const item of listItems) {
    const folderKey = item.folder?.toLowerCase();
    if (!folderKey) continue;

    if (!this.folderCache.has(folderKey)) {
      this.folderCache.set(folderKey, []);
    }
    this.folderCache.get(folderKey)!.push(item);
  }

  return this.folderCache;
}

/**
 * Invalidate cache when lists.yml changes
 */
invalidateCache(): void {
  this.folderCache.clear();
}

async getItem(id: string): Promise<Folder | null> {
  const folders = await this.loadFolders();
  const folderKey = id.toLowerCase();
  const items = folders.get(folderKey);

  if (!items) return null;

  return {
    id: `folder:${id}`,
    source: 'folder',
    title: id,  // Use original casing from first item
    name: id,
    items,
    itemCount: items.length,
    isContainer: true,
    traversalMode: 'sequential'
  };
}

async getList(id: string): Promise<Listable[]> {
  const folder = await this.getItem(id);
  if (!folder) return [];

  const listables: Listable[] = [];

  for (const item of folder.items) {
    // Apply day filtering
    if (!this.isActiveToday(item)) continue;

    // Skip inactive items
    if (item.active === false) continue;

    const resolved = await this.resolveItem(item);
    if (!resolved) continue;

    listables.push({
      id: resolved.id,
      source: resolved.source,
      title: item.label ?? resolved.title,
      thumbnail: item.image ?? resolved.thumbnail,
      itemType: resolved.isContainer ? 'container' : 'leaf',
      metadata: {
        action: item.action ?? 'play',
        ...item  // Include all folder item properties
      }
    });
  }

  return listables;
}

/**
 * Resolve folder to playable items.
 * For each child, execute play() to get the "next up" item.
 * This is the core of daily programming - variety and rotation.
 */
async resolvePlayables(id: string): Promise<Playable[]> {
  const folder = await this.getItem(id);
  if (!folder) return [];

  const playables: Playable[] = [];

  for (const item of folder.items) {
    // Apply day filtering
    if (!this.isActiveToday(item)) continue;

    // Skip inactive items
    if (item.active === false) continue;

    // Skip "open" actions - they're not playable
    if (item.action === 'open') continue;

    try {
      const resolved = await this.resolveItem(item);
      if (!resolved) continue;

      if (item.action === 'queue') {
        // Queue action: get ALL playables from child
        const childPlayables = await resolved.adapter.resolvePlayables(resolved.localId);
        playables.push(...this.applyItemModifiers(childPlayables, item));
      } else {
        // Play action (default): get NEXT UP from child
        const nextUp = await this.queueService.getNextPlayable(
          `${resolved.adapter.source}:${resolved.localId}`
        );
        if (nextUp) {
          playables.push(this.applyItemModifiers([nextUp], item)[0]);
        }
      }
    } catch (err) {
      // Log and skip failed items (graceful degradation)
      logger.warn('folder.item_resolution_failed', {
        folder: id,
        input: item.input,
        error: err.message
      });
    }
  }

  return playables;
}

async getStoragePath(id: string): Promise<string> {
  return 'folders';
}
```

#### 5.8.6 Item Resolution

```typescript
/**
 * Resolve a folder item's input string to an adapter + localId
 */
private async resolveItem(item: FolderItem): Promise<{
  adapter: Adapter;
  localId: string;
  id: string;
  source: string;
  title: string;
  thumbnail?: string;
  isContainer: boolean;
} | null> {
  const parsed = this.inputParser.parse(item.input, {
    shuffle: item.shuffle,
    continuous: item.continuous,
    volume: item.volume,
    playbackRate: item.playbackRate,
    days: item.days,
    active: item.active
  });

  if (!parsed.sources.length) {
    logger.warn('folder.invalid_input', { input: item.input });
    return null;
  }

  // Use first source (multiple sources handled at queue level)
  const { adapter, localId } = parsed.sources[0];

  try {
    const resolved = await adapter.getItem(localId);
    if (!resolved) return null;

    return {
      adapter,
      localId,
      id: resolved.id,
      source: resolved.source,
      title: resolved.title,
      thumbnail: resolved.thumbnail,
      isContainer: 'isContainer' in resolved ? resolved.isContainer : false
    };
  } catch {
    return null;
  }
}

/**
 * Apply folder item modifiers to resolved playables
 */
private applyItemModifiers(playables: Playable[], item: FolderItem): Playable[] {
  return playables.map(p => ({
    ...p,
    // Override with folder item settings
    ...(item.volume !== undefined && { volume: item.volume }),
    ...(item.playbackRate !== undefined && { playbackRate: item.playbackRate }),
    ...(item.shuffle !== undefined && { shuffle: item.shuffle }),
    ...(item.continuous !== undefined && { continuous: item.continuous }),
    // Preserve label override
    ...(item.label && { title: item.label })
  }));
}
```

#### 5.8.7 Day Filtering

```typescript
private readonly DAY_MAP: Record<string, number[]> = {
  'monday': [1],
  'tuesday': [2],
  'wednesday': [3],
  'thursday': [4],
  'friday': [5],
  'saturday': [6],
  'sunday': [0],
  'weekdays': [1, 2, 3, 4, 5],
  'weekend': [0, 6],
  'm•w•f': [1, 3, 5],
  't•th': [2, 4],
  'm•w': [1, 3],
};

/**
 * Check if item should be active today based on days filter
 */
private isActiveToday(item: FolderItem): boolean {
  if (!item.days) return true;

  const today = new Date().getDay();  // 0 = Sunday
  const daysKey = item.days.toLowerCase();
  const allowedDays = this.DAY_MAP[daysKey];

  if (!allowedDays) {
    logger.warn('folder.unknown_days_value', { days: item.days });
    return true;  // Default to active if unknown
  }

  return allowedDays.includes(today);
}
```

#### 5.8.8 Folder References (Nested Folders)

Folders can reference other folders via the plus-sign syntax:

```yaml
- input: morning+program      # References "Morning Program" folder
  folder: TVApp
  action: Queue
```

```typescript
/**
 * Handle folder reference in input
 * "morning+program" → folder: "morning program"
 */
private parseFolderReference(input: string): string | null {
  if (input.includes('+') && !input.includes(':')) {
    return input.replace(/\+/g, ' ');
  }
  return null;
}

// In resolveItem():
const folderRef = this.parseFolderReference(item.input);
if (folderRef) {
  // Self-reference: resolve via this adapter
  return {
    adapter: this,
    localId: folderRef,
    id: `folder:${folderRef}`,
    source: 'folder',
    title: folderRef,
    isContainer: true
  };
}
```

#### 5.8.9 Menu Memory Sorting

```typescript
/**
 * Sort folder items by recent access (menu memory)
 * Unless folder has folder_color (indicating fixed order)
 */
private async sortByMenuMemory(items: FolderItem[]): Promise<FolderItem[]> {
  // Check if folder uses fixed order
  const hasFixedOrder = items.some(item => item.folder_color);
  if (hasFixedOrder) return items;

  const menuMemory = await this.loadMenuMemory();

  return [...items].sort((a, b) => {
    const aTime = menuMemory[a.input] ?? 0;
    const bTime = menuMemory[b.input] ?? 0;
    return bTime - aTime;  // Most recent first
  });
}
```

#### 5.8.10 Cache Invalidation

```typescript
// FolderAdapter should watch for lists.yml changes
class FolderAdapter {
  private watcher: FSWatcher;

  constructor(/* ... */) {
    // Watch for config changes
    this.watcher = chokidar.watch(this.configPath);
    this.watcher.on('change', () => {
      logger.info('folder.config_changed', { path: this.configPath });
      this.invalidateCache();
    });
  }

  destroy(): void {
    this.watcher.close();
  }
}
```

---

### 5.9 WatchlistAdapter

**WatchlistAdapter** manages curated watchlists synced from external sources (Infinity). Unlike FolderAdapter which groups items by folder name, WatchlistAdapter tracks individual items with scheduling metadata (wait_until, skip_after, hold) and watch progress.

#### 5.9.1 Capabilities

| Capability | Support | Notes |
|------------|---------|-------|
| Listable | ✅ | Browse watchlist items |
| Playable | ❌ | Watchlist is a container |
| Queueable | ✅ | Resolve to next unwatched item |
| Openable | ❌ | Not applicable |

#### 5.9.2 Prefix Registration

```typescript
class WatchlistAdapter implements Adapter {
  source = 'watchlist';

  prefixes = [
    { prefix: 'watchlist' },      // watchlist: Scripture
    { prefix: 'wl' },             // wl: Scripture (alias)
  ];

  constructor(
    private registry: AdapterRegistry,
    private watchStateStore: WatchStateStore,
    private configPath: string    // Path to watchlist.yml
  ) {}
}
```

#### 5.9.3 Watchlist Data Model

Watchlist items are stored in `watchlist.yml`:

```yaml
# watchlist.yml
_schemaVersion: 1

# Each item represents something to watch
- media_key: '12345'              # Plex ID or media path
  src: plex                       # Source: 'plex' or 'media'
  folder: Scripture               # Watchlist group name
  title: 'Book of Mormon Video'
  program: Scripture Study        # Optional program context
  uid: abc123                     # External sync ID (Infinity)

  # Scheduling
  wait_until: '2026-01-15'        # Don't show until this date
  skip_after: '2026-02-01'        # Hide after this date
  hold: false                     # Temporarily pause

  # Progress tracking (synced from watch state)
  percent: 45                     # Last known watch percent
  watched: false                  # Fully watched flag
```

#### 5.9.4 Types

```typescript
interface WatchlistItem {
  media_key: string;              // ID in source system (plex ID or media path)
  src: 'plex' | 'media';          // Which adapter handles this
  folder: string;                 // Watchlist group name
  title?: string;                 // Display title
  program?: string;               // Program context

  // External sync
  uid?: string;                   // Infinity item ID

  // Scheduling
  wait_until?: string;            // ISO date - don't show until
  skip_after?: string;            // ISO date - hide after
  hold?: boolean;                 // Temporarily paused

  // Progress (read from watch state)
  percent?: number;
  watched?: boolean;
}

interface Watchlist extends Item, Queueable {
  name: string;
  items: WatchlistItem[];
  itemCount: number;
  unwatchedCount: number;
}

interface CandidateBuckets {
  urgent: Map<string, WatchlistItem>;      // wait_until passed, should watch soon
  normal: Map<string, WatchlistItem>;      // Regular priority
  in_progress: Map<string, WatchlistItem>; // Started but not finished
}
```

#### 5.9.5 Core Adapter Methods

```typescript
async getItem(id: string): Promise<Watchlist | null> {
  const items = await this.getWatchlistItems(id);
  if (!items.length) return null;

  const unwatched = items.filter(i => !i.watched && !this.isSkipped(i));

  return {
    id: `watchlist:${id}`,
    source: 'watchlist',
    title: id,
    name: id,
    items,
    itemCount: items.length,
    unwatchedCount: unwatched.length,
    isContainer: true,
    traversalMode: 'priority'  // Uses priority buckets, not sequential
  };
}

async getList(id: string): Promise<Listable[]> {
  const items = await this.getWatchlistItems(id);
  const listables: Listable[] = [];

  for (const item of items) {
    // Skip items outside their date window
    if (this.isSkipped(item)) continue;
    if (this.isWaiting(item)) continue;

    const resolved = await this.resolveSourceItem(item);
    if (!resolved) continue;

    listables.push({
      id: resolved.id,
      source: resolved.source,
      title: item.title ?? resolved.title,
      thumbnail: resolved.thumbnail,
      itemType: 'leaf',
      metadata: {
        watchlistFolder: item.folder,
        percent: item.percent,
        watched: item.watched,
        hold: item.hold,
        wait_until: item.wait_until,
        skip_after: item.skip_after
      }
    });
  }

  return listables;
}

/**
 * Resolve watchlist to next item using priority buckets.
 * Priority order: in_progress > urgent > normal
 */
async resolvePlayables(id: string): Promise<Playable[]> {
  const items = await this.getWatchlistItems(id);
  const candidates = this.categorizeCandidates(items);

  // Pick from buckets in priority order
  const nextItem = this.pickNextCandidate(candidates);
  if (!nextItem) {
    // All watched - could auto-clear or return empty
    logger.info('watchlist.all_watched', { folder: id });
    return [];
  }

  const resolved = await this.resolveSourceItem(nextItem);
  if (!resolved) return [];

  // Return single item - watchlist gives you ONE thing to watch
  return [resolved];
}

async getStoragePath(id: string): Promise<string> {
  return 'watchlist';
}

/**
 * Load watchlist items for a folder
 */
private async getWatchlistItems(folder: string): Promise<WatchlistItem[]> {
  const allItems: WatchlistItem[] = await this.loadWatchlistYaml();
  const normalizedFolder = this.normalizeKey(folder);

  // Filter by folder name (case-insensitive)
  const folderItems = allItems.filter(
    item => this.normalizeKey(item.folder) === normalizedFolder
  );

  // Enrich with current watch state
  return Promise.all(folderItems.map(item => this.enrichWithWatchState(item)));
}

private normalizeKey(key: string): string {
  return key?.replace(/[^A-Za-z0-9]/g, '').toLowerCase() ?? '';
}
```

#### 5.9.6 Priority Bucketing

```typescript
/**
 * Categorize items into priority buckets.
 * This is the core watchlist algorithm.
 */
private categorizeCandidates(items: WatchlistItem[]): CandidateBuckets {
  const candidates: CandidateBuckets = {
    urgent: new Map(),
    normal: new Map(),
    in_progress: new Map()
  };

  const now = new Date();

  for (const item of items) {
    // Skip if on hold
    if (item.hold) continue;

    // Skip if outside date window
    if (this.isSkipped(item)) continue;

    // Skip if already watched
    if (item.watched || (item.percent && item.percent >= 90)) continue;

    const key = item.media_key;

    // In-progress: started but not finished (10-90%)
    if (item.percent && item.percent >= 10 && item.percent < 90) {
      candidates.in_progress.set(key, item);
      continue;
    }

    // Urgent: wait_until has passed
    if (item.wait_until) {
      const waitDate = new Date(item.wait_until);
      if (waitDate <= now) {
        candidates.urgent.set(key, item);
        continue;
      } else {
        // Still waiting
        continue;
      }
    }

    // Normal: everything else
    candidates.normal.set(key, item);
  }

  return candidates;
}

/**
 * Pick next item from buckets in priority order
 */
private pickNextCandidate(candidates: CandidateBuckets): WatchlistItem | null {
  // Priority 1: Items in progress (resume watching)
  if (candidates.in_progress.size > 0) {
    // Sort by most recent watch, pick first
    const sorted = [...candidates.in_progress.values()].sort(
      (a, b) => (b.percent ?? 0) - (a.percent ?? 0)
    );
    return sorted[0];
  }

  // Priority 2: Urgent items (wait_until passed)
  if (candidates.urgent.size > 0) {
    // Sort by wait_until date (earliest first)
    const sorted = [...candidates.urgent.values()].sort(
      (a, b) => new Date(a.wait_until!).getTime() - new Date(b.wait_until!).getTime()
    );
    return sorted[0];
  }

  // Priority 3: Normal items
  if (candidates.normal.size > 0) {
    // Return first (order from YAML)
    return candidates.normal.values().next().value;
  }

  return null;
}
```

#### 5.9.7 Date Window Filtering

```typescript
private isWaiting(item: WatchlistItem): boolean {
  if (!item.wait_until) return false;
  return new Date(item.wait_until) > new Date();
}

private isSkipped(item: WatchlistItem): boolean {
  if (!item.skip_after) return false;
  return new Date(item.skip_after) < new Date();
}
```

#### 5.9.8 Watch State Enrichment

```typescript
/**
 * Enrich watchlist item with current watch state from memory
 */
private async enrichWithWatchState(item: WatchlistItem): Promise<WatchlistItem> {
  const storagePath = item.src === 'plex'
    ? await this.getPlexStoragePath(item.media_key)
    : 'media';

  const watchState = await this.watchStateStore.getProgress(
    storagePath,
    item.media_key
  );

  return {
    ...item,
    percent: watchState?.percent ?? item.percent ?? 0,
    watched: watchState?.watched ?? item.watched ?? false
  };
}

/**
 * Get Plex library-specific storage path
 */
private async getPlexStoragePath(plexKey: string): Promise<string> {
  // Plex items are stored by library: plex/1_movies, plex/2_tv, etc.
  const plexAdapter = this.registry.get('plex');
  return plexAdapter.getStoragePath(plexKey);
}
```

#### 5.9.9 Source Item Resolution

```typescript
/**
 * Resolve watchlist item to its source adapter
 */
private async resolveSourceItem(item: WatchlistItem): Promise<Playable | null> {
  const adapter = item.src === 'plex'
    ? this.registry.get('plex')
    : this.registry.get('filesystem');

  if (!adapter) {
    logger.warn('watchlist.unknown_source', { src: item.src });
    return null;
  }

  try {
    const resolved = await adapter.getItem(item.media_key);
    if (!resolved) return null;

    // For Plex shows/seasons, get next episode
    if ('resolvePlayables' in adapter && resolved.isContainer) {
      const playables = await adapter.resolvePlayables(item.media_key);
      return playables[0] ?? null;
    }

    return resolved as Playable;
  } catch (err) {
    logger.warn('watchlist.resolution_failed', {
      media_key: item.media_key,
      src: item.src,
      error: err.message
    });
    return null;
  }
}
```

#### 5.9.10 Fallback Behavior

```typescript
/**
 * When all items are watched, try progressively relaxed filters
 */
async resolvePlayablesWithFallback(id: string): Promise<Playable[]> {
  const items = await this.getWatchlistItems(id);

  // Try 1: Normal rules
  let candidates = this.categorizeCandidates(items);
  let next = this.pickNextCandidate(candidates);
  if (next) return this.resolveAndWrap(next);

  // Try 2: Ignore skip_after
  candidates = this.categorizeCandidates(items, { ignoreSkips: true });
  next = this.pickNextCandidate(candidates);
  if (next) return this.resolveAndWrap(next);

  // Try 3: Ignore watch status (re-watch)
  candidates = this.categorizeCandidates(items, { ignoreSkips: true, ignoreWatched: true });
  next = this.pickNextCandidate(candidates);
  if (next) return this.resolveAndWrap(next);

  // Try 4: Ignore wait_until
  candidates = this.categorizeCandidates(items, { ignoreSkips: true, ignoreWatched: true, ignoreWait: true });
  next = this.pickNextCandidate(candidates);
  if (next) return this.resolveAndWrap(next);

  // Nothing available
  return [];
}

private async resolveAndWrap(item: WatchlistItem): Promise<Playable[]> {
  const resolved = await this.resolveSourceItem(item);
  return resolved ? [resolved] : [];
}
```

#### 5.9.11 External Sync (Infinity)

```typescript
/**
 * Update Infinity when watch progress changes
 */
async syncProgressToInfinity(mediaKey: string, percent: number): Promise<void> {
  const items = await this.loadWatchlistYaml();
  const matches = items.filter(item => item.media_key === mediaKey);

  if (!matches.length) return;

  const { watchlist_progress, watchlist_watched } = process.env.infinity;
  const isComplete = percent >= 90;

  for (const match of matches) {
    if (!match.uid) continue;

    try {
      await Infinity.updateItem(
        process.env.infinity.watchlist,
        match.uid,
        watchlist_progress,
        percent
      );

      if (isComplete) {
        await Infinity.updateItem(
          process.env.infinity.watchlist,
          match.uid,
          watchlist_watched,
          true
        );
      }

      logger.info('watchlist.infinity_synced', { uid: match.uid, percent });
    } catch (err) {
      logger.warn('watchlist.infinity_sync_failed', {
        uid: match.uid,
        error: err.message
      });
    }
  }
}
```

---

### 5.10 AppAdapter

**AppAdapter** handles openable applications - UI components that can be launched but don't stream media. Unlike Playable items that have media URLs, Openable items render React components in the AppContainer.

#### 5.10.1 Capabilities

| Capability | Support | Notes |
|------------|---------|-------|
| Listable | ✅ | Browse available apps |
| Playable | ❌ | Apps are not media |
| Queueable | ❌ | Apps don't queue |
| Openable | ✅ | Primary capability |

#### 5.10.2 Prefix Registration

```typescript
class AppAdapter implements Adapter {
  source = 'app';

  prefixes = [
    { prefix: 'app' },            // app: wrapup
    { prefix: 'open' },           // open: gratitude (alias)
  ];

  constructor(
    private appRegistry: AppRegistry
  ) {}
}
```

#### 5.10.3 App Registry

Apps are defined in code (React components), but their metadata can be enriched via config:

```typescript
interface AppDefinition {
  id: string;                     // App identifier: 'wrapup'
  title: string;                  // Display name: 'Wrap Up'
  description?: string;           // What the app does
  icon?: string;                  // Icon path or component name
  category?: AppCategory;         // Grouping for menu display
  requiresParam?: boolean;        // Does app need a param? (e.g., art/nativity)
  paramLabel?: string;            // Label for param: 'Art Path'
}

type AppCategory = 'utility' | 'display' | 'interactive' | 'system';

// Built-in apps from AppContainer.jsx
const BUILT_IN_APPS: AppDefinition[] = [
  {
    id: 'wrapup',
    title: 'Wrap Up',
    description: 'End of program summary',
    category: 'utility'
  },
  {
    id: 'gratitude',
    title: 'Gratitude',
    description: 'Daily gratitude prompt',
    category: 'interactive'
  },
  {
    id: 'art',
    title: 'Art Display',
    description: 'Display artwork',
    category: 'display',
    requiresParam: true,
    paramLabel: 'Art Path'
  },
  {
    id: 'webcam',
    title: 'Webcam',
    description: 'Camera view',
    category: 'display'
  },
  {
    id: 'websocket',
    title: 'WebSocket Debug',
    description: 'WebSocket connection viewer',
    category: 'system',
    requiresParam: true,
    paramLabel: 'Path'
  },
  {
    id: 'glympse',
    title: 'Glympse',
    description: 'Location tracking display',
    category: 'display',
    requiresParam: true,
    paramLabel: 'Glympse ID'
  },
  {
    id: 'keycode',
    title: 'Key Tester',
    description: 'Keyboard input tester',
    category: 'system'
  },
  {
    id: 'office_off',
    title: 'Office Off',
    description: 'Office shutdown sequence',
    category: 'utility'
  },
  {
    id: 'family-selector',
    title: 'Family Selector',
    description: 'Random family member picker',
    category: 'interactive',
    requiresParam: false,
    paramLabel: 'Winner (optional)'
  }
];
```

#### 5.10.4 Types

```typescript
interface OpenableApp extends Item, Openable {
  appId: string;                  // App identifier
  param?: string;                 // Optional parameter
  definition: AppDefinition;      // App metadata
}

interface Openable {
  /**
   * Returns data needed to open/render the app.
   * Frontend uses this to render via AppContainer.
   */
  openPayload: OpenPayload;
}

interface OpenPayload {
  app: string;                    // App ID
  param?: string;                 // Optional param
}
```

#### 5.10.5 Core Adapter Methods

```typescript
async getItem(id: string): Promise<OpenableApp | null> {
  // Parse id - may contain param: "art/nativity" or just "art"
  const [appId, param] = id.split('/');

  const definition = this.appRegistry.get(appId);
  if (!definition) {
    logger.warn('app.unknown', { appId });
    return null;
  }

  // Validate param requirement
  if (definition.requiresParam && !param) {
    logger.warn('app.missing_param', { appId, paramLabel: definition.paramLabel });
    // Still return - let frontend handle missing param
  }

  return {
    id: `app:${id}`,
    source: 'app',
    title: definition.title,
    thumbnail: definition.icon,
    appId,
    param,
    definition,
    openPayload: {
      app: appId,
      param
    }
  };
}

async getList(id?: string): Promise<Listable[]> {
  // If id provided, filter by category
  const category = id as AppCategory | undefined;

  const apps = category
    ? this.appRegistry.getByCategory(category)
    : this.appRegistry.getAll();

  return apps.map(def => ({
    id: `app:${def.id}`,
    source: 'app',
    title: def.title,
    thumbnail: def.icon,
    itemType: 'leaf',
    metadata: {
      category: def.category,
      description: def.description,
      requiresParam: def.requiresParam
    }
  }));
}

// Apps are not queueable - they open immediately
async resolvePlayables(id: string): Promise<Playable[]> {
  throw new AdapterError(
    'Apps are not playable',
    'app',
    AdapterErrorCode.OPERATION_NOT_SUPPORTED
  );
}

// Apps don't have watch state
async getStoragePath(id: string): Promise<string> {
  throw new AdapterError(
    'Apps do not have storage paths',
    'app',
    AdapterErrorCode.OPERATION_NOT_SUPPORTED
  );
}
```

#### 5.10.6 App Registry Implementation

```typescript
class AppRegistry {
  private apps: Map<string, AppDefinition> = new Map();

  constructor() {
    // Register built-in apps
    for (const app of BUILT_IN_APPS) {
      this.register(app);
    }
  }

  register(definition: AppDefinition): void {
    this.apps.set(definition.id, definition);
  }

  get(id: string): AppDefinition | undefined {
    return this.apps.get(id);
  }

  getAll(): AppDefinition[] {
    return [...this.apps.values()];
  }

  getByCategory(category: AppCategory): AppDefinition[] {
    return this.getAll().filter(app => app.category === category);
  }

  exists(id: string): boolean {
    return this.apps.has(id);
  }
}
```

#### 5.10.7 Integration with FolderAdapter

Apps can be included in folders with `action: Open`:

```yaml
# lists.yml
- input: 'app: wrapup'
  action: Open
  folder: Morning Program
  label: End Program
```

The FolderAdapter handles this by detecting `action: Open` and returning the OpenPayload instead of trying to resolve playables:

```typescript
// In FolderAdapter.resolvePlayables():
if (item.action === 'open') {
  // Skip - handled separately by getOpenables()
  continue;
}

// New method in FolderAdapter:
async getOpenables(id: string): Promise<OpenableApp[]> {
  const folder = await this.getItem(id);
  if (!folder) return [];

  const openables: OpenableApp[] = [];

  for (const item of folder.items) {
    if (item.action !== 'open') continue;
    if (!this.isActiveToday(item)) continue;
    if (item.active === false) continue;

    const resolved = await this.resolveItem(item);
    if (resolved && 'openPayload' in resolved) {
      openables.push(resolved as OpenableApp);
    }
  }

  return openables;
}
```

#### 5.10.8 Frontend Integration

The frontend's AppContainer already handles rendering based on app ID:

```tsx
// AppContainer.jsx (existing)
if (app === "wrapup") return <WrapUp clear={clear} />;
if (app === "gratitude") return <Gratitude clear={clear} />;
if (app === "art") return <ArtApp path={param} />;
// etc.
```

The API returns an OpenPayload that the frontend uses:

```typescript
// API Response
{
  id: 'app:wrapup',
  source: 'app',
  title: 'Wrap Up',
  openPayload: {
    app: 'wrapup'
  }
}

// Frontend usage
const { openPayload } = await api.getItem('app:wrapup');
push({ type: 'app', props: { open: openPayload } });
```

#### 5.10.9 Config Extension (Optional)

Apps can be extended via config for household-specific customization:

```yaml
# apps.yml (optional)
_schemaVersion: 1

# Override built-in app metadata
wrapup:
  title: 'Morning Wrap Up'
  icon: '/media/img/icons/sunrise.png'

# Add custom app (must have matching React component)
custom-widget:
  title: 'Custom Widget'
  description: 'Household-specific widget'
  category: 'utility'
```

```typescript
class AppRegistry {
  async loadConfig(configPath: string): Promise<void> {
    const config = await loadYaml(configPath);
    if (!config) return;

    for (const [appId, overrides] of Object.entries(config)) {
      if (appId.startsWith('_')) continue;  // Skip schema version

      const existing = this.apps.get(appId);
      if (existing) {
        // Merge overrides with built-in definition
        this.apps.set(appId, { ...existing, ...overrides });
      } else {
        // New custom app - requires React component to exist
        logger.warn('app.custom_missing_component', { appId });
      }
    }
  }
}
```

---

### 5.11 Future: FreshRSSAdapter (Placeholder)

**Status:** Not yet implemented

**Purpose:** RSS feed aggregation via FreshRSS API

```typescript
class FreshRSSAdapter implements Adapter {
  source = 'freshrss';

  // Capabilities:
  // - Listable: Feeds, categories, saved items
  // - Openable: Article reader view
  // - Queueable: Unread article queue

  // TODO: Implement when FreshRSS integration is prioritized
}
```

**Input prefix:** `rss: {feed-id}` or `article: {article-id}`

**Key considerations:**
- Read/unread state sync
- Article content extraction
- Feed refresh scheduling

---

## 6. QueueService Design

### 6.1 Responsibilities

The QueueService is the brain for "what plays next":
- Resolves containers to playable leaves
- Applies watch state heuristics
- Manages priority (in_progress > urgent > unwatched)
- Handles skip_after / wait_until logic

### 6.2 Interface

```typescript
interface WatchState {
  itemId: string;
  playhead: number;
  duration: number;
  percent: number;
  playCount: number;
  lastPlayed: string;
  watchTime: number;
}

interface QueueHeuristics {
  skipAfter?: string;
  waitUntil?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  hold?: boolean;
}

interface QueueService {
  // Resolution
  getNextPlayable(id: string): Promise<Playable | null>;
  getAllPlayables(id: string): Promise<Playable[]>;

  // Watch State
  getWatchState(id: string): Promise<WatchState | null>;
  updateProgress(id: string, playhead: number, duration: number): Promise<void>;
  markWatched(id: string): Promise<void>;
  clearWatchState(ids: string[]): Promise<void>;

  // Heuristics
  getHeuristics(id: string): Promise<QueueHeuristics | null>;
  setHeuristics(id: string, heuristics: Partial<QueueHeuristics>): Promise<void>;
}
```

### 6.3 Selection Algorithm

```typescript
async getNextPlayable(id: string): Promise<Playable | null> {
  const { adapter, localId } = this.registry.resolve(id);
  const candidates = await adapter.resolvePlayables(localId);

  // Categorize by watch status
  const { unwatched, inProgress, watched } =
    await this.categorizeByWatchState(candidates);

  // Apply heuristics (skip_after, wait_until, hold)
  const filtered = this.applyHeuristics(unwatched, inProgress);

  // Priority: in_progress > urgent > unwatched > restart
  if (inProgress.length) return this.pickByProgress(inProgress);
  if (filtered.length) return filtered[0];

  // All watched - clear and restart
  await this.clearWatchState(watched.map(p => p.id));
  return watched[0] ?? null;
}
```

### 6.4 Respecting Resumability

```typescript
async updateProgress(id: string, playhead: number, duration: number): Promise<void> {
  const item = await this.getItem(id);
  if (!item.resumable) return;  // Don't track ephemeral content
  await this.watchStateStore.set(id, { playhead, duration, /* ... */ });
}
```

### 6.5 Heuristics Breakdown

The QueueService uses these heuristics to determine "next up":

| Heuristic | Type | Description | Example |
|-----------|------|-------------|---------|
| `waitUntil` | date | Don't play before this date | `waitUntil: '2026-12-01'` for seasonal content |
| `skipAfter` | date | Don't play after this date | `skipAfter: '2026-01-15'` for time-sensitive news |
| `priority` | enum | Urgency level affects ordering | `urgent` > `high` > `medium` > `low` |
| `hold` | bool | Exclude from auto-selection | User manually unpauses when ready |
| `days` | array | Only play on specific weekdays | `days: [0, 6]` for weekend-only content |
| `shuffle` | bool | Randomize instead of sequential | Music playlists |
| `continuous` | bool | Keep playing through children | Background music mode |

**Selection Priority:**
1. In-progress items (resume where left off)
2. Urgent priority items
3. Standard priority, filtered by date heuristics
4. If all watched: clear and restart from beginning

**Playback Config Inheritance:**

Playback settings can be defined at multiple levels:
- **Global:** `media_config.yml` defaults
- **Container:** Settings on a show, playlist, or folder
- **Item:** Per-episode overrides in watchlist

Child items inherit from parent, with local overrides taking precedence:

```typescript
function resolvePlaybackConfig(item: Item, parent?: Item): PlaybackConfig {
  return {
    ...getGlobalDefaults(),
    ...parent?.playbackConfig,
    ...item.playbackConfig
  };
}
```

---

## 7. WatchStateStore

### 7.1 Known Limitation: YAML Persistence

> **Future improvement:** The current YAML-based persistence has known issues:
> - **Race conditions:** Concurrent writes from multiple clients can lose data
> - **Performance:** Read-modify-write cycle is expensive as history grows
> - **Corruption risk:** Process crash during write can corrupt entire file
>
> **Planned migration:** SQLite (via `better-sqlite3`) for atomic, safe persistence.
> Until then, all IO is abstracted via `backend/lib/io.mjs` which provides:
> - Per-path write queues to serialize concurrent saves
> - Graceful error handling and logging
>
> The `WatchStateStore` interface below is **implementation-agnostic** - switching
> from YAML to SQLite requires only a new implementation class, no API changes.

### 7.2 Storage Structure (Current)

Preserves existing folder structure:

```
media_memory/
├── plex/
│   ├── 1_movies.yml
│   ├── 2_tv-shows.yml
│   └── 3_fitness.yml
├── filesystem/
│   └── media.yml
├── immich/
│   └── albums.yml
└── audiobookshelf/
    └── library.yml
```

### 7.3 Interface

```typescript
interface WatchStateStore {
  get(itemId: string): Promise<WatchState | null>;
  set(itemId: string, state: WatchState): Promise<void>;
  delete(itemId: string): Promise<void>;
  getBulk(itemIds: string[]): Promise<Map<string, WatchState>>;
  deleteBulk(itemIds: string[]): Promise<void>;
}
```

### 7.4 Current Implementation (YAML via io.mjs)

```typescript
class YamlWatchStateStore implements WatchStateStore {
  constructor(
    private basePath: string,
    private registry: AdapterRegistry
  ) {}

  private async resolvePath(itemId: string): Promise<string> {
    const { adapter, localId } = this.registry.resolve(itemId);
    const subPath = await adapter.getStoragePath?.(localId) ?? 'default';
    return `${this.basePath}/${adapter.source}/${subPath}.yml`;
  }

  // Delegates to io.mjs which handles:
  // - Per-path write queues (SAVE_QUEUES)
  // - Circular reference removal
  // - Path translation for legacy locations
}
```

### 7.5 Future Implementation (SQLite)

```typescript
class SqliteWatchStateStore implements WatchStateStore {
  // Same interface, atomic writes, no race conditions
  // Migration path: run once to import YAML → SQLite, then switch impl
}
```

---

## 8. Proxy Layer

### 8.1 URL Scheme

```
/proxy/{source}/{type}/{id}

Examples:
/proxy/plex/stream/12345
/proxy/plex/thumb/12345
/proxy/filesystem/stream/audio~music~song.mp3
/proxy/immich/thumb/abc-123
```

### 8.2 ProxyRouter

```typescript
class ProxyRouter {
  constructor(private registry: AdapterRegistry) {}

  async handle(req: Request, res: Response): Promise<void> {
    const { source, type, id } = req.params;
    const adapter = this.registry.get(source);

    if (!adapter.proxy) {
      return res.status(404).json({ error: `No proxy for ${source}` });
    }

    switch (type) {
      case 'stream': return adapter.proxy.stream(id, req, res);
      case 'thumb': return adapter.proxy.thumbnail(id, req, res);
      default: return res.status(400).json({ error: `Unknown type: ${type}` });
    }
  }
}
```

### 8.3 Caching

```typescript
interface ProxyCache {
  get(source: string, type: string, id: string): Promise<Buffer | null>;
  set(source: string, type: string, id: string, data: Buffer, ttl?: number): Promise<void>;
}

// Thumbnails: cached to disk (cache/proxy/plex/thumb/{id}.jpg)
// Streams: not cached (proxied real-time)
```

---

## 9. API Layer

### 9.1 Endpoints

```
GET  /api/item/:source/:id       → Get item with capabilities
GET  /api/list/:source/:id       → Get listable children
GET  /api/play/:source/:id       → Resolve to next playable
GET  /api/queue/:source/:id      → Get all playables for queue
POST /api/progress/:source/:id   → Update watch state
GET  /api/search?q=...&source=   → Search across sources
```

### 9.2 Response Shapes

```typescript
interface ItemResponse {
  item: Item & Partial<Listable & Playable & Openable & Queueable>;
  capabilities: ('listable' | 'playable' | 'openable' | 'queueable')[];
}

interface ListResponse {
  parent: Item;
  items: Item[];
}

interface PlayResponse {
  item: Playable;
  resumePosition: number;
  queueContext?: {
    parentId: string;
    position: number;
    total: number;
  };
}

interface QueueResponse {
  parent: Item;
  items: Playable[];
  currentIndex: number;
}
```

### 9.3 Path Separator

Filesystem paths use tilde (`~`) as separator:

```
/api/item/filesystem/audio~music~song.mp3
```

---

## 10. Security: Path Traversal Prevention

### 10.1 Threat Model

Multiple API endpoints accept user-provided path segments that are concatenated to form filesystem paths. Without proper sanitization, attackers can escape intended directories:

```
# Malicious request
GET /media/info/../../../etc/passwd
GET /api/list/filesystem/..~..~..~etc~passwd
```

**Affected endpoints:**
- `/media/*` - Direct filesystem access
- `/media/info/*` - Media metadata lookup
- `/fetch/list/*` - Directory listing
- `/api/list/filesystem/:path` - New API equivalent

### 10.2 Defense: Path Canonicalization

**All path-accepting functions MUST canonicalize before access:**

```typescript
import path from 'path';

function sanitizePath(userInput: string, basePath: string): string | null {
  // 1. Decode URL encoding
  const decoded = decodeURIComponent(userInput);

  // 2. Convert tilde separator to path separator
  const withSlashes = decoded.replace(/~/g, '/');

  // 3. Resolve to absolute path (handles .., ., etc.)
  const resolved = path.resolve(basePath, withSlashes);

  // 4. Verify result is still under basePath
  const normalizedBase = path.resolve(basePath);
  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    logger.warn('security.path_traversal_attempt', {
      userInput,
      resolved,
      basePath: normalizedBase
    });
    return null;  // Reject path escape attempt
  }

  return resolved;
}
```

### 10.3 Implementation Points

Every adapter's path resolution must use this pattern:

```typescript
// FilesystemAdapter
async getItem(id: string): Promise<Item | null> {
  const safePath = sanitizePath(id, this.mediaBasePath);
  if (!safePath) {
    throw new AdapterError('Invalid path', 'filesystem', AdapterErrorCode.INVALID_ID);
  }
  // Proceed with safePath...
}

// LocalContentAdapter
async getItem(id: string): Promise<Item | null> {
  const [contentType, ...pathParts] = id.split('/');
  const config = LOCAL_CONTENT_TYPES[contentType];

  const safePath = sanitizePath(pathParts.join('/'), `${this.dataBasePath}/${config.dataPath}`);
  if (!safePath) {
    throw new AdapterError('Invalid content path', 'local-content', AdapterErrorCode.INVALID_ID);
  }
  // Proceed with safePath...
}
```

### 10.4 Additional Safeguards

1. **Allowlist file extensions** for media endpoints:
   ```typescript
   const ALLOWED_EXTENSIONS = new Set(['.mp3', '.mp4', '.m4a', '.webm', '.jpg', '.png']);
   ```

2. **Symlink resolution**: Use `fs.realpath()` to resolve symlinks, then re-check the base path constraint.

3. **Null byte injection**: Reject paths containing `\0` (can truncate strings in some contexts).

4. **Double encoding**: Decode repeatedly until stable, then validate.

---

## 11. Path Resolution (Tilde Separator)

### 11.1 Known Limitation: Sync I/O in Tilde Resolution

> **Performance concern:** The naive tilde resolution algorithm uses synchronous
> `fs.existsSync` calls in a loop, blocking the event loop. For a 5-segment path,
> this hits the disk 5 times per request. On NAS or busy systems, this adds latency.

**Mitigations (in order of preference):**

1. **Strict IDs at ingestion** (best): When content is scanned/ingested, generate
   the canonical ID once. Frontend requests exact IDs, no fuzzy resolution needed.

2. **In-memory directory cache**: FilesystemAdapter maintains an in-memory tree
   of the directory structure, updated via `chokidar` file watching. Resolution
   happens against memory, not disk.

3. **Async I/O with caching**: Use `fs.promises.stat` with an LRU cache for
   recently-resolved paths.

### 11.2 Common Case Optimization

Most filenames don't contain tildes. Fast-path for the common case:

```typescript
async function resolveTildePath(
  tildePath: string,
  basePath: string,
  dirCache: DirectoryCache
): Promise<string | null> {
  // Fast path: if no tildes in filename portion, direct resolution
  const segments = tildePath.split('~');
  const directPath = `${basePath}/${segments.join('/')}`;

  if (await dirCache.exists(directPath)) {
    return directPath;
  }

  // Slow path: filename contains tildes, need smart resolution
  return resolveAmbiguousTildePath(segments, basePath, dirCache);
}
```

### 11.3 Directory Cache (chokidar)

```typescript
class DirectoryCache {
  private tree: Map<string, Set<string>> = new Map();  // dir → children
  private watcher: FSWatcher;

  constructor(basePath: string) {
    this.watcher = chokidar.watch(basePath, { persistent: true });
    this.watcher.on('add', path => this.addToTree(path));
    this.watcher.on('unlink', path => this.removeFromTree(path));
    this.watcher.on('addDir', path => this.addToTree(path));
    this.watcher.on('unlinkDir', path => this.removeFromTree(path));
  }

  async exists(path: string): Promise<boolean> {
    // Check in-memory tree first (O(1) per segment)
    return this.tree.has(path);
  }

  isDirectory(path: string): boolean {
    return this.tree.has(path) && this.tree.get(path)!.size > 0;
  }
}
```

### 11.4 Smart Resolution Algorithm (Cached)

```typescript
async function resolveAmbiguousTildePath(
  segments: string[],
  basePath: string,
  dirCache: DirectoryCache
): Promise<string | null> {
  let resolvedPath = basePath;
  let remaining = [...segments];

  while (remaining.length > 1) {
    const nextSegment = remaining[0];
    const candidatePath = `${resolvedPath}/${nextSegment}`;

    // Memory lookup, not disk I/O
    if (dirCache.isDirectory(candidatePath)) {
      resolvedPath = candidatePath;
      remaining.shift();
    } else {
      break;
    }
  }

  const filename = remaining.join('~');
  const fullPath = `${resolvedPath}/${filename}`;
  return dirCache.exists(fullPath) ? fullPath : null;
}
```

### 11.5 Example Resolutions

| Input | Directories exist | Result |
|-------|-------------------|--------|
| `audio~music~song.mp3` | `audio/`, `audio/music/` | `audio/music/song.mp3` |
| `audio~music~song~remix.mp3` | `audio/`, `audio/music/` | `audio/music/song~remix.mp3` |
| `audio~my~mix~2024~track.mp3` | `audio/` only | `audio/my~mix~2024~track.mp3` |

### 11.6 Long-term: Content Ingestion

The ideal solution is to eliminate runtime resolution entirely:

```typescript
// At content scan/ingestion time:
const canonicalId = 'audio~music~song~remix.mp3';  // Stored in index
const resolvedPath = '/media/audio/music/song~remix.mp3';  // Verified once

// At request time:
const path = contentIndex.get(canonicalId);  // O(1) lookup, no I/O
```

This requires a content indexing service (future work).

---

## 12. Backward Compatibility

> **See also:** [API Consumer Inventory](./2026-01-10-api-consumer-inventory.md) for a complete catalog of frontend files affected by this migration.

### 12.1 Legacy Route Mapping

```typescript
const LEGACY_ROUTES = {
  'GET /media/info/*':           'GET /api/play/filesystem/:path',
  'GET /media/plex/info/:key':   'GET /api/play/plex/:key',
  'GET /media/plex/list/:key':   'GET /api/list/plex/:key',
  'GET /media/plex/play/:key':   'GET /proxy/plex/stream/:key',
  'GET /media/plex/img/:key':    'GET /proxy/plex/thumb/:key',
  'GET /media/*':                'GET /proxy/filesystem/stream/:path',
  'POST /media/log':             'POST /api/progress/:source/:id',
  'GET /fetch/list/*':           'GET /api/list/filesystem/:path',
};
```

### 12.2 LegacyRouter

```typescript
class LegacyRouter {
  constructor(private apiRouter: ApiRouter, private proxyRouter: ProxyRouter) {}

  register(app: Express): void {
    app.get('/media/plex/info/:key/:config?', async (req, res) => {
      req.params.source = 'plex';
      req.params.id = req.params.key;
      return this.apiRouter.play(req, res);
    });

    app.get('/media/info/*', async (req, res) => {
      req.params.source = 'filesystem';
      req.params.id = req.params[0].replace(/\//g, '~');
      return this.apiRouter.play(req, res);
    });

    // ... etc
  }
}
```

### 12.3 Deprecation Logging

```typescript
app.use('/media/*', (req, res, next) => {
  logger.warn('legacy.endpoint.called', {
    path: req.path,
    newPath: this.mapToNewPath(req.path)
  });
  next();
});
```

---

## 13. Folder Structure

```
backend/
├── src/                          # New TypeScript code
│   ├── domain/
│   │   ├── types/
│   │   │   ├── Item.ts
│   │   │   ├── Listable.ts
│   │   │   ├── Playable.ts
│   │   │   ├── Openable.ts
│   │   │   ├── Queueable.ts
│   │   │   ├── LocalContentItem.ts
│   │   │   └── index.ts
│   │   └── interfaces/
│   │       ├── Adapter.ts
│   │       ├── ProxyHandler.ts
│   │       ├── QueueService.ts
│   │       └── WatchStateStore.ts
│   │
│   ├── adapters/
│   │   ├── plex/
│   │   │   ├── PlexAdapter.ts
│   │   │   ├── PlexProxyHandler.ts
│   │   │   ├── PlexClient.ts
│   │   │   └── index.ts
│   │   ├── filesystem/
│   │   │   ├── FilesystemAdapter.ts
│   │   │   ├── FilesystemProxyHandler.ts
│   │   │   └── index.ts
│   │   ├── local-content/
│   │   │   ├── LocalContentAdapter.ts
│   │   │   ├── LocalContentProxyHandler.ts
│   │   │   ├── contentTypes.ts        # Content type configs
│   │   │   └── index.ts
│   │   ├── immich/                    # Future: photo/video library
│   │   │   └── index.ts               # Placeholder
│   │   ├── audiobookshelf/            # Future: audiobooks/podcasts
│   │   │   └── index.ts               # Placeholder
│   │   ├── freshrss/                  # Future: RSS feeds
│   │   │   └── index.ts               # Placeholder
│   │   └── registry.ts
│   │
│   ├── services/
│   │   ├── QueueServiceImpl.ts
│   │   ├── WatchStateStoreYaml.ts
│   │   ├── PathResolver.ts
│   │   └── InputParser.ts             # Parses input prefixes
│   │
│   ├── api/
│   │   ├── ApiRouter.ts
│   │   ├── ProxyRouter.ts
│   │   └── LegacyRouter.ts
│   │
│   ├── util/
│   │   ├── logger.ts
│   │   └── config.ts
│   │
│   └── index.ts
│
├── lib/                          # Existing JS (migrates gradually)
├── routers/                      # Existing JS routers (deprecated)
├── tsconfig.json
└── package.json
```

---

## 14. Error Handling

### 14.1 Adapter Error Types

```typescript
class AdapterError extends Error {
  constructor(
    message: string,
    public readonly source: string,
    public readonly code: AdapterErrorCode,
    public readonly cause?: Error
  ) {
    super(message);
  }
}

enum AdapterErrorCode {
  NOT_FOUND = 'NOT_FOUND',           // Item doesn't exist
  UNAVAILABLE = 'UNAVAILABLE',       // Service unreachable (Plex down, file missing)
  UNAUTHORIZED = 'UNAUTHORIZED',     // Auth failed
  INVALID_ID = 'INVALID_ID',         // Malformed ID format
  RESOLUTION_FAILED = 'RESOLUTION_FAILED',  // Can't resolve to playables
}
```

### 14.2 Error Propagation

Adapters throw typed errors; services catch and handle:

```typescript
// Adapter throws
async getItem(id: string): Promise<Item> {
  const meta = await this.client.loadMeta(id);
  if (!meta) {
    throw new AdapterError(`Item not found: ${id}`, 'plex', AdapterErrorCode.NOT_FOUND);
  }
  return this.toItem(meta);
}

// QueueService handles gracefully
async getNextPlayable(id: string): Promise<Playable | null> {
  try {
    const { adapter, localId } = this.registry.resolve(id);
    return await adapter.resolvePlayables(localId);
  } catch (err) {
    if (err instanceof AdapterError && err.code === AdapterErrorCode.UNAVAILABLE) {
      logger.warn('adapter.unavailable', { source: err.source, id });
      return null;  // Skip this item, continue with queue
    }
    throw err;  // Re-throw unexpected errors
  }
}
```

### 14.3 API Error Responses

```typescript
interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    source?: string;
    details?: Record<string, unknown>;
  };
}

// Example responses:
// 404: { error: { code: 'NOT_FOUND', message: 'Item not found', source: 'plex' } }
// 503: { error: { code: 'UNAVAILABLE', message: 'Plex server unreachable', source: 'plex' } }
// 400: { error: { code: 'INVALID_ID', message: 'Malformed item ID' } }
```

### 14.4 Fallback Behavior

| Scenario | Behavior |
|----------|----------|
| Plex unreachable | Skip Plex items in queue, continue with others |
| File not found | Return error, don't skip (data integrity issue) |
| LocalContent YAML missing | Return error with path for debugging |
| Proxy stream fails | Return 502 with upstream error details |

---

## 15. Testing Strategy

### 15.1 Adapter Mocking

Each adapter has a mock implementation for testing:

```typescript
class MockPlexAdapter implements Adapter {
  source = 'plex';

  private items: Map<string, Item> = new Map();

  // Test helpers
  addItem(id: string, item: Item): void { this.items.set(id, item); }
  clear(): void { this.items.clear(); }

  // Adapter interface
  async getItem(id: string): Promise<Item | null> {
    return this.items.get(id) ?? null;
  }

  async resolvePlayables(id: string): Promise<Playable[]> {
    const item = this.items.get(id);
    if (!item) return [];
    // Return mock playables based on test setup
  }
}
```

### 15.2 Test Registry

```typescript
function createTestRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();
  registry.register(new MockPlexAdapter());
  registry.register(new MockFilesystemAdapter());
  registry.register(new MockLocalContentAdapter());
  return registry;
}
```

### 15.3 Integration Test Patterns

```typescript
describe('QueueService', () => {
  let registry: AdapterRegistry;
  let queueService: QueueService;
  let mockPlex: MockPlexAdapter;

  beforeEach(() => {
    registry = createTestRegistry();
    mockPlex = registry.get('plex') as MockPlexAdapter;
    queueService = new QueueServiceImpl(registry, new InMemoryWatchStateStore());
  });

  it('returns next unwatched episode', async () => {
    mockPlex.addItem('show-1', createMockShow({ episodes: 10 }));

    const next = await queueService.getNextPlayable('plex:show-1');

    expect(next?.id).toBe('plex:show-1-ep-1');
  });

  it('skips unavailable adapters gracefully', async () => {
    mockPlex.simulateUnavailable();

    const next = await queueService.getNextPlayable('plex:show-1');

    expect(next).toBeNull();
    // Should not throw
  });
});
```

### 15.4 Test Data Fixtures

```
backend/src/__tests__/
├── fixtures/
│   ├── plex/
│   │   ├── show.json
│   │   ├── movie.json
│   │   └── music-album.json
│   ├── local-content/
│   │   ├── hymn.yaml
│   │   ├── talk.yaml
│   │   └── poetry.yaml
│   └── filesystem/
│       └── directory-listing.json
├── mocks/
│   ├── MockPlexAdapter.ts
│   ├── MockFilesystemAdapter.ts
│   ├── MockLocalContentAdapter.ts
│   └── InMemoryWatchStateStore.ts
└── helpers/
    ├── createTestRegistry.ts
    └── createMockItem.ts
```

### 15.5 Coverage Goals

| Layer | Target | Focus |
|-------|--------|-------|
| Adapters | 90% | ID parsing, error handling, data transformation |
| QueueService | 95% | Selection algorithm, heuristics, edge cases |
| API Router | 80% | Request validation, response shapes |
| InputParser | 100% | All prefix mappings, edge cases |

---

## 16. Future Integrations

The adapter pattern enables these future integrations:

| Integration | Listable | Playable | Openable | Queueable |
|-------------|----------|----------|----------|-----------|
| Immich | Albums | Slideshows | Grid view | Photo sequences |
| Audiobookshelf | Library | Audio (resumable) | eBook reader | Chapters |
| Paperless-ngx | Documents | - | PDF viewer | - |
| Home Assistant | Devices | - | Panels | - |
| Frigate/Reolink | Event clips | Live streams | - | Event replay |
| FreshRSS | Feeds | - | Reader | - |
| ClickUp | Tasks | - | Task view | - |
| Mealie/Tandoor | Recipes | - | Recipe view | - |
| Emulation | ROMs | - | Emulator | - |

Adding a new integration requires only:
1. Create new adapter in `src/adapters/{source}/`
2. Implement the `Adapter` interface
3. Register in `AdapterRegistry`

No changes to core domain or frontend required.

---

## 17. Config File Consolidation

### 17.1 Current State Files

The existing system uses multiple overlapping config files:

| File | Purpose | Key Fields |
|------|---------|------------|
| `lists.yml` | Queue/folder definitions | `input`, `folder`, `action`, `label` |
| `watchlist.yml` | Fine-grained item curation | `media_key`, `program`, `index`, `priority`, `progress` |
| `mediamenu.yml` | Menu items with playback config | `type`, `key`, `shuffle`, `continuous` |
| `nav.yml` | Navigation structure with actions | `label`, `play`, `queue`, `open` |
| `media_config.yml` | Per-item playback overrides | `playbackRate`, `skipIntro`, etc. |

### 17.2 Proposed Consolidation

The new architecture can consolidate these into a cleaner structure.

**All config files include `_schemaVersion`** for future migrations:

**`queues.yml`** - All queue/folder definitions (replaces lists.yml):
```yaml
_schemaVersion: 1

Morning Program:
  - input: 'media: sfx/intro'
  - input: 'scripture: cfm'
  - input: 'plex: 375839'
    label: Crash Course Kids

TVApp:
  - input: morning+program
    label: Morning Program
    action: Queue
```

**`watchlist.yml`** - Item-level curation layer:
```yaml
_schemaVersion: 1

items:
  - media_key: '225728'
    program: Yale - New Testament
    # ... existing fields
```

**`navigation.yml`** - Unified nav (replaces nav.yml + mediamenu.yml):
```yaml
_schemaVersion: 1

TVApp:
  - label: Morning Program
    queue: morning+program
  - label: Baby Joy Joy
    play:
      plex: '409169'
      shuffle: true
      continuous: true
```

**`playback.yml`** - All playback config (replaces media_config.yml):
```yaml
_schemaVersion: 1

defaults:
  playbackRate: 1.0

overrides:
  'plex:409169':
    playbackRate: 1.25
    skipIntro: true
```

### 17.3 Migration Path

1. Keep existing files working via LegacyConfigService
2. New ConfigService reads from consolidated files
3. One-time migration script converts old → new format
4. Remove legacy files after verification

---

## 18. Known Gaps & Open Questions

This section documents areas that need further design work before implementation.

### 18.1 Missing Adapter Implementations

| Adapter | Status | Notes |
|---------|--------|-------|
| `FilesystemAdapter` | ✅ **Defined** | See Section 5.4 |
| `FolderAdapter` | ✅ **Defined** | See Section 5.8 - meta-adapter for lists.yml |
| `WatchlistAdapter` | ✅ **Defined** | See Section 5.9 - priority-based with scheduling |
| `AppAdapter` | ✅ **Defined** | See Section 5.10 - Openable apps/utilities |

**All required adapters are now fully specified.**

### 18.2 ~~Missing: `registry.resolve()` Method~~ ✅ RESOLVED

**Added to Section 5.2 (AdapterRegistry):**

```typescript
resolve(compoundId: string): { adapter: Adapter; localId: string } | null
canResolve(compoundId: string): boolean
```

The `resolve()` method handles compound IDs (`plex:12345`) by:
1. If no colon → treat as filesystem path (default adapter)
2. Try exact source match (`plex` → PlexAdapter)
3. Fall back to prefix resolution (`hymn` → LocalContentAdapter via prefix mapping)

### 18.3 Household / Multi-Tenant Scope

The current system uses household-scoped paths:
```
data/households/{hid}/apps/tv/lists.yml
data/households/{hid}/state/media_memory/
```

**Not addressed:**
- How does new API handle household context?
- Is `hid` passed via header, URL prefix, or session?
- How do adapters access household-specific config?

**Proposed approach:** Inject `householdId` into service context:
```typescript
interface RequestContext {
  householdId: string;
  userId?: string;
}

// All services receive context
queueService.getNextPlayable(id, context);
```

### 18.4 Frontend Migration Path

The design shows new API endpoints but doesn't specify how the frontend migrates.

**Options:**
1. **Big bang:** Update all frontend calls at once
2. **Gradual:** Use feature flag to switch between old/new APIs
3. **Transparent:** Backend serves both old and new endpoints indefinitely

**Recommended:** Option 3 with deprecation logging. Frontend can migrate incrementally while old endpoints continue working.

### 18.5 Missing: Health Check Endpoints

No health check endpoints defined for monitoring:

```typescript
// Proposed:
GET /api/health              → Overall system health
GET /api/health/adapters     → Per-adapter status (Plex reachable, etc.)
GET /api/health/storage      → Watch state storage status
```

### 18.6 Missing: Rate Limiting

No rate limiting strategy defined. Consider:
- Per-IP limits for unauthenticated requests
- Per-household limits for authenticated requests
- Proxy stream bandwidth limits

### 18.7 Logging Strategy

Error handling mentions logging but no structured logging strategy defined.

**Recommended:** Structured JSON logging with consistent fields:
```typescript
interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  event: string;           // Dot-separated: 'adapter.plex.request_failed'
  source?: string;         // Adapter source
  itemId?: string;
  householdId?: string;
  durationMs?: number;
  error?: { message: string; stack?: string };
}
```

### 18.8 Legacy Route Inconsistency

The document shows:
- Frontend uses `data/list/{key}` (per API Consumer Inventory)
- Legacy mapping shows `fetch/list/*`

**Need to verify:** Which legacy routes actually exist and need mapping.

### 18.9 Design Decisions (Resolved)

| Question | Decision |
|----------|----------|
| Should `FolderAdapter` be a real adapter? | **Yes** - implement as proper adapter |
| How are Plex auth tokens managed? | **Hard-pasted** - manually configured in settings, not dynamically refreshed |
| How is concurrent playback handled? | **None** - each device is independent, no cross-device sync |
| What happens when Plex is offline? | **Fail gracefully** - return empty lists, skip unavailable items, continue with others |
| Can YAML configs hot-reload? | **Desired** - nice to have, not critical for v1 |
| Is content indexing required for v1? | **No** - use runtime resolution with caching; indexing is future optimization |
| Metrics/observability strategy? | **Generic** - standard request logging, no custom metrics infrastructure for v1 |
