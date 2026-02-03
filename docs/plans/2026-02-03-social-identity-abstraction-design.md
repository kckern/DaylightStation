# Social & Identity Abstraction Design

> Protocol-agnostic social federation with Nostr and Polycentric support

**Date:** 2026-02-03
**Status:** Design Complete
**Supersedes:** `docs/roadmap/2026-02-02-licensing-roadmap.md`, `docs/roadmap/2026-02-02-social-features-design.md`

---

## Overview

DaylightStation Social enables sharing between households running separate instances. Rather than coupling to a single protocol, this design abstracts social federation behind a port interface with pluggable adapters.

**Supported protocols:**
- **Nostr** - Decentralized social via relays, Schnorr signatures, NIP-44 encryption
- **Polycentric** - Futo's decentralized protocol, Ed25519 signatures, native encryption

**Design principles:**
- Domain layer is protocol-agnostic
- Adapters declare capabilities, domain adapts behavior
- Users can link multiple protocol identities
- One system license, badges issued per-protocol on demand

---

## Identity Model

### Three Layers

| Layer | Scope | Examples |
|-------|-------|----------|
| **System** | The DaylightStation deployment | License, primary owner, instance ID |
| **Household** | A family unit within the system | Config, users, devices, household identity |
| **User** | An individual person | Profile, roles, linked protocol identities |

### User Types

**Acknowledged users:**
- Exist in the system (chore assignments, mentions)
- No login credentials
- No external protocol identity
- Activities shared via household identity
- Example: Kids on a kitchen kiosk

**Full users:**
- Have credentials, can log in
- May link external protocol identities
- Can post as themselves (if identity linked) or as household

### Linked Identities

Full users and households can link protocol identities:

```yaml
# User profile
linked_identities:
  - protocol: nostr
    identity: "npub1kevin..."
    verified: true
    linked_at: 2026-01-15T10:00:00Z
  - protocol: polycentric
    identity: "did:poly:kevin..."
    verified: true
    linked_at: 2026-01-20T14:00:00Z

# Household config
linked_identities:
  - protocol: nostr
    identity: "npub1kernhousehold..."
    verified: true
  - protocol: polycentric
    identity: "did:poly:kernhome..."
    verified: true
```

### Author Resolution

When an activity occurs, author is determined by:

```
1. Full user with linked identity → Post as user's protocol identity
2. Full user without linked identity → Post as household's protocol identity
3. Acknowledged user → Post as household (user mentioned in content)
4. Device with no user context → Post as household
```

| Activity | Author on network |
|----------|-------------------|
| Kevin completed workout (has npub) | `npub1kevin...` |
| Kevin completed workout (no npub) | `npub1kernhousehold...` |
| Junior finished chores (acknowledged) | `npub1kernhousehold...` with "Junior finished his chores" |
| Kitchen kiosk: "Dinner's ready" | `npub1kernhousehold...` |

---

## Licensing & Badges

### License (System-Level)

Purchased by the primary owner. Proves the DaylightStation instance is paid.

```json
{
  "product": "daylightstation",
  "instance_id": "inst_abc123",
  "tier": "patron",
  "billing": "subscription",
  "owner_email": "kevin@example.com",
  "issued": 1738483200,
  "nonce": "a1b2c3d4"
}
+ server signature
```

The license is protocol-agnostic. No npub, no DID - just instance + owner.

### Badge Certificates (Per-Protocol, Per-Identity)

Generated on demand when a user or household links a protocol identity. Proves "this protocol identity belongs to a licensed instance."

**User badge:**

```json
{
  "instance_id": "inst_abc123",
  "protocol": "nostr",
  "identity": "npub1kevin...",
  "identity_type": "user",
  "tier": "patron",
  "status": "active",
  "valid_until": 1741075200
}
+ server signature
```

**Household badge:**

```json
{
  "instance_id": "inst_abc123",
  "protocol": "nostr",
  "identity": "npub1kernhousehold...",
  "identity_type": "household",
  "household_name": "The Kern Home",
  "tier": "patron",
  "status": "active",
  "valid_until": 1741075200
}
+ server signature
```

