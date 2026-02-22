# LiveKit Video Calling Design

> 2-way video calling via self-hosted LiveKit WebRTC SFU, enabling family video calls to the home kiosk

**Last Updated:** 2026-02-21
**Status:** Design Complete, Ready for Implementation
**Initial Provider:** LiveKit (self-hosted)

---

## Overview

Add 2-way video calling to DaylightStation using LiveKit as a self-hosted WebRTC SFU. Transforms the existing Webcam input module into a shareable video conference with room IDs, enabling family members to video call the home kiosk from anywhere.

## Context

- **Webcam module** already exists at `frontend/src/modules/Input/Webcam.jsx` with device selection, stream acquisition, and volume metering
- **WebSocket event bus** exists at `backend/src/0_system/eventbus/WebSocketEventBus.mjs` — could relay room state notifications but is not needed for WebRTC signaling (LiveKit handles that)
- **Adapter pattern** is well-established — LiveKit fits as a new capability in `1_adapters/` with manifest-based discovery
- **Use case**: Family member opens a room on the kiosk, shares a link, remote person joins from phone/laptop

---

## Why LiveKit

| Considered | Verdict | Reason |
|------------|---------|--------|
| **LiveKit** | Selected | Self-hostable SFU, embedded TURN for NAT traversal, official React SDK, ephemeral rooms with `maxParticipants`, Docker-native, Apache 2.0 |
| PeerJS | Rejected | No built-in TURN — remote family callers behind NAT would fail. Signaling server is simpler but doesn't solve the hard problem |
| Daily.co | Rejected | Not self-hostable. Cloud dependency unacceptable for a home server |
| simple-peer | Rejected | Unmaintained. All signaling/TURN/room management is DIY |

---

## Architecture

### Infrastructure

```
┌──────────────────────────────────────────────────┐
│  Docker Compose                                  │
│                                                  │
│  ┌──────────────┐     ┌────────────────────┐    │
│  │  DaylightStn │     │  LiveKit Server    │    │
│  │  (Node.js)   │────▶│  (Go, port 7880)   │    │
│  │  port 3111   │     │  UDP 50000-50200   │    │
│  └──────┬───────┘     └────────┬───────────┘    │
│         │                      │                 │
│         │  JWT tokens          │  WebRTC media   │
│         ▼                      ▼                 │
│  ┌──────────────────────────────────────────┐   │
│  │  Browser (kiosk or remote)               │   │
│  │  @livekit/components-react               │   │
│  └──────────────────────────────────────────┘   │
└──────────────────────────────────────────────────┘
```

### DDD Layer Mapping

| Layer | Artifact | Purpose |
|-------|----------|---------|
| `services.yml` | `livekit:` entry | Environment-specific LiveKit server URL |
| `secrets.yml` | `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | Auth credentials |
| `integrations.yml` | `livekit: { service: livekit }` | Household integration config |
| `1_adapters/video-calling/livekit/` | `LiveKitAdapter.mjs` + `manifest.mjs` | Token generation, room CRUD |
| `3_applications/.../ports/` | `IVideoCallingGateway.mjs` | Port interface |
| `4_api/v1/routers/` | `videocall.mjs` | `POST /token`, `GET /rooms` |
| `frontend/src/modules/Input/` | `VideoCall.jsx` + hooks | React UI |

### Backend Flow

```
Browser POST /api/v1/videocall/token { room, identity }
  → videocall router
    → LiveKitAdapter.generateToken(room, identity)
      → livekit-server-sdk AccessToken
    ← { token, serverUrl }
  ← JSON response

