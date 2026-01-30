# Open Source Community Traction Plan

> Getting users running DaylightStation, then contributors following

**Created:** 2026-01-30
**Status:** Ready for Implementation
**Goal:** Build foundation for r/selfhosted launch and demo video

---

## Strategic Context

### Goal Hierarchy
1. **Users** — People running DaylightStation in their homes
2. **Contributors** — PRs, adapters, bug fixes
3. **Philosophy adoption** — Implied by 1 & 2

### Target Audience
**Self-hosted enthusiasts** already running Plex, Home Assistant, Immich, Docker. They have the skills to handle setup complexity and already use the tools DaylightStation integrates with.

### Discovery Channels
- r/selfhosted (300K+ members)
- Awesome-selfhosted GitHub list
- YouTube (self-hosted YouTubers)
- Home Assistant community
- Personal blog / build in public

### Launch Strategy
**Demo video + Philosophy-first README** with a dedicated **demo household** to protect privacy and respect content licensing.

---

## The Barriers

| Barrier | Description |
|---------|-------------|
| **Discovery** | People don't know DaylightStation exists |
| **Setup complexity** | Too many dependencies, integrations, config |
| **Cold start** | Some features (nutrition, journaling) need historical data to show value |
| **Hardware requirements** | Best features (fitness kiosk, thermal printer) require physical setup |

### The "Aha Moment"
**Immich interstitials** — Family photos woven between Plex content. This is something no commercial streaming app would do. It embodies the philosophy: grounding, not extracting.

---

## Phase 1: Philosophy & README

**Goal:** Articulate the vision so compellingly that early adopters want to figure out setup.

**Deliverable:** Root `README.md` rewrite

### Content Structure

1. **The Problem**
   - Attention economy, algorithmic feeds
   - Personal data scattered across services
   - Commercial apps optimize for engagement, not wellbeing

2. **The Philosophy**
   - "Data refinery for intentional life"
   - Anti-doomscrolling, context-aware delivery
   - Grounding, not extracting

3. **What DaylightStation Is**
   - Self-hosted system that ingests personal data
   - Delivers through ambient, context-aware interfaces
   - You control the algorithm

4. **The "Taps" (Output Interfaces)**
   - Morning receipt (thermal printer)
   - Fitness kiosk (garage display + ANT+ HR)
   - TV interstitials (family photos between episodes)
   - Telegram bots (Nutribot, Journalist)
   - Office dashboard

5. **Who It's For**
   - Self-hosters running Plex/Home Assistant/Immich
   - People who want to reclaim attention
   - Families seeking intentional technology use

6. **Who It's Not For**
   - People wanting a simple dashboard
   - Those seeking maximum convenience
   - Anyone expecting plug-and-play setup (yet)

**Tone:** Manifesto-like but practical. Show something real has been built.

---

## Phase 2: Demo Household Scaffolding

**Goal:** Enable demos and videos without exposing real family data or violating content licensing.

### Directory Structure

```
data/household-demo/
├── apps/
│   ├── fitness/
│   │   └── config.yml          # Fake users: Alex, Jordan, Riley
│   ├── tv/
│   │   └── config.yml          # Demo Plex library config
│   ├── interstitial/
│   │   └── config.yml          # Demo pools config
│   ├── nutrition/
│   │   └── config.yml
│   └── journaling/
│       └── config.yml
├── adapters/
│   ├── plex.yml                # Demo Plex server
│   └── immich.yml              # Demo Immich album
└── userdata/
    ├── nutrition/              # Synthetic meal logs
    ├── journaling/             # Synthetic journal entries
    └── fitness/
        └── sessions/           # Synthetic session history
```

### Routing

`householdResolver.mjs` already supports domain-based routing:

```yaml
domain_mapping:
  "demo.daylightstation.app": "demo"
  "localhost:3111": "demo"
```

Or query param override for recording: `?household=demo`

### Demo Content Sources

