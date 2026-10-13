# Business Model

> How Daylight Station sustains itself: an audience that funds a subscription that funds a platform.

**Last Updated:** 2026-09-16
**Status:** Strategy agreed, unbuilt

---

## Thesis

Daylight Station is free software. The core stays MIT and fully functional with
your own API keys — that is a precondition for everything below, not a
limitation on it.

Revenue comes from three engines in strict order, plus one loop that earns
nothing directly and compounds everything:

```
        AUDIENCE                SUBSCRIPTION              ECOSYSTEM
     (YouTube channel)      (Daylight Connect $10/mo)   (store, kits, packs)

   sponsorship + ads   ──▶   reliability + content   ──▶   moat + retention
        acquisition              the business             renewal reason
                                      ▲
                                      │
                                  REFERRAL
                        (cross-household federation)
                     each household invites its relatives
```

Each engine depends on the one to its left. The channel is the only acquisition
channel that exists; without it there are no subscribers, no buyers, and no
contributors. **Nothing downstream is worth building before the audience is
real.**

Referral is the one loop that runs backwards — it returns new households to the
subscription without going through the channel at all.

---

## Engine 1: Audience

**Role:** acquisition first, revenue second.

The channel does what documentation cannot — it shows a household system
working in a real house, which is the only way anyone understands what this is.
Ad revenue is the smallest line; integrated sponsorship typically runs several
times AdSense at any given size. Both matter less than the fact that every
other engine draws from here.

| Line | Shape |
|---|---|
| AdSense | Self-hosted/homelab RPM ≈ $8–25 |
| Sponsorship | Integrated reads; the majority of channel revenue |
| Pack sales | Platform-independent packs sold to viewers who never install |
| Kit affiliate | BOM links in build videos |

Every feature built is an episode. Every content pack is an episode. The
publishing schedule and the roadmap are the same document.

---

## Engine 2: Daylight Connect — $10/month

**One tier. One price. Everything included.**

This supersedes the six-tier badge model in
[social-and-licensing.md](../roadmap/social-and-licensing.md). Tiered status
badges optimize for social proof among people who already pay; a single tier
optimizes for the decision to pay at all. Chiding non-payers is off the table —
the hosted services justify the price without it.

### What it sells: the removal of recurring breakage

The test a hosted feature must pass: **annoying to set up AND annoying to keep
working.** One-time annoyance loses to a good README. Recurring breakage is what
people pay to make go away.

| Pillar | What it removes | Recurring? |
|---|---|---|
| **Verified connections** | Registering a developer app with every provider; unverified OAuth apps issue refresh tokens that expire in days, so integrations die on a schedule | Constantly |
| **Public endpoint** | No inbound webhooks behind CGNAT — no Telegram bots, no push from fitness or calendar providers, no real-time anything | Constantly |
| **Add-on management** | Installing and wiring companion containers by hand | Per service |
| **AI capacity** | Getting a provider key, putting a card on file, fearing a surprise bill | Bill anxiety |
| **Household restore** | Losing the family record when a disk dies | Ongoing worry |

All five are the same promise — *it works and it stays working* — which is why
they are one product and not five SKUs.

### Pillar detail

**Verified connections.** The project runs one verified application per
provider and brokers the authorization. Users click Connect and see a normal
consent screen. Tokens transit; they land on the user's own machine and do not
rest with us. This is the highest-value pillar and the longest lead time —
provider verification is measured in months, so the applications go in first.

**Public endpoint.** A stable HTTPS surface for inbound push. Converts polling
harvesters into real-time ones, which is a visible feature rather than
plumbing. Cheap to run, weeks to build.

**Add-on management.** From the admin UI: install and wire a companion service
on the user's own hardware. Storage, liability and backups stay with them. The
convenience is ours to sell; the disk is theirs to fill.

**AI capacity.** Metered and capped, using the existing usage ledger, pricing
table and cost-budget entities. The cap is a feature — it removes the fear, not
just the signup. Priced as an inclusion, never the anchor: the margin sits on
top of someone else's falling prices.

**Household restore.** The product is *restore*, not backup. Megabytes of YAML
and JSONL — ledgers, journals, history — not media. Point a fresh install at an
account and the household comes back. Encrypted client-side so we hold
ciphertext we cannot read. Restores are tested automatically and shown as
green; an untested backup is a rumor.

### Unit economics

| Line | Per subscriber |
|---|---|
| Revenue | $10.00 |
| AI at cap | −$2.00 to −$4.00 |
| Infrastructure (broker, relay, object storage) | −$0.60 |
| Payment processing / merchant of record | −$0.80 |
| **Net** | **≈ $4.50–6.50** |

**1,000 subscribers ≈ $120k gross, $85–95k net.** That is the target number.
It is a far more reachable figure than the thousands of small donors an
equivalent donation model would require.

---

## Engine 3: Content, store, and ecosystem

### First-party store, opened later

Not a two-sided marketplace. A first-party store that *can* accept third-party
submissions once it has an audience. Seeded entirely with our own packs, so it
is never empty and never junky. The revenue-share offer costs nothing until
somebody takes it.

