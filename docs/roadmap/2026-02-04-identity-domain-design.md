# Identity Domain Design

> Protocol-agnostic identity linking and reputation management

**Last Updated:** 2026-02-04
**Status:** Design Complete

---

## Overview

The identity domain manages the linking of internal DaylightStation entities (system, household, user) to external protocol identities (Nostr, Harbor/Polycentric, GitHub, email) and aggregates reputation data (vouches) from providers like Harbor.

**Key principle:** Strict vendor agnosticism. The domain defines ports; adapters implement protocol-specific logic.

**Relationship to other domains:**
- **core** — Provides the anchors (system, household, user) that identities link to
- **licensing** — Issues badges to LinkedIdentities; identity domain doesn't know about payment
- **social** — Uses identity resolution for federation; displays badges + vouches together

---

## Domain Structure

```
2_domains/identity/
├── entities/
│   ├── LinkedIdentity.mjs       # External identity linked to internal entity
│   └── Vouch.mjs                # Reputation endorsement
│
├── value-objects/
│   ├── Protocol.mjs             # nostr | polycentric | github | email
│   ├── IdentityAnchor.mjs       # { type: system|household|user, id: string }
│   └── VerificationStatus.mjs   # pending | verified | failed | expired
│
├── services/
│   ├── IdentityLinkingService.mjs   # Link, verify, unlink
│   ├── IdentityResolver.mjs         # Bidirectional resolution
│   └── ReputationService.mjs        # Aggregate vouches, compute trust
│
└── ports/
    └── IdentityProviderPort.mjs     # Interface adapters implement
```

**Adapters:**

```
1_adapters/
├── harbor/
│   ├── HarborAdapter.mjs            # Implements IdentityProviderPort
│   ├── HarborVouchParser.mjs        # Parse vouch format
│   └── HarborIdentityResolver.mjs   # Resolve Harbor/Polycentric DIDs
│
├── nostr/
│   ├── NostrIdentityAdapter.mjs     # NIP-05 verification, pubkey resolution
│   └── NostrProfileFetcher.mjs      # Fetch profile metadata
│
└── github/  (future)
    └── GitHubIdentityAdapter.mjs    # OAuth verification
```

---

## Entities

### LinkedIdentity

Represents an external protocol identity linked to an internal DaylightStation entity.

```javascript
class LinkedIdentity {
  constructor({
    id,                    // Internal ID (uuid)
    anchor,                // { type: 'system'|'household'|'user', id: string }
    protocol,              // 'nostr' | 'polycentric' | 'github' | 'email'
    externalId,            // Protocol-specific ID (npub1..., did:poly:..., etc.)
    displayName,           // Optional human-readable name from provider
    verificationStatus,    // 'pending' | 'verified' | 'failed' | 'expired'
    verifiedAt,            // Timestamp of last successful verification
    linkedAt,              // Timestamp of initial linking
    metadata               // Protocol-specific extras (avatar, nip05, etc.)
  }) { ... }
}
```

**Examples:**

| anchor | protocol | externalId | verificationStatus |
|--------|----------|------------|-------------------|
| `{ type: 'user', id: 'kevin' }` | nostr | `npub1kevin...` | verified |
| `{ type: 'household', id: 'hh_001' }` | polycentric | `did:poly:kern...` | verified |
| `{ type: 'system', id: 'inst_abc' }` | email | `kevin@example.com` | verified |

### Vouch

A reputation endorsement from an external identity, received via Harbor/Polycentric.

```javascript
class Vouch {
  constructor({
    id,                    // Internal ID
    subjectIdentityId,     // LinkedIdentity being vouched for
    voucherExternalId,     // Who gave the vouch (did:poly:..., npub1...)
    voucherProtocol,       // Protocol of voucher
    vouchType,             // 'general' | 'expertise' | 'trust' | 'identity'
    content,               // Optional message/context
    signature,             // Cryptographic signature from voucher
    issuedAt,              // When vouch was issued
    receivedAt,            // When we received/synced it
    verified               // Signature verified against voucher's pubkey
  }) { ... }
}
```

