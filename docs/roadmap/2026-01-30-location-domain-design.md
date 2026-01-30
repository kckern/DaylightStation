# Location Domain Design

> Live location sharing for family awareness ("Dad is on his way home")

**Last Updated:** 2026-01-30
**Status:** Design Complete, Ready for Implementation
**MVP Use Case:** TV App PIP showing family member en route

---

## Overview

The Location domain tracks active location shares from family members, enabling ambient awareness features like "Dad is 5 minutes away" displayed as a PIP overlay on the TV while watching a show.

**Key principles:**
- **Vendor-agnostic** - Domain doesn't know about Glympse, Life360, etc.
- **Event-driven** - Share started/ended events flow through EventBus
- **Privacy-respecting** - Explicit opt-in sharing, not continuous tracking
- **Decoupled triggers** - Share detection and arrival detection are abstracted

---

## Use Case

From the landing page vision:

> "A small notification slides in: 'Dad is 5 minutes away.' A map shows his route. The movie doesn't pause."

**Flow:**
1. Dad starts a Glympse share (explicit action)
2. System detects the share (via Gmail polling, Telegram, etc.)
3. TV App shows PIP with embedded map
4. Dad arrives home (detected via Home Assistant presence)
5. TV App hides PIP

---

## Architecture

### Layer Responsibilities

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 4_api/v1/location/                                                          │
│                                                                             │
│ • POST /shares - Manual share creation                                     │
│ • GET /shares/active - List active shares                                  │
│ • DELETE /shares/:id - Cancel share                                        │
│ • GET /shares/:id/embed - Get embed config for frontend                    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 3_applications/location/                                                    │
│                                                                             │
│ • LocationTrackingService - Orchestrates share lifecycle                   │
│ • ShareDetectionHandler - Processes incoming share notifications           │
│ • PresenceChangeHandler - Ends shares when user arrives home               │
│                                                                             │
│ Listens to:                                                                │
│ • Share detection events (from Gmail harvester, Telegram, manual)          │
│ • Home Assistant presence changes                                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 1_domains/location/                                                         │
│                                                                             │
│ • LocationShare entity - Share state and metadata                          │
│ • LocationShareService - Domain logic (create, end, query)                 │
│ • LocationSourcePort - Adapter interface                                   │
│                                                                             │
│ Emits:                                                                     │
│ • location.share.started                                                   │
│ • location.share.ended                                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│ 2_adapters/location/                                                        │
│                                                                             │
│ • glympse/GlympseAdapter - Implements LocationSourcePort                   │
│ • (future) life360/Life360Adapter                                          │
│ • (future) ha-companion/HACompanionAdapter                                 │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
1_domains/location/
├── entities/
│   └── LocationShare.mjs
├── services/
│   └── LocationShareService.mjs
├── ports/
│   └── LocationSourcePort.mjs
└── index.mjs

2_adapters/location/
├── glympse/
│   ├── GlympseAdapter.mjs
│   └── manifest.mjs
└── index.mjs

3_applications/location/
├── LocationTrackingService.mjs
├── handlers/
│   ├── ShareDetectionHandler.mjs
│   └── PresenceChangeHandler.mjs
└── index.mjs

4_api/v1/routers/
└── location.mjs
```

---

## Domain Model

### LocationShare Entity

```javascript
/**
 * LocationShare - A time-bounded location sharing session
 *
 * Vendor-agnostic: uses location_src + location_key instead of vendor-specific URLs
 */
class LocationShare {
  constructor(data) {
    this.id = data.id                           // Unique share ID
    this.user = data.user                       // Daylight user (maps to HA person)
    this.location_src = data.location_src       // 'glympse' | 'life360' | 'ha_companion'
    this.location_key = data.location_key       // Adapter-specific identifier
    this.label = data.label                     // Optional: "Dad", "Coming home from work"
    this.startedAt = data.startedAt             // When share was detected
    this.status = data.status                   // 'active' | 'arrived' | 'expired' | 'cancelled'
    this.endedAt = data.endedAt                 // When share ended (if ended)
    this.endReason = data.endReason             // 'arrived' | 'expired' | 'cancelled'
  }

  isActive() {
    return this.status === 'active'
  }

  end(reason) {
    this.status = reason
    this.endReason = reason
    this.endedAt = new Date()
  }
}
```

### LocationSourcePort Interface

```javascript
/**
 * LocationSourcePort - Adapter interface for location sources
 *
 * Implementations: GlympseAdapter, Life360Adapter, etc.
 */
interface LocationSourcePort {
  /**
   * Check if this adapter handles the given source type
   */
  canHandle(location_src: string): boolean

  /**
   * Get embed configuration for frontend display
   */
  getEmbed(location_key: string): LocationEmbed

  /**
   * Optional: Check if share is still active
   * (For adapters that can poll status)
   */
  isActive?(location_key: string): Promise<boolean>

