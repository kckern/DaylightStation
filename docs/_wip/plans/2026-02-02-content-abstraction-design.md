# Content Abstraction Design

**Status:** Ready for Implementation
**Created:** 2026-02-02
**Authors:** kckern, Claude

---

## Problem Statement

The current content system has domain knowledge baked into the code. The backend has hardcoded methods like `_getTalk()`, `_getScripture()`, `_getSong()`. The frontend has hardcoded routing: `if (!!hymn) return <Hymns />`. Adding a new content type (e.g., audiobooks, TED talks) requires touching multiple files across the stack.

**Goal:** The code should not know what a "hymn" is.

---

## Solution Overview

Abstract content into two UI-behavior categories:

| Category | UI Behavior | Examples |
|----------|-------------|----------|
| **singing** | Centered stanzas synced to audio (participatory sing-along) | hymn, primary, karaoke |
| **narrated** | Flowing text synced to audio/video (follow-along) | scripture, poetry, talks, audiobooks |

The code handles categories generically. The specific domain (hymn, scripture, talk) becomes metadata and folder organization, not code paths.

**Key Principles:**
- No domain terms in code - "hymn", "scripture", "talk" live only in config and folder names
- Convention over configuration - folder location determines category
- Config-driven mapping - one config file for legacy support everywhere
- Style injection - collection appearance defined in manifest, not codebase
- Resolver pattern - collection-specific resolution logic in adapter layer, frontend stays abstract

---

## Data Organization

### Folder Structure

```
data/content/
├── singing/
│   ├── hymn/
│   │   ├── manifest.yml          # optional style/config overrides
│   │   ├── 0001-the-morning-breaks.yml
│   │   └── 0002-the-spirit-of-god.yml
│   ├── primary/
│   │   └── 0001-i-am-a-child-of-god.yml
│   └── {future-collections}/
└── narrated/
    ├── scripture/
    │   ├── manifest.yml          # declares resolver: scripture
    │   └── bom/sebom/31103.yml
    ├── poetry/
    │   └── remedy/01.yml
    ├── talks/
    │   └── ldsgc202410/smith.yml
    └── audiobooks/
        └── erta/chapter-01.yml

media/
├── singing/
│   ├── hymn/
│   │   └── 0002-the-spirit-of-god.mp3
│   └── primary/
└── narrated/
    ├── scripture/
    │   └── bom/sebom/31103.mp3
    ├── talks/
    │   └── ldsgc202410/smith.mp4
    └── poetry/
```

### Convention-Based Defaults

- `singing/*` → singing behavior (centered stanzas, no ambient, audio-only)
- `narrated/*` → narrated behavior (flowing text, optional video/ambient)
- Override with `manifest.yml` only when needed

### Manifest Options

```yaml
# data/content/narrated/talks/manifest.yml
containerType: watchlist      # → random-unwatched selection via ItemSelectionService
contentType: paragraphs       # default for narrated, override if needed
ambient: true                 # include ambient track
style:
  fontFamily: sans-serif
  fontSize: 1.2rem
```

```yaml
# data/content/singing/hymn/manifest.yml
containerType: album          # → sequential selection
contentType: stanzas          # default for singing
style:
  fontFamily: serif
  textAlign: center
```

---

## ID Format

### Canonical Format

```
{category}:{collection}/{path}

singing:hymn/123
singing:primary/42
narrated:scripture/bom/sebom/31103
narrated:talks/ldsgc202410/smith
narrated:poetry/remedy/01
narrated:audiobooks/erta/chapter-01
```

### Browsing Collections

```
singing:              → list all singing collections (hymn, primary, ...)
singing:hymn          → list all hymns
narrated:           → list all narrated collections
narrated:talks      → list all talk folders
narrated:talks/ldsgc202410 → list talks in that folder
```

---

## Legacy Compatibility

### Config-Driven Prefix Mapping

```yaml
# data/config/content-prefixes.yml
legacy:
  hymn: singing:hymn
  primary: singing:primary
  scripture: narrated:scripture
  talk: narrated:talks
  poem: narrated:poetry
```