### Badge Issuance Flow

```
User links npub to their account
    │
    ▼
POST /api/badges/request { protocol: "nostr", identity: "npub1..." }
    │
    ▼
Server verifies:
  1. User belongs to this instance
  2. Instance license is valid
  3. User proves ownership of npub (challenge/response)
    │
    ▼
Returns signed badge certificate
```

### Cross-Protocol Badge Issuance

A valid badge for one protocol can bootstrap another:

```
POST /api/badges/request {
  protocol: "polycentric",
  identity: "did:poly:...",
  existing_badge: "<nostr-badge-cert>"
}
```

Server verifies the existing badge, confirms same instance, issues new protocol badge.

### Tiers & Pricing

| Tier | Monthly | Annual | Lifetime | Badge |
|------|---------|--------|----------|-------|
| **Freeloader** | Free | Free | Free | - |
| **Backer** | $1 | $10 | $50 | ✓ |
| **Sponsor** | $3 | $25 | $125 | 🏆 |
| **Patron** | $5 | $50 | $250 | 💎 |
| **Benefactor** | $10 | $100 | $500 | 👑 |
| **Medici** | $50 | $500 | $2500 | ⭐ |

### Badge Display

| Payment Status | Network Display |
|----------------|-----------------|
| Active (subscription) | Tier badge (✓ 🏆 💎 👑 ⭐) |
| Active (lifetime) | Tier badge + 🎖️ |
| Past due | ⚠️ Delinquent |
| Cancelled/lapsed | 🪦 Lapsed |
| No valid badge | 🚨 Intruder |

---

## Social Content Model

### Activity (Core Unit)

Activities follow an actor-verb-object pattern:

```javascript
{
  id: "act_abc123",
  actor: { type: "user", id: "kevin", householdId: "hh_001" },
  verb: "completed",
  object: { type: "workout", ref: "workout:2026-02-03:cycling" },
  visibility: "connections",
  circles: [],
  content: "Just finished a 45-minute cycling session!",
  attachments: [
    { type: "workout_summary", duration: 45, calories: 380 }
  ],
  inReplyTo: null,
  createdAt: 1738500000
}
```

### Verbs

| Verb | Usage |
|------|-------|
| `posted` | Freeform text post |
| `completed` | Workout, chore, task |
| `watched` | Media playback |
| `listened` | Audio/music |
| `shared` | Recipe, photo album |
| `liked` | Reaction |
| `replied` | Response to activity |

### Visibility Levels

| Level | Audience | Transport |
|-------|----------|-----------|
| **private** | Only the author | Local only |
| **household** | All users in household (role-filtered) | Local only |
| **circle** | Named groups on other instances | Protocol (encrypted) |
| **connections** | All mutual connections | Protocol (encrypted) |
| **public** | Anyone on the network | Protocol (unencrypted) |

---

## Architecture

### Domain Layer (`backend/src/2_domains/social/`)

Protocol-agnostic business logic.

```
2_domains/social/
├── entities/
│   ├── Activity.mjs          # Core unit: actor, verb, object, visibility
│   ├── Actor.mjs             # User or Household reference
│   ├── Connection.mjs        # Relationship between actors
│   └── Circle.mjs            # Named group of connections
│
├── value-objects/
│   ├── Visibility.mjs        # private | household | circle | connections | public
│   ├── Verb.mjs              # posted | completed | watched | shared | etc.
│   ├── ActivityObject.mjs    # Reference to domain object
│   └── Reaction.mjs          # like | emoji | reply
│
├── services/
│   ├── FeedService.mjs       # Build feeds for an actor
│   ├── ActivityFactory.mjs   # Create activities with author resolution
│   ├── ConnectionService.mjs # Manage circles, connections
│   └── VisibilityResolver.mjs
│
└── ports/
    └── SocialNetworkPort.mjs # Interface adapters implement
```

