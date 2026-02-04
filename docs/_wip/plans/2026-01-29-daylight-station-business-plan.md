# Daylight Station — Business Plan (Draft)

Date: 2026-01-29

## 1) Executive Summary

**Daylight Station** is a self-hosted “data refinery” that ingests data from a person’s scattered digital services (cloud APIs + self-hosted services + sensors), refines noise into high-purity signal, and delivers context-aware experiences through “taps” distributed across the home (kiosks, TV overlays, thermal printer, bots, notifications, ambient lighting).

The differentiator is **owning the last mile**: instead of another dashboard, Daylight Station pushes the right information to the right place at the right moment—without attention-extractive design.

**Business strategy:** grow an open-source community around the self-hosted core while monetizing through a **voluntary supporter program**, optional paid products/services, and curated hardware + onboarding. The MIT license removes friction while cryptographic badge verification creates social proof incentives for supporters.

**Near-term wedge:** self-hosters, home automation enthusiasts, quantified-self users—people already running Plex/Home Assistant/Immich and feeling “value trapped in bookmarks.”

**Long-term vision:** a “private OS” for family life management where every screen in the home can become a tap into refined personal data.

---

## 2) Problem

People who invest in tracking and self-hosting still experience:

- **Context switching** across 10–20 services (tabs, apps, bookmarks)
- **Data silos** (fitness doesn’t talk to calendar; media doesn’t talk to sensors)
- **Attention capture** and doomscrolling reinforced by commercial algorithms
- **Low realized value** from services that are “set up” but rarely checked

The data exists, but the “last mile” interface is owned by commercial apps that optimize for engagement rather than user intent.

---

## 3) Solution (Product)

Daylight Station is a **refinery**:

- **Ingest:** pull raw signals from APIs, self-hosted services, and sensors
- **Refine:** normalize, synthesize, add context (time, location, household, device)
- **Deliver:** publish to context-specific “taps” in the environment

**Key product experiences (from marketing narrative):**

- **Morning receipt** (thermal printer): weather + calendar + reminders + accountability nudges
- **Office kiosk**: passive display with next event, trends, “entropy alerts”
- **Garage fitness kiosk**: workout video playback with live heart rate overlay + post-session voice memo prompt
- **TV app**: media browsing with photo interstitials + unobtrusive PIP notifications
- **Telegram bots**: meal logging/journaling/home control via voice/photo/text

**Core product promise:** “One backbone. Many taps. Always relevant.”

---

## 4) Target Customers & Use Cases

### Primary (initial wedge)

1) **Self-hosters / homelab users**
- Already run Plex/Home Assistant/Immich/FreshRSS, comfortable with Docker.
- Pain: value trapped behind bookmarks; too many “systems,” no synthesis.

2) **Home automation power users**
- Have room-specific hardware and want human-first presentation, not dashboards.
- Pain: Home Assistant is a cockpit; they want a butler.

3) **Quantified-self / wellness optimizers**
- Track fitness/nutrition/sleep; want accountability and context-driven prompts.
- Pain: data in silos; checking it becomes another task.

### Secondary (adjacent)

- Families wanting “less phone, more ambient computing”
- Privacy-focused users seeking local-first/controlled algorithms
- Small offices / studios with shared displays (non-family but still “household”)

---

## 5) Market Context & Competitive Landscape

Daylight Station is not a direct replacement for any one tool; it is a **synthesis + delivery layer**.

**Adjacent categories:**

- Home Assistant dashboards, MagicMirror, wall dashboards
- Plex frontends and media experiences
- Personal dashboards (Notion, Grafana, custom portals)
- Aggregators (IFTTT/Zapier-style) and agent tools

**Differentiation:**

- “Refinery” framing: transformation into signal, not aggregation
- “Many taps”: printer/TV/kiosks/bots/sensors, not just web dashboards
- Context-aware delivery: spatial computing without the headset
- Human-first design: intentional friction (grounding, reflection prompts)

---

## 6) Product Strategy

### Product principles

- **Push > pull** for routine awareness (surface what matters)
- **Context-aware**: room/time/activity/household
- **Human attention is sacred**: no ads, no engagement loops
- **Composable**: new inputs (adapters) and new taps are first-class

### Product packaging (conceptual)

- **Core**: refinery backbone + baseline taps
- **Packs** (optional): Fitness Pack, Family Pack, Finance Pack, etc.
- **Hardware kits**: “kiosk kit” + “printer kit” + “sensor kit” with guided setup

---

## 7) Business Model & Monetization

Daylight Station can sustain an open-source community while reserving commercial rights.

### Licensing model (updated 2026-02-04)

