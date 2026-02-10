# Content Format Plugin Architecture — Design

## Goal

Replace the monolithic `LocalContentAdapter` (5 hardcoded `_get*()` methods, ~500 lines of variant-specific code) with declarative plugin manifests that configure two generic format adapters: `ReadalongAdapter` and `SingalongAdapter`. Each content variant (scripture, talk, poem, hymn, primary) becomes a self-contained plugin file.

## Architecture

Two layers:

1. **Format adapters** — generic, shared code for each format (`readalong`, `singalong`). Handle YAML loading, PlayableItem construction, media discovery, streaming. Know nothing about scripture, talks, or hymns.

2. **Plugins** — declarative manifests that configure a format adapter instance. Declare paths, media type, content shape, and optional resolver/renderer hooks for variant-specific logic.

```
┌─────────────────────────────────────────────────────┐
│  ReadalongAdapter (generic)                         │
│  - loadYaml(dataPath, localId)                      │
│  - buildPlayableItem(metadata, config)              │
│  - discoverMedia(mediaPath, localId)                │
│  - streamMedia(mediaPath, localId)                  │
├──────────┬──────────┬───────────────────────────────┤
│ scripture│  talk    │  poem                         │
│ plugin   │  plugin  │  plugin                       │
│ (resolver│ (resolver│  (config only,                │
│  + render│  + list  │   no hooks)                   │
│  hook)   │  hook)   │                               │
└──────────┴──────────┴───────────────────────────────┘

┌─────────────────────────────────────────────────────┐
│  SingalongAdapter (generic)                         │
│  - loadYaml(dataPath, number)                       │
│  - buildPlayableItem(metadata, config)              │
│  - discoverMedia(mediaPath, number)                 │
├──────────────────┬──────────────────────────────────┤
│  hymn plugin     │  primary plugin                  │
│  (media path     │  (config only)                   │
│   preference)    │                                  │
└──────────────────┴──────────────────────────────────┘
```

## Plugin Manifest Structure

Each plugin is a single `.mjs` file exporting a config object with optional hooks.

### Required fields

```javascript
export default {
  name: 'scripture',          // Plugin ID, used as content prefix
  format: 'readalong',       // Which format adapter to use
  paths: {
    data: 'readalong/scripture',           // Relative to dataPath
    media: 'audio/readalong/scripture',    // Relative to mediaPath
  },
  mediaType: 'audio',        // 'audio' or 'video'
  contentType: 'verses',     // Tells frontend which renderer to use
  resumable: true,           // Whether to track playback progress
}
```

### Optional hooks

```javascript
export default {
  // ...required fields...

  // ID resolution: turn user-facing ID into concrete file path
  // Only needed when the mapping isn't a simple 1:1 path lookup
  resolver: ScriptureResolver,

  // Media path preferences: search order for media file discovery
  // Default: [''] (root only). Config-driven, not hardcoded per collection.
  mediaPreference: {
    subdirs: ['_ldsgc', ''],  // Search order for media files
  },

  // Container support: declares that this type has browseable containers
  // e.g., scripture volumes, talk conferences
  containers: {
    type: 'hierarchy',        // 'hierarchy' (nested) or 'flat' (single level)
    // Provided by resolver if present
  },

  // Metadata extraction: map YAML fields to standard PlayableItem metadata
  // Default: { title: 'title', duration: 'duration' }
  // Override for non-standard YAML schemas
  metadataMap: {
    title: 'title',
    speaker: 'speaker',
    date: 'date',
    number: ['number', 'hymn_num', 'song_num'],  // Try fields in order
  },
}
```

### Config-driven principle

Plugin manifests are **data**, not code. Hardcoded values like `['_ldsgc', '']` live in the manifest config, not in adapter logic. The generic adapter reads `plugin.mediaPreference.subdirs` and iterates — it never contains collection-specific `if` branches.

The only code in a plugin is the **resolver class** (when needed), which encapsulates genuinely algorithmic logic like scripture reference parsing or conference hierarchy traversal. Everything else is declarative config that the generic adapter consumes.
```

## The Five Plugins

### Scripture (readalong + resolver + frontend renderer)

```javascript
// plugins/scripture.mjs
import { ScriptureResolver } from './resolvers/scripture.mjs';