### SocialNetworkPort Interface

```javascript
class SocialNetworkPort {
  // Identity
  getProtocolName()                          // 'nostr' | 'polycentric'
  getCapabilities()                          // { reactions: true, circles: true, ... }

  async resolveActor(protocolIdentity)       // Protocol ID → Actor
  async getProtocolIdentity(actor)           // Actor → Protocol ID

  // Publishing
  async publish(activity, badge)             // Activity → network
  async update(activity, badge)              // Edit (if supported)
  async delete(activityId, badge)            // Remove (if supported)

  // Encryption
  async encrypt(content, recipientIds)       // E2E for circles/connections
  async decrypt(encrypted, senderId)

  // Subscriptions
  async subscribe(filters)                   // Returns async iterator
  async fetchHistory(since, connections)     // Backfill

  // Connections
  async sendConnectionRequest(toIdentity)
  async acceptConnection(fromIdentity)

  // Lifecycle
  async connect(endpoints)                   // Connect to relays/systems
  async disconnect()
}
```

### Adapter Layer (`backend/src/1_adapters/social/`)

```
1_adapters/social/
├── nostr/
│   ├── NostrAdapter.mjs           # Implements SocialNetworkPort
│   ├── NostrIdentityManager.mjs   # npub/nsec handling
│   ├── NostrEventBuilder.mjs      # Activity → Nostr event
│   ├── NostrEventParser.mjs       # Nostr event → Activity
│   ├── NostrEncryption.mjs        # NIP-44
│   ├── NostrRelayPool.mjs
│   └── kinds.mjs                  # Event kind constants
│
├── polycentric/
│   ├── PolycentricAdapter.mjs     # Implements SocialNetworkPort
│   ├── PolycentricIdentity.mjs    # Ed25519, DID handling
│   ├── PolycentricClaimBuilder.mjs
│   ├── PolycentricClaimParser.mjs
│   ├── PolycentricEncryption.mjs
│   └── PolycentricSystemPool.mjs
│
└── local/
    └── LocalAdapter.mjs           # Household-only (no network)
```

### Capability Declaration

```javascript
// NostrAdapter.mjs
getCapabilities() {
  return {
    visibility: ['private', 'household', 'circle', 'connections', 'public'],
    reactions: ['like', 'emoji'],
    edit: false,
    delete: true,
    circles: true,
    threads: true
  };
}

// PolycentricAdapter.mjs
getCapabilities() {
  return {
    visibility: ['private', 'household', 'circle', 'connections', 'public'],
    reactions: ['like'],
    edit: true,
    delete: true,
    circles: true,
    threads: true
  };
}
```

### Application Layer (`backend/src/3_applications/social/`)

```
3_applications/social/
├── SocialOrchestrator.mjs        # Main entry point
├── MultiProtocolPublisher.mjs    # Publish to multiple protocols
├── FeedAggregator.mjs            # Merge feeds from protocols
│
├── sync/
│   ├── OutboundSync.mjs
│   ├── InboundSync.mjs
│   └── SyncScheduler.mjs
│
├── automation/
│   ├── ActivityWatcher.mjs       # Listen to domain events
│   ├── AutoPostGenerator.mjs     # Apply sharing policies
│   └── AuthorResolver.mjs
│
└── bridges/
    ├── GatekeeperBridge.mjs
    ├── LicensingBridge.mjs
    └── IdentityBridge.mjs
```

### Multi-Protocol Publishing

```javascript
async publish(activity, actor) {
  const results = [];
  const linkedIdentities = await this.identityBridge.getLinkedIdentities(actor);

  for (const { protocol, identity } of linkedIdentities) {
    const adapter = this.adapters.get(protocol);

    if (!adapter.getCapabilities().visibility.includes(activity.visibility)) {
      results.push({ protocol, status: 'unsupported' });
      continue;
    }

    const badge = await this.licensingBridge.getBadge(protocol, identity);

    try {
      const ref = await adapter.publish(activity, badge);
      results.push({ protocol, status: 'published', ref });
    } catch (err) {
      results.push({ protocol, status: 'failed', error: err.message });
    }
  }

  return results;
}
```

