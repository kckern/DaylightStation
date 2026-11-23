# Identity Model

> System, household, user, and profile hierarchy with licensing and social federation

---

## Overview

DaylightStation uses a three-tier identity hierarchy. Each tier has distinct responsibilities for licensing, social presence, and content sharing.

```
┌─────────────────────────────────────────────────────────────┐
│  SYSTEM (Deployment)                                        │
│  • One per DaylightStation installation                     │
│  • Owns the license                                         │
│  • Has a primary owner (head of household)                  │
│  • Instance ID is the root identity anchor                  │
├─────────────────────────────────────────────────────────────┤
│  HOUSEHOLD(S)                                               │
│  • One or more per system                                   │
│  • Family unit with shared config                           │
│  • Can have its own social link (optional)                  │
│  • Contains users and profiles                              │
├─────────────────────────────────────────────────────────────┤
│  USERS & PROFILES                                           │
│  • Zero or more per household                               │
│  • Users have login credentials                             │
│  • Profiles are people without system access                │
│  • Users can have their own social links                    │
└─────────────────────────────────────────────────────────────┘
```

**Key relationships:**
- A system always has exactly one license
- Multiple households can share a single system license
- Users and profiles within a household share the household's license tier
- Social links are optional at both household and user level

---

## Profiles vs Users

Within a household, people are represented as either **profiles** or **users**.

### Profiles

- Represent a person without system access
- Used for task assignments, mentions, activity attribution
- No login credentials
- Cannot have social links
- Activities post via the household's social link
- Example: Young children tracked for chores
- Can be upgraded to a user (e.g., on 16th birthday)

### Users

- Have login credentials and system access
- Can optionally add social links (npub, DID, etc.)
- Can post as themselves (if social link exists) or as household
- Manage their own preferences and social circles

### Capability Matrix

| Capability | Profile | User | User + Social Link |
|------------|---------|------|-------------------|
| Assigned tasks/chores | ✓ | ✓ | ✓ |
| Mentioned in posts | ✓ | ✓ | ✓ |
| Log in | ✗ | ✓ | ✓ |
| Personal preferences | ✗ | ✓ | ✓ |
| Add social links | ✗ | ✗ | ✓ |
| Post as self | ✗ | ✗ | ✓ |
| Manage circles | ✗ | ✗ | ✓ |
| Direct messages | ✗ | ✗ | ✓ |

**Upgrade path:** Profile → User (add credentials) → User + Social Link (link protocol account)

---

## Screens

Screens (TVs, kiosks) never sign in. A screen is identified by its declared device in
`devices.yml` (`content_control` or `fleet: true`) through the `X-Daylight-Device:
fleet:<name>` header on the house network, and acts as the participant id
`screen:<name>`. That identity is not a sign-in: it can show an agenda and start its
activities, never edit. See `__capabilities/content-catalog/docs/participant-launch.md`
(Screens and sign-in).

---

## Admin sign-in

Claiming a profile sets its password on the server. If the browser cannot save the session after a successful claim or sign-in, Admin keeps the username and opens the sign-in form. Once site storage is available, the user can sign in with the password they already set.

---

## Social Links

Social links connect internal entities (households, users) to external protocol accounts for federation.

### Who Can Have Social Links

| Entity | Social Links | Purpose |
|--------|--------------|---------|
| System | ✗ | License only, no social presence |
| Household | Optional | Post on behalf of profiles and linkless users |
| Profile | ✗ | Mentioned by name in household posts |
| User | Optional | Post as individual |

### How Profiles Appear on the Network

Profiles don't have social links, but they're still credited. When Junior finishes chores:

- **Author:** Household's social link (`npub1kernhome...`)
- **Content:** "Junior finished his chores" (profile mentioned by name)

The household speaks, but names the profile. Recipients see it came from "The Kern Home" about "Junior."

### Author Resolution

| Scenario | Author | Content mentions |
|----------|--------|------------------|
| User with social link posts | User's link | - |
| User without link posts | Household's link | User's name |
| Profile completes activity | Household's link | Profile's name |
| Device with no context | Household's link | Device name (optional) |

### Multiple Links Per Entity

Both households and users can have multiple protocol links:

```
Household: The Kern Home
├── nostr: npub1kernhome...
└── polycentric: did:poly:kernhome...

User: Kevin
├── nostr: npub1kevin...
└── polycentric: did:poly:kevin...
```

When posting, the system publishes to all linked protocols where visibility is supported.

---

## Licensing & Trust Model

### License Inheritance

All social links within a system inherit the system's license tier. One payment covers all households, users, and social links.