Precedent: Steam shipped Valve-only for two years; Amazon was first-party for
five; Home Assistant's add-on store began as official add-ons.

### The free seed pack

The most valuable content decision is giving the starter pack away. Programs,
music drills, the classical library, a sample term — enough that a bare install
*does something* in ten minutes with no media server, no printer and no keys.
This is worth more than any price we could put on it.

### What is actually sold

| Sold | Not sold |
|---|---|
| Structures, schemas, ladders, templates | Anyone else's content |
| Our own authored synthesis | Anything derived from a copyrighted work |
| Public-domain and openly-licensed corpora | Media, or access to media |
| Platform-independent packs (PDF + data) | Platform-locked packs as the only form |

Packs are bundled into Connect rather than sold à la carte. Bundling raises
subscription value, creates a monthly shipping cadence (which is also the video
cadence), and converts one-time purchases into retention.

### Convenience is the moat, not exclusivity

Anything we distribute can be copied and reposted. That has never been what
kills a store; absence of demand is. What cannot be copied:

1. **Freshness.** A pack improves and propagates to every linked instance. A
   copied file is frozen at the moment it was taken.
2. **Matching.** Resolving *which* variant applies to a user's specific
   library, and at what offset, is the hard problem. It gets better with every
   instance reporting back.
3. **Installation.** Browse, click, live tonight. Nobody wants to download an
   archive and copy it onto a server.

Instances **pull** a signed manifest on a schedule. We never reach into a user's
network — same experience, and it keeps us out of the inbound-access business.

### If and when third-party submissions open

- Free submissions first. The question that decides whether paid is possible is
  *will anyone contribute at all*, and a revenue share does not change that
  answer. Free index, then payments.
- A **DMCA designated agent** must be registered with the Copyright Office
  before the first third-party upload. Without it there is no safe harbor.
  Pair it with a written takedown process and a repeat-infringer policy.
- Use a **merchant of record** rather than building payouts. They absorb sales
  tax across jurisdictions for digital goods.
- Prefer **pool payouts** (share of a monthly pool by download share) over
  per-download pricing. Per-download amounts are too small to motivate authors
  and force a purchase decision that suppresses browsing.
- **Commissioning specific works for money changes our legal position** from
  host toward producer, and weakens safe harbor. Bounties are acceptable only
  where the work itself is independently protected; plain hosting with a
  mandatory license attestation everywhere else.

---

## Engine 4: Referral — cross-household federation

**Earns nothing on its own. It is the only growth loop in the business.**

Every other engine is one-way: we publish, someone installs. Federation is the
one feature where each household that joins gives its relatives a personal,
motivated reason to join — cousins seeing each other's workouts, grandparents
seeing photos from three households, a family calendar that spans homes.

Relatives are the highest-converting audience available: a product they have
watched work, an invitation from someone they trust, and a shared reason to
want it. No advertising reaches that quality of lead.

It is a Connect feature by construction. Cross-household sharing needs
identity, a reachable public endpoint, and relay infrastructure — precisely
what the subscription already sells. It adds a reason to subscribe without
adding a business model.

### Build direct federation first; protocols later

The [social design](../roadmap/social-and-licensing.md) abstracts federation
behind a port with pluggable protocol adapters. The abstraction is right. The
priority inside it is not.

For a known set of households who already know each other, **direct
instance-to-instance federation over the Connect endpoint** is simpler, more
private, and better than a public protocol. Public relays are a poor fit for
private family photos even with payload encryption, because relays are
untrusted infrastructure by design and metadata leaks regardless.

| Item | Priority | Rationale |
|---|---|---|
| `SocialNetworkPort` + `LocalAdapter` + direct federation | **High** | The referral loop. No external protocol required. |
| Polycentric adapter | Low, cheap, kept warm | Visibility with a foundation that funds work in this space. A grant path — runway, not revenue. |
| Nostr adapter | Deferred | Small, bitcoin-native active population with little overlap with our buyer. Poor fit for private family data. |
| Lightning zaps as a contributor payout rail | Opportunistic | Could fund store payouts with no merchant of record, no tax jurisdiction problem. Reaches only a slice; never the primary rail. |
| Paid subscriber-only relay | Marginal | Nearly free if relay infrastructure exists anyway. Small money. |
| Badge certificates | Deferred | Status display requires a network to display it on. Until federation has users, it is infrastructure for an audience of zero. |

### What the protocols are and are not

They are **not** a monetization channel: the native payment primitives are real
but the audiences are far too small to move subscription numbers. They are
**not** a meaningful word-of-mouth channel either, for the same reason.

What they are is an option on a future — a cheap way to stay legible to the
wider self-hosted and protocol-native world, and a credible signal to
organizations that fund this kind of work.

---

## Hardware taps

Many taps are physical and require buying a specific board, flashing firmware,
and wiring a sensor. That work is a weekend project with several places to
fail, and most people who want the outcome will never do the project.

**Stage one — zero inventory.** Publish an exact bill of materials with
affiliate links, and ship a **browser-based flasher** (WebSerial). "Click
Flash" replaces installing a build toolchain. This captures most of a kit's
value at none of its risk, and it is how the ESP ecosystem onboards
non-technical users today.

