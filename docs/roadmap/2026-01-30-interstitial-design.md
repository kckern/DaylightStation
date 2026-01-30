# Grounding Interstitial Design

> Value-add content between queue items ("commercial breaks" that ground, not extract)

**Last Updated:** 2026-01-30
**Status:** Design Complete, Ready for Implementation
**MVP Use Case:** Family photos/videos between TV episodes

---

## Overview

Grounding Interstitials insert value-add content between queue items during playback. Instead of ads, viewers see:

- Family photos/videos from Immich or local media
- Calendar reminders ("Dentist tomorrow at 2pm")
- Entropy alerts ("4 days since last workout")
- Prosocial content from curated Plex playlists
- Scripture, quotes, or lifeplan nudges

**Key principles:**
- **Backend-centric** - Frontend asks "what's next?", backend decides
- **Policy-driven** - Gatekeeper policies control frequency, pools, and priority
- **Context-aware** - Backend uses watch history, session duration, time of day
- **Source-agnostic** - Normalized item format regardless of origin
- **Universal playback** - Works for React Player, VLC, m3u8 streams

---

## Use Case

From the landing page vision:

> "Between episodes, instead of an ad, a photo from three years ago appears: the kids at the beach."

**Flow:**
1. Episode ends
2. Frontend calls `POST /api/v1/interstitial/next` with finished item ID
3. Backend evaluates policies, session context, and priorities
4. Backend returns either an interstitial item or `null` (skip to next episode)
5. If interstitial returned, frontend plays it as a queue item
6. After interstitial ends, frontend advances to next episode normally

---

## Architecture

### Layer Responsibilities

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4_api/v1/interstitial/                                                      │
│                                                                             │
│ • POST /next - "I finished {itemId}, what's next?"                         │
│   Returns: InterstitialItem | null                                         │
│ • GET /render/:cardId.png - Pre-rendered card image                        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3_applications/interstitial/                                                │
│                                                                             │
│ • InterstitialService                                                       │
│   - evaluateNext(sessionContext) → InterstitialItem | null                 │
│   - Checks Gatekeeper policy                                               │
│   - Tracks session history                                                 │
│   - Applies priority selection                                             │
│                                                                             │
│ • CardRenderer                                                             │
│   - Generates PNG images from card data                                    │
│   - Caches rendered cards                                                  │
│                                                                             │
│ • ports/ContentPoolPort.mjs - Interface for content sources               │
│                                                                             │
│ • pool-adapters/ (thin wrappers over existing adapters)                   │
│   - PlexPoolAdapter.mjs - Uses PlexAdapter                                │
│   - ImmichPoolAdapter.mjs - Uses ImmichProxyAdapter                       │
│   - LocalMediaPoolAdapter.mjs - Uses MediaAdapter                         │
│   - CalendarPoolAdapter.mjs - Uses CalendarAdapter → card generation      │
│   - TodoistPoolAdapter.mjs - Uses TodoistAdapter → card generation        │
│   - EntropyPoolAdapter.mjs - Uses EntropyService → card generation        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                        Uses existing adapters
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2_adapters/ (existing)                                                      │
│                                                                             │
│ • content/media/plex/PlexAdapter.mjs                                       │
│ • proxy/ImmichProxyAdapter.mjs                                             │
│ • scheduling/CalendarAdapter.mjs                                           │
│ • scheduling/TodoistAdapter.mjs                                            │
│ • entropy/ (existing entropy adapters)                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1_domains/interstitial/                                                     │
│                                                                             │
│ • entities/InterstitialItem.mjs                                            │
│   { type, contentType, media_url, duration, card?, source, skippable }    │
│                                                                             │
│ • value-objects/ContentPool.mjs                                            │
│   { id, source, sourceConfig, priority, enabled }                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
1_domains/interstitial/
├── entities/
│   └── InterstitialItem.mjs
├── value-objects/
│   └── ContentPool.mjs
└── index.mjs

3_applications/interstitial/
├── InterstitialService.mjs
├── CardRenderer.mjs
├── ports/
│   └── ContentPoolPort.mjs
├── pool-adapters/
│   ├── PlexPoolAdapter.mjs
│   ├── ImmichPoolAdapter.mjs
│   ├── LocalMediaPoolAdapter.mjs
│   ├── CalendarPoolAdapter.mjs
│   ├── TodoistPoolAdapter.mjs
│   └── EntropyPoolAdapter.mjs
└── index.mjs

4_api/v1/routers/
└── interstitial.mjs
```

---

## Domain Model

### InterstitialItem Entity

```javascript
/**
 * InterstitialItem - A grounding content item for playback between queue items
 */