```
┌─────────────────────────────────────────────────────────────┐
│  SYSTEM LICENSE (Patron tier)                               │
│  └── Household A                                            │
│      ├── Social link: npub1homeA... → Badge (Patron)        │
│      ├── User: Kevin                                        │
│      │   └── Social link: npub1kevin... → Badge (Patron)    │
│      └── Profile: Junior (no social link, no badge)         │
│                                                             │
│  └── Household B (same system, same license)                │
│      ├── Social link: npub1homeB... → Badge (Patron)        │
│      └── User: Grandma                                      │
│          └── Social link: npub1grandma... → Badge (Patron)  │
└─────────────────────────────────────────────────────────────┘
```

### The Trust Chain

```
DaylightStation Server (signing authority)
  • Holds private signing key
  • Public key published in repo + Nostr profile
        │
        │ signs
        ▼
LICENSE (system-level)
  • Proves: "This instance is licensed at Patron tier"
  • Contains: instance ID, tier, owner email, expiration date
  • Replaced on renewal with new signed license
  • Private credential, never shared publicly
        │
        │ authorizes
        ▼
BADGE (per social link, 30-day refresh)
  • Proves: "npub1kevin belongs to a licensed system"
  • Contains: tier, status, validity window
  • Public credential, attached to posts
```

### License Lifecycle

| Event | What happens |
|-------|--------------|
| Purchase | New license issued with expiration date |
| Renewal | Old license exchanged for new license with extended expiration |
| Upgrade | Old license exchanged for new license at higher tier |
| Expiration | License invalid, badges show "lapsed" |
| Lifetime purchase | License has no expiration, never needs renewal |

### License vs. Badge

| Credential | Lifespan | What it proves |
|------------|----------|----------------|
| License | Until expiration (or lifetime) | "You purchased this tier" |
| Badge | 30 days (auto-refresh) | "This social link belongs to a licensed system" |

The license is used to request badge refreshes. On refresh, the server verifies the license is still valid and issues a badge reflecting current status.

---

## Visibility Model

Visibility controls who can see a post. Each level has different reach and transport requirements.

### Visibility Levels

| Level | Audience | Transport | Encryption | Requires Social Link |
|-------|----------|-----------|------------|---------------------|
| **Private** | Only the author | Local DB | None | No |
| **Household** | All users in household | Local DB | None | No |
| **Circle** | Named group of connections | Network | E2E encrypted | Yes |
| **Connections** | All mutual connections | Network | E2E encrypted | Yes |
| **Public** | Anyone on the network | Network | None | Yes |

**Key insight:** Anything beyond household requires a social link. Without one, you can only share locally.

### Who Can Post at Each Level

| Visibility | Profile | User | User + Link | Household + Link |
|------------|---------|------|-------------|------------------|
| Private | ✗ | ✓ | ✓ | - |
| Household | Via HH | ✓ | ✓ | - |
| Circle | ✗ | ✗ | ✓ | ✓ (on behalf) |
| Connections | ✗ | ✗ | ✓ | ✓ (on behalf) |
| Public | ✗ | ✗ | ✓ | ✓ (on behalf) |

**"Via HH" / "On behalf":** When a profile's activity is shared beyond household, the household's social link posts it, mentioning the profile by name.

---

## Circles & Connections

Social links can connect to other social links across DaylightStation instances. Circles group connections for targeted sharing.

### Connections

A connection is a mutual relationship between two social links (user-to-user, user-to-household, or household-to-household).

```
The Kern Home (npub1kernhome)
    │
    ├── mutual connection ←→ The Smith Home (npub1smithhome)
    │
    └── User: Kevin (npub1kevin)
            │
            ├── mutual connection ←→ Cousin Sarah (npub1sarah)
            └── mutual connection ←→ Uncle Bob (did:poly:bob)
```

Connections are per-social-link, not per-household. Kevin's connections are his own; the household has separate connections.

### Circles

Circles are named groups of connections, defined by the social link owner.

| Circle | Members | Use case |
|--------|---------|----------|
| Close Family | npub1sarah, npub1smithhome | Daily activity sharing |
| Extended Family | did:poly:bob, npub1cousins | Holiday updates |
| Workout Buddies | npub1gym1, npub1gym2 | Fitness posts only |

### Circle Ownership

- User social links own their own circles
- Household social links own household-level circles
- Profiles cannot have circles (no social link)

### Visibility + Circles

When posting with visibility "Circle," you select which circles see it:

- "Share with: Close Family" → Only connections in that circle
- "Share with: Close Family, Workout Buddies" → Union of both circles

---

## Signing & Authentication

Every post on the network carries two signatures: one proving authorship, one proving license status.

### Two Signatures Per Post