- **MIT License:** Free for all use — personal, commercial, enterprise, forks.
- **Voluntary Supporter Program:** Cryptographically verified badges for supporters who fund development.

This maximizes adoption by removing license friction while creating a social proof mechanism that incentivizes voluntary support. Trade-off: no legal leverage over commercial use.

**Risks accepted:**
- Forks could gain traction (acceptable — if they out-execute, they deserve to win)
- Commercial OEMs ship free (acceptable — we prefer partnerships but can't enforce them)
- No legal enforcement (acceptable — social proof via badge verification is the mechanism)

### Revenue streams (prioritized)

1) **Voluntary supporter program**
- Supporters pay $1-$50/month for verified badge, community access, and supporters page listing.
- Cryptographic verification via signed tokens — only official project can issue valid badges.
- Social proof on network: unverified users display differently than supporters.

2) **Paid onboarding & support**
- “Installation concierge” over video/SSH + configuration review
- Priority bug fixes and roadmap influence (support tiers)

3) **Hardware + kits margin**
- Curated bill of materials, pre-configured images, “known good” hardware bundles

4) **Templates / premium taps**
- Optional paid tap templates (receipt formats, dashboard layouts) or advanced device UIs

5) **Managed hosting (future optional)**
- Not required initially; could exist as a separate product once security and multi-tenant story is mature.

### Pricing (starting points; adjust after discovery)

- **Commercial license:** starting at $499–$2,500 / year depending on org size and use.
- **Support:** $49–$199 / month (community support tiers); higher for commercial SLA.
- **Setup concierge:** fixed fee (e.g., $299–$999) depending on complexity.

---

## 8) Go-To-Market (GTM)

This GTM section is about **commercial revenue**: organizations and professionals who deploy Daylight Station as part of a paid service or within a business environment.

### Commercial beachhead (who pays)

**Beachhead ICP #1: smart-home / home-theater integrators**

- Business: small-to-mid integrators who already install Home Assistant, AV, networking, wall tablets, digital signage.
- Current pain: they repeatedly build one-off “dashboard/signage” solutions that are fragile, bespoke, and hard to maintain across clients.
- Why now: clients are buying more screens, more sensors, more self-hosted services, but there is no coherent “experience layer” to unify them.

**Beachhead ICP #2: boutique fitness + wellness studios**

- Business: gyms/studios that already run video, classes, scheduling, and want modern in-room displays.
- Current pain: consumer apps don’t fit their workflow; signage tools are generic; integrations are shallow.
- Fit: the fitness kiosk + overlays + session logging are a differentiated, visually demonstrable solution.

**ICP #3 (later): co-living / hospitality / short-term rentals**

- Business: properties needing in-room “butler” displays (house rules, schedules, local info, ambient content).
- Caution: requires more admin features; treat as phase 2 once packaging is stable.

### Commercial value proposition (why a business pays)

Commercial customers pay for one of two things:

1) **Integrators pay for repeatability**
- A standard platform they can deploy across clients instead of bespoke glue.
- A predictable update path and support escalation.
- A differentiated offering that isn’t “yet another tablet dashboard.”

2) **Operators pay for outcomes**
- A context-aware display experience that improves retention/engagement in the physical space.
- A system that can be tailored without custom software development.

**Bottom line:** Daylight Station turns “custom integration work” into a repeatable product that can be sold, installed, and supported.

### Commercial product offering (what is sold)

**Daylight Station Commercial** is sold as:

1) **Commercial License (required for monetized deployments)**
- License grants the right to deploy Daylight Station as part of a paid service, client project, or within an organization.
- Includes access to commercial documentation, deployment playbooks, and update/backup runbooks.

2) **Partner Program (integrators)**
- Training + certification (lightweight at first)
- Deal registration (optional) and preferred support channel
- Reference architectures and “known good” hardware matrix

3) **Support & Services (attach revenue)**
- Tiered support (email/Slack-style channel, response windows)
- Paid implementation support for new taps/integrations
- Optional: annual “health check” and upgrade assistance

The community/self-hosted edition remains an adoption engine and credibility asset, but commercial GTM does not depend on it converting at scale.

### Packaging & pricing (commercial)

Pricing should be simple and tied to how customers create value.

**Integrator pricing (recommended):**
- **Per-deployment / per-site annual license** (integrator passes cost through)
- Optional volume discounts after N sites

**Operator pricing (studios/venues):**
- **Per location annual license** (includes a bounded number of displays/taps)

**Support attach:**
- Annual support plans (bundled hours or response windows)

Starting price anchors (validate via discovery):
- Commercial license: $1,000–$5,000 / site / year (depending on support and scope)
- Support: $2,000–$15,000 / year depending on responsiveness and customization