export default {
  name: 'scripture',
  format: 'readalong',
  paths: {
    data: 'readalong/scripture',
    media: 'audio/readalong/scripture',
  },
  mediaType: 'audio',
  contentType: 'verses',
  resumable: true,
  resolver: ScriptureResolver,
  containers: { type: 'hierarchy' },  // volume → version → chapter
}
```

**Resolver** (`resolvers/scripture.mjs`): Encapsulates `scripture-guide` library usage. Handles reference parsing (`alma-32` → `bom/sebom/31103`), version defaults from manifest, verse ID ranges, version fallback when requested version is missing.

**Frontend renderer** (`scripture-guide.jsx`): Already exists. Converts verse objects (with `verse_id`, `format`, `headings`, `text`) to JSX with verse numbers, prose/poetry blocks, headings. Registered via `contentType: 'verses'`.

### Talk (readalong + resolver)

```javascript
// plugins/talk.mjs
import { TalkResolver } from './resolvers/talk.mjs';

export default {
  name: 'talk',
  format: 'readalong',
  paths: {
    data: 'readalong/talks',
    media: 'video/readalong/talks',
  },
  mediaType: 'video',
  contentType: 'paragraphs',
  resumable: true,
  resolver: TalkResolver,
  containers: { type: 'hierarchy' },  // series → conference → talk
  metadataMap: {
    title: 'title',
    speaker: 'speaker',
    date: 'date',
  },
}
```

**Resolver** (`resolvers/talk.mjs`): Encapsulates conference/series hierarchy navigation. Handles alias resolution (`ldsgc` → `ldsgc/ldsgc202510`), nested path detection, container type detection (series vs conference). Does NOT handle auto-selection — that's a selection concern, not a resolution concern.

**No frontend renderer** — paragraphs are the default readalong rendering.

### Poem (readalong, config only)

```javascript
// plugins/poem.mjs
export default {
  name: 'poem',
  format: 'readalong',
  paths: {
    data: 'readalong/poetry',
    media: 'audio/readalong/poetry',
  },
  mediaType: 'audio',
  contentType: 'paragraphs',
  resumable: false,
  metadataMap: {
    title: 'title',
    author: 'author',
    condition: 'condition',
  },
}
```

**No resolver, no renderer, no hooks.** The simplest plugin — pure config. This is the litmus test: if the simplest variant isn't trivial, the abstraction is wrong.

### Hymn (singalong + media preference)

```javascript
// plugins/hymn.mjs
export default {
  name: 'hymn',
  format: 'singalong',
  paths: {
    data: 'singalong/hymn',
    media: 'audio/singalong/hymn',
  },
  mediaType: 'audio',
  contentType: 'stanzas',
  resumable: false,
  mediaPreference: {
    subdirs: ['_ldsgc', ''],  // Prefer General Conference recordings
  },
  metadataMap: {
    title: 'title',
    number: ['number', 'hymn_num'],
  },
}
```

### Primary (singalong, config only)

```javascript
// plugins/primary.mjs
export default {
  name: 'primary',
  format: 'singalong',
  paths: {
    data: 'singalong/primary',
    media: 'audio/singalong/primary',
  },
  mediaType: 'audio',
  contentType: 'stanzas',
  resumable: false,
  mediaPreference: {
    subdirs: ['_ldsgc', ''],  // Prefer General Conference recordings (bug fix: was root-only)
  },
  metadataMap: {
    title: 'title',
    number: ['number', 'song_num'],
  },
}
```

## Generic Format Adapters

### ReadalongAdapter

Replaces all readalong logic from `LocalContentAdapter`. Driven entirely by plugin config.

```javascript
class ReadalongAdapter {
  constructor(plugin, { dataPath, mediaPath }) {
    this.plugin = plugin;
    this.dataPath = path.resolve(dataPath, plugin.paths.data);
    this.mediaPath = path.resolve(mediaPath, plugin.paths.media);
    this.resolver = plugin.resolver ? new plugin.resolver({ dataPath: this.dataPath, mediaPath: this.mediaPath }) : null;
  }

  async getItem(localId) {
    // 1. Resolve ID (plugin resolver or direct path)
    const resolved = this.resolver
      ? this.resolver.resolve(localId)
      : { path: localId };

    if (!resolved) return null;

    // 2. If resolver says it's a container, return container
    if (resolved.container) {
      return this._buildContainer(resolved);
    }

    // 3. Load YAML
    const metadata = loadContainedYaml(this.dataPath, resolved.path);
    if (!metadata) return null;

    // 4. Build PlayableItem from config + metadata
    return this._buildPlayableItem(resolved.path, metadata);
  }