**Vouch types:**

| Type | Meaning |
|------|---------|
| `general` | Generic endorsement ("I vouch for this person") |
| `expertise` | Domain-specific ("They know fitness") |
| `trust` | Personal trust ("I know them IRL") |
| `identity` | Identity confirmation ("This is really them") |

---

## Services

### IdentityLinkingService

Manages the lifecycle of linking external identities to internal entities.

```javascript
class IdentityLinkingService {

  // Initiate linking — returns challenge for user to prove ownership
  async initiateLink(anchor, protocol, externalId)
  // → { challengeId, challengeType, challengeData, expiresAt }

  // Complete linking — verify challenge response, create LinkedIdentity
  async completeLink(challengeId, response)
  // → LinkedIdentity (verified) or throws VerificationFailed

  // Unlink — remove a linked identity
  async unlink(linkedIdentityId)

  // Re-verify — check identity still valid (e.g., NIP-05 still resolves)
  async reverify(linkedIdentityId)
  // → updated VerificationStatus

  // List all linked identities for an anchor
  async getLinkedIdentities(anchor)
  // → LinkedIdentity[]
}
```

**Challenge types by protocol:**

| Protocol | Challenge Type | How It Works |
|----------|---------------|--------------|
| nostr | signed_event | User signs a challenge string with their nsec |
| polycentric | signed_claim | User creates a Harbor claim referencing the challenge |
| github | oauth | OAuth flow, verify token |
| email | code | Send code to email, user enters it |

### IdentityResolver

Bidirectional resolution between internal anchors and external identities.

```javascript
class IdentityResolver {

  // External → Internal: "Who in our system is npub1kevin...?"
  async resolveToAnchor(protocol, externalId)
  // → IdentityAnchor | null

  // Internal → External: "What's Kevin's nostr identity?"
  async resolveToExternal(anchor, protocol)
  // → externalId | null

  // Internal → All externals: "What identities does Kevin have?"
  async resolveAllExternals(anchor)
  // → { protocol: externalId }[]

  // External → All internals: "Is this npub linked anywhere?"
  async resolveAllAnchors(protocol, externalId)
  // → IdentityAnchor[] (could be multiple if same person in multiple households)

  // Batch resolve for feed rendering
  async batchResolve(externalIds)
  // → Map<externalId, IdentityAnchor>
}
```

### ReputationService

Aggregates vouches and computes trust metrics.

```javascript
class ReputationService {

  // Get all vouches for a linked identity
  async getVouches(linkedIdentityId)
  // → Vouch[]

  // Get vouch summary (counts by type, total)
  async getVouchSummary(linkedIdentityId)
  // → { total: number, byType: { general: n, trust: n, ... } }

  // Check if vouched by specific identity (for trust decisions)
  async isVouchedBy(linkedIdentityId, voucherExternalId)
  // → boolean

  // Sync vouches from provider (pull latest from Harbor)
  async syncVouches(linkedIdentityId)

  // Compute trust score (optional, algorithm TBD)
  async computeTrustScore(linkedIdentityId, context)
  // → { score: 0-100, factors: [...] }
}
```

---

## Port Interface

### IdentityProviderPort

The interface that protocol adapters implement.

```javascript
class IdentityProviderPort {

  // === Protocol Info ===

  getProtocolName()
  // → 'nostr' | 'polycentric' | 'github' | 'email'

  getCapabilities()
  // → { vouching: boolean, profiles: boolean, verification: 'challenge' | 'oauth' | 'code' }


  // === Identity Verification ===

  async createChallenge(externalId)
  // → { challengeData, challengeType, expiresAt }

  async verifyChallenge(externalId, challengeData, response)
  // → { verified: boolean, error?: string }

  async reverify(externalId)
  // → { valid: boolean, reason?: string }


  // === Profile Data ===

  async fetchProfile(externalId)
  // → { displayName, avatar, metadata } | null


  // === Vouching (if supported) ===

  async fetchVouches(externalId)
  // → Vouch[] (in domain format)

  async subscribeToVouches(externalId, callback)
  // → unsubscribe function (for real-time updates)


  // === Resolution ===

  async resolveIdentifier(humanReadable)
  // e.g., NIP-05: "kevin@example.com" → npub
  // e.g., Harbor handle → did:poly
  // → externalId | null

  async validateFormat(externalId)
  // → boolean (is this a valid npub/did/etc.)
}
```