### Channels (commercial demand)

Commercial demand should be built via partner-led distribution plus founder-led outbound.

1) **Partner-led distribution**
- Recruit 5–20 integrators as early partners.
- Provide demo assets, a deployment kit, and a support backchannel.

2) **Founder-led outbound**
- Target integrators already selling HA/AV installs.
- Target boutique gyms/studios with a strong brand and willingness to invest in in-room experience.

3) **Credibility marketing (supports sales, not the primary funnel)**
- Case studies with photos/videos (“before/after” experience in a real space).
- Conference talks and meetups (home automation, self-hosting, maker).

### Sales motion (commercial)

Commercial sales should be structured around a fast, low-risk pilot that proves value.

**Land:**
- 2–4 week pilot with one “hero room” installation (one tap, one location, one success metric).
- Deliver a highly visual demo outcome (fitness overlay; lobby/office kiosk; printer receipt).

**Expand:**
- Add 2nd and 3rd taps after the first room is stable.
- Expand to additional rooms/locations using the same playbook.

**Renew:**
- Renewal tied to continued updates, support, and new tap templates.

### Enablement (what must exist to sell repeatedly)

Commercial GTM becomes real when the following assets exist:

- A commercial landing page: “Who needs a commercial license and why” (integrators + organizations)
- A deployment kit: reference architecture, backup/update runbook, hardware matrix
- A demo kit: short videos + a scripted in-person/Zoom walkthrough
- A partner onboarding guide and a small certification checklist

### Success metrics (commercial)

- Number of active commercial partners
- Paid pilots started → pilots completed → conversions
- Average time-to-first-successful-room (pilot)
- Attach rate of annual support
- Renewal rate and expansion rate (additional sites)

---

## 9) Product Roadmap (Business-Oriented)

This aligns with the existing internal roadmap and emphasizes what unlocks adoption.

### Phase 1: Onboarding + reliability (0–3 months)

- Reduce setup friction; add configuration validation + friendly errors
- Improve docs and “first successful tap” walkthrough
- Harden the daily-running production path (logging, diagnostics, runbooks)

### Phase 2: Expand the “wow moments” (3–6 months)

- Anti-doomscroll feed MVP (high shareability, broad appeal)
- E-ink dashboard support (ambient computing story)
- Voice assistant integration exploration (privacy-first)

### Phase 3: Monetizable packaging (6–12 months)

- Hardware kits + guided setup
- “Starter templates” library
- Support tiers + commercial licensing flow

---

## 10) Operations

### Development

- Maintain a crisp architecture boundary (adapters/domains/applications/api)
- Define an adapter + tap contribution guide (reduce contributor friction)

### Customer support

- Public issues for bugs, feature requests
- Private channel for paid support
- Publish runbooks for common ops (updates, backups, troubleshooting)

### Security & privacy posture

- Local-first by default; minimize external dependencies
- Secrets management guidance and safe defaults
- Clear data retention policies per domain

---

## 11) Key Metrics

**Adoption metrics**
- Docker pulls, GitHub stars, installs (proxy), first-tap completion rate

**Engagement metrics (non-addictive)**
- Active taps per household (kiosk+printer+bot)
- “Days without opening phone first thing” proxy (opt-in)

**Value metrics**
- Reduction in missed tasks/appointments (self-reported)
- Fitness adherence (“days since last workout” trends)

**Revenue metrics**
- Paid onboarding conversions
- Support MRR
- Commercial license ARR

---

## 12) Risks & Mitigations

- **Complexity of integrations:** mitigate via strong adapter patterns, validation, and default templates.
- **Hardware variability:** mitigate via “known-good” hardware recommendations and kits.
- **Support burden:** mitigate via docs/runbooks, community moderation, and tiered support.
- **Privacy concerns (AI features):** mitigate via local-first options and explicit opt-in.
- **Positioning confusion (“another dashboard”):** mitigate via “day in the life” demos and the refinery metaphor.

---

## 13) Next Steps (Actionable)

1) Define the **commercial license offer**: who it applies to, pricing, and purchase workflow.
2) Create a **single canonical onboarding path**: “Get a printer receipt working” or “Get an office kiosk working” in under 30 minutes.
3) Package 2–3 **showcase demos**: thermal receipt-paper, fitness overlay, TV photo interstitials.
4) Publish **contributor guides** for adapters and taps.
5) Add a lightweight **support page** describing paid onboarding/support options.

---

## Appendix A: Product Narrative (for investors/partners)

Daylight Station is about reclaiming attention. It turns the ambient environment into a user-owned interface layer, embedding personal data into physical context so life is guided by intent, not by app-checking and engagement algorithms.
