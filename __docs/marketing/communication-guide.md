# Daylight Station Communication Guide

A meta-document for crafting future communications about Daylight Station. This is not marketing copy itself, nor a style guide, but direction on what to lead with, what to emphasize, how to tell the story, and how to avoid common pitfalls.

---

## The Core Metaphor: Refinery

**Use "refinery" not "orchestration," "dashboard," or "aggregator."**

Why this works:
- **Implies transformation** — Raw inputs become refined outputs (not just displayed)
- **Implies accountability** — Refineries have purity standards; the system serves *your* intent
- **Implies flow** — Data is wet, streaming, being processed in real-time
- **Implies purpose** — Refineries produce fuel; this produces actionable wellness signals

The full tagline: **"A self-hosted data refinery for an intentional life."**

### The Refinery Process

When explaining what Daylight Station does, frame it as stages:

| Stage | What Happens | Example |
|-------|--------------|---------|
| **Ingest** | Pull raw data from many sources | Calendar, Strava, Withings, Plex, Home Assistant |
| **Refine** | Filter noise, add context, synthesize | Combine workout video + live heart rate + location |
| **Deliver** | Push to the right tap at the right moment | Garage kiosk, thermal printer, Telegram bot |

This is not just aggregation (showing things side by side). It's transformation into high-purity signal.

---

## The Architecture: One Backbone, Many Taps

**The central insight: you control the "last mile."**

The "last mile" is where data meets your eyes, your hands, your environment. Commercial apps own this layer and use it to extract attention. Daylight Station returns control to you.

### What "Taps" Are

A "tap" is any output modality that draws from the refined data. **Do not default to "screens" or "dashboards."**

Taps include:
- Room-specific kiosks (garage, office, kitchen)
- TV overlays (PIP maps, photo interstitials)
- Thermal printer (morning receipt, fitness workout summary, gratitude reminders)
- Telegram bots (Nutribot, Journalist, Homebot)
- Push notifications / WebSocket
- Ambient lighting (via Home Assistant)
- Voice assistants (future)
- E-ink displays (future)
- Phone calls via Twilio (future)

When describing the system, always mention at least 2-3 different tap types to convey the breadth.

### "One Backbone" Means Single Truth

The refinery is the single source of truth. Every tap draws from the same refined data pool. This is what enables synthesis across domains—your fitness data can appear during your morning receipt, your calendar can influence your TV app, your location can trigger ambient lighting.

---

## The Problem Statement(s)

Daylight Station solves several related problems. Lead with whichever resonates with your audience.

### Problem 1: Context Collapse (For Self-Hosters)

Your digital life happens on a single 6-inch screen. Your gym, office, family time, and entertainment all compete for the same attention span. This creates anxiety because your brain never switches modes.

**The insight:** Daylight Station re-tethers digital actions to physical locations. The garage is for workouts. The printer is for morning ritual. The TV is for family time. When you leave the room, the device doesn't follow you.

### Problem 2: Attention Economy (For Privacy-Conscious)

Commercial apps are designed to extract attention, not serve it. Post-honeymoon-period, every feature is optimized for engagement metrics, not user wellness. Algorithms radicalize, doomscrolling replaces intentional action.

**The insight:** By owning the last mile, you write the algorithm. Your feed includes family photos. Your notifications are filtered by *your* priorities. The system grounds you in reality instead of extracting you from it.

### Problem 3: Data Silos (For Power Users)

You have 20 services, 20 browser tabs, 20 subdomains bookmarked. The data exists but doesn't talk to itself. Your workout video doesn't know about your heart rate sensor. Your calendar doesn't influence your ambient lighting.

**The insight:** Daylight Station bridges the gaps. It's the synthesis layer that makes [Plex + Home Assistant + Strava] more valuable together than apart.

### Problem 4: Value Trapped in Bookmarks (For Self-Hosters)

You've done the hard work of self-hosting. But most of those services sit idle behind bookmarks you rarely visit. The value is locked up, not realized.

**The insight:** Daylight Station shifts from "pull" (you remember to check) to "push" (it surfaces what matters). Your services stop being a database and start being an advisory system.

---

## What NOT to Say

### Don't say "yet another dashboard"

Dashboards are passive. They display. They wait for you to look. Daylight Station is active—it delivers the right data to the right place at the right moment.

### Don't lead with integrations or feature lists

"It integrates with Plex, Home Assistant, Strava, Todoist, Google Calendar, Withings, Buxfer, Immich, LastFM, FreshRSS..."

This sounds like a data aggregator. It misses the *why*. Lead with the experience, not the inputs.

### Don't frame it as a "self-hosted wrapper"

Daylight Station pulls from both self-hosted services (Plex, Immich, Home Assistant) AND cloud APIs (Strava, Google, Withings, Todoist). It's not a replacement for cloud services—it's a synthesis layer that includes them.

### Don't be abstract

"A context-aware data synthesis platform for wellness-oriented signal delivery" means nothing. Show what it *does*: "Your garage kiosk shows your heart rate over your workout video, then prompts you for a voice memo when you stop."

### Don't claim to replace phones

The phone isn't going away. The goal is to make the phone less necessary for daily life, not to eliminate it. Frame it as "your phone becomes optional for routine tasks" not "you don't need a phone."

---

## What TO Emphasize

### Lead with the day, not the features

The most effective narrative is: "Here's what a day looks like with Daylight Station."

- **Morning:** Thermal receipt-paper with weather, calendar, accountability nudges. No screen.
- **Midday:** Office kiosk shows next meeting, spending trends. Peripheral vision, no active checking.
- **Evening:** Garage display plays workout video with live heart rate overlay. Voice memo prompt when you stop.
- **Night:** TV shows family photos between episodes. PIP map when Dad is 5 minutes away.

