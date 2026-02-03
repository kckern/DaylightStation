# Daylight Station - Pitch Deck

A slide-by-slide outline for presenting Daylight Station. Core deck is ~10 slides; optional deep-dives can be appended based on audience.

---

## CORE DECK

---

### Slide 1: Title

**DAYLIGHT STATION**

*Where your apps finally meet.*

Alone, they're apps. At Daylight Station, they're a life.

[Your name]
[Date]

---

### Slide 2: The Problem

**Your apps have never been in the same room.**

- Calendar in Google
- Tasks in Todoist
- Runs in Strava
- Weight in Withings
- Media on Plex
- Home in Home Assistant
- Photos in Immich

**20 services. 20 browser tabs. Zero introductions.**

They all know about you. None of them know about each other.

---

### Slide 3: The Deeper Problem

**The tools that promised to help you are now competing for your attention.**

- Notifications designed to pull you back in
- Algorithms optimized for engagement, not utility
- Doomscrolling replacing intentional action

You set up tracking to improve your life.
Instead, you spend your life checking apps.

**The data exists. It just doesn't work for you.**

---

### Slide 4: The Insight

**You don't need another app. You need a place where they meet.**

Your services work. They just don't work *together*.

Strava knows your runs. Withings knows your weight. Plex knows your movies. Google knows your calendar.

**What if they finally met?**

What if the right data appeared on the right screen at the right moment — because your apps were finally in the same room?

---

### Slide 5: The Solution

**Daylight Station is where your apps finally meet.**

It pulls from everywhere your life already lives:
- Cloud APIs (Strava, Google, Todoist, Withings)
- Self-hosted services (Plex, Home Assistant, Immich)
- Sensors (heart rate, motion, MQTT)

It introduces them to each other. They start working together.

That collaboration flows to purpose-built **taps** throughout your home:
- Room kiosks
- TV overlays
- Telegram bots
- Thermal printer
- Push notifications
- Ambient lighting

**Alone, they're apps. Together, they're a life.**

---

### Slide 6: How It Works

```
┌─────────────────────────────────────────┐
│              YOUR LIFE                  │
│  Calendar · Fitness · Media · Tasks ·   │
│  Health · Home · News · Photos          │
└───────────────────┬─────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────┐
│          DAYLIGHT STATION               │
│                                         │
│   Ingest  →  Refine  →  Deliver         │
│                                         │
└───────────────────┬─────────────────────┘
                    │
      ┌─────────────┼─────────────┐
      ▼             ▼             ▼
 ┌─────────┐  ┌──────────┐  ┌─────────┐
 │ Kiosks  │  │   Bots   │  │ Printer │
 │   TV    │  │  Alerts  │  │  Voice  │
 └─────────┘  └──────────┘  └─────────┘
```

**Inputs:** 20+ sources (cloud + self-hosted)
**Processing:** Domain logic, synthesis, context-awareness
**Outputs:** Purpose-built interfaces throughout the home

---

### Slide 7: A Day With Daylight Station

**Morning**
A thermal printer outputs today's calendar, weather, and "4 days since last workout."
No screen. Just paper.

**Midday**
The office kiosk shows your next meeting and spending trends.
You don't check it. It's just there.

**Evening**
The garage display plays workout videos with live heart rate overlay.
When you stop, it prompts for a voice memo.

**Night**
The TV shows family photos between episodes.
A PIP map shows Dad's ETA without pausing the movie.

**Same data, finally together. Different moments. Always relevant.**

---

### Slide 8: What's Built

| Domain | Status |
|--------|--------|
| **Fitness** | Live HR overlay, zones, multi-participant, voice memos |
| **Nutrition** | Telegram bot: photo/voice/text → AI parsing → calorie log |
| **Journaling** | AI bot with day-aware prompts, private storage |
| **Finance** | Buxfer integration, spending charts, budget alerts |
| **Media** | Plex/Audiobookshelf wrapper, photo interstitials |
| **Lifelog** | 15+ extractors aggregating into unified timeline |
| **Home** | Home Assistant integration, ambient LED, device control |
| **Hardware** | Thermal printer, MQTT sensors, ANT+/Bluetooth |

**Running daily in a real home.**

---

### Slide 9: Architecture

**Backend (Node.js)**
- DDD structure: Adapters → Domains → Applications → API
- 20+ adapters for external services
- 15 domain modules (fitness, nutrition, finance, etc.)
- Event bus for real-time updates

**Frontend (React)**
- Purpose-built apps: Office, Fitness, TV, Health
- Optimized per context (touch kiosk, TV remote, dashboard)

**Infrastructure**
- Docker Compose deployment
- YAML-based configuration
- Multi-household support