class InterstitialItem {
  constructor(data) {
    this.id = data.id                           // Unique interstitial ID
    this.type = 'interstitial'                  // Always 'interstitial'
    this.contentType = data.contentType         // 'video' | 'audio' | 'image' | 'card'
    this.media_url = data.media_url             // Media URL (for video/audio/image)
    this.duration = data.duration               // Display/play duration in seconds
    this.title = data.title                     // Display title
    this.source = data.source                   // Origin: 'plex' | 'immich' | 'calendar' | etc.
    this.skippable = data.skippable ?? true     // Can user skip?

    // For card types:
    this.card = data.card                       // { template, data }
    this.image_url = data.image_url             // Pre-rendered fallback image
  }
}
```

### ContentPool Value Object

```javascript
/**
 * ContentPool - Configuration for a content source
 */
class ContentPool {
  constructor(data) {
    this.id = data.id                           // Pool identifier
    this.source = data.source                   // 'plex' | 'immich' | 'local' | 'calendar' | etc.
    this.sourceConfig = data.sourceConfig       // Source-specific config (playlist ID, album, path)
    this.priority = data.priority ?? 5          // Lower = higher priority
    this.enabled = data.enabled ?? true
  }
}
```

### ContentPoolPort Interface

```javascript
/**
 * ContentPoolPort - Interface for content pool adapters
 */
interface ContentPoolPort {
  /**
   * Get pool identifier
   */
  getId(): string

  /**
   * Get a random item from the pool
   */
  getRandomItem(): Promise<InterstitialItem | null>

  /**
   * Get multiple items from the pool
   */
  getItems(limit: number): Promise<InterstitialItem[]>

  /**
   * Check if pool has available content
   */
  hasContent(): Promise<boolean>
}
```

---

## API Contract

### POST /api/v1/interstitial/next

Check if an interstitial should play after the finished item.

**Request:**
```javascript
{
  finishedItemId: 'plex:12345',  // What just finished
  sessionId: 'abc-123'           // Optional: client-provided session ID
}
```

**Response (interstitial):**
```javascript
{
  type: 'interstitial',
  contentType: 'video' | 'audio' | 'image' | 'card',

  // For video/audio/image:
  media_url: '/api/v1/proxy/plex/...',

  // For cards (structured data for React Player):
  card: {
    template: 'calendar' | 'todo' | 'entropy' | 'scripture' | 'quote',
    data: { /* template-specific */ }
  },

  // Pre-rendered fallback (for VLC, m3u8, non-React consumers):
  image_url: '/api/v1/interstitial/render/card-abc123.png',

  duration: 30,              // Seconds (display time for images/cards)
  title: 'Family Beach 2023',
  source: 'immich',          // Origin for debugging/analytics
  skippable: true,           // Can user skip? (policy-controlled)
  interstitialId: 'int-xyz'  // For tracking shown items
}
```

**Response (no interstitial):**
```javascript
{
  type: 'continue',
  interstitial: null
}
```

### GET /api/v1/interstitial/render/:cardId.png

Returns pre-rendered card image. Generated on-demand and cached.

---

## Configuration

### Interstitial App Config

```yaml
# data/household/apps/interstitial/config.yml
interstitial:
  enabled: true

  # Content pools (sources for interstitial content)
  pools:
    family-media:
      source: plex
      playlist: 12345          # Plex playlist ID
      priority: 2

    family-photos:
      source: immich
      album: 'family-favorites'
      priority: 3

    local-greetings:
      source: local
      path: 'grounding/greetings'
      priority: 2

    calendar-cards:
      source: calendar
      lookahead_hours: 24      # Show events within 24 hours
      priority: 1              # Higher priority = shown first

    entropy-alerts:
      source: entropy
      priority: 0              # Highest priority

    scripture:
      source: scripture
      collection: 'daily'
      priority: 4

  # Default frequency (can be overridden by policy)
  defaults:
    frequency: every_n_items
    n: 3                       # Every 3 episodes
    min_item_duration: 300     # Don't interrupt items < 5 min
```

### Gatekeeper Policy Integration

```yaml
# data/household/apps/gatekeeper/config.yml
policies:
  kids-media-interstitials:
    statements:
      - effect: allow
        actions: [media-playback]
        resources: [plex:library:kids-tv]
        conditions:
          interstitial:
            frequency: every_n_items
            n: 1                    # Every episode for kids
            pools: [family-photos, scripture]
            skippable: false        # Kids can't skip

  teen-evening-interstitials:
    statements:
      - effect: allow
        actions: [media-playback]
        resources: [plex:library:*]
        conditions:
          time: { after: "19:00", before: "21:00" }
          interstitial:
            frequency: every_n_items
            n: 2
            pools: [entropy-alerts, calendar-cards, family-media]
            priority_override:
              entropy-alerts: 0     # Always show entropy first
```

---

## Frontend Integration

### useQueueController Changes

```javascript
// frontend/src/modules/Player/hooks/useQueueController.js