---

## Data Storage

### Hybrid Approach

| Data | Storage | Reason |
|------|---------|--------|
| Activities | SQLite | Volume, queries, timeline ordering |
| Connections & Circles | YAML | Config-like, human-editable |
| Protocol sync state | SQLite | Frequent updates |
| Linked identities | YAML (user profile) | Part of user config |

### SQLite Schema

```sql
CREATE TABLE activities (
    id TEXT PRIMARY KEY,
    actor_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    verb TEXT NOT NULL,
    object_type TEXT,
    object_ref TEXT,
    visibility TEXT NOT NULL,
    circles TEXT,                       -- JSON array
    content TEXT,                       -- JSON
    in_reply_to TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER,
    outbound_status TEXT,
    source_protocol TEXT,
    source_ref TEXT,
    source_badge TEXT
);

CREATE INDEX idx_activities_feed ON activities(visibility, created_at DESC);
CREATE INDEX idx_activities_actor ON activities(actor_type, actor_id);
CREATE INDEX idx_activities_outbound ON activities(outbound_status)
    WHERE outbound_status IS NOT NULL;

CREATE TABLE sync_state (
    protocol TEXT NOT NULL,
    endpoint TEXT NOT NULL,
    last_event_time INTEGER,
    last_sync INTEGER,
    status TEXT,
    PRIMARY KEY (protocol, endpoint)
);

CREATE TABLE reactions (
    id TEXT PRIMARY KEY,
    activity_id TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_id TEXT NOT NULL,
    reaction_type TEXT NOT NULL,
    emoji TEXT,
    created_at INTEGER NOT NULL,
    source_protocol TEXT,
    source_ref TEXT,
    FOREIGN KEY (activity_id) REFERENCES activities(id)
);
```

### YAML Configs

```yaml
# data/household/apps/social/connections.yml
connections:
  - id: "conn_abc123"
    protocol: nostr
    identity: "npub1cousin..."
    alias: "Sarah's Family"
    status: mutual
    household_name: "The Smith Home"
    circles: [family, extended]
    added: 2026-01-15T10:30:00Z

# data/household/apps/social/circles.yml
circles:
  - id: family
    name: "Close Family"
  - id: extended
    name: "Extended Family"
  - id: friends
    name: "Friends"
```

---

## API Layer

### Endpoints

```
# Activities
GET    /api/v1/social/feed
POST   /api/v1/social/activities
GET    /api/v1/social/activities/:id
DELETE /api/v1/social/activities/:id
POST   /api/v1/social/activities/:id/reactions

# Connections
GET    /api/v1/social/connections
POST   /api/v1/social/connections
PATCH  /api/v1/social/connections/:id
DELETE /api/v1/social/connections/:id

# Circles
GET    /api/v1/social/circles
POST   /api/v1/social/circles
PATCH  /api/v1/social/circles/:id/members

# Identities
GET    /api/v1/social/identities
POST   /api/v1/social/identities
POST   /api/v1/social/identities/:id/verify
DELETE /api/v1/social/identities/:id
POST   /api/v1/social/identities/:id/badge
```

### WebSocket Events

```javascript
socket.on('social:activity:new', (activity) => {});
socket.on('social:activity:deleted', (id) => {});
socket.on('social:reaction:new', ({ activityId, reaction }) => {});
socket.on('social:connection:request', (connection) => {});
socket.on('social:sync:status', ({ protocol, status }) => {});
```

---

## Frontend Module

```
frontend/src/modules/Social/
├── Social.jsx
├── Social.scss
├── context/
│   └── SocialContext.jsx
├── components/
│   ├── Feed/
│   ├── Activity/
│   ├── Actor/
│   ├── Connections/
│   ├── Circles/
│   └── Settings/
└── hooks/
    ├── useFeed.js
    ├── useConnections.js
    ├── useCircles.js
    ├── useSocialSocket.js
    └── useLinkedIdentities.js
```