**Stage two — kits, only if the affiliate numbers justify it.** Pre-flashed,
pre-wired, in an enclosure, with a pairing card. The lead product is the
morning receipt: the most photogenic feature, the cheapest path to first value,
and the only line that converts a *viewer* into a *user*. Roughly $150–200 at
~35% margin.

Hardware carries capital, shipping, returns, RMA and radio-certification costs.
Prefer pre-certified modules and fulfillment partners. Let demand prove itself
before owning inventory.

---

## What we do not sell

| Not sold | Why |
|---|---|
| **Hosted photo, media or file storage** | Negative margin, maximum liability, and it contradicts the positioning. We are the layer where services meet, not a replacement for them. Manage their container on their disk instead. |
| **Access to licensed streaming content** | No major subscription service licenses third-party playback, and none can — the requirement is imposed on them by their own content licenses. |
| **Anything requiring circumvention** | A separate offense from infringement, and it forfeits the statutory protection our filtering features depend on. Filtering is control-only: drive the authorized player, never carry or copy the stream. |
| **Status tiers and badges** | Converts worse than one obvious price. |
| **Core functionality** | The MIT core stays complete with the user's own keys. Paywalling it would end the community that makes any of this work. |

---

## Content provenance policy

**Binding, and it predates any revenue.**

Every content item carries `source:` and `license:`. Both are **required**, and
the packaging tool **refuses to build a pack containing any item not marked
with a distributable license.** The gate lives in the build path, not in
reviewer discipline.

- Material derived from a copyrighted work — questions keyed to a specific
  book, editorial annotations, another product's corpus — is personal-use only
  and never ships, free or paid.
- Factual data (timestamps, dates, catalog metadata, musical structures) is
  distributable; the descriptive prose written *about* it generally is not.
- Openly-licensed sources ship with their attribution and share-alike
  obligations honored in the pack manifest.
- Private working data and distributable data must not share a directory. The
  wall is structural, so that packaging in a hurry cannot cross it.

Where a user wants content we cannot ship, the answer is a **generator, not a
corpus** — tooling that builds their pack from material they own.

---

## Prerequisite: the first fifteen minutes

No business model survives an empty first run. Today a stranger who starts the
stack sees dashboards with nothing in them.

**Before the channel launches**, one tap must deliver something delightful with
no media server, no special hardware, and at most one connected account. Every
video implicitly promises this; the promise has to be true first.

Supporting work in the same tranche:

- Seed/demo household with synthetic data — the demo must never be a real
  family's records
- Continuous integration — third-party pull requests cannot be accepted safely
  without it
- Remove instance-specific hosts, addresses and identifiers from the tree

---

## Sequencing and gates

| Phase | Build | Gate to continue |
|---|---|---|
| **0. Make it installable** | First-value tap, demo household, CI, de-personalize | A stranger reaches value in 15 minutes, unaided |
| **1. Audience** | Publish on a fixed cadence; project stays quiet until the format works | One video ≥ 10k views; ≥ 1k subscribers |
| **2. Launch the project** | Lead with the single strongest tap | ≥ 1,000 stars; below ~300 means the messaging is wrong, not the code |
| **3. Connect** | Public endpoint → provider verification → add-ons → AI → restore | ≥ $2k MRR |
| **4. Referral** | `SocialNetworkPort`, `LocalAdapter`, direct household-to-household federation | Invited households convert at a measurable rate |
| **5. Store** | First-party, signed manifest, pull client, matcher | Renewal rate holds |
| **6. Open it** | Free submissions, DMCA agent, then payouts | Third parties contribute unprompted |

Provider verification applications are submitted during phase 1 — they are the
long pole and they wait on nobody.

A gate that fails is information, not failure. Below-threshold at phase 1 means
the constraint is the format; below-threshold at phase 2 means the constraint is
the message. Neither is fixed by writing more code.

---

## Open questions

1. Do provider terms permit brokering authorization to user-operated instances?
   Answer per provider before building the broker; the strictest one sets the
   design.
2. Merchant of record versus direct processing — at what volume does the ~5%
   stop being worth the tax abstraction?
3. Does the store ship inside the app, or as a separate service other
   self-hosted platforms can also consume? The wider surface is a better
   acquisition channel but a larger commitment.
4. Fulfillment partner or self-fulfillment for kits, if they happen at all?
5. Free-tier boundary for the AI capacity: bring-your-own-key only, or a small
   included allowance to demonstrate the feature?
6. Does federation stay on direct instance-to-instance transport, or do public
   protocol adapters follow — and on what signal? A funding relationship and
   demonstrated user demand are the two that would justify the engineering.

---

## Changelog

| Date | Change |
|------|--------|
| 2026-09-16 | Added referral engine: federation as the growth loop; direct transport before public protocols; badge certificates deferred |
| 2026-09-16 | Initial business model: audience → subscription → ecosystem; single-tier Connect supersedes the six-tier badge model; provenance policy made binding |