// After an item ends (in advance function):
const advance = useCallback(async (step = 1) => {
  const finishedItem = playQueue[0];

  // Check for interstitial before advancing
  if (finishedItem && step > 0) {
    const response = await DaylightAPI('api/v1/interstitial/next', {
      method: 'POST',
      body: {
        finishedItemId: finishedItem.plex || finishedItem.media_key,
        sessionId: sessionRef.current
      }
    });

    if (response.type === 'interstitial') {
      // Insert interstitial at front of queue, it plays next
      setQueue(prev => [normalizeInterstitial(response), ...prev]);
      return;
    }
  }

  // Normal queue advancement (existing logic)
  setQueue(prev => { /* existing advance logic */ });
}, [playQueue, ...]);

// Normalize interstitial to queue item format
function normalizeInterstitial(item) {
  return {
    guid: guid(),
    type: item.contentType,           // 'video' | 'audio' | 'image' | 'card'
    media_url: item.media_url,
    duration: item.duration,
    title: item.title,
    isInterstitial: true,             // Flag for special handling
    card: item.card,                  // Structured card data (if card type)
    image_url: item.image_url,        // Fallback image
    skippable: item.skippable,
    interstitialId: item.interstitialId
  };
}
```

### InterstitialCard Component

```jsx
// frontend/src/modules/Player/components/InterstitialCard.jsx

function InterstitialCard({ card, fallbackImage, duration, onEnd }) {
  useEffect(() => {
    const timer = setTimeout(onEnd, duration * 1000);
    return () => clearTimeout(timer);
  }, [duration, onEnd]);

  // Render based on template
  const templates = {
    calendar: CalendarCard,
    todo: TodoCard,
    entropy: EntropyCard,
    scripture: ScriptureCard,
    quote: QuoteCard
  };

  const Template = templates[card?.template];

  if (Template && card?.data) {
    return <Template {...card.data} />;
  }

  // Fallback to pre-rendered image
  return <img src={fallbackImage} alt="Interstitial" />;
}
```

### SinglePlayer Handling

```javascript
// In SinglePlayer.jsx - add card type routing
if (media.type === 'card' || (media.isInterstitial && media.card)) {
  return <InterstitialCard
    card={media.card}
    fallbackImage={media.image_url}
    duration={media.duration}
    onEnd={advance}
  />;
}
```

---

## Implementation Phases

### Phase 1: Core Infrastructure (MVP)

- [ ] `1_domains/interstitial/` - InterstitialItem entity, ContentPool value object
- [ ] `3_applications/interstitial/InterstitialService.mjs` - Core orchestration
- [ ] `3_applications/interstitial/ports/ContentPoolPort.mjs` - Pool interface
- [ ] `3_applications/interstitial/pool-adapters/PlexPoolAdapter.mjs` - Plex playlist source
- [ ] `4_api/v1/routers/interstitial.mjs` - POST /next endpoint
- [ ] Basic frequency logic (every N items)
- [ ] Session tracking (don't repeat recent interstitials)

**MVP content:** Single Plex playlist as grounding pool, video/audio/image types only.

### Phase 2: Card Types + Rendering

- [ ] Card templates: calendar, todo, entropy
- [ ] `3_applications/interstitial/CardRenderer.mjs` - Image generation service
- [ ] `GET /api/v1/interstitial/render/:cardId.png` endpoint
- [ ] Frontend `InterstitialCard` component with templates
- [ ] Pool adapters: CalendarPoolAdapter, TodoistPoolAdapter, EntropyPoolAdapter

### Phase 3: Gatekeeper Integration

- [ ] Policy condition parsing for interstitial rules
- [ ] Per-user/role frequency overrides
- [ ] Pool selection by policy
- [ ] Skippable control by policy
- [ ] Content filtering by labels/libraries

### Phase 4: Additional Sources

- [ ] ImmichPoolAdapter - Family photos from Immich albums
- [ ] LocalMediaPoolAdapter - Local media folder
- [ ] ScripturePoolAdapter - Scripture/quote content
- [ ] Priority-based selection across multiple pools

### Phase 5: Stream Integration (Future)

- [ ] m3u8/HLS stream generation with interstitial injection
- [ ] Radio endpoint: `/api/v1/stream/radio/:channel`

---

## Open Questions

1. **Card rendering technology:** Puppeteer, sharp+canvas, or SVG-to-PNG for card image generation?

2. **Session persistence:** Should session history persist across app restarts? (In-memory vs Redis/YAML)

3. **Analytics:** Should we track interstitial impressions for parent dashboard?

4. **Skip behavior:** When skipped, should we still count it toward "items since last interstitial"?

5. **Audio interstitials:** For audio-only streams, should card content be read aloud via TTS?

---

## Related Documents

- [Gatekeeper Domain Design](./2026-01-30-gatekeeper-domain-design.md) - Policy engine for interstitial rules
- [Location Domain Design](./2026-01-30-location-domain-design.md) - PIP overlay pattern (related UI)
- Landing page - Original vision description

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-30 | Initial design from brainstorming session |