This single config file serves both:
- **Backend:** ContentQueryService loads it for ID resolution
- **Frontend:** Query param resolver loads it for `tv?hymn=113` support

### Resolution Examples

| Legacy Input | Canonical Output |
|--------------|------------------|
| `hymn:123` | `singing:hymn/123` |
| `scripture:bom/sebom/31103` | `narrated:scripture/bom/sebom/31103` |
| `scripture:alma-32` | `narrated:scripture/alma-32` → resolver → `narrated:scripture/bom/sebom/34541` |
| `talk:ldsgc202410/smith` | `narrated:talks/ldsgc202410/smith` |
| `tv?hymn=113` | `contentId: singing:hymn/113` |
| `tv?scripture=alma-32` | `contentId: narrated:scripture/alma-32` |

---

## Backend Architecture

### Adapter Layer

Replace `LocalContentAdapter` with two generic adapters:

| Adapter | Source | Handles |
|---------|--------|---------|
| `SingingAdapter` | `singing` | Everything in `data/content/singing/*` |
| `ReadingAdapter` | `narrated` | Everything in `data/content/narrated/*` |

### Adapter Interface

```javascript
class SingingAdapter {
  constructor({ dataPath, mediaPath, mediaProgressMemory }) {
    this.dataPath = dataPath;      // data/content/singing/
    this.mediaPath = mediaPath;
    this.mediaProgressMemory = mediaProgressMemory;
  }

  get source() { return 'singing'; }

  get prefixes() { return [{ prefix: 'singing' }]; }

  canResolve(id) {
    return id.startsWith('singing:');
  }

  // Get single item: singing:hymn/123 → localId = "hymn/123"
  async getItem(localId) {
    const [collection, ...rest] = localId.split('/');
    const itemPath = rest.join('/');
    // Load manifest for collection (if exists)
    // Apply resolver if specified
    // Load item YAML
    // Return PlayableItem with category, collection, style
  }

  async getList(localId) { ... }
  async resolvePlayables(localId) { ... }
  async search(query) { ... }
  getStoragePath(id) { return 'singing'; }
}
```

### Filename Resolution (Prefix Matching)

The adapter layer preserves existing prefix-matching capability for numbered content:

```
singing:hymn/113  →  finds  0113-the-spirit-of-god.yml
                    finds  0113-the-spirit-of-god.mp3
```

This uses existing utilities:
- `loadYamlByPrefix(basePath, number)` - finds YAML by numeric prefix
- `findMediaFileByPrefix(searchDir, number)` - finds media by numeric prefix

The adapter applies prefix matching automatically for collections with numbered items. No resolver needed - this is default behavior for numeric IDs within a collection.

```javascript
// In SingingAdapter.getItem()
async getItem(localId) {
  const [collection, itemId] = localId.split('/');
  const collectionPath = path.join(this.dataPath, collection);

  // If itemId is numeric, use prefix matching
  if (/^\d+$/.test(itemId)) {
    const metadata = loadYamlByPrefix(collectionPath, itemId);
    // ...
  } else {
    // Otherwise direct path lookup
    const metadata = loadContainedYaml(collectionPath, itemId);
  }
}
```

---

### Collection Resolvers

Collections needing special input resolution declare it in their manifest:

```yaml
# data/content/narrated/scripture/manifest.yml
resolver: scripture
```

The adapter loads the resolver from `resolvers/`:

```javascript
// backend/src/1_adapters/content/narrated/resolvers/scripture.mjs
import { lookupReference, generateReference } from 'scripture-guide';

const VOLUME_RANGES = {
  ot: { start: 1, end: 23145 },
  nt: { start: 23146, end: 31102 },
  bom: { start: 31103, end: 37706 },
  dc: { start: 37707, end: 41994 },
  pgp: { start: 41995, end: 42663 }
};

export const ScriptureResolver = {
  /**
   * Resolve scripture input to normalized path
   * Supports: "alma-32", "37707", "bom", "bom/sebom/31103"
   * @returns {string} Normalized path like "bom/sebom/34541"
   */
  resolve(input, dataPath) {
    // Full path passthrough
    if (input.includes('/') && input.split('/').length === 3) {
      return input;
    }

    // Reference string (e.g., "alma-32")
    try {
      const ref = lookupReference(input);
      const verseId = ref?.verse_ids?.[0];
      if (verseId) {
        const volume = getVolumeFromVerseId(verseId);
        const version = getDefaultVersion(dataPath, volume);
        return `${volume}/${version}/${verseId}`;
      }
    } catch (e) { /* continue */ }

    // Numeric verse_id
    const asNumber = parseInt(input, 10);
    if (!isNaN(asNumber) && asNumber > 0) {
      const volume = getVolumeFromVerseId(asNumber);
      const version = getDefaultVersion(dataPath, volume);
      return `${volume}/${version}/${asNumber}`;
    }

    // Volume name (return first verse)
    if (VOLUME_RANGES[input]) {
      const version = getDefaultVersion(dataPath, input);
      return `${input}/${version}/${VOLUME_RANGES[input].start}`;
    }

    return null;
  }
};
```

**Benefits of resolver pattern:**
- Frontend stays completely abstract (no scripture-guide import)
- Resolution logic lives with its data in adapter layer
- Single source of truth - API, CLI, future clients all use same resolver
- Testable in isolation
- Extensible - add new resolvers for audiobooks (ISBN), TED (slug), etc.

### ContentQueryService Integration

Update `#parseIdFromText()` to load legacy mapping from config:

```javascript
constructor({ registry, mediaProgressMemory, legacyPrefixMap }) {
  this.#registry = registry;
  this.#mediaProgressMemory = mediaProgressMemory;
  this.#legacyPrefixMap = legacyPrefixMap || {};  // Loaded from content-prefixes.yml
}

#parseIdFromText(text) {
  // ... existing logic ...

  const explicitMatch = trimmed.match(/^([a-z-]+):(.+)$/i);
  if (explicitMatch) {
    const prefix = explicitMatch[1].toLowerCase();

    // Check legacy mapping from config
    const legacyTarget = this.#legacyPrefixMap[prefix];
    if (legacyTarget) {
      // hymn:123 → singing:hymn/123
      const [targetSource, targetCollection] = legacyTarget.split(':');
      return { source: targetSource, id: `${targetCollection}/${explicitMatch[2]}` };
    }

    return { source: prefix, id: explicitMatch[2] };
  }
  // ... rest unchanged ...
}
```

---

## API Response Shape

### Song Response

```javascript
// GET /api/v1/item/singing/hymn/123
{
  id: "singing:hymn/123",
  category: "singing",
  collection: "hymn",
  title: "The Spirit of God",
  subtitle: "Hymn #2",
  mediaUrl: "/api/v1/stream/singing/hymn/123",
  duration: 245,
  content: {
    type: "stanzas",
    data: [["line1", "line2"], ["line3", "line4"]]
  },
  style: {
    fontFamily: "serif",
    fontSize: "1.4rem",
    textAlign: "center",
    background: "#f5f0e6"
  }
}
```

### Reading Response

```javascript
// GET /api/v1/item/narrated/talks/ldsgc202410/smith
{
  id: "narrated:talks/ldsgc202410/smith",
  category: "narrated",
  collection: "talks",
  title: "Faith in Christ",
  subtitle: "Elder Smith",
  mediaUrl: "/api/v1/stream/narrated/talks/.../audio",
  videoUrl: "/api/v1/stream/narrated/talks/.../video",  // optional
  ambientUrl: "/api/v1/stream/ambient/random",          // optional
  duration: 1200,
  content: {
    type: "paragraphs",
    data: ["First paragraph...", "Second paragraph..."]
  },
  style: {
    fontFamily: "sans-serif",
    fontSize: "1.2rem",
    textAlign: "left"
  }
}
```

### Style from Manifest

```yaml
# data/content/singing/hymn/manifest.yml
style:
  fontFamily: serif
  fontSize: 1.4rem
  textAlign: center
  background: "#f5f0e6"
```

No manifest = category defaults apply.

