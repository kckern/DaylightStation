# Title Cards for Slideshow Queries

Title cards are custom-rendered slides (intro, outro, section dividers, intertitles) that appear inline in slideshow queues alongside photos and videos. They are defined in query YAML, resolved as synthetic queue items, and rendered via JSX on the frontend.

---

## Query YAML Structure

### Composite queries

When an `items:` key is present, the query becomes a composite — an ordered list of entries that resolve and concatenate into a single queue.

Each entry is one of:
- **Title card** (`type: titlecard`) — resolves to a single synthetic queue item
- **Content query** (`type: immich/plex/freshvideo`) — resolves to many items via the adapter
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
        textShadow: "0 2px 8px rgba(0,0,0,0.6)"

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
      subtitle: "Five Years Ago"

  - query: march-4-2019

  - type: titlecard
    template: credits
    duration: 8
    text:
      title: "The End"
      lines:
        - "Photos from Immich"
        - "Music: Anniversary Waltz"
```

### Flat queries (backwards compatible)

When no `items:` key is present, the top-level object is the single item to resolve. This is today's format, unchanged:

```yaml
title: March 4 Photos
type: immich
params:
  month: 3
  day: 4
slideshow:
  duration: 5
  effect: kenburns
```

A flat query is equivalent to a single-element `items:` array. `SavedQueryService` normalizes both forms before passing downstream.

A standalone title card is also valid as a flat query:

```yaml
title: Welcome Screen
type: titlecard
template: centered
duration: 10
text:
  title: "Welcome"
```

### Title card fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `type` | `"titlecard"` | yes | Identifies the entry as a title card |
| `template` | string | yes | Base template name: `centered`, `section-header`, `credits`, `lower-third` |
| `duration` | number | yes | Display duration in seconds |
| `text` | object | yes | Text content (keys depend on template) |
| `text.title` | string | — | Main title text |
| `text.subtitle` | string | — | Subtitle text |
| `text.lines` | string[] | — | Array of lines (used by `credits` template) |
| `effect` | string | — | Animation effect: `kenburns` or `none` (default: `none`) |
| `zoom` | number | — | Ken Burns zoom scale (default: `1.2`) |
| `image` | string | — | Background image contentId (resolved server-side to URL) |
| `theme` | string | — | Named theme preset (default: `default`) |
| `css` | object | — | Per-element inline style overrides |

---

## Styling Hierarchy

Three layers, each overriding the previous:

### 1. Base template

Structural layout and default styles baked into the component.

| Template | Layout | Use case |
|----------|--------|----------|
| `centered` | Title + subtitle centered vertically/horizontally, semi-transparent backdrop | Intro cards, announcements |
| `section-header` | Large text centered, minimal chrome | Year/chapter dividers |
| `credits` | Vertically scrolling or stacked lines, centered | Outro/credits |
| `lower-third` | Text bar anchored to bottom third | Caption-style overlay on background image |

### 2. Theme

Named color/typography presets applied via CSS class (`.titlecard--theme-{name}`).

| Theme | Style |
|-------|-------|
| `default` | White text, dark scrim, system font |
| `warm-gold` | Warm amber tones, serif font |
| `minimal` | Thin weight, no backdrop, clean |
| `bold` | Large heavy type, high contrast |

Themes are defined in the component's SCSS. Custom themes can be added via household theme overrides.

### 3. Explicit CSS

Per-element inline styles from the YAML `css` map. Keys map to rendered elements:

```yaml
css:
  title:
    fontSize: "5rem"
    color: "#ffd700"
  subtitle:
    fontStyle: "italic"
  container:
    background: "linear-gradient(to bottom, transparent, rgba(0,0,0,0.8))"
