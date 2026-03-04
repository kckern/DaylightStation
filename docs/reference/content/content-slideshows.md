# Content Slideshows

Slideshows display sequences of photos (and optionally videos) from Immich queries with Ken Burns animations, cross-dissolve transitions, optional background audio, metadata overlays, and title cards. Configuration lives entirely in query YAML files.

---

## Query Configuration

Queries can be **flat** (single content source, backwards compatible) or **composite** (an `items:` array of entries that resolve and concatenate).

### Flat query

A single content source. This is the original format:

```yaml
title: March 4 Anniversary
type: immich
sort: date_desc

params:
  month: 3
  day: 4
  yearFrom: 2014

exclude:
  - e94d8f82-0678-435a-a0a3-b16f6e8c1234

slideshow:
  duration: 5
  effect: kenburns
  zoom: 1.2
  showMetadata: true
  focusPerson: Felix

audio:
  contentId: music:anniversary
  behavior: pause
  mode: hidden
  duckLevel: 0.15
```

### Composite query

When `items:` is present, each entry resolves independently and results concatenate. Entries can be:

- **Title card** (`type: titlecard`) — a single synthetic slide
- **Content query** (`type: immich/plex/freshvideo`) — resolves to many items via adapter
- **Named query ref** (`query: name`) — resolves recursively via `SavedQueryService`

Root-level `title` and `audio` apply to the entire composed queue.

```yaml
title: March 4 Anniversary
audio:
  contentId: music:anniversary
  behavior: pause

items:
  - type: titlecard
    template: centered
    duration: 6
    effect: kenburns
    image: immich:album-cover-uuid
    text:
      title: "March 4th"
      subtitle: "A Decade of Memories"
    theme: warm-gold
    css:
      title:
        fontSize: "4rem"

  - type: immich
    params:
      month: 3
      day: 4
      yearFrom: 2022
    slideshow:
      duration: 5
      effect: kenburns
      showMetadata: true

  - type: titlecard
    template: section-header
    duration: 4
    text:
      title: "2019"

  - query: march-4-2019

  - type: titlecard
    template: credits
    duration: 8
    text:
      title: "The End"
      lines:
        - "Photos from Immich"
```

A flat query without `items:` is normalized internally into a single-element array — both forms use the same resolution pipeline.

### Title card fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"titlecard"` | yes | Identifies the entry as a title card |
| `template` | string | yes | Base template: `centered`, `section-header`, `credits`, `lower-third` |
| `duration` | number | yes | Display duration in seconds |
| `text` | object | yes | Text content (keys depend on template) |
| `text.title` | string | — | Main title text |
| `text.subtitle` | string | — | Subtitle text |
| `text.lines` | string[] | — | Array of lines (used by `credits` template) |
| `effect` | string | — | Animation effect: `kenburns` or `none` (default: `none`) |
| `zoom` | number | — | Ken Burns zoom scale (default: `1.2`) |
| `image` | string | — | Background image contentId (resolved server-side to URL) |
| `theme` | string | — | Named theme preset (default: `default`) |
| `css` | object | — | Per-element inline style overrides (keys: `title`, `subtitle`, `container`, `lines`) |

#### Styling hierarchy

Three layers, each overriding the previous:

1. **Base template** — structural layout baked into the component
2. **Theme** — named color/typography preset via CSS class (`.titlecard--theme-{name}`). Built-in: `default`, `warm-gold`, `minimal`, `bold`
3. **Explicit CSS** — per-element inline styles from the YAML `css` map, applied as React `style` objects

### `exclude`

An array of Immich asset UUIDs to filter out of the results. Applied after search and deduplication.

### `slideshow`

Display configuration stamped onto every item in the query result.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `duration` | number | `5` | Seconds per slide |
| `effect` | string | `kenburns` | Animation effect (`kenburns` or `none`) |
| `zoom` | number | `1.2` | Ken Burns zoom scale (1.0 = no zoom) |
| `showMetadata` | boolean | `false` | Show date/people/location overlay |
| `focusPerson` | string | — | Immich person name to target with smart zoom |
| `transition` | string | `crossfade` | Transition between slides |

### `audio`

Background audio track configuration. Returned at the root level of the queue API response, not per-item.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `contentId` | string | — | Content ID resolved via `ContentIdResolver` |
| `behavior` | string | `pause` | What happens during video items: `pause`, `duck`, or `skip` |
| `mode` | string | `hidden` | Player visibility: `hidden`, `overlay`, or `mini` |
| `duckLevel` | number | `0.15` | Volume multiplier when ducking (0.0–1.0) |

---

## Backend Data Flow

### SavedQueryService

`SavedQueryService.getQuery(name)` reads the YAML file and normalizes both flat and composite queries into a uniform shape with an `items` array. Root-level `title` and `audio` stay at the top level.

- **Flat query** (no `items:` key) → wrapped into `{ title, items: [{ source, params, ... }] }`
- **Composite query** (`items:` key present) → items array passed through as-is

**Location:** `backend/src/3_applications/content/SavedQueryService.mjs`

### QueryAdapter

`QueryAdapter.resolvePlayables()` iterates the normalized `items` array. For each entry:

| Entry type | Resolution |
|------------|------------|
| `type: titlecard` | Creates a synthetic `PlayableItem` with `format: 'titlecard'`, resolves `image` contentId to proxy URL |
| `type: immich/plex/freshvideo` | Resolves via existing adapter (exclude filtering, slideshow stamping) |
| `query: name` | Recursive call to `SavedQueryService.getQuery(name)`, then resolves that query's items |

Results concatenate in array order. Title card IDs are deterministic: `titlecard:{queryName}:{index}`.

**Location:** `backend/src/1_adapters/content/query/QueryAdapter.mjs`

### ImmichAdapter

`ImmichAdapter` creates `PlayableItem` instances for each asset, including face bounding box data in `metadata.people`. This face data drives the Ken Burns smart zoom on the frontend.

**Location:** `backend/src/1_adapters/content/gallery/immich/ImmichAdapter.mjs`

### Queue API

`GET /api/v1/queue/query/{queryName}` serializes the resolved items. Each item's `slideshow` config is passed through via `toQueueItem()`. The `audio` config is included at the response root level.

**Location:** `backend/src/4_api/v1/routers/queue.mjs`

---

## Frontend Components

### ImageFrame

Renders individual photos with Ken Burns animation and cross-dissolve transitions.

**Location:** `frontend/src/modules/Player/renderers/ImageFrame.jsx`

**Reads from each queue item:**
- `slideshow.duration` — auto-advance timer
- `slideshow.effect` — animation type
- `slideshow.zoom` — zoom scale
- `slideshow.focusPerson` — face targeting
- `slideshow.showMetadata` — metadata overlay toggle
- `metadata.people` — face bounding boxes for smart zoom

#### Ken Burns Smart Zoom

The `computeZoomTarget()` function selects a zoom target with this priority:

1. **Focus person** — if `focusPerson` is set and a matching face exists, zoom toward that face
2. **Center-most face** — if faces exist but no focus person matches, zoom toward the face nearest image center
3. **Random center** — if no faces, pick a random point within the center 60% of the image

Animations use the Web Animations API for smooth, GPU-accelerated transforms.

#### Cross-Dissolve

Two image layers alternate. When transitioning, the incoming image fades in while the outgoing image fades out. Both Ken Burns animations run simultaneously during the dissolve period, preventing visual discontinuity.

#### Image Upgrade

Slides initially display the thumbnail for fast rendering, then upgrade to the full-resolution original via a background load. The upgrade is seamless — the high-res image replaces the thumbnail without interrupting the Ken Burns animation.

### AudioLayer

Renders a background audio player that reacts to the current item's media type.

**Location:** `frontend/src/modules/Player/components/AudioLayer.jsx`

| Behavior | On video start | On video end |
|----------|---------------|--------------|
| `pause` | Pauses audio | Resumes audio |
| `duck` | Fades volume to `duckLevel` over 1s | Restores volume over 1s |
| `skip` | Audio continues unchanged | — |

When `mode` is `hidden`, the audio player is rendered in a zero-size container with no pointer events.

### TitleCardRenderer

Renders title cards as slides in the player queue. Registered in the format registry as `'titlecard'`.

**Location:** `frontend/src/modules/Player/renderers/TitleCardRenderer.jsx`

**Features:**
- Four built-in templates: `centered`, `section-header`, `credits`, `lower-third`
- Four themes: `default`, `warm-gold`, `minimal`, `bold`
- Ken Burns animation on optional background image (reuses `computeZoomTarget` from ImageFrame)
- Auto-advance timer (same pattern as ImageFrame)
- Per-element CSS overrides from query YAML applied as inline styles

Title cards use `mediaType: 'image'`, so AudioLayer treats them like photos — background audio continues playing without pause or duck.

### SlideshowMetadataOverlay

Displays photo metadata (date, people names, location) in a bottom overlay when `showMetadata` is enabled.

**Location:** `frontend/src/modules/Player/components/SlideshowMetadataOverlay.jsx`

Metadata is either preloaded by `ImageFrame` (via `requestIdleCallback`) or JIT-fetched from `/api/v1/info/{contentId}`. The overlay fades in/out using the Web Animations API.

---

## End-to-End Flow

```
Query YAML (flat or composite with items array)
  → SavedQueryService (normalize to items array)
  → QueryAdapter (iterate items)
      ├── titlecard → synthetic PlayableItem (resolve image contentId)
      ├── content type → existing adapter (exclude filter + slideshow stamp)
      └── query ref → recursive resolution
  → Concatenate all resolved items in order
  → Queue API (items + root-level audio)
  → Player
      ├── AudioLayer (background music, pause/duck/skip)
      └── Per item by format:
          ├── 'titlecard' → TitleCardRenderer (template + theme + css + optional bg image)
          ├── 'image' → ImageFrame (Ken Burns + dissolve + metadata overlay)
          └── 'video' → VideoPlayer (AudioLayer reacts via behavior)
```

---

## Related Docs

- `content-sources.md` — Immich driver and adapter contract
- `content-playback.md` — Player rendering pipeline
- `content-configuration.md` — Query YAML structure