  _buildPlayableItem(localId, metadata) {
    const mapped = this._mapMetadata(metadata);
    return new PlayableItem({
      id: `${this.plugin.name}:${localId}`,
      source: this.plugin.name,
      localId,
      title: mapped.title || localId,
      mediaType: this.plugin.mediaType,
      mediaUrl: `/api/v1/proxy/local-content/stream/${this.plugin.name}/${localId}`,
      duration: metadata.duration || 0,
      resumable: this.plugin.resumable,
      metadata: {
        contentFormat: 'readalong',
        contentType: this.plugin.contentType,
        content: metadata.content || metadata,
        mediaFile: `${this.plugin.paths.media}/${localId}.${this.plugin.mediaType === 'video' ? 'mp4' : 'mp3'}`,
        ...mapped,
      },
    });
  }

  _mapMetadata(metadata) {
    const map = this.plugin.metadataMap || { title: 'title', duration: 'duration' };
    const result = {};
    for (const [key, yamlField] of Object.entries(map)) {
      if (Array.isArray(yamlField)) {
        // Try fields in order (e.g., number: ['number', 'hymn_num', 'song_num'])
        result[key] = yamlField.reduce((v, f) => v ?? metadata[f], undefined);
      } else {
        result[key] = metadata[yamlField];
      }
    }
    return result;
  }
}
```

### SingalongAdapter

Same pattern, tuned for singalong content (stanza structure, song numbering, zero-padded filenames).

```javascript
class SingalongAdapter {
  constructor(plugin, { dataPath, mediaPath }) {
    this.plugin = plugin;
    this.dataPath = path.resolve(dataPath, plugin.paths.data);
    this.mediaPath = path.resolve(mediaPath, plugin.paths.media);
  }

  async getItem(localId) {
    // localId is typically a song number
    const metadata = loadYamlByPrefix(this.dataPath, localId);
    if (!metadata) return null;
    return this._buildPlayableItem(localId, metadata);
  }

  _buildPlayableItem(localId, metadata) {
    const mapped = this._mapMetadata(metadata);
    const mediaFile = this._discoverMedia(localId);
    return new PlayableItem({
      id: `${this.plugin.name}:${localId}`,
      source: this.plugin.name,
      localId,
      title: mapped.title || `#${localId}`,
      mediaType: 'audio',
      mediaUrl: mediaFile
        ? `/api/v1/proxy/local-content/stream/${this.plugin.name}/${localId}`
        : null,
      duration: metadata.duration || 0,
      resumable: false,
      metadata: {
        contentFormat: 'singalong',
        contentType: 'stanzas',
        content: { type: 'stanzas', data: metadata.verses || [] },
        collection: this.plugin.name,
        ...mapped,
      },
    });
  }

  _discoverMedia(localId) {
    const subdirs = this.plugin.mediaPreference?.subdirs || [''];
    for (const subdir of subdirs) {
      const searchDir = subdir
        ? path.join(this.mediaPath, subdir)
        : this.mediaPath;
      const found = findMediaFileByPrefix(searchDir, localId);
      if (found) return found;
    }
    return null;
  }
}
```

## Frontend: Renderer Registry

Rename components to match format names:
- `NarratedScroller.jsx` → `ReadalongScroller.jsx`
- `SingingScroller.jsx` → `SingalongScroller.jsx`

The `contentRenderers.jsx` becomes the frontend plugin registry, keyed by `contentType`:

```javascript
// contentRenderers.jsx
import { convertVersesToScriptureData, scriptureDataToJSX } from './scripture-guide.jsx';
import { generateReference } from 'scripture-guide';

const renderers = {
  // Scripture: custom verse rendering with verse numbers, poetry/prose detection
  verses: {
    parseContent: (contentData) => {
      if (!contentData?.data) return null;
      const blocks = convertVersesToScriptureData(contentData.data);
      return <div className="scripture-text">{scriptureDataToJSX(blocks)}</div>;
    },
    extractTitle: (data) => {
      if (data.resolved?.verseId) {
        try { return generateReference(data.resolved.verseId).replace(/:1$/, ''); }
        catch { /* fall through */ }
      }
      return data.metadata?.reference || data.title;
    },
    extractSubtitle: (data) => {
      const verses = data.content?.data;
      if (Array.isArray(verses) && verses[0]?.headings) {
        const { title, subtitle } = verses[0].headings;
        return [title, subtitle].filter(Boolean).join(' \u2022 ');
      }
      return data.subtitle;
    },
  },

  // Paragraphs and stanzas: no custom renderer — scroller defaults handle these.
};