```

Applied as React inline `style` objects, so they override template and theme styles.

---

## Data Model

### Synthetic queue item

A title card resolves to this shape in the queue API response:

```json
{
  "id": "titlecard:march-4-anniversary:0",
  "contentId": "titlecard:march-4-anniversary:0",
  "title": "March 4th",
  "source": "titlecard",
  "mediaType": "image",
  "format": "titlecard",
  "duration": 6,
  "slideshow": {
    "duration": 6,
    "effect": "kenburns",
    "zoom": 1.15
  },
  "titlecard": {
    "template": "centered",
    "text": {
      "title": "March 4th",
      "subtitle": "A Decade of Memories"
    },
    "theme": "warm-gold",
    "css": {
      "title": { "fontSize": "4rem" }
    },
    "imageUrl": "/api/v1/proxy/immich/assets/uuid/file"
  }
}
```

Key decisions:
- **`mediaType: 'image'`** — AudioLayer treats it like a photo (audio keeps playing)
- **`format: 'titlecard'`** — routes to `TitleCardRenderer` in the format registry
- **`slideshow`** — standard effect config reused by the renderer
- **`titlecard`** — rendering payload (template, text, theme, css, resolved image URL)
- **`id`** — deterministic: `titlecard:{queryName}:{index}`
- **`image` contentId** resolved server-side to `imageUrl` so the frontend has a ready URL

---

## Backend Resolution

### SavedQueryService normalization

`getQuery()` normalizes both forms:

1. If `items:` key exists → return items array with root-level `audio`/`title` as shared config
2. If no `items:` key → wrap top-level object into a single-element array

Downstream code always works with an array.

### QueryAdapter resolution

`resolvePlayables()` iterates the normalized array. For each entry:

| Entry type | Resolution |
|------------|------------|
| `type: titlecard` | Create synthetic `PlayableItem` with `format: 'titlecard'`, resolve `image` contentId to URL, attach template/text/theme/css |
| `type: immich/plex/freshvideo` | Resolve via existing adapter (unchanged) |
| `query: name` | Recursive call to `SavedQueryService.getQuery(name)`, then resolve that query's items |

Results concatenate in array order. Title card IDs are `titlecard:{parentQueryName}:{index}` where index is the position in the `items:` array.

### Queue API serialization

`toQueueItem()` passes through the `titlecard` payload alongside the standard fields. No special handling needed — the existing conditional spread pattern applies.

---

## Frontend Renderer

### TitleCardRenderer

New component registered in the format registry as `'titlecard'`.

**Props:** Same contract as `ImageFrame` — `media`, `advance`, `clear`, `shader`, `resilienceBridge`.

**Behavior:**

1. Select template component based on `media.titlecard.template`
2. If `media.titlecard.imageUrl` exists, render as background `<img>` with Ken Burns animation (reuse `computeZoomTarget` from ImageFrame)
3. Render text elements from `media.titlecard.text` with theme CSS class + inline style overrides
4. Auto-advance after `media.slideshow.duration` seconds (same timer pattern as ImageFrame)
5. Provide `resilienceBridge` mock (title cards aren't real media elements)

**No dual-layer cross-dissolve** — title cards don't need it. Transitions between items use the Player's standard item-change mechanism.

### Template components

Each template is a small functional component that receives `text`, `theme`, `css`, and renders the appropriate layout. Templates are selected via a map:

```javascript
const TEMPLATES = {
  centered: CenteredTemplate,
  'section-header': SectionHeaderTemplate,
  credits: CreditsTemplate,
  'lower-third': LowerThirdTemplate,
};
```

### Integration points

- **Format registry:** Register `'titlecard'` → `TitleCardRenderer`
- **AudioLayer:** No changes needed — `mediaType: 'image'` means audio continues playing
- **Player/SinglePlayer:** No changes needed — format dispatch handles routing
- **SlideshowMetadataOverlay:** Not shown for title cards (no photo metadata)

---

## End-to-end flow

```
Query YAML (items array with titlecards + content + query refs)
  → SavedQueryService (normalize flat/array, pass through)
  → QueryAdapter (iterate items array)
      ├── titlecard → synthetic PlayableItem (resolve image contentId)
      ├── content type → existing adapter resolution
      └── query ref → recursive SavedQueryService.getQuery() → resolve
  → Concatenate all resolved items in order
  → Queue API (serialize with titlecard payload)
  → Player
      ├── AudioLayer (audio continues — mediaType is 'image')
      └── Per item by format:
          ├── 'titlecard' → TitleCardRenderer (template + theme + css + optional bg image)
          ├── 'image' → ImageFrame (Ken Burns + dissolve)
          └── 'video' → VideoPlayer
```