```
┌─────────────────────────────────────────────────────────────┐
│  POST                                                       │
│                                                             │
│  Content: "Just finished a 5k run!"                         │
│  Author: npub1kevin...                                      │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  AUTHOR SIGNATURE (user's private key)              │   │
│  │  Proves: "Kevin wrote this"                         │   │
│  │  Signed by: Kevin's nsec (Nostr) or Ed25519 (PC)    │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  BADGE (DaylightStation server's signature)         │   │
│  │  Proves: "Kevin's system is licensed at Patron"     │   │
│  │  Signed by: DaylightStation signing key             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### What Each Signature Proves

| Signature | Signer | Proves | Can be forged? |
|-----------|--------|--------|----------------|
| Author | User/Household private key | "I wrote this" | Only if key compromised |
| Badge | DaylightStation server | "Author is licensed" | Never (key is secret) |

### Verification by Recipients

1. Verify author signature → Confirms post is authentic
2. Verify badge signature → Confirms license status
3. Check badge matches author → Prevents badge theft
4. Check badge not expired → Confirms status is current

### Protocol Adapters

| Protocol | Author signature | Key type |
|----------|-----------------|----------|
| Nostr | Schnorr (secp256k1) | nsec/npub |
| Polycentric | Ed25519 | Private/public key pair |

The badge signature is always the same (DaylightStation server key), regardless of protocol.

---

## Edge Cases & Failure Modes

### License Issues

| Scenario | Badge status | Network display | Can still post locally? |
|----------|--------------|-----------------|------------------------|
| License valid, subscription active | Active | Tier badge (💎 Patron) | ✓ |
| License valid, payment past due | Past due | ⚠️ Delinquent | ✓ |
| License expired, not renewed | Lapsed | 🪦 Lapsed | ✓ |
| License lifetime | Active (forever) | Tier badge + 🎖️ | ✓ |
| No license (freeloader) | None | No social features | ✓ (household only) |
| Forged/invalid badge | Invalid | 🚨 Intruder | ✓ |

### Social Link Issues

| Scenario | What happens |
|----------|--------------|
| User removes social link | Can no longer post as self; falls back to household |
| Household has no social link | Profiles and linkless users cannot post externally |
| User has link, household doesn't | User can post as self; profiles stuck local-only |
| Badge expires (30 days) | Auto-refresh attempted; if fails, posts show stale badge |
| Badge refresh fails (offline) | Use cached badge until online; may become stale |

### Author Resolution Edge Cases

| Scenario | Result |
|----------|--------|
| Profile activity, household has no link | Activity stays local (household visibility max) |
| User posts, has link, household has link | User chooses: post as self or as household |
| User posts, no link, household has link | Posts as household, user mentioned by name |
| User posts, has link, household has no link | Posts as user (no household fallback needed) |
| Device post, no user context, no household link | Stays local only |

### Connection Issues

| Scenario | What happens |
|----------|--------------|
| Connection blocked by recipient | Your posts no longer delivered to them |
| Connection's badge invalid | Their posts show 🚨 Intruder to you |
| Connection switches protocols | Must establish new connection on new protocol |
| Circle member removes their link | They stop receiving circle posts |

---

## Quick Reference

### Entity Hierarchy

```
System (1)
└── Households (1+)
    ├── Social links (0+)
    ├── Users (0+)
    │   └── Social links (0+)
    └── Profiles (0+)
        └── Social links: never
```

### Who Owns What

| Entity | License | Social Links | Circles | Connections |
|--------|---------|--------------|---------|-------------|
| System | ✓ (owns) | ✗ | ✗ | ✗ |
| Household | Inherits | Optional | Per-link | Per-link |
| User | Inherits | Optional | Per-link | Per-link |
| Profile | Inherits | ✗ | ✗ | ✗ |

### Social Link Requirements by Action

| Action | Requires social link? | Falls back to |
|--------|----------------------|---------------|
| Post privately | No | - |
| Post to household | No | - |
| Post to circle | Yes | Household link (if available) |
| Post to connections | Yes | Household link (if available) |
| Post publicly | Yes | Household link (if available) |
| Receive direct message | Yes | Cannot receive |
| Join a circle | Yes | Cannot join |

### Badge States

| License state | Subscription | Badge shows |
|---------------|--------------|-------------|
| Valid | Active | Tier badge |
| Valid | Past due | ⚠️ Delinquent |
| Expired | - | 🪦 Lapsed |
| Lifetime | N/A | Tier badge + 🎖️ |
| None/Invalid | - | 🚨 Intruder |

### Protocol Support

| Protocol | Adapter | Signature type | Encryption |
|----------|---------|----------------|------------|
| Nostr | NostrAdapter | Schnorr (secp256k1) | NIP-44 |
| Polycentric | PolycentricAdapter | Ed25519 | Native |
| Local | LocalAdapter | None | None |

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-03 | Initial reference document |