---

## Frontend Architecture

### Component Structure

```
ContentScroller.jsx (base - unchanged)
├── SingingScroller.jsx    (new - replaces Hymns)
└── ReadingScroller.jsx (new - replaces Scriptures, Talk, Poetry)
```

### SinglePlayer Routing

```javascript
// Before: hardcoded domain knowledge
if (!!scripture) return <Scriptures {...props} />;
if (!!hymn) return <Hymns {...props} />;
if (!!talk) return <Talk {...props} />;
if (!!poem) return <Poetry {...props} />;

// After: route by category from content ID
const category = contentId?.split(':')[0];

if (category === 'singing') return <SingingScroller contentId={contentId} {...props} />;
if (category === 'narrated') return <ReadingScroller contentId={contentId} {...props} />;
```

### Query Param Resolution

```javascript
// lib/queryParamResolver.js
// Loaded from backend config endpoint, not hardcoded
const LEGACY_PARAMS = await fetchConfig('content-prefixes');
// Returns: { hymn: 'singing:hymn', scripture: 'narrated:scripture', ... }

function resolvePlayParams(params) {
  for (const [legacyKey, canonicalPrefix] of Object.entries(LEGACY_PARAMS.legacy)) {
    if (params[legacyKey]) {
      return {
        contentId: `${canonicalPrefix}/${params[legacyKey]}`
        // hymn=113 → contentId: "singing:hymn/113"
        // scripture=alma-32 → contentId: "narrated:scripture/alma-32"
      };
    }
  }

  // New canonical format passes through
  if (params.play) return { contentId: params.play };
  if (params.queue) return { contentId: params.queue, queue: true };

  return null;
}
```

### Dynamic Styling

```jsx
function SingingScroller({ style, content, ...props }) {
  const cssVars = {
    '--font-family': style?.fontFamily || 'sans-serif',
    '--font-size': style?.fontSize || '1.2rem',
    '--text-align': style?.textAlign || 'center',
    '--background': style?.background || 'transparent',
    '--color': style?.color || 'inherit'
  };

  return (
    <div className="singing-scroller" style={cssVars}>
      {/* content */}
    </div>
  );
}
```

```scss
// No .hymn, .primary, .scripture classes - just category classes
.singing-scroller {
  font-family: var(--font-family);
  font-size: var(--font-size);
  text-align: var(--text-align);
  background: var(--background);
  color: var(--color);
}

.narrated-scroller {
  font-family: var(--font-family);
  font-size: var(--font-size);
  text-align: var(--text-align);
}
```

---

## Migration Path

### Phase 1: Add New Adapters (Parallel)

- Create `SingingAdapter` and `ReadingAdapter`
- Register with ContentSourceRegistry as `singing` and `narrated`
- Keep `LocalContentAdapter` running for legacy IDs
- Add legacy prefix mapping to `data/config/content-prefixes.yml`

### Phase 2: Migrate Data Folders

```bash
# Move content to new structure
# Current: data/content/songs/hymn/ → New: data/content/singing/hymn/
# Current: data/content/songs/primary/ → New: data/content/singing/primary/
# Current: data/content/scripture/ → New: data/content/narrated/scripture/
# Current: data/content/poetry/ → New: data/content/narrated/poetry/
# Current: data/content/talks/ → New: data/content/narrated/talks/

# Also migrate media files:
# Current: media/audio/songs/hymn/ → New: media/singing/hymn/
# Current: media/audio/songs/primary/ → New: media/singing/primary/
# Current: media/audio/scripture/ → New: media/narrated/scripture/
# Current: media/video/talks/ → New: media/narrated/talks/
# Current: media/audio/poetry/ → New: media/narrated/poetry/
```

### Phase 2.5: Migrate Watch State

```bash
# One-time migration script to convert storage keys:
# 'songs' → 'singing'
# 'talks' → 'narrated'
# 'scripture' → 'narrated'
# 'poetry' → 'narrated'
```

### Phase 3: Update Frontend

