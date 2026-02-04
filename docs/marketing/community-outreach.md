# Daylight Station - Community Outreach Guide

> Targeted messaging for self-hosted software communities

**Last Updated:** 2026-02-03

---

## Overview

This document provides tailored messaging for reaching users of specific self-hosted services. Each section maps a Daylight Station adapter to its community, explains the value proposition, and provides ready-to-use copy.

**Strategy:** Don't pitch Daylight Station as a replacement. Position it as the **presentation layer** that makes their existing investment pay off.

---

## Community Matrix

| Service | Community | Adapter | Value Proposition |
|---------|-----------|---------|-------------------|
| **Immich** | r/immich | `gallery/immich` | Photos surface in your life, not trapped in an app |
| **Plex** | r/Plex | `content/media/plex` | Custom viewing experience with fitness overlays and interstitials |
| **Home Assistant** | r/homeassistant | `home-automation/homeassistant` | Purpose-built kiosks instead of Lovelace dashboards |
| **Audiobookshelf** | r/audiobookshelf | `content/media` | Morning briefings with your audiobook queue |
| **FreshRSS** | r/freshrss | (planned) | Grounded feed mixing news with personal data |
| **Strava** | r/Strava | `harvester/fitness/StravaHarvester` | Entropy alerts and workout accountability |
| **Todoist** | r/todoist | `harvester/productivity/TodoistHarvester` | Tasks surfaced ambient on kiosks |
| **Withings** | r/withings | `harvester/fitness/WithingsHarvester` | Health trends on morning receipt |
| **LastFM** | r/lastfm | `harvester/social/LastfmHarvester` | Listening history in AI journaling prompts |
| **Letterboxd** | r/letterboxd | `harvester/social/LetterboxdHarvester` | Watch history informs media recommendations |
| **Huginn** | r/huginn | `adapters/huginn` | DS as a presentation layer for your scenarios |
| **n8n** | r/n8n | (planned) | Bidirectional automation with cross-domain awareness |
| **Node-RED** | r/nodered | (planned) | Flow outputs rendered on purpose-built kiosks |
| **Nostr** | nostr communities | (planned) | Decentralized feed in grounded scrolling |
| **Matrix** | r/matrixdotorg | (planned) | Matrix as messaging backbone instead of Telegram |
| **Gotify/ntfy** | r/selfhosted | (planned) | Self-hosted push notifications as output tap |
| **Mastodon** | r/Mastodon | (planned) | Fediverse posts in grounded feed |
| **Navidrome** | r/navidrome | (planned) | Music library integration |
| **Jellyfin** | r/jellyfin | (planned) | Alternative media server adapter |
| **Komga** | r/komga | (planned) | Comic/manga library integration |

---

## Immich Community

### Why They Care
Immich users have invested heavily in self-hosted photo management. But photos often sit in the library, rarely surfaced outside the app. Daylight Station makes those photos **appear in daily life**.

### The Hook
> **"Your Immich library is amazing. When's the last time you actually looked at it?"**

### Value Proposition
- **TV Interstitials:** Family photos appear between Plex episodes instead of "Up Next" promos
- **Morning Receipt:** A random "on this day" photo prints with your thermal receipt
- **Kiosk Slideshows:** Kitchen display cycles through recent memories
- **AI Journaling:** "You took 47 photos at the park yesterday. What was the occasion?"

### Ready-to-Post Copy (r/immich)

**Title:** I built a system that surfaces Immich photos throughout my home

I love Immich, but I realized most of my photos were sitting in a library I rarely opened. So I built something that makes them appear *in context*:

- **TV interstitials:** Between Plex episodes, a family photo appears instead of ads. It's like commercial breaks, but with memories.
- **Morning receipt:** My thermal printer includes an "On This Day" photo with the daily summary.
- **Kitchen slideshow:** A wall display cycles through recent Immich albums while we cook.
- **AI journaling:** My journal bot knows I took 50 photos at the beach and asks about it.

The photos are still in Immich. Daylight Station just makes them *visible* without opening an app.

Part of a larger self-hosted "data refinery" that connects Immich, Plex, Home Assistant, and more.

