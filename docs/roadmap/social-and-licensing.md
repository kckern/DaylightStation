# Social Features & Licensing

> Protocol-agnostic social federation with cryptographic licensing

**Last Updated:** 2026-02-03
**Status:** Design Complete

---

## Overview

DaylightStation Social enables sharing between households running separate instances. Rather than coupling to a single protocol, the design abstracts social federation behind a port interface with pluggable adapters.

**Supported protocols:**
- **Nostr** - Decentralized social via relays, Schnorr signatures (secp256k1), NIP-44 encryption
- **Polycentric** - Futo's protocol, Ed25519 signatures, native encryption

**Design principles:**
- Domain layer is protocol-agnostic
- Adapters declare capabilities, domain adapts behavior
- Users can link multiple protocol identities
- One system license, badges issued per-protocol on demand

**Security model:** Zero-trust network. Relays/systems are untrusted infrastructure. Security comes from cryptography (signatures for authenticity, encryption for confidentiality), not network perimeters.

---

## Part 1: Identity Model

### Three Layers

| Layer | Scope | Examples |
|-------|-------|----------|
| **System** | The DaylightStation deployment | License, primary owner, instance ID |
| **Household** | A family unit within the system | Config, users, devices, household identity |
| **User** | An individual person | Profile, roles, linked protocol identities |

A single system may contain multiple households. Each household may contain multiple users.

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

## Part 2: Licensing

> **Full licensing documentation:** See [docs/reference/licensing.md](/docs/reference/licensing.md) for the complete licensing model, including personal tiers, commercial licenses, badge verification (Freeloader vs Knockoff), and FAQ.

### License (System-Level)

Purchased by the primary owner. Proves the DaylightStation instance is paid. The license is protocol-agnostic—no npub, no DID, just instance + owner.

```json
{
  "product": "daylightstation",
  "instance_id": "inst_abc123",
  "tier": "patron",
  "billing": "subscription",
  "owner_email": "kevin@example.com",
  "stripe_customer_id": "cus_abc123",
  "issued": 1738483200,
  "nonce": "a1b2c3d4"
}
+ server signature
```

**Billing types:**
- `"subscription"` - Monthly or annual, checked against Stripe
- `"lifetime"` - One-time purchase, never expires

### Tiers & Pricing

| Tier | Monthly | Annual | Lifetime | Badge |
|------|---------|--------|----------|-------|
| **Freeloader** | Free | Free | Free | - |
| **Backer** | $1 | $10 | $50 | ✓ |
| **Sponsor** | $3 | $25 | $125 | 🏆 |
| **Patron** | $5 | $50 | $250 | 💎 |
| **Benefactor** | $10 | $100 | $500 | 👑 |
| **Medici** | $50 | $500 | $2500 | ⭐ |

**Lifetime** = 5x annual price. License never expires, no renewal needed.

### Tier Descriptions

- **Freeloader**: Free unlimited trial. Full core functionality, no social features. Officially chided for not paying.
- **Backer**: Entry-level supporter. Unlocks local extras. Link identity anytime for social.
- **Sponsor**: Committed supporter. Same features as Backer, higher status on network.
- **Patron**: Classic arts supporter tier. You're keeping the lights on.
- **Benefactor**: Serious contributor. People notice your badge.
- **Medici**: You're literally funding the Renaissance. Maximum clout.

### Feature Access

All paid tiers unlock the same features. The difference is **social proof**.

| Feature | Freeloader | Paid (no identity) | Paid (with identity) |
|---------|------------|-------------------|---------------------|
| Core app | ✅ | ✅ | ✅ |
| Local extras | ❌ | ✅ | ✅ |
| Social features | ❌ | ❌ | ✅ |
| Network badge | ❌ | ❌ | ✅ (status-based) |

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

**Status values:**
- `"active"` - Subscription current, show tier badge
- `"past_due"` - Payment failed, show ⚠️ Delinquent
- `"lapsed"` - Subscription cancelled, show 🪦 Lapsed

### Badge Display

| Payment Status | Network Display |
|----------------|-----------------|
| Active (subscription) | Tier badge (✓ 🏆 💎 👑 ⭐) |
| Active (lifetime) | Tier badge + 🎖️ |
| Past due | ⚠️ Delinquent |
| Cancelled/lapsed | 🪦 Lapsed |
| No valid badge | 👜 Knockoff |

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
  3. User proves ownership of identity (challenge/response)
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

Server verifies the existing badge, confirms same instance, issues new protocol badge. One payment, badges for any protocol on demand.

### Badge Refresh

Badges expire after 30 days. App automatically refreshes before expiration:

```
App startup / badge nearing expiration
    │
    ▼
POST /api/refresh-badge { license: "...", protocol: "nostr", identity: "npub1..." }
    │
    ▼
Lambda:
  1. Verify license signature
  2. Check Stripe subscription status
  3. Return fresh badge cert (valid 30 days)
    │
    ▼
App stores new badge, attaches to future events
```

### Why Badges Can't Be Forged

| Attack | Result |
|--------|--------|
| No badge tag | Shows "👜 Knockoff" |
| Forged badge signature | Signature verification fails → "👜 Knockoff" |
| Copy someone else's badge | Identity doesn't match event author → "👜 Knockoff" |
| Modify badge data | Signature no longer valid → "👜 Knockoff" |
| Hack client to show fake badge | Other clients still verify → they see "👜 Knockoff" |

**Your signing key is the root of trust. Without it, valid badges cannot be created.**

---

## Part 3: Social Features

### Use Cases

**Family Clusters (Primary):**
- Cousins see each other's workout completions
- Grandparents see photo albums from multiple households
- Extended family shares recipes and meal ideas