---

## Gatekeeper Integration

### Governed Actions

| Action | Resource | Conditions |
|--------|----------|------------|
| `social:view` | `activity:*` | visibility, content labels, curfew |
| `social:publish` | `activity:*` | visibility level, content type, time |
| `social:connect` | `connection:*` | can user manage connections |
| `social:link-identity` | `identity:*` | can user link protocols |

### Example Policy

```yaml
policies:
  child-social:
    statements:
      - effect: allow
        actions: [social:view, social:publish]
        resources: [activity:*]
        conditions:
          visibility: [private, household]
          curfew: { after: "06:00", before: "21:00" }

      - effect: deny
        actions: [social:view, social:publish]
        conditions:
          visibility: [circle, connections, public]

  adult-social:
    statements:
      - effect: allow
        actions: [social:view, social:publish, social:connect, social:link-identity]
        resources: [activity:*, connection:*, identity:*]
```

---

## Auto-Sharing

### Sharing Policies (Per-User)

```yaml
# data/household/users/kevin/social-policies.yml
sharing:
  fitness:
    mode: auto              # auto | ask | never
    visibility: connections
    include_details: true

  media:
    mode: ask
    visibility: circle
    circles: [family]
    exclude_labels: [adult]

  chores:
    mode: auto
    visibility: household

  recipes:
    mode: never
```

### Flow

```
Domain event (workout completed)
    │
    ▼
ActivityWatcher receives event
    │
    ▼
AutoPostGenerator.maybePost()
    │
    ├── mode: never → Skip
    ├── mode: auto → Build activity → Gatekeeper → Publish
    └── mode: ask → Create draft → Notify user → User approves/cancels
```

---

## Connection Discovery

### Methods

| Method | Description |
|--------|-------------|
| QR Code | Scan to exchange identities |
| Manual | Paste npub or DID |
| NIP-05 / DID resolution | Human-readable identifier |

### QR Payload

```json
{
  "type": "daylight-connect",
  "version": 1,
  "identities": [
    { "protocol": "nostr", "identity": "npub1kernhousehold..." },
    { "protocol": "polycentric", "identity": "did:poly:kernhome..." }
  ],
  "name": "The Kern Home",
  "relay_hints": ["wss://relay.daylightstation.com"]
}
```

---

## Implementation Phases

### Phase 1: Domain Foundation
- [ ] Social domain entities (Activity, Actor, Connection, Circle)
- [ ] Value objects (Visibility, Verb, etc.)
- [ ] SocialNetworkPort interface
- [ ] LocalAdapter (household-only)
- [ ] Basic API endpoints
- [ ] SQLite storage

### Phase 2: Nostr Adapter
- [ ] NostrAdapter implementing SocialNetworkPort
- [ ] Event building/parsing
- [ ] NIP-44 encryption
- [ ] Relay pool management
- [ ] Nostr badge certificates

### Phase 3: Licensing Updates
- [ ] Refactor license to instance-level
- [ ] Badge issuance endpoint (per-protocol)
- [ ] Cross-protocol badge generation
- [ ] Update Lambda for new badge format

### Phase 4: Frontend & Auto-sharing
- [ ] Social module UI
- [ ] ActivityWatcher + AutoPostGenerator
- [ ] Sharing policies config
- [ ] Connection management UI

### Phase 5: Polycentric Adapter
- [ ] PolycentricAdapter implementing SocialNetworkPort
- [ ] Claim building/parsing
- [ ] Polycentric encryption
- [ ] System pool management
- [ ] Polycentric badge certificates

### Phase 6: Multi-protocol & Polish
- [ ] MultiProtocolPublisher
- [ ] FeedAggregator with deduplication
- [ ] QR code connection flow
- [ ] Sync health monitoring

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-03 | Initial design - protocol abstraction for Nostr + Polycentric |