| Content | Source | Notes |
|---------|--------|-------|
| **Plex library** | Public domain films from archive.org | Separate library or playlist |
| **Immich album** | CC0/Unsplash "family" photos | 20-50 images |
| **Fitness videos** | Public domain exercise content | Or blur real content |
| **Nutrition logs** | AI-generated synthetic data | 2-4 weeks of meals |
| **Journal entries** | AI-generated reflections | 2-4 weeks |
| **Fitness sessions** | Synthetic YAML files | 10-20 historical sessions |

### Deliverables

- [ ] `household-demo/` directory structure
- [ ] Demo user profiles (Alex, Jordan, Riley)
- [ ] Demo Plex library with public domain content
- [ ] Demo Immich album with CC0 photos
- [ ] Synthetic historical data for cold-start domains
- [ ] Routing configuration for demo household

---

## Phase 3: Fitness Simulation Hardening

**Goal:** Make FitnessApp demo-able without physical ANT+ hardware.

### Current State

`_extensions/fitness/simulation.mjs` exists with:
- WebSocket connection to DaylightStation
- Synthetic HR data with phased waveforms
- Multi-device support
- Config-based device/user mappings

### Gaps

- Hardcoded to real household config
- No demo user profiles
- No session lifecycle simulation
- No scenario scripting for predictable demos

### Demo Users

```yaml
# household-demo/apps/fitness/config.yml
users:
  primary:
    - id: alex
      name: Alex
      zones:
        zone1: { min: 100, max: 120, color: "#3498db" }
        zone2: { min: 120, max: 140, color: "#2ecc71" }
        zone3: { min: 140, max: 160, color: "#f1c40f" }
        zone4: { min: 160, max: 180, color: "#e74c3c" }
    - id: jordan
      name: Jordan
  secondary:
    - id: riley
      name: Riley

devices:
  heart_rate:
    "12345": alex
    "12346": jordan
    "12347": riley
```

### Scenario Support

```javascript
// simulation-scenarios.mjs
export const scenarios = {
  "quick-demo": {
    duration: 120,
    phases: [
      { name: "warmup", duration: 30, hrRange: [95, 115] },
      { name: "work", duration: 60, hrRange: [130, 165] },
      { name: "cooldown", duration: 30, hrRange: [100, 120] }
    ],
    events: [
      { at: 90, type: "voice-memo-prompt" }
    ]
  },
  "full-workout": {
    duration: 1800,
    phases: [ /* ... */ ]
  }
};
```

### Invocation

```bash
# CLI
node _extensions/fitness/simulation.mjs --household=demo --scenario=quick-demo

# API (already partially exists)
POST /api/v1/fitness/simulate
{
  "household": "demo",
  "scenario": "quick-demo",
  "users": ["alex", "jordan"]
}
```

### Reliability Improvements

- **Deterministic seeding** — Same scenario = same curves (for retakes)
- **Graceful dropout/reconnect** — Simulate sensor dropouts
- **Visible coin accumulation** — Coins increment during demo
- **Clear zone transitions** — Movement through HR zones is visible

### Historical Data

Pre-generate 10-20 sessions in `household-demo/userdata/fitness/sessions/`:

```yaml
# 20260115-morning.yml
sessionId: "20260115093000"
participants:
  - profileId: alex
    name: Alex
    duration: 1800
    calories: 320
    zones:
      zone1: 180
      zone2: 600
      zone3: 720
      zone4: 300
voiceMemos:
  - timestamp: 1800
    transcript: "Great workout today, felt strong on the hills."
```

### Deliverables

- [ ] `simulation.mjs` updates: household flag, scenario support, deterministic mode
- [ ] `simulation-scenarios.mjs` with scripted scenarios
- [ ] `household-demo/apps/fitness/config.yml` with demo users
- [ ] `household-demo/userdata/fitness/sessions/*.yml` historical data
- [ ] API endpoint hardening for `/api/v1/fitness/simulate`

---

## Phase 4: Immich Interstitials

**Goal:** Build the "aha moment" — family photos between Plex content.

**Design Document:** `docs/roadmap/2026-01-30-interstitial-design.md`

### Summary