  /**
   * Optional: Parse share URL into location_key
   * (For adapters that receive URLs)
   */
  parseUrl?(url: string): { location_src: string, location_key: string } | null
}

/**
 * LocationEmbed - Display configuration for frontend
 */
interface LocationEmbed {
  url: string                    // Embed URL
  type: 'iframe' | 'image' | 'redirect'
  aspectRatio?: string           // '16:9', '4:3', '1:1'
  refreshInterval?: number       // Seconds (for image type)
  allowFullscreen?: boolean
  sandbox?: string               // iframe sandbox attributes
}
```

---

## Events

Events flow through the existing EventBus infrastructure.

### location.share.started

Emitted when a new location share is detected.

```javascript
{
  topic: 'location.share.started',
  payload: {
    shareId: 'share-123',
    user: 'dad',
    location_src: 'glympse',
    location_key: 'abc123xyz',
    label: 'Dad',
    timestamp: '2026-01-30T18:30:00Z'
  }
}
```

### location.share.ended

Emitted when a location share ends (any reason).

```javascript
{
  topic: 'location.share.ended',
  payload: {
    shareId: 'share-123',
    user: 'dad',
    reason: 'arrived',    // 'arrived' | 'expired' | 'cancelled'
    timestamp: '2026-01-30T18:45:00Z'
  }
}
```

---

## Share Detection

Share detection is decoupled from the domain. Multiple sources can feed shares:

### Gmail Polling (MVP)

Glympse sends email notifications when shares start. The existing Gmail harvester can be extended to detect Glympse links.

```
Gmail Harvester
     │
     │ Detects Glympse link in email
     ▼
ShareDetectionHandler.handleGlympseEmail({
  from: 'dad@family.com',
  url: 'https://glympse.com/abc123xyz'
})
     │
     │ Resolves user from email
     │ Extracts location_key from URL
     ▼
LocationShareService.createShare({
  user: 'dad',
  location_src: 'glympse',
  location_key: 'abc123xyz'
})
```

### Telegram Bot (Future)

Family shares Glympse link to Telegram group, bot detects it.

### Manual API (Fallback)

```bash
curl -X POST /api/v1/location/shares \
  -d '{"user": "dad", "location_src": "glympse", "location_key": "abc123xyz"}'
```

---

## Arrival Detection

Arrival detection is handled by Home Assistant presence, abstracted through the EventBus.

### Home Assistant Integration

```
Home Assistant
├── person.dad state: 'home' / 'not_home'
│   ├── device_tracker.dad_phone (geofence)
│   ├── device_tracker.dad_keys (Bluetooth)
│   └── device_tracker.dad_laptop (WiFi)
│
└── Automation: On person state change → notify Daylight
```

The existing HomeAssistantAdapter can subscribe to state changes and emit presence events:

```javascript
{
  topic: 'presence.changed',
  payload: {
    user: 'dad',
    state: 'home',          // 'home' | 'not_home' | 'away'
    timestamp: '2026-01-30T18:45:00Z'
  }
}
```

### PresenceChangeHandler

```javascript
// 3_applications/location/handlers/PresenceChangeHandler.mjs

class PresenceChangeHandler {
  constructor({ locationShareService, eventBus, logger }) {
    this.locationShareService = locationShareService
    this.eventBus = eventBus
    this.logger = logger
  }

  start() {
    this.eventBus.subscribe('presence.changed', this.handlePresenceChange.bind(this))
  }

  async handlePresenceChange(event) {
    const { user, state } = event.payload

    // If user arrived home, end any active shares
    if (state === 'home') {
      const activeShares = await this.locationShareService.getActiveSharesForUser(user)

      for (const share of activeShares) {
        await this.locationShareService.endShare(share.id, 'arrived')
        this.logger.info('location.share.auto-ended', { shareId: share.id, user, reason: 'arrived' })
      }
    }
  }
}
```

---

## Adapter Implementation

### GlympseAdapter

```javascript
// 2_adapters/location/glympse/GlympseAdapter.mjs

class GlympseAdapter {
  constructor(config, { logger }) {
    this.logger = logger
  }

  canHandle(location_src) {
    return location_src === 'glympse'
  }

  getEmbed(location_key) {
    return {
      url: `https://glympse.com/${location_key}`,
      type: 'iframe',
      aspectRatio: '16:9',
      allowFullscreen: true,
      sandbox: 'allow-scripts allow-same-origin'
    }
  }