### Adapter Capability Matrix

| Method | Nostr | Harbor/Polycentric | GitHub | Email |
|--------|-------|-------------------|--------|-------|
| `createChallenge` | ✅ signed event | ✅ signed claim | ✅ oauth | ✅ code |
| `verifyChallenge` | ✅ | ✅ | ✅ | ✅ |
| `reverify` | ✅ NIP-05 check | ✅ DID resolve | ✅ token refresh | ❌ |
| `fetchProfile` | ✅ kind:0 | ✅ Harbor profile | ✅ API | ❌ |
| `fetchVouches` | ❌ | ✅ | ❌ | ❌ |
| `subscribeToVouches` | ❌ | ✅ | ❌ | ❌ |
| `resolveIdentifier` | ✅ NIP-05 | ✅ handle | ✅ username | ✅ |
| `validateFormat` | ✅ npub regex | ✅ did:poly regex | ✅ | ✅ email regex |

---

## Interaction with Licensing

### The Relationship

| Domain | Owns | Provides |
|--------|------|----------|
| **identity** | LinkedIdentity, Vouch | "Who is this person across protocols" |
| **licensing** | License, Badge | "Is this instance paid, what tier" |

Badges are issued **to** LinkedIdentities. The identity domain manages the link; the licensing domain manages the credential.

```
┌─────────────────┐         ┌─────────────────┐
│    identity     │         │    licensing    │
│                 │         │                 │
│  LinkedIdentity │◄────────│     Badge       │
│  (who you are)  │ issued  │  (payment proof)│
│                 │   to    │                 │
│     Vouch       │         │    License      │
│  (reputation)   │         │  (system-level) │
└─────────────────┘         └─────────────────┘
```

### Badge Issuance Flow

```
User links npub via identity domain
         │
         ▼
IdentityLinkingService.completeLink()
         │
         ▼
LinkedIdentity created (verified)
         │
         ▼
User requests badge for this identity
         │
         ▼
LicensingService checks:
  1. LinkedIdentity exists and is verified
  2. System license is valid
  3. Anchor (user/household) is authorized
         │
         ▼
Badge issued, references LinkedIdentity.id
```

### Network Display: Badge + Vouch

On the social network, a user's post shows both:

| Source | Display |
|--------|---------|
| **Badge** (licensing) | 💎 Patron |
| **Vouches** (identity/Harbor) | "Vouched by 12 peers" |

```
┌────────────────────────────────────────┐
│  @kevin (npub1kevin...)                │
│  💎 Patron · 🤝 12 vouches             │
│                                        │
│  Just finished a 45-minute workout!    │
└────────────────────────────────────────┘
```

- **Badge** = "This person pays for DaylightStation" (commercial status)
- **Vouches** = "This person is trusted by peers" (social reputation)

Orthogonal signals. Both valuable. Neither replaces the other.

---

## Data Storage

### Storage Strategy

| Data | Storage | Reason |
|------|---------|--------|
| LinkedIdentity | SQLite | Queryable, indexed by anchor + protocol + externalId |
| Vouch | SQLite | Volume (many vouches per identity), timestamps, queries |
| Pending challenges | SQLite | Short-lived, needs expiration queries |
| Protocol config | YAML | Adapter settings, endpoints, feature flags |

### Schema