Browser connects to LiveKit server directly via WebSocket (wss://...)
  → LiveKit handles all WebRTC signaling + media
```

### Frontend Flow

```
1. User opens Webcam app → sees current camera preview (existing behavior)
2. User clicks "Start Call" → backend creates room, returns token
3. Component switches to <LiveKitRoom> with token
4. Room ID displayed + shareable link generated
5. Remote user opens link → gets their own token → joins same room
6. Both see each other's video + audio
7. Either party hangs up → room auto-destroys after timeout
```

---

## Port Interface

### IVideoCallingGateway

```javascript
/**
 * IVideoCallingGateway - Video calling adapter interface
 *
 * Implementations: LiveKitAdapter
 */
export class IVideoCallingGateway {
  /**
   * Generate an access token for a participant to join a room
   * @param {string} roomName - Room identifier
   * @param {string} identity - Participant identity
   * @param {Object} [options] - Grant options (canPublish, canSubscribe)
   * @returns {Promise<{ token: string, serverUrl: string }>}
   */
  async generateToken(roomName, identity, options = {}) {
    throw new Error('generateToken must be implemented');
  }

  /**
   * Create a room with specific settings
   * @param {string} name - Room name
   * @param {Object} [options] - { maxParticipants, emptyTimeout }
   * @returns {Promise<Object>} Room info
   */
  async createRoom(name, options = {}) {
    throw new Error('createRoom must be implemented');
  }

  /**
   * List active rooms
   * @returns {Promise<Object[]>}
   */
  async listRooms() {
    throw new Error('listRooms must be implemented');
  }

  /**
   * Delete a room
   * @param {string} name - Room name
   */
  async deleteRoom(name) {
    throw new Error('deleteRoom must be implemented');
  }
}
```

---

## Adapter Structure

### Directory Layout

```
1_adapters/video-calling/
└── livekit/
    ├── manifest.mjs           # Provider metadata & config schema
    ├── LiveKitAdapter.mjs     # Implements IVideoCallingGateway
    └── index.mjs              # Re-exports
```

### Manifest

```javascript
// 1_adapters/video-calling/livekit/manifest.mjs
export default {
  provider: 'livekit',
  capability: 'video_calling',
  displayName: 'LiveKit Video Platform',

  adapter: () => import('./LiveKitAdapter.mjs'),

  configSchema: {
    apiKey: { type: 'string', secret: true, required: true, description: 'LiveKit API key' },
    apiSecret: { type: 'string', secret: true, required: true, description: 'LiveKit API secret' },
    url: { type: 'string', required: true, description: 'LiveKit server URL' },
  }
};
```

### Adapter (Sketch)

```javascript
// 1_adapters/video-calling/livekit/LiveKitAdapter.mjs
import { AccessToken, RoomServiceClient } from 'livekit-server-sdk';

export class LiveKitAdapter {
  #apiKey;
  #apiSecret;
  #url;
  #roomService;
  #logger;

  constructor(config, deps = {}) {
    this.#apiKey = config.apiKey;
    this.#apiSecret = config.apiSecret;
    this.#url = config.url;
    this.#roomService = new RoomServiceClient(this.#url, this.#apiKey, this.#apiSecret);
    this.#logger = deps.logger || console;
  }

  async generateToken(roomName, identity, options = {}) {
    const at = new AccessToken(this.#apiKey, this.#apiSecret, {
      identity,
      ttl: '6h',
    });
    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: options.canPublish ?? true,
      canSubscribe: options.canSubscribe ?? true,
    });
    const token = await at.toJwt();
    return { token, serverUrl: this.#url };
  }

  async createRoom(name, options = {}) {
    return this.#roomService.createRoom({
      name,
      maxParticipants: options.maxParticipants ?? 2,
      emptyTimeout: options.emptyTimeout ?? 300,
    });
  }

  async listRooms() {
    return this.#roomService.listRooms();
  }

  async deleteRoom(name) {
    return this.#roomService.deleteRoom(name);
  }
}
```

---

## Configuration

### services.yml

```yaml
livekit:
  docker: http://livekit:7880
  kckern-server: http://localhost:7880
  kckern-macbook: http://localhost:7880
```

### secrets.yml

```yaml
LIVEKIT_API_KEY: daylight
LIVEKIT_API_SECRET: "{generated-secret-min-32-chars}"
```

### livekit.yaml (LiveKit server config)

```yaml
port: 7880
rtc:
  port_range_start: 50000
  port_range_end: 50200
  tcp_port: 7881
  use_external_ip: true
keys:
  daylight: "{generated-secret-min-32-chars}"
room:
  empty_timeout: 300
  departure_timeout: 20
logging:
  json: false
  level: info
```

### Docker Compose

```yaml
livekit:
  image: livekit/livekit-server:v1.8
  restart: unless-stopped
  network_mode: "host"
  volumes:
    - ./config/livekit.yaml:/etc/livekit.yaml
  command: --config /etc/livekit.yaml