  /**
   * Parse Glympse URL into location_key
   * Handles: https://glympse.com/abc123 or glympse://abc123
   */
  parseUrl(url) {
    const match = url.match(/glympse\.com\/([a-zA-Z0-9]+)/)
    if (match) {
      return {
        location_src: 'glympse',
        location_key: match[1]
      }
    }
    return null
  }
}
```

---

## Frontend Integration (MVP: TV App)

### WebSocket Subscription

TV App subscribes to location events via existing WebSocket EventBus:

```javascript
// Frontend - subscribe to location events
eventBus.subscribe('location.share.started', (event) => {
  setActiveShare({
    shareId: event.payload.shareId,
    user: event.payload.user,
    label: event.payload.label
  })
  setShowPIP(true)
})

eventBus.subscribe('location.share.ended', (event) => {
  if (activeShare?.shareId === event.payload.shareId) {
    setShowPIP(false)
    setActiveShare(null)
  }
})
```

### Fetching Embed Config

When PIP should display, frontend fetches embed config:

```javascript
// GET /api/v1/location/shares/:shareId/embed
const embed = await DaylightAPI(`api/v1/location/shares/${shareId}/embed`)

// Response:
{
  url: "https://glympse.com/abc123xyz",
  type: "iframe",
  aspectRatio: "16:9",
  allowFullscreen: true
}
```

### PIP Component

```jsx
// Simplified PIP component
function LocationPIP({ share, onClose }) {
  const [embed, setEmbed] = useState(null)

  useEffect(() => {
    if (share) {
      DaylightAPI(`api/v1/location/shares/${share.shareId}/embed`)
        .then(setEmbed)
    }
  }, [share])

  if (!embed) return null

  return (
    <div className="location-pip">
      <div className="location-pip__header">
        <span>{share.label || share.user} is on the way</span>
        <button onClick={onClose}>×</button>
      </div>
      <div className="location-pip__content" style={{ aspectRatio: embed.aspectRatio }}>
        {embed.type === 'iframe' && (
          <iframe
            src={embed.url}
            sandbox={embed.sandbox}
            allowFullScreen={embed.allowFullscreen}
          />
        )}
      </div>
    </div>
  )
}
```

---

## Configuration

### Location Domain Config

```yaml
# data/household/apps/location/config.yml
location:
  # Auto-show PIP on any active TV App
  auto_show_pip: true

  # Which users to track (maps to HA person entities)
  tracked_users:
    - dad
    - mom

  # User-friendly labels for PIP display
  user_labels:
    dad: "Dad"
    mom: "Mom"
```

### Share Detection Config

```yaml
# data/household/apps/harvester/config.yml
harvesters:
  gmail:
    enabled: true
    detect_glympse: true          # Parse Glympse links from emails
    glympse_senders:              # Only from known family emails
      - dad@family.com
      - mom@family.com
```

### Home Assistant Presence Config

```yaml
# Home Assistant configuration.yaml
person:
  - name: Dad
    id: dad
    device_trackers:
      - device_tracker.dad_phone
      - device_tracker.dad_keys_ble

automation:
  - alias: "Notify Daylight on presence change"
    trigger:
      - platform: state
        entity_id: person.dad
    action:
      - service: rest_command.daylight_presence
        data:
          user: "dad"
          state: "{{ states('person.dad') }}"
```

---

## Implementation Phases

### Phase 1: Core Domain + Manual API

- [ ] LocationShare entity
- [ ] LocationShareService
- [ ] LocationSourcePort interface
- [ ] GlympseAdapter
- [ ] API endpoints (CRUD + embed)
- [ ] EventBus integration

### Phase 2: Share Detection

- [ ] Gmail harvester extension (detect Glympse links)
- [ ] ShareDetectionHandler
- [ ] User resolution from email

### Phase 3: Arrival Detection

- [ ] HA presence event subscription
- [ ] PresenceChangeHandler
- [ ] Auto-end shares on arrival

### Phase 4: Frontend Integration

- [ ] TV App PIP component
- [ ] WebSocket subscription to location events
- [ ] PIP positioning and styling

### Phase 5: Enhancements (Future)

- [ ] Telegram bot share detection
- [ ] Multiple simultaneous shares
- [ ] Share expiration handling
- [ ] ETA scraping (if feasible)
- [ ] Geofence zones (e.g., "5 minutes away" trigger)

---

## Open Questions

1. **Multiple shares:** Can there be multiple active shares? (Mom and Dad both coming home)

2. **Share persistence:** Should shares persist across restarts? (YAML vs in-memory)

3. **ETA extraction:** Is it worth attempting to scrape ETA from Glympse iframe? (Probably not for MVP)

4. **Notification vs PIP:** Should there be a toast notification before/instead of PIP?

5. **Other consumers:** What other taps would use location data? (Office kiosk, thermal printer?)

---

## Related Documents

- [Gatekeeper Domain Design](./2026-01-30-gatekeeper-domain-design.md) - Policy engine (if location needs access control)
- [Telco Adapter Design](./2026-01-30-telco-adapter-design.md) - SMS notification of arrivals
- Landing page - Original vision description

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-30 | Initial design from brainstorming session |