This "follow the data through the day" approach makes the value tangible without listing features.

### Emphasize the physical over the digital

The thermal printer receipt is more compelling than a dashboard. The wall-mounted kiosk is more interesting than a web app. The voice memo prompt is more engaging than a form.

Daylight Station feels different because it exists in physical space, not just on a screen.

### Emphasize what you DON'T see

Half the value is in what doesn't happen:
- No notifications competing for attention
- No ads, no algorithms optimized for engagement
- No context switching between apps
- No need to "check" anything—it's just there

### Emphasize synthesis across domains

The magic is in the connections:
- Your workout video + your heart rate data
- Your calendar + your TV (PIP arrival notifications)
- Your RSS feed + your family photos (grounded scrolling)
- Your sleep data + your morning receipt

Single-domain features are table stakes. Cross-domain synthesis is the differentiator.

---

## Narrative Techniques That Work

### "Optimizing for Next" vs "Optimizing for Latest"

Commercial media optimizes for *latest*—whatever is new, to keep ad inventory fresh. Daylight Station can optimize for *next*—what's next in a course, a workout plan, a reading list.

This shifts from a **consumer mindset** (reactive to the world) to a **curriculum mindset** (proactive execution of a plan).

### "Spatial Computing Without the Headset"

You're building a world where digital actions are tied to physical locations. The garage is for workouts. The kitchen kiosk is for recipes and family scheduling. The thermal printer is for morning ritual.

This is the promise of spatial computing—context-aware interfaces—without requiring a VR headset or augmented reality glasses.

### "Intentional Friction"

Most software strives for frictionless experiences to keep you hooked. Daylight Station intentionally injects friction:
- Family photos interrupt your doomscroll
- Voice memo prompt demands active reflection after passive video consumption
- Time-on-feed warnings remind you you've been scrolling

The system uses the mechanics of the attention economy but hacks them to ground you instead of extract you.

### "The Butler, Not the Cockpit"

Home Assistant is a cockpit—lots of dials, switches, and graphs. It assumes you want to be a pilot. Daylight Station is a butler. It assumes you want to live your life, and it only interrupts when the data suggests it can add value.

---

## Adapting to Audiences

### For r/selfhosted

Lead with: "You've liberated your data. Now liberate your attention."

Emphasize:
- The synthesis layer over your existing stack
- Purpose-built kiosks vs. generic dashboards
- Value realization from services you already run

Avoid: Making it sound like it replaces their stack

### For r/homeassistant

Lead with: "Home Assistant is the cockpit. Daylight Station is the experience."

Emphasize:
- The presentation layer over HA's control layer
- Spatial kiosks that aren't generic Lovelace dashboards
- Cross-domain experiences HA can't do alone (fitness + media)

Avoid: Sounding like a HA competitor

### For r/QuantifiedSelf

Lead with: "Your data exists. It just doesn't work together."

Emphasize:
- Synthesis across health, fitness, nutrition, sleep
- "Entropy reports"—accountability for goals
- The morning receipt as a tangible output of your tracking

Avoid: Feature-listing every integration

### For Hacker News

Lead with the insight: "Commercial apps own the last mile of your digital experience. What if you owned it instead?"

Emphasize:
- The architecture (refinery model, adapter pattern)
- The philosophy (reclaiming attention, spatial computing)
- What's technically interesting (DDD, multi-tap delivery)

Avoid: Marketing speak, superlatives, claims you can't back up

### For Product Hunt

Lead with: "Stop managing apps. Start living your data."

Emphasize:
- The thermal printer (it's weird and memorable)
- The workout kiosk with live HR (it's visually compelling)
- The "anti-doomscroll" concept (it's a pain point everyone has)

Avoid: Technical jargon, self-hosting prerequisites

---

## Pitfalls to Avoid

### Painting Into a Corner

Don't make claims that limit future direction:
- "Daylight Station is for self-hosters" → Limits future cloud hosting option
- "It's a fitness system" → Limits non-fitness use cases
- "It replaces X" → Creates unnecessary enemies

Instead: "Daylight Station is a data refinery that synthesizes your digital life into context-aware experiences."

### Being Too Generic

"A platform for life optimization" means nothing. Be specific:
- "Your morning starts with a thermal receipt-paper, not a phone"
- "Your workout video shows your live heart rate"
- "Your TV slips family photos between episodes"

Concrete examples > abstract descriptions.

### Overloading With Scope

The system does a lot. Don't try to explain everything at once. Pick 2-3 taps and follow the data through them. Save the full integration list for docs.

### Underselling the Vision

This isn't just another self-hosted project. It's a bet on a different relationship with technology—one where your environment serves you instead of extracting from you. Don't be afraid to articulate that ambition.

---

## Phrases to Use

| Instead of... | Say... |
|---------------|--------|
| Dashboard | Kiosk, tap, or "purpose-built interface" |
| Aggregation | Synthesis, refining, distillation |
| Orchestration | Refinery, backbone, synthesis layer |
| Display | Deliver, surface, present |
| App | Tap, experience, touchpoint |
| Check | See, receive, get |
| Manage | Live, experience, trust |

---

## The One-Sentence Versions

**For technical audiences:**
"A self-hosted data refinery that ingests from 20+ sources and delivers context-aware experiences through purpose-built taps throughout your home."

**For general audiences:**
"What if your house knew what you needed to see, and showed it to you at the right moment—without you having to check anything?"

**For the r/selfhosted pitch:**
"You've done the hard work of self-hosting. Daylight Station is the presentation layer that makes it actually useful—delivering the right data to the right screen at the right moment."

**For the philosophical pitch:**
"The attention economy owns the last mile of your digital life. Daylight Station is how you take it back."

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-29 | Initial guide created |