**Extensible:** Adding a new input (adapter) or output (tap) follows established patterns.

---

### Slide 10: Vision

**Near-term:**
- Anti-doomscroll mobile feed (RSS + personal grounding)
- E-ink dashboard support
- Voice assistant integration (Alexa/Google-style, self-hosted)
- Phone call gateway for teens without smartphones

**Long-term:**
- The "private OS" for family life management
- Every screen in your home is a tap into your refined data
- AI agents with full context of your life, running locally

**The end state:**
Your apps finally work together.
Your environment works for you.

---

### Slide 11: The Ask

**For casual audiences:**
- Star the repo: github.com/kckern/DaylightStation
- Try it if you self-host
- Share feedback

**For collaborators:**
- Adapters for new services (Oura, YNAB, etc.)
- New taps (e-ink, voice, SMS)
- Documentation and onboarding

**For community talks:**
- Let's discuss the "last mile" concept
- What would you want your home to tell you?

---

## OPTIONAL DEEP-DIVES

*Append these slides based on audience interest*

---

### Deep-Dive A: Technical Architecture

**Layer 0: System**
- Bootstrap, config loading, environment setup
- Multi-household tenant support

**Layer 1: Domains**
- Fitness, Nutrition, Finance, Journaling, Health, Messaging, Content, Scheduling, Entropy, Gratitude, Lifelog, Home Automation
- Entities, services, value objects per domain

**Layer 2: Adapters**
- External APIs: Strava, Buxfer, Nutritionix, OpenAI, Anthropic
- Self-hosted: Plex, Immich, Audiobookshelf, FreshRSS, Home Assistant
- Hardware: Thermal printer (ESC/POS), MQTT sensors, TTS

**Layer 3: Applications**
- Use cases orchestrating across domains
- Nutribot: 36 use cases for meal logging flow
- Journalist: AI conversation management

**Layer 4: API**
- Express routes exposing domain functionality
- WebSocket for real-time updates
- Telegram webhook handlers

---

### Deep-Dive B: Fitness Kiosk Demo

**Hardware:**
- Mini PC or Raspberry Pi 4
- Touchscreen display (wall-mounted)
- ANT+ USB dongle for heart rate sensors

**Experience:**
1. Browse workout video library (from Plex)
2. Select video; playback begins
3. Heart rate appears in corner (live from chest strap)
4. Zone indicators: gray → blue → green → yellow → red
5. Multi-participant: family members' HR appear if they join
6. Stop video → voice memo prompt appears
7. Speak for 30 seconds → attached to workout log
8. Session data synced to lifelog

**Why it matters:**
Peloton-style experience with *your* content, *your* data, *your* control.

---

### Deep-Dive C: Nutribot Demo

**Interface:** Telegram chat

**Input methods:**
- Text: "Two eggs and toast for breakfast"
- Voice: Send voice memo describing meal
- Photo: Send picture of plate
- Barcode: Send photo of UPC code

**Processing:**
- AI parses food items and portions (GPT-4 / Claude)
- Nutritionix lookup for calorie/macro data
- Logs to personal database

**Output:**
- Confirmation with calorie count
- Daily summary on demand
- Trend-based coaching ("You're under on protein this week")

**Why it matters:**
Friction-free logging without opening an app or searching a database.

---

### Deep-Dive D: Integration Map

**Inputs (20+ sources):**

| Category | Services |
|----------|----------|
| Calendar | Google Calendar |
| Tasks | Todoist, ClickUp |
| Fitness | Strava, Garmin (via Strava) |
| Health | Withings |
| Media | Plex, Audiobookshelf, YouTube |
| Photos | Immich |
| Finance | Buxfer |
| News | FreshRSS |
| Home | Home Assistant, MQTT |
| Email | Gmail |
| Social | Reddit, GitHub, LastFM |
| AI | OpenAI, Anthropic |

**Outputs (Taps):**

| Tap | Technology |
|-----|------------|
| Room kiosks | React app on mini PC / tablet |
| TV app | React app on HTPC / Fire Stick |
| Telegram bots | Webhook handlers |
| Thermal printer | ESC/POS over network |
| Home Assistant | REST API / MQTT |
| Push notifications | WebSocket / event bus |
| Ambient LED | MQTT |

---

### Deep-Dive E: Roadmap

**Q1 2026 (Current)**
- ✅ Core platform running in production
- ✅ Fitness, Nutrition, Journaling, Finance, Media, Lifelog
- ✅ Thermal printer, Telegram bots, room kiosks
- 🔄 DDD architecture cleanup
- 🔄 Documentation for self-hosters