export function getRenderer(contentType) {
  return renderers[contentType] || null;
}
```

The scroller checks `getRenderer(data.contentType)`. If a renderer exists, it uses it. Otherwise, default rendering.

## API Response Shape

The play/info endpoints return a `contentType` field alongside `format`:

```json
{
  "contentId": "scripture:bom/sebom/31103",
  "format": "readalong",
  "contentType": "verses",
  "mediaType": "audio",
  "title": "Alma 32",
  "mediaUrl": "/api/v1/proxy/local-content/stream/scripture/bom/sebom/31103",
  "content": {
    "type": "verses",
    "data": [...]
  }
}
```

```json
{
  "contentId": "talk:ldsgc/ldsgc202510/13",
  "format": "readalong",
  "contentType": "paragraphs",
  "mediaType": "video",
  "title": "Tune Your Heart to Jesus Christ",
  "mediaUrl": "/api/v1/proxy/local-content/stream/talk/ldsgc/ldsgc202510/13",
  "content": {
    "type": "paragraphs",
    "data": [...]
  }
}
```

`format` drives which scroller component renders. `contentType` drives which renderer plugin (if any) is used within that scroller.

## Container Resolution vs. Smart Selection

These are separate concerns:

**Container resolution** (plugin responsibility): Turning `scripture:bom` into a browseable list of chapters, or `talk:ldsgc` into a list of conferences. This lives in the plugin's resolver.

**Smart selection** (selection service responsibility): Picking the next unwatched talk from a conference, filtering by file existence on disk, using watch history. This is NOT a plugin concern. It's handled by `ItemSelectionService` + `resolvePlayables()`, and applies equally to Plex episodes, talks, or any queue.

The current bug (talk audio picking nonexistent file) should be fixed by adding file-existence filtering to `resolvePlayables()`, not by duplicating the localContent router's 120-line auto-selection logic.

## Plugin Registration (Bootstrap)

Plugins are discovered and registered at bootstrap time:

```javascript
// bootstrap.mjs
import scripturePlugin from '#plugins/scripture.mjs';
import talkPlugin from '#plugins/talk.mjs';
import poemPlugin from '#plugins/poem.mjs';
import hymnPlugin from '#plugins/hymn.mjs';
import primaryPlugin from '#plugins/primary.mjs';

const readalongPlugins = [scripturePlugin, talkPlugin, poemPlugin];
const singalongPlugins = [hymnPlugin, primaryPlugin];

for (const plugin of readalongPlugins) {
  const adapter = new ReadalongAdapter(plugin, { dataPath, mediaPath });
  registry.register(plugin.name, adapter);
}

for (const plugin of singalongPlugins) {
  const adapter = new SingalongAdapter(plugin, { dataPath, mediaPath });
  registry.register(plugin.name, adapter);
}
```

Each plugin gets its own adapter instance in the registry. `ContentIdResolver` maps aliases (`hymn:166` → `singalong:hymn/166`) and the registry resolves the adapter.

## Migration Path

1. **Phase 0**: Fix immediate talk audio bug (file-existence filter in `resolvePlayables`)
2. **Phase 1**: Create plugin manifests + generic adapters alongside existing code
3. **Phase 2**: Wire new adapters into registry, verify all regression tests pass
4. **Phase 3**: Remove `_getTalk()`, `_getScripture()`, `_getSong()`, `_getPoem()` from `LocalContentAdapter`
5. **Phase 4**: Rename scroller components, update contentRenderers to use `contentType` key
6. **Phase 5**: Delete `LocalContentAdapter` entirely (replaced by per-plugin adapter instances)

Each phase runs the full regression matrix. No phase changes external behavior.

## What This Deletes

- `LocalContentAdapter._getTalk()` (~80 lines)
- `LocalContentAdapter._getScripture()` (~150 lines)
- `LocalContentAdapter._getSong()` (~55 lines)
- `LocalContentAdapter._getPoem()` (~30 lines)
- `LocalContentAdapter._getTalkFolder()` (~100 lines)
- `LocalContentAdapter._selectFromFolder()` (~100 lines)
- `localContent.mjs` router conference auto-selection (~120 lines)
- Content-type detection heuristics in `contentRenderers.jsx`

Total: ~650 lines of variant-specific code replaced by ~5 plugin manifests (~30 lines each) + 2 generic adapters (~150 lines each).

## What This Preserves

- `scripture-guide.jsx` (frontend rendering — real complexity, stays as-is)
- `ScriptureResolver` (moved from inline to plugin hook — same logic, better home)
- `TalkResolver` (extracted from `_getTalk` + `_getTalkFolder` — same logic, isolated)
- All content URLs, API responses, and frontend rendering behavior