The interstitial system is backend-centric:
1. Episode ends
2. Frontend calls `POST /api/v1/interstitial/next`
3. Backend evaluates policies, returns interstitial or null
4. Frontend plays interstitial as queue item
5. After interstitial, next episode plays

### MVP Scope (for demo)

Focus on **Phase 1 + Phase 4** from the design doc:

**Phase 1 (Core Infrastructure):**
- [ ] `1_domains/interstitial/` — InterstitialItem entity, ContentPool value object
- [ ] `3_applications/interstitial/InterstitialService.mjs` — Core orchestration
- [ ] `3_applications/interstitial/ports/ContentPoolPort.mjs` — Pool interface
- [ ] `3_applications/interstitial/pool-adapters/PlexPoolAdapter.mjs` — Plex playlist source
- [ ] `4_api/v1/routers/interstitial.mjs` — POST /next endpoint
- [ ] Basic frequency logic (every N items)
- [ ] Session tracking (don't repeat recent interstitials)

**Phase 4 (Immich Source):**
- [ ] `3_applications/interstitial/pool-adapters/ImmichPoolAdapter.mjs`
- [ ] Immich API integration for random photo from album
- [ ] Image display in frontend (duration-based advancement)

### Demo Configuration

```yaml
# household-demo/apps/interstitial/config.yml
interstitial:
  enabled: true
  pools:
    demo-photos:
      source: immich
      album: demo-family-album-id
      priority: 1
  defaults:
    frequency: every_n_items
    n: 2
    duration_seconds: 8
```

### Deliverables

- [ ] InterstitialService with pool adapter pattern
- [ ] ImmichPoolAdapter for photo retrieval
- [ ] PlexPoolAdapter for video interstitials (optional for MVP)
- [ ] `POST /api/v1/interstitial/next` endpoint
- [ ] Frontend integration in TVApp/Player
- [ ] Demo Immich album with CC0 photos
- [ ] Demo household interstitial config

---

## Phase Sequence

```
Phase 1 (README)          ─────────────────────────────▶  Can start immediately
                                                          Low dependency

Phase 2 (Demo Household)  ─────────────────────────────▶  Infrastructure for 3 & 4
                                                          Creates household-demo/

Phase 3 (Fitness Sim)     ────────────────▶               Depends on Phase 2
                                                          Parallel with Phase 4

Phase 4 (Interstitials)   ────────────────▶               Depends on Phase 2
                                                          The "aha moment"

                          ────────────────────────────────────────────────────▶
                          Week 1           Week 2         Week 3         Demo Video
```

### Recommended Order

1. **Phase 1** — Start immediately (low effort, high impact)
2. **Phase 2** — Create scaffolding (enables 3 & 4)
3. **Phase 3 & 4** — Parallel work
4. **Demo video** — After 3 & 4 complete

---

## Success Criteria

### For Demo Video
- [ ] TVApp plays public domain content from demo Plex library
- [ ] Immich interstitials appear between episodes with CC0 "family" photos
- [ ] FitnessApp runs with simulated HR data for demo users
- [ ] No real family data or licensed content visible
- [ ] Philosophy is clearly articulated in README

### For r/selfhosted Launch
- [ ] Compelling README with clear value proposition
- [ ] Demo video showing the unique experience
- [ ] Basic setup instructions (Docker-focused)
- [ ] Clear "what you need" prerequisites
- [ ] Link to discussion/feedback channel

---

## Open Questions

1. **Demo instance hosting?** — Should there be a live demo at demo.daylightstation.app?
2. **Setup complexity reduction?** — Can we simplify first-run experience post-launch?
3. **Community channel?** — Discord? GitHub Discussions? Matrix?
4. **Contributor docs?** — What's needed to enable first PRs?

---

## Related Documents

- [Interstitial Design](../roadmap/2026-01-30-interstitial-design.md) — Full interstitial architecture
- [Gatekeeper Domain Design](../roadmap/2026-01-30-gatekeeper-domain-design.md) — Policy engine
- [Backend Architecture](../reference/core/backend-architecture.md) — DDD layer structure

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-30 | Initial plan from brainstorming session |