- Create `SingingScroller` and `ReadingScroller` components
- Update `SinglePlayer` to route by category
- Add query param resolver using config
- Remove `Scriptures`, `Hymns`, `Talk`, `Poetry` components

### Phase 4: Update Lists/Menus

- Update YAML lists using legacy IDs to canonical format
- Legacy fallback handles old references during transition

### Phase 5: Remove Legacy

- Delete `LocalContentAdapter`
- Remove legacy mapping from config (or keep indefinitely for external references)

---

## Exit Criteria

Runtime tests in `tests/runtime/content-migration/` verifying:

```javascript
// tests/runtime/content-migration/legacy-params.test.mjs
describe('Legacy query params', () => {
  test('tv?hymn=2 plays singing:hymn/2');
  test('tv?primary=1 plays singing:primary/1');
  test('tv?scripture=bom/1ne/1 plays narrated:scripture/bom/1ne/1');
  test('tv?scripture=alma-32 resolves and plays correctly');
  test('tv?scripture=37707 resolves verse_id and plays correctly');
  test('tv?talk=ldsgc202410/smith plays narrated:talks/ldsgc202410/smith');
  test('tv?poem=remedy/01 plays narrated:poetry/remedy/01');
});

describe('Canonical IDs', () => {
  test('tv?play=singing:hymn/2 works');
  test('tv?play=narrated:scripture/bom/sebom/31103 works');
  test('tv?play=narrated:talks/ldsgc202410/smith works');
});

describe('API resolution', () => {
  test('hymn:2 resolves to singing:hymn/2');
  test('scripture:alma-32 resolves to narrated:scripture/bom/sebom/34541');
  test('singing:hymn/2 returns correct response shape with style');
  test('narrated:scripture/bom/sebom/31103 returns correct response shape');
});

describe('Scripture resolver edge cases', () => {
  test('resolves reference string: alma-32');
  test('resolves verse_id: 37707');
  test('resolves volume: bom → first chapter');
  test('passes through full path: bom/sebom/31103');
});

describe('Prefix matching (numbered content)', () => {
  test('singing:hymn/2 finds 0002-the-spirit-of-god.yml');
  test('singing:hymn/113 finds 0113-*.yml');
  test('singing:primary/1 finds 0001-i-am-a-child-of-god.yml');
  test('media file found by prefix: 113 → 0113-*.mp3');
});
```

---

## Design Decisions (Audit)

| Question | Decision |
|----------|----------|
| Media file location | Mirror data structure: `media/singing/`, `media/narrated/` |
| API routing | Unified item router: `/api/v1/item/singing/...`, `/api/v1/item/narrated/...` |
| Watch state migration | One-time migration script converts storage keys |
| Smart selection | Manifest declares `containerType`, ItemSelectionService applies strategy |
| Folder vs source naming | Both singular: `singing`, `narrated` |
| Content type | Category default (stanzas/paragraphs), manifest can override |
| Ambient tracks | Adapter resolves random ambient, returns resolved URL |
| Duration fetching | Adapter handles (YAML first, parseFile fallback) |
| Data parent directory | Keep `content/` parent: `data/content/singing/`, `data/content/narrated/` |

---

## Summary

| Layer | Change |
|-------|--------|
| **Data** | Reorganize into `data/content/singing/` and `data/content/narrated/` |
| **Config** | `content-prefixes.yml` for legacy mapping (shared) |
| **Backend** | Replace `LocalContentAdapter` with `SingingAdapter` + `ReadingAdapter` |
| **Resolvers** | Collection-specific resolvers in adapter layer (e.g., ScriptureResolver) |
| **ContentQueryService** | Load legacy prefix map from config |
| **Frontend** | Replace 5 components with 2: `SingingScroller`, `ReadingScroller` |
| **Frontend routing** | Query param resolver uses same config, routes by category |
| **Styling** | Injected from collection manifest via CSS variables |

**No domain terms in code.** "Hymn", "scripture", "talk" exist only in:
- Folder names (`data/content/singing/hymn/`)
- Config files (`content-prefixes.yml`)
- Manifest files (`manifest.yml`)

The codebase is fully generic and extensible.