```sql
CREATE TABLE linked_identities (
  id TEXT PRIMARY KEY,
  anchor_type TEXT NOT NULL,           -- 'system' | 'household' | 'user'
  anchor_id TEXT NOT NULL,
  protocol TEXT NOT NULL,              -- 'nostr' | 'polycentric' | 'github' | 'email'
  external_id TEXT NOT NULL,
  display_name TEXT,
  verification_status TEXT NOT NULL,   -- 'pending' | 'verified' | 'failed' | 'expired'
  verified_at INTEGER,
  linked_at INTEGER NOT NULL,
  metadata TEXT,                       -- JSON blob for protocol-specific extras

  UNIQUE(protocol, external_id),       -- One link per external identity
  UNIQUE(anchor_type, anchor_id, protocol)  -- One identity per protocol per anchor
);

CREATE INDEX idx_linked_anchor ON linked_identities(anchor_type, anchor_id);
CREATE INDEX idx_linked_external ON linked_identities(protocol, external_id);


CREATE TABLE vouches (
  id TEXT PRIMARY KEY,
  subject_identity_id TEXT NOT NULL,   -- FK to linked_identities
  voucher_external_id TEXT NOT NULL,
  voucher_protocol TEXT NOT NULL,
  vouch_type TEXT NOT NULL,            -- 'general' | 'expertise' | 'trust' | 'identity'
  content TEXT,
  signature TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  verified INTEGER NOT NULL DEFAULT 0,

  FOREIGN KEY (subject_identity_id) REFERENCES linked_identities(id),
  UNIQUE(subject_identity_id, voucher_external_id, vouch_type)
);

CREATE INDEX idx_vouches_subject ON vouches(subject_identity_id);


CREATE TABLE pending_challenges (
  id TEXT PRIMARY KEY,
  anchor_type TEXT NOT NULL,
  anchor_id TEXT NOT NULL,
  protocol TEXT NOT NULL,
  external_id TEXT NOT NULL,
  challenge_type TEXT NOT NULL,
  challenge_data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE INDEX idx_challenges_expires ON pending_challenges(expires_at);
```

### File Locations

```
data/
├── system/
│   ├── identity.db              # SQLite database
│   └── config/
│       └── identity.yml         # Protocol settings
│
└── household[-{hid}]/
    └── config/
        └── identity.yml         # Household-level overrides (optional)
```

### identity.yml (Protocol Config)

```yaml
protocols:
  nostr:
    enabled: true
    nip05_verification: true
    relays:
      - wss://relay.damus.io
      - wss://nos.lol

  polycentric:
    enabled: true
    harbor_endpoint: https://harbor.social
    systems:
      - https://srv1.polycentric.io

  github:
    enabled: false    # Future

  email:
    enabled: true
    verification_ttl: 86400  # 24 hours

challenge:
  ttl: 600            # 10 minutes to complete verification
  cleanup_interval: 3600

vouches:
  sync_interval: 3600       # Sync vouches every hour
  max_per_identity: 1000    # Cap storage per identity
```

---

## Architecture Diagram

```
                    ┌──────────────┐
                    │     core     │
                    │ system/hh/user│
                    └──────┬───────┘
                           │ anchor
                           ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   licensing  │◄───│   identity   │◄───│    social    │
│ license/badge│    │ links/vouches│    │ activities   │
└──────────────┘    └──────┬───────┘    └──────────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
        ┌─────────┐  ┌──────────┐  ┌─────────┐
        │  nostr  │  │  harbor  │  │  email  │
        │ adapter │  │ adapter  │  │ adapter │
        └─────────┘  └──────────┘  └─────────┘
```

---

## Implementation Phases

| Phase | Scope |
|-------|-------|
| **1. Foundation** | Domain structure, entities, SQLite schema, IdentityLinkingService |
| **2. Nostr Adapter** | Challenge/verify via signed event, NIP-05 resolution |
| **3. Harbor Adapter** | Challenge/verify via signed claim, vouch fetching |
| **4. Licensing Integration** | Badge issuance to LinkedIdentities |
| **5. Social Integration** | Display badge + vouches in network profile |

---

## Open Questions

1. **Vouch trust weighting** — How to score vouches? By voucher reputation? Recency?
2. **Cross-protocol linking** — If same person has npub + did:poly, show unified profile?
3. **Revocation** — What happens when someone unlinks? Vouches orphaned?
4. **Rate limiting** — Max linked identities per anchor? Max vouches synced?

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-04 | Initial design |