GitHub: https://github.com/kckern/DaylightStation

Anyone else trying to get more value out of their Immich library?

---

## Plex Community

### Why They Care
Plex users have curated media libraries but are stuck with the standard Plex UI. Many want custom viewing experiences, fitness integrations, or family-friendly interstitials.

### The Hook
> **"Plex knows what you watch. Daylight Station decides how you experience it."**

### Value Proposition
- **Fitness Kiosk:** Play workout videos with live heart rate overlay (like Peloton, but your content)
- **Photo Interstitials:** Family photos between episodes replace algorithmic recommendations
- **Governed Viewing:** Kids' profiles show only approved content, with parental visibility
- **Voice Memo Prompts:** Post-workout reflection attached to your training log

### Ready-to-Post Copy (r/Plex)

**Title:** I built a custom Plex frontend with fitness tracking and family photo interstitials

I love Plex, but I wanted more control over the viewing experience—especially on dedicated TVs and kiosks.

**Daylight Station** wraps Plex with custom interfaces:

- **Fitness Kiosk:** Plays workout videos from Plex with live heart rate zones overlaid (via ANT+/Bluetooth sensors). When I stop, it prompts for a voice memo.
- **TV App:** Browse your library, but between episodes, family photos from Immich appear instead of "Up Next" promos.
- **Governed Mode:** Kids see only approved content. Parents get visibility into what's being watched.

It uses Plex as the media backend but gives you full control over the presentation layer. Runs on Docker.

GitHub: https://github.com/kckern/DaylightStation

Anyone else customizing the Plex viewing experience beyond native apps?

---

## Home Assistant Community

### Why They Care
HA users have powerful automation but often struggle with good display interfaces. Lovelace dashboards are flexible but require constant tinkering. Daylight Station offers **opinionated, purpose-built kiosks**.

### The Hook
> **"Home Assistant is the cockpit. Daylight Station is the experience."**

### Value Proposition
- **Room-Specific Kiosks:** Office shows calendar + tasks. Garage shows fitness. Kitchen shows recipes.
- **Ambient Lighting Integration:** Data triggers HA automations (workout starts → lights dim)
- **Sensor Fusion:** Heart rate from fitness sensors flows through HA MQTT
- **No Lovelace Required:** Purpose-built React UIs for each use case

### Ready-to-Post Copy (r/homeassistant)

**Title:** I built a "presentation layer" that sits on top of Home Assistant

Home Assistant is incredible for control and automation. But I got frustrated with dashboards—they show everything at once. I wanted displays that show *only what matters* based on room and moment.

**Daylight Station** is a self-hosted system that pulls from HA (plus Plex, Strava, calendar APIs) and delivers it to purpose-built kiosks:

- **Office:** Calendar, weather, spending trends, "entropy alerts" (things I'm neglecting)
- **Garage:** Workout videos with live heart rate overlay via MQTT sensors
- **Kitchen:** Thermal receipt with morning schedule—no screen needed
- **Living Room:** TV shows family photos between episodes; PIP when family member is arriving

It doesn't replace HA—it uses HA as one of many data sources, then synthesizes everything into human-optimized interfaces.

If you can run HA, you can run this alongside it.

GitHub: https://github.com/kckern/DaylightStation

Anyone else building "experience layers" on top of their HA setup?

---

## Strava Community

### Why They Care
Strava users track outdoor activities religiously but often have indoor workout gaps. They want accountability and synthesis with other life data.

### The Hook
> **"Strava knows your last run. Does your environment?"**

### Value Proposition
- **Entropy Alerts:** "4 days since last workout" appears on office kiosk
- **Indoor Workout Tracking:** Heart rate overlay on fitness videos (Peloton-style with your content)
- **Morning Accountability:** Thermal receipt includes workout streak status
- **Cross-Domain Synthesis:** Workout data informs AI journaling prompts

### Ready-to-Post Copy (r/Strava)

**Title:** I built a system that overlays heart rate zones on workout videos and nags me when I skip

I track outdoor runs on Strava, but indoor workouts were a gap. And honestly, I'd forget to check my Strava stats and let streaks slip.

**Daylight Station** fixes both:

**For indoor workouts:**
- Plays fitness videos from my Plex library with live heart rate zones overlaid (via ANT+/Bluetooth)
- Zone 1-5 indicators based on your thresholds
- Post-workout voice memo prompt for reflection

**For accountability:**
- Office kiosk shows "entropy alerts": "4 days since last run"
- Morning thermal receipt includes workout streak status
- Can't forget to check—it's literally on the wall

It pulls your Strava history via API and combines it with indoor sensor data.

Self-hosted, Docker-based.

GitHub: https://github.com/kckern/DaylightStation

Anyone else doing DIY fitness accountability setups?

---

## Audiobookshelf Community

### Why They Care
Audiobookshelf users have curated audiobook and podcast libraries. They want their listening integrated into daily routines.

### The Hook
> **"Your audiobooks are queued. Your morning alarm should know."**

### Value Proposition
- **Morning Briefing:** Alarm that plays podcast summaries and audiobook progress
- **Voice Interface:** "Continue my audiobook" via Telegram or voice assistant
- **Cross-Media Awareness:** TV app knows you're mid-series and suggests continuing

### Ready-to-Post Copy (r/audiobookshelf)

**Title:** Integrating Audiobookshelf into a whole-home "data refinery"

I use Audiobookshelf for podcasts and audiobooks, but wanted the content to surface *contextually* throughout my day.

**Daylight Station** pulls from Audiobookshelf and:

- **Morning Alarm:** Instead of a buzzer, hear a summary of your queue: "You're 3 hours into [book], 2 new episodes of [podcast]"
- **Telegram Bot:** "Continue my audiobook" → starts playback on nearest speaker
- **TV Integration:** If you fell asleep mid-episode, the TV app offers to resume

Part of a larger system that synthesizes Plex, Home Assistant, calendars, fitness tracking, and more.

GitHub: https://github.com/kckern/DaylightStation

How do you integrate Audiobookshelf into your daily routines?

---

## Todoist Community

### Why They Care
Todoist users live by their task lists but often forget to check them. They want tasks surfaced ambiently without app-checking.

### The Hook
> **"Your Todoist has 47 overdue tasks. Your wall doesn't care—until now."**

### Value Proposition
- **Kiosk Display:** Today's tasks on the office wall, no app required
- **Morning Receipt:** Overdue items printed with daily schedule
- **Entropy Alerts:** "3 items overdue" nudges on periphery displays
- **Grounded Feed:** Tasks interleaved with news and photos

### Ready-to-Post Copy (r/todoist)

**Title:** I made my Todoist tasks appear on my wall so I stop ignoring them

I'm great at adding tasks to Todoist. Less great at checking Todoist. The tasks exist, but out of sight = out of mind.

**Daylight Station** pulls from the Todoist API and surfaces tasks *in my environment*:

- **Office kiosk:** Today's tasks on a wall-mounted display. I don't check it—it's just *there*.
- **Morning receipt:** Thermal printer outputs overdue items with my daily schedule.
- **Entropy alerts:** "3 items overdue" appears in the corner of displays.
- **Grounded feed:** When I scroll news, my overdue tasks appear between posts.

The tasks stay in Todoist. But now my environment knows about them.

Part of a larger self-hosted system that connects calendars, fitness, media, and more.

GitHub: https://github.com/kckern/DaylightStation

How do you keep Todoist visible without constantly checking the app?

---

## Withings Community

### Why They Care
Withings users have weight scales, sleep trackers, and blood pressure monitors. The data exists but rarely translates to action.

### The Hook
> **"Withings knows your weight trend. Your morning coffee doesn't—until now."**

### Value Proposition
- **Morning Receipt:** Weight trend printed with daily schedule
- **Entropy Alerts:** "Weight up 3 lbs this month" on office kiosk
- **AI Journaling:** "Your sleep score was 62 last night. How do you feel?"
- **Cross-Domain Synthesis:** Sleep data + calendar + weight = health picture

### Ready-to-Post Copy (r/withings)

**Title:** Making Withings data ambient instead of trapped in an app

I have Withings scales and sleep trackers. The data is useful—when I remember to check the app, which is never.

**Daylight Station** pulls Withings data via API and makes it *visible*:

- **Morning receipt:** Thermal printer includes weight trend and sleep score with my daily schedule
- **Office kiosk:** "Weight up 2 lbs this week" in peripheral vision
- **AI journaling:** Bot knows my sleep score and asks "You slept 5 hours. What kept you up?"

The data stays in Withings. But now my environment surfaces insights without app-checking.

Part of a self-hosted system that connects fitness, media, calendars, and more.

GitHub: https://github.com/kckern/DaylightStation

How do you actually use your Withings data day-to-day?

---

## LastFM Community

### Why They Care
LastFM users track listening obsessively but rarely connect it to other life data. The scrobbles exist in isolation.

### The Hook
> **"LastFM knows you listened to [album] for 3 hours. Your journal should too."**

### Value Proposition
- **AI Journaling:** "You listened to melancholy music all day. What's on your mind?"
- **Cross-Domain Insights:** Music + calendar + mood = patterns
- **Lifelog Integration:** Listening history appears in unified timeline

### Ready-to-Post Copy (r/lastfm)

**Title:** I connected LastFM to an AI journaling bot that asks about my music

I've been scrobbling for years. The data exists, but I never *used* it for anything beyond year-end stats.

**Daylight Station** pulls LastFM scrobbles and integrates them with AI journaling:

- **Contextual prompts:** "You listened to [artist] for 4 hours yesterday. What drew you to them?"
- **Mood patterns:** Bot notices when I play melancholy music all week and asks about it
- **Unified timeline:** Listening history appears alongside calendar events, workouts, and other life data

Part of a self-hosted "data refinery" that synthesizes scattered personal data.

GitHub: https://github.com/kckern/DaylightStation

Anyone else trying to do something *with* their scrobble data?

---

## Letterboxd Community

### Why They Care
Letterboxd users log films diligently. But their watch history doesn't inform their viewing environment.

### The Hook
> **"You've logged 500 films on Letterboxd. Does your TV know?"**

### Value Proposition
- **Watch History Integration:** TV app knows what you've seen
- **AI Recommendations:** Based on your Letterboxd ratings, not algorithms
- **Cross-Media Awareness:** Your Plex library meets your Letterboxd taste

### Ready-to-Post Copy (r/letterboxd)

**Title:** Connecting Letterboxd to my home media system

I log everything on Letterboxd, but that data never influenced what my TV showed me.

**Daylight Station** pulls Letterboxd data and integrates it with my Plex setup:

- **Watch history sync:** The TV app knows what I've already seen (even if not on Plex)
- **Rating awareness:** Recommendations factor in my Letterboxd ratings
- **Unified view:** My logged films + my Plex library in one interface

Part of a self-hosted system that connects media, fitness, calendars, and more.

GitHub: https://github.com/kckern/DaylightStation

Anyone else trying to bridge Letterboxd with their media server?

---

## General Self-Hosted Community

### Why They Care
r/selfhosted users have invested in infrastructure but often don't realize the full value. Services sit behind bookmarks, rarely visited.

### The Hook
> **"You've liberated your data. Now liberate your attention."**

### Value Proposition
- **Value Realization:** Your existing services finally work together
- **No Replacement:** Adds synthesis layer, doesn't replace anything
- **Purpose-Built Interfaces:** Not another dashboard—context-aware kiosks

### Ready-to-Post Copy (r/selfhosted)

**Title:** I built a "synthesis layer" that makes my self-hosted stack actually useful

I run Plex, Immich, Home Assistant, FreshRSS. I track in Strava, Todoist, Withings. But the value was trapped—20 services, 20 bookmarks I rarely visited.

**Daylight Station** is the missing layer that makes them work *together*:

- **Morning receipt:** Thermal printer with calendar, weather, and "4 days since last workout"
- **Office kiosk:** Calendar + tasks + spending trends + entropy alerts
- **TV app:** Plex with Immich photo interstitials between episodes
- **Fitness kiosk:** Workout videos with live heart rate overlay
- **Telegram bots:** Meal logging, AI journaling, home control

It pulls from cloud APIs *and* self-hosted services. The synthesis happens locally—your data never leaves.

Stack: Node.js (DDD), React, Docker.

GitHub: https://github.com/kckern/DaylightStation

License: MIT (free for any use)

What would make your self-hosted stack more valuable?

---

## Huginn Community

### Why They Care
Huginn users build complex automation scenarios but often struggle with the "last mile" — how to surface the output in useful ways. Most scenarios end in emails or webhooks to nowhere.

### The Hook
> **"Your Huginn scenarios work. Now make them visible."**

### Value Proposition
- **Presentation Layer:** Huginn outputs appear on kiosks, thermal printer, TV
- **Cross-Domain Synthesis:** Huginn data + calendar + fitness = contextual display
- **AI Enhancement:** Route Huginn events through DS's AI agents for interpretation
- **Bidirectional (Future):** DS triggers Huginn scenarios based on domain events

### Ready-to-Post Copy (r/huginn)

**Title:** Using Daylight Station as a presentation layer for Huginn scenarios

I've been running Huginn for years — RSS aggregation, price monitoring, social scraping. But most of my scenarios ended in webhooks that went... nowhere useful.

**Daylight Station** gives Huginn scenarios somewhere to *go*:

- **Kiosk display:** My RSS aggregator scenario posts to DS, which displays headlines on my office wall
- **Thermal printer:** Price alerts print on my kitchen receipt each morning
- **Grounded feed:** Huginn-sourced content mixes with family photos and health nudges
- **AI processing:** Huginn events can route through DS's AI agents for summarization before display

The architecture uses webhooks from Huginn → DS, with optional bidirectional triggering (DS → Huginn).

See the [automation domain design](https://github.com/kckern/DaylightStation/blob/main/docs/roadmap/2026-02-03-automation-domain-design.md) for the full integration spec.

GitHub: https://github.com/kckern/DaylightStation

Anyone else building presentation layers for their Huginn output?

---

## n8n Community

### Why They Care
n8n users have powerful visual workflows but face the same "last mile" problem as Huginn users. They build automations but lack purpose-built interfaces for output.

### The Hook
> **"n8n handles the flow. Daylight Station handles the view."**

### Value Proposition
- **Webhook Sink:** n8n workflows post to DS via standardized webhook
- **Cross-Domain Awareness:** n8n data enriched with DS's calendar, fitness, location context
- **Purpose-Built Display:** Outputs go to kiosks, not generic notifications
- **Deduplication:** If you're also using native harvesters, DS deduplicates intelligently

### Ready-to-Post Copy (r/n8n)

**Title:** Building a presentation layer for n8n workflow outputs

I love n8n for building automations, but I struggled with *where* all that data should go. Email? Slack? Generic notifications?

**Daylight Station** provides purpose-built interfaces for workflow outputs:

- **Standardized webhook:** Post from any n8n workflow to `/api/v1/automation/webhook/n8n`
- **Contextual display:** Your workflow data appears alongside calendar, fitness, and other life data
- **Room-specific kiosks:** Different outputs can route to different physical displays
- **Priority-based deduplication:** If you're harvesting Strava via n8n AND native adapter, DS picks the better source

Part of a self-hosted "data refinery" that synthesizes scattered data into context-aware experiences.

GitHub: https://github.com/kckern/DaylightStation

What do you do with your n8n workflow outputs?

---

## Node-RED Community

### Why They Care
Node-RED users have visual flow programming for IoT and automation, often tightly integrated with Home Assistant. They want outputs that aren't just MQTT publishes.

### The Hook
> **"Node-RED flows → somewhere useful."**

### Value Proposition
- **MQTT Bridge:** Node-RED publishes to MQTT → DS subscribes and displays
- **Flow-Based Routing:** Different flows can target different kiosks/taps
- **Sensor Fusion:** Node-RED sensor data + DS fitness/calendar = rich context
- **HA Complement:** Works alongside existing Node-RED + HA setups

### Ready-to-Post Copy (r/nodered)

**Title:** Displaying Node-RED flow outputs on dedicated room kiosks

Node-RED is great for wiring up sensors and automations, but I wanted the *output* to be more than MQTT publishes to Home Assistant entities.

**Daylight Station** provides display surfaces for flows:

- **MQTT subscriber:** DS listens to configured topics and displays data on kiosks
- **Webhook endpoint:** `/api/v1/automation/webhook/nodered` accepts flow outputs
- **Room routing:** Different flows can target office, kitchen, or garage displays
- **Sensor synthesis:** Combine sensor data with calendar and fitness for context

Example: My temperature/humidity flow publishes to MQTT → DS displays it on the kitchen kiosk alongside today's meal plan and calendar.

Part of a larger self-hosted system that presents data from many sources.

GitHub: https://github.com/kckern/DaylightStation

How do you display Node-RED outputs beyond HA dashboards?

---

## Nostr Community

### Why They Care
Nostr users value decentralized, censorship-resistant social media. They want to consume Nostr feeds without being trapped in a single client.

### The Hook
> **"Your Nostr feed, grounded in your actual life."**

### Value Proposition
- **Grounded Feed:** Nostr posts interleaved with family photos, health nudges, calendar reminders
- **Self-Hosted Relay Client:** DS acts as a Nostr client, pulling from your preferred relays
- **Algorithm You Control:** Mix Nostr with RSS, Reddit, and personal data
- **Anti-Doomscroll:** Time limits, reality anchors between posts

### Ready-to-Post Copy (Nostr communities)

**Title:** Integrating Nostr into a "grounded" feed I control

I'm bullish on Nostr for decentralized social, but I noticed I was still doomscrolling — just on a different protocol.

**Daylight Station** includes a "grounded feed" concept that mixes external content with your actual life:

- **Nostr posts** interleaved with...
- **Family photos** from your Immich library
- **Health nudges:** "4 days since last workout"
- **Calendar reminders:** "Dentist tomorrow"
- **Overdue tasks** from your Todoist

The algorithm is yours. Nostr is one input, but it's grounded in reality. Plus, time-on-feed warnings when you've been scrolling too long.

Planning to add native Nostr relay support. Current workaround is RSS bridges or Huginn scenarios that pull from relays.

GitHub: https://github.com/kckern/DaylightStation

Anyone else trying to make social consumption more intentional?

---

## Matrix Community

### Why They Care
Matrix users have decentralized, encrypted messaging. They want Matrix to be a control plane for their digital life, not just chat.

### The Hook
> **"Matrix as your life's command line."**

### Value Proposition
- **Bot Interface:** Matrix bots for meal logging, journaling, home control
- **Bridge to Existing Bots:** If you already have bridges, DS can consume Matrix as input
- **Encrypted Logging:** Private, end-to-end encrypted journaling via Matrix
- **Self-Hosted Purity:** No Telegram dependency — use your own Synapse

### Ready-to-Post Copy (r/matrixdotorg)

**Title:** Using Matrix as the messaging backbone for a personal data system

I currently use Telegram bots for meal logging, AI journaling, and home control. But I want to move to Matrix for full self-hosted control.

**Daylight Station** (a self-hosted data refinery) currently supports Telegram, but the architecture is adapter-based — Matrix could slot in:

**Current Telegram features that would translate to Matrix:**
- **Nutribot:** "Two eggs and toast" → AI parses into calories
- **Journalist:** AI journaling with contextual prompts based on your day
- **Homebot:** "Turn off garage lights" → Home Assistant control

**Why Matrix:**
- Fully self-hosted (Synapse)
- End-to-end encryption for private journaling
- No dependency on Telegram's servers
- Bridges to other services you might already use

If there's interest, I'd prioritize a Matrix adapter.

GitHub: https://github.com/kckern/DaylightStation

Anyone interested in Matrix as a control plane for personal data systems?

---

## Jellyfin Community

### Why They Care
Jellyfin users want open-source media management but lack the ecosystem of Plex apps. They'd benefit from custom viewing experiences.

### The Hook
> **"Jellyfin's library, your viewing experience."**

### Value Proposition
- **Custom Frontend:** Purpose-built interfaces beyond Jellyfin's native UI
- **Fitness Integration:** Workout videos with live heart rate overlay
- **Photo Interstitials:** Immich photos between episodes
- **Governed Viewing:** Parental controls with visibility

### Ready-to-Post Copy (r/jellyfin)

**Title:** Building a custom Jellyfin frontend with fitness tracking and photo interstitials

I'm planning to add Jellyfin support to **Daylight Station** — a self-hosted system that wraps media libraries with custom interfaces.

**What Plex users already get:**
- **Fitness Kiosk:** Workout videos with live heart rate overlay (ANT+/Bluetooth sensors)
- **TV App:** Family photos from Immich appear between episodes
- **Governed Mode:** Kids see approved content only, parents see what's watched

The architecture is adapter-based, so adding Jellyfin alongside Plex would give users choice.

**Question for the community:** What Jellyfin-specific features would you want that Plex doesn't have? Better multi-user handling? Integration with Jellyfin's watch status?

GitHub: https://github.com/kckern/DaylightStation

Would there be interest in a Jellyfin adapter?

---

## Navidrome Community

### Why They Care
Navidrome users have self-hosted music libraries but limited options for contextual playback or integration with other life data.

### The Hook
> **"Your Navidrome library meets your life."**

### Value Proposition
- **Contextual Playback:** Morning alarm plays from your library based on mood/sleep data
- **Ambient Music:** TV app can play background music from Navidrome between content
- **Listening History:** Scrobble-equivalent for AI journaling prompts
- **Cross-Domain:** Music + fitness + mood = patterns

### Ready-to-Post Copy (r/navidrome)

**Title:** Integrating Navidrome into a whole-home music and data system

I use Navidrome for self-hosted music, but the playback is disconnected from the rest of my life.

**Daylight Station** could integrate Navidrome for:

- **Morning alarm:** Instead of a buzzer, your wake-up plays music from your library based on sleep score or mood
- **Ambient TV:** Between Plex episodes, play background music from Navidrome instead of silence
- **Listening patterns:** Track what you listen to, surface in AI journaling ("You listened to a lot of jazz this week. Feeling mellow?")
- **Workout playlists:** Auto-queue high-BPM tracks during fitness sessions

Currently supports LastFM for scrobble history. Native Navidrome/Subsonic API support would add library access.

GitHub: https://github.com/kckern/DaylightStation

Would Navidrome integration be useful for your setup?

---

## Komga Community

### Why They Care
Komga users have organized comic/manga libraries. They want reading integrated into their daily routines like other media.

### The Hook
> **"Your Komga library, surfaced where you read."**

### Value Proposition
- **Reading Progress:** "Continue reading" on relevant kiosks
- **New Releases:** Morning receipt includes new additions to library
- **Cross-Media:** Reading history + Plex + Audiobookshelf = unified media view
- **Tablet Integration:** Reading suggestions pushed to tablet displays

### Ready-to-Post Copy (r/komga)

**Title:** Surfacing Komga reading progress throughout the house

I use Komga for comics and manga, but I realized I only check it when I actively think to open it.

**Daylight Station** could integrate Komga for:

- **Continue reading:** Bedroom tablet shows where you left off
- **New additions:** Morning thermal receipt includes "3 new issues added to [series]"
- **Reading time:** Track reading like other media consumption
- **Unified library:** See comics alongside Plex shows and Audiobookshelf books

Part of a self-hosted system that synthesizes scattered data into context-aware experiences.

GitHub: https://github.com/kckern/DaylightStation

Would Komga integration be valuable? What would you want it to show?

---

## Gotify / ntfy Community

### Why They Care
Users of self-hosted notification services want to replace push notification dependencies on Google/Apple while maintaining functionality.

### The Hook
> **"Your notifications, your infrastructure."**

### Value Proposition
- **Output Tap:** DS can push to Gotify/ntfy instead of (or alongside) Telegram
- **Priority Routing:** High-priority alerts to phone, low-priority to kiosk
- **Self-Hosted End-to-End:** No cloud notification services required
- **Unified Alerting:** All DS alerts through one self-hosted channel

### Ready-to-Post Copy (r/selfhosted — Gotify/ntfy thread)

**Title:** Using Gotify/ntfy as the notification backbone for a personal data system

I've been building **Daylight Station** — a self-hosted platform that synthesizes data from many sources. Currently it outputs to Telegram bots, kiosks, thermal printer, and TV.

**Adding Gotify/ntfy support would enable:**

- **Mobile notifications without Telegram:** Entropy alerts ("4 days since workout") push to your phone via your own infrastructure
- **Priority-based routing:** Critical alerts to phone, info-level to office kiosk
- **Unified notification stream:** All DS alerts through one self-hosted channel
- **No Google/Apple FCM:** True self-hosted push

The adapter pattern makes this straightforward — Gotify/ntfy would be another "tap" like Telegram.

GitHub: https://github.com/kckern/DaylightStation

Would Gotify or ntfy integration be useful?

---

## Contribution Asks

For communities where Daylight Station could use help, lead with the contribution opportunity:

### Template
> **"We have a [Service] adapter, but it could use help from people who actually use [Service]."**

### Specific Asks

| Service | Ask | Difficulty |
|---------|-----|------------|
| **Immich** | Help refine album selection logic for interstitials | Easy |
| **Audiobookshelf** | Test integration with various library structures | Easy |
| **FreshRSS** | Build the RSS harvester adapter | Medium |
| **Komga** | Implement comic/manga library integration | Medium |
| **Calibre-Web** | Implement ebook library integration | Medium |
| **Navidrome** | Implement music library integration (Subsonic API) | Medium |
| **Jellyfin** | Implement alternative media server adapter | Medium |
| **Huginn** | Test bidirectional integration, help with event mapping | Easy |
| **n8n** | Build n8n event source adapter | Medium |
| **Node-RED** | Build MQTT/webhook integration for flow outputs | Medium |
| **Nostr** | Implement relay client for grounded feed | Hard |
| **Matrix** | Implement Matrix bot adapter (replace Telegram) | Hard |
| **Gotify/ntfy** | Implement notification output tap | Easy |
| **Mastodon** | Build ActivityPub harvester for fediverse content | Medium |

---

## Cross-Posting Strategy

### Priority Tiers

| Tier | Communities | Rationale |
|------|-------------|-----------|
| **1 - Launch** | r/selfhosted, Hacker News | Establishes legitimacy, technical audience |
| **2 - Core Self-Hosted** | r/homeassistant, r/Plex, r/immich | Existing adapters, immediate value |
| **3 - Fitness/Quantified** | r/Strava, r/QuantifiedSelf, r/withings | Strong feature differentiation |
| **4 - Productivity** | r/todoist, r/productivity, r/ADHD | Unique "ambient accountability" angle |
| **5 - Automation** | r/huginn, r/n8n, r/nodered | Bidirectional integration story |
| **6 - Decentralized** | Nostr, r/matrixdotorg, r/Mastodon | Philosophy alignment, contribution asks |
| **7 - Alt Media** | r/jellyfin, r/navidrome, r/komga | Contribution asks, roadmap interest |

### Sequencing

1. **Post to r/selfhosted first** — establishes legitimacy
2. **Post to Tier 2-3 communities** — within 1-2 weeks, with tailored messaging
3. **Post to Tier 4-5** — after addressing feedback from earlier posts
4. **Post to Tier 6-7** — frame as contribution asks, gauge interest
5. **Link back** — "Cross-posted from r/selfhosted where there's more discussion"
6. **Engage authentically** — answer questions, take feedback, don't spam

### Timing
- Stagger posts by 2-3 days minimum
- Avoid weekends for niche communities
- Post during evening hours (US time) for maximum engagement
- Post to automation communities (Huginn, n8n) after automation domain is implemented

### Fediverse Strategy

For Nostr and Mastodon communities:
- Post on the platforms themselves, not just about them
- Use hashtags: #selfhosted #homelab #quantifiedself #opensource
- Engage with replies — these communities value interaction over broadcast

---

## Changelog

| Date | Change |
|------|--------|
| 2026-02-03 | Initial community outreach guide |