**Q2 2026**
- Anti-doomscroll mobile feed
- E-ink dashboard support
- Improved onboarding / setup wizard
- Community adapter contributions

**Q3 2026**
- Voice assistant integration (local wake word)
- Phone call gateway (Twilio)
- Multi-user / family profiles
- Recipe integration (Mealie)

**Q4 2026**
- Local LLM support (Ollama)
- AI agents with full life context
- Plugin system for community taps

---

### Deep-Dive F: Investment / Business Angle

**Is there a business here?**

The self-hosted version is free (Polyform Noncommercial).

Potential models if pursued commercially:

**1. Managed Hosting (SaaS)**
- "Daylight Cloud" — we run the refinery, you connect your APIs
- Privacy-conscious hosting with data sovereignty guarantees
- Target: Quantified self enthusiasts who don't want to self-host

**2. Hardware Kits**
- Pre-configured kiosk bundles (mini PC + display + sensors)
- "Daylight Fitness Kit" with ANT+ dongle and HR strap
- Thermal printer bundles with morning receipt templates

**3. Enterprise / Family Office**
- White-label "family operating system"
- Multi-property, multi-user, managed deployment
- Target: High-net-worth families, family offices

**4. Licensing**
- License the platform to smart home companies
- "Powered by Daylight Station" for context-aware interfaces

**Why it could work:**
- Growing fatigue with attention economy
- Self-hosting is booming (Plex, Home Assistant)
- No incumbent owns the "synthesis layer"

**Why it might not:**
- Niche audience (self-hosters, quantified self)
- High setup friction
- Hard to monetize "less screen time"

**Current stance:**
Building for personal use and open-source community first.
Commercial angles are speculative but documented.

---

### Deep-Dive G: Why Now?

**Confluence of trends:**

1. **Self-hosting renaissance**
   - Plex: 25M+ users
   - Home Assistant: 1M+ installations
   - Growing distrust of cloud services

2. **Quantified self maturation**
   - Oura, Whoop, Garmin, Withings mainstream
   - People have years of data — but no synthesis

3. **AI capabilities**
   - Vision models can parse meal photos
   - LLMs enable natural language logging
   - Local models make privacy-first AI possible

4. **Attention economy backlash**
   - Digital minimalism movement
   - Screen time awareness
   - Demand for "calm technology"

5. **Hardware commoditization**
   - Mini PCs under $200
   - Touchscreens under $100
   - E-ink displays becoming affordable

**The pieces exist. Someone needs to assemble them.**

---

### Deep-Dive H: Competitive Landscape

| Solution | What It Does | Gap |
|----------|--------------|-----|
| **Home Assistant** | Device control + automation | No life data synthesis |
| **Grafana / Prometheus** | Metrics dashboards | Technical, not lifestyle-oriented |
| **Exist.io** | Quantified self correlation | Cloud-only, no room context |
| **Gyroscope** | Health dashboard | Cloud-only, no self-hosting |
| **Notion / Obsidian** | Personal knowledge | Manual entry, no automation |
| **Apple Health** | Health aggregation | Walled garden, no custom taps |

**Daylight Station's position:**
The synthesis layer that connects self-hosted infrastructure (HA, Plex) with cloud APIs (Strava, Google) and delivers through context-aware interfaces.

**No one else is doing:**
- Room-specific kiosks with live data
- Thermal printer as an output modality
- AI bots that know your day and prompt accordingly

---

## APPENDIX: Speaker Notes

**For casual audiences (friends/family):**
- Lead with Slide 7 (A Day With Daylight Station)
- Skip architecture slides
- Focus on "what it feels like" not "how it works"

**For tech community (meetups, homelab):**
- Include Deep-Dive A (Technical Architecture)
- Emphasize DDD structure and extensibility
- Ask: "What integrations would you want?"

**For potential collaborators:**
- Include Deep-Dive D (Integration Map) and E (Roadmap)
- Emphasize adapter pattern and contribution opportunities
- Be specific about what help is needed

**For investment conversations:**
- Include Deep-Dive F (Business Angle) and G (Why Now)
- Be honest: this is speculative, not a pitch for funding
- Frame as "here's what could exist if someone wanted to build a company"

---

## USAGE

This deck is in `docs/marketing/pitch-deck.md`.

To present:
1. Copy relevant slides into your presentation tool
2. Add screenshots from `docs/screenshots/`
3. Append deep-dives based on audience
4. Customize speaker notes for your style

Suggested tools:
- **Reveal.js** — Markdown-native, lives in repo
- **Google Slides** — Easy sharing
- **Keynote / PowerPoint** — Polish for formal talks
- **Deckset** — Mac app, renders Markdown directly