**Household-Internal:**
- Kid completes chores → Parents see it in household feed
- Family announcements visible to all household members
- Private posts for personal journaling

**Activity Sharing:**
- "Kevin completed a 30-minute cycling workout"
- "Sarah watched Severance S2E03"
- "The Kern Household tried a new pasta recipe"

### Visibility Model

| Level | Audience | Transport |
|-------|----------|-----------|
| **private** | Only the author | Local only |
| **household** | All users in household (role-filtered) | Local only |
| **circle** | Named groups on other instances | Protocol (encrypted) |
| **connections** | All mutual connections | Protocol (encrypted) |
| **public** | Anyone on the network | Protocol (unencrypted) |

### Content Model

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
  createdAt: 1738500000
}
```

**Verbs:** `posted`, `completed`, `watched`, `listened`, `shared`, `liked`, `replied`

### Auto-Sharing

System events can auto-generate posts based on user policies:

```yaml
# Per-user sharing policies
sharing:
  fitness:
    mode: auto              # auto | ask | never
    visibility: connections
    include_details: true

  media:
    mode: ask               # Prompt before sharing
    visibility: circle
    circles: [family]

  chores:
    mode: auto
    visibility: household   # Only share within household
```

### Connections & Circles

**Connections:** Mutual relationships between actors (users or households) across instances.

**Circles:** Named groups of connections for targeted sharing (e.g., "Close Family", "Extended Family", "Friends").

**Connection discovery:**
- QR code exchange
- Manual identity entry
- NIP-05 / DID resolution

---

## Part 4: Architecture

### Domain Layer (`backend/src/2_domains/social/`)

Protocol-agnostic business logic. Knows nothing about Nostr or Polycentric.

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

Adapters declare what they support; domain adapts behavior:

```javascript
// NostrAdapter
getCapabilities() {
  return {
    visibility: ['private', 'household', 'circle', 'connections', 'public'],
    reactions: ['like', 'emoji'],
    edit: false,           // Nostr events are immutable
    delete: true,          // NIP-09 deletion requests
    circles: true,
    threads: true
  };
}

// PolycentricAdapter
getCapabilities() {
  return {
    visibility: ['private', 'household', 'circle', 'connections', 'public'],
    reactions: ['like'],   // No emoji reactions yet
    edit: true,            // Polycentric supports edits
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

When an activity has external visibility, it may go to multiple protocols:

```javascript
async publish(activity, actor) {
  const linkedIdentities = await this.identityBridge.getLinkedIdentities(actor);

  for (const { protocol, identity } of linkedIdentities) {
    const adapter = this.adapters.get(protocol);

    if (!adapter.getCapabilities().visibility.includes(activity.visibility)) {
      continue;  // Protocol doesn't support this visibility
    }

    const badge = await this.licensingBridge.getBadge(protocol, identity);
    await adapter.publish(activity, badge);
  }
}
```

### Data Storage

| Data | Storage | Reason |
|------|---------|--------|
| Activities | SQLite | Volume, queries, timeline ordering |
| Connections & Circles | YAML | Config-like, human-editable |
| Protocol sync state | SQLite | Frequent updates |
| Linked identities | YAML (user/household config) | Part of config |

### API Endpoints

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

---

## Part 5: Gatekeeper Integration

Social actions are governed by Gatekeeper policies:

| Action | Resource | Conditions |
|--------|----------|------------|
| `social:view` | `activity:*` | visibility, content labels, curfew |
| `social:publish` | `activity:*` | visibility level, content type, time |
| `social:connect` | `connection:*` | can user manage connections |
| `social:link-identity` | `identity:*` | can user link protocols |

**Example policy:**

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

**Key principle:** External visibility requires explicit policy allowance. Default-deny for anything leaving the household.

---

## Part 6: AWS Infrastructure

### Architecture

```
Stripe ──▶ API Gateway ──▶ Lambda ──▶ Secrets Manager
                             │              │
                             │       ┌──────┘
                             ▼       ▼
                        [Signs credentials]
                             │
                             ▼
                      Returns to user
```

### Secrets Manager

```bash
aws secretsmanager create-secret \
  --name "daylightstation/licensing-key" \
  --description "Private key for signing licenses" \
  --secret-string "..."
```

### Cost Estimate

| Component | Cost |
|-----------|------|
| AWS Lambda | ~$0.20/month |
| API Gateway | ~$0.10/month |
| Secrets Manager | $0.40/month |
| Amplify Hosting | Free tier |
| Stripe fees | 2.9% + $0.30/txn |
| **Total** | **~$0.70/month** + Stripe fees |

---

## Part 7: Implementation Phases

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

## Security Checklist

- [ ] Signing key NEVER in git
- [ ] Key stored in AWS Secrets Manager
- [ ] Lambda IAM role has least-privilege
- [ ] Stripe webhook signature verified
- [ ] Identity ownership verified before issuing badges
- [ ] Badge contains no PII
- [ ] Server pubkey hardcoded in official build

---

## Open Questions

1. **Relay/system selection:** Public infrastructure, recommended servers, or encourage self-hosting?
2. **Photo storage:** Thumbnails in events, full resolution via direct fetch?
3. **Offline handling:** How long to queue outbound when network unavailable?
4. **Moderation:** Can household admins delete incoming posts? Block external users?
5. **License recovery:** Email-based lookup if user loses license key?
6. **Rate limiting:** How many identity changes per year?

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-03 | Merged licensing + social; added protocol abstraction for Nostr + Polycentric |
| 2026-02-02 | Initial licensing roadmap |
| 2026-02-02 | Initial social features design |