```

---

## Key Dependencies

| Package | Where | Purpose |
|---------|-------|---------|
| `livekit-server-sdk` | Backend | Token generation, room management |
| `@livekit/components-react` | Frontend | React hooks + components |
| `livekit-client` | Frontend | WebRTC client (peer dep) |

---

## Implementation Phases

### Phase 1: Infrastructure

- [ ] Add LiveKit to Docker Compose — `livekit/livekit-server:v1.8` with `network_mode: "host"`
- [ ] Create `livekit.yaml` config — minimal: port 7880, UDP 50000-50200, API key/secret, no TURN initially
- [ ] Add to `services.yml` — URL per environment
- [ ] Add to `secrets.yml` — API key + secret

### Phase 2: Backend Adapter

- [ ] Create port interface — `IVideoCallingGateway.mjs`
- [ ] Create adapter — `1_adapters/video-calling/livekit/LiveKitAdapter.mjs` using `livekit-server-sdk`
- [ ] Create manifest — `manifest.mjs` with `provider: 'livekit'`, `capability: 'video_calling'`
- [ ] Create API route — `4_api/v1/routers/videocall.mjs` with `POST /token` and `GET /rooms`
- [ ] Wire into IntegrationLoader via `integrations.yml`

### Phase 3: Frontend

- [ ] Install packages — `@livekit/components-react`, `livekit-client`
- [ ] Create `useVideoCall` hook — manages room state, token fetching, connection lifecycle
- [ ] Update Webcam.jsx — add call UI: "Start Call" button, room ID display, shareable link, hang up
- [ ] Video layout — use `useTracks()` + `GridLayout` or custom 2-person layout (local small, remote large)
- [ ] Controls — mute/unmute mic, toggle camera, hang up

### Phase 4: Polish

- [ ] TURN configuration — enable embedded TURN in `livekit.yaml` for reliable remote connections (requires TLS cert)
- [ ] Room notifications — broadcast room events via existing WebSocket bus so other kiosk screens can show "incoming call"
- [ ] Device selection — integrate existing `useMediaDevices` hook with LiveKit's device management

---

## Scalability: Beyond 2-Person Calls

LiveKit is an SFU — it natively supports multi-party calls. The `maxParticipants: 2` in Phase 1 is a config value, not an architectural limit. Expanding to group calls requires only layout changes, not infrastructure changes.

### What Scales Automatically

- **Room capacity** — change `maxParticipants` to any number (LiveKit supports up to 3,000/room)
- **Media routing** — SFU handles selective forwarding; each participant sends one stream, server fans it out
- **Token auth** — same JWT pattern works for N participants
- **TURN/NAT traversal** — same embedded TURN handles all participants

### What Needs Work for 3+ Participants

| Concern | 2-Person | 3+ Group | Notes |
|---------|----------|----------|-------|
| **Video layout** | Local small + remote large | Grid/speaker view | LiveKit's `GridLayout` + `FocusLayout` handle this out of the box |
| **Bandwidth** | ~6 Mbps total | ~3 Mbps per additional participant | LiveKit does simulcast + SVC — auto-adjusts quality per viewer |
| **Room creation API** | Fixed `maxParticipants: 2` | Configurable per room | Pass as param to `createRoom()` |
| **Permissions** | Everyone can publish | Role-based (host/viewer) | Token grants: `canPublish: false` for view-only participants |
| **UI controls** | Simple | Participant list, mute others | LiveKit `ParticipantLoop` + `TrackToggle` components |

### Implementation Notes

- `GridLayout` auto-adapts from 1×1 to NxN grid as participants join
- `FocusLayout` shows active speaker large with others in sidebar — better for 3+ calls
- Simulcast (enabled by default) sends multiple quality layers; LiveKit picks the best one per subscriber based on their available layout size
- No Redis needed until you want multi-node clustering or recording/egress features

---

## Constraints & Decisions

- **No Redis** — single-node deployment, no clustering needed
- **Ephemeral rooms** — auto-created on first join, auto-destroyed when empty. No persistent room state
- **Start with `maxParticipants: 2`** — configurable per room; expand to group calls with layout changes only
- **TURN deferred to Phase 4** — LAN calls work without it; remote calls may need it depending on NAT topology
- **~700KB client bundle** — acceptable for a kiosk app that loads once
- **LiveKit server is Go, not Node** — lives as a Docker sidecar, not embedded in the backend process. Backend only generates tokens via the Node SDK

---

## Open Questions

1. Should room IDs be human-readable (e.g., `kitchen-call-1234`) or UUIDs?
2. Should the kiosk auto-answer incoming calls or require manual accept?
3. Should call history be persisted (domain entity) or purely ephemeral?
4. Default `maxParticipants` per room — 2 for family calls, higher for group events?

---

## Related Documents

- [Telco Adapter Design](./2026-01-30-telco-adapter-design.md) — SMS/voice telephony (complementary capability)

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-21 | Initial design from brainstorming session |
