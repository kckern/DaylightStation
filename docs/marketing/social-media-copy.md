# Daylight Station - Social Media Copy

A collection of platform-specific posts for launching Daylight Station.

---

## Reddit: r/selfhosted (Primary)

**Title:** Daylight Station: A self-hosted data refinery for your scattered digital life

I've been building this for a while and finally feel ready to share.

**The problem:** I self-host Plex, Home Assistant, Immich, FreshRSS. I track fitness on Strava, tasks in Todoist, weight in Withings. But all that value was trapped in 20 browser tabs. My data didn't *talk* to each other, and I was still doomscrolling on my phone.

**What I built:** Daylight Station is a "data refinery" that pulls from all these sources (self-hosted AND cloud APIs), synthesizes them, and delivers context-aware experiences to purpose-built interfaces throughout my house.

**What that actually means:**

- A **thermal printer** in my kitchen prints a morning "receipt" with today's calendar, weather, and accountability nudges ("4 days since last workout") — before I touch a screen
- A **garage kiosk** plays workout videos with my live heart rate overlaid, then prompts for a voice memo when I stop
- The **TV app** slips family photos from Immich between episodes instead of ads
- **Telegram bots** let me log meals by photo/voice ("two eggs and toast" → 340 calories logged)
- An **office dashboard** shows calendar, weather, finance trends, and entropy alerts

It's not another dashboard that shows all your data at once. It's about delivering the *right* data to the *right* screen at the *right* moment.

**Stack:** Node.js backend (DDD architecture), React frontend, Docker deployment. Pulls from Plex, Home Assistant, Strava, Withings, Google Calendar, Todoist, Immich, FreshRSS, Gmail, and more.

**Links:**
- GitHub: https://github.com/kckern/DaylightStation
- Docker Hub: https://hub.docker.com/r/kckern/daylight-station

License is Polyform Noncommercial — free for personal use.

Happy to answer questions about the architecture or specific integrations.

---

## Reddit: r/homeassistant

**Title:** I built a "presentation layer" that sits on top of Home Assistant

Home Assistant is incredible for controlling devices and automations. But I wanted something different for *displaying* information — context-aware dashboards that change based on the room and the moment.

**Daylight Station** is a self-hosted system that pulls data from HA (plus Plex, Strava, calendar APIs, etc.) and delivers it to purpose-built kiosks:

- **Office kiosk:** Calendar, weather, spending trends, "entropy alerts" (e.g., "4 days since last workout")
- **Garage kiosk:** Workout videos with live heart rate overlay via MQTT sensors, voice memo prompts after sessions
- **Kitchen printer:** A thermal receipt-paper each morning with the day's schedule and accountability nudges
- **TV:** Family photos appear between episodes; PIP shows Dad's ETA without pausing the movie

It doesn't replace HA — it uses HA as one of many data sources, then synthesizes everything into interfaces optimized for humans, not config.

Runs on Docker. If you can run HA, you can run this alongside it.

GitHub: https://github.com/kckern/DaylightStation

Anyone else building "display layers" on top of their HA setup?

---

## Reddit: r/Plex

**Title:** I built a custom Plex frontend with fitness tracking, family photos, and no ads

I love Plex, but I wanted more control over the viewing experience — especially on dedicated TVs and kiosks around the house.

**Daylight Station** wraps Plex with custom interfaces:

- **TV App:** Browse your library, but between episodes, family photos from Immich appear instead of "Up Next" promos. You control the algorithm.
- **Fitness Kiosk:** Plays workout videos from Plex with live heart rate overlay (via ANT+/Bluetooth sensors). When you stop, it prompts for a voice memo that gets attached to your workout log.
- **Interstitials:** You can inject "commercials" of your own — home videos, photo slideshows, motivational quotes — between episodes.

It uses Plex as the media backend but gives you full control over the presentation layer. Runs on Docker, talks to your existing Plex server.

GitHub: https://github.com/kckern/DaylightStation

Curious if anyone else has tried to customize the Plex viewing experience beyond what the native apps offer.

---

## Reddit: r/QuantifiedSelf

**Title:** Daylight Station: Synthesizing QS data into context-aware daily experiences

I've been tracking for years — Strava for runs, Withings for weight, Todoist for tasks, Google Calendar, sleep data, nutrition. But the data lived in silos. Checking my "stats" meant opening 10 apps.

I built **Daylight Station** to synthesize all of it and surface insights *where I actually am* throughout the day:

- **Morning thermal receipt-paper:** Printed summary of today's schedule, weather, and accountability nudges ("4 days since last run", "weight trending up")
- **Office kiosk:** Passive display showing calendar, spending, and "entropy alerts" — things drifting from my goals
- **Fitness kiosk:** Live heart rate zones during workouts, with automatic voice memo prompts for post-session reflection
- **Telegram bots:** "Two eggs and toast" → logs 340 calories with AI parsing. Daily coaching based on trends.

The philosophy: don't make me *check* my data. Deliver it to me in the right context, at the right moment, through the right interface.

Self-hosted, pulls from Strava, Withings, Google, Todoist, and more.

GitHub: https://github.com/kckern/DaylightStation

What's your setup for synthesizing data across tracking platforms?

---

## Reddit: r/homelab / r/docker

**Title:** Daylight Station: A Docker-based "data refinery" for personal/home data

Sharing a project I've been working on — a self-hosted platform that aggregates data from various sources (Plex, Home Assistant, Strava, Google Calendar, etc.) and serves it to custom interfaces throughout the house.

**Architecture:**
- Node.js backend with DDD structure (adapters → domains → applications → API)
- React frontends optimized for specific use cases (TV, fitness kiosk, office dashboard)
- MQTT for real-time sensor data (heart rate monitors, vibration sensors)
- ESC/POS thermal printer integration
- Telegram bot webhooks for mobile interaction

**What it does:**
- Pulls from ~20 different APIs (cloud + self-hosted)
- Synthesizes into a unified "lifelog"
- Delivers context-aware views to kiosks, TV, bots, and a thermal printer

Docker Compose deployment, Alpine-based image.

GitHub: https://github.com/kckern/DaylightStation
Docker Hub: https://hub.docker.com/r/kckern/daylight-station

Happy to talk architecture if anyone's interested in the DDD approach or the adapter pattern for external APIs.

---

## Reddit: r/homeautomation

**Title:** Beyond dashboards: Context-aware displays for every room

I've been deep into home automation for years, but I got frustrated with dashboards. They show everything at once. I wanted displays that show *only what matters* based on where I am and what I'm doing.

**Daylight Station** is what I built:

- **Office:** Wall tablet shows calendar, weather, and "entropy alerts" (things I'm neglecting)
- **Garage:** Fitness kiosk with workout videos + live heart rate overlay from chest strap sensors
- **Kitchen:** Thermal printer outputs a morning "receipt" — schedule, weather, reminders — no screen needed
- **Living room:** TV shows Plex content with family photos as interstitials; PIP notifications when someone's arriving home

It pulls from Home Assistant, Plex, Strava, Google Calendar, and more. The idea is "ubiquitous computing" — information embedded in your environment, not trapped in your pocket.

Self-hosted, Docker-based.

GitHub: https://github.com/kckern/DaylightStation

Anyone else doing room-specific displays beyond the typical HA dashboard tablet?

---

## Reddit: r/SideProject

**Title:** I built a "data refinery" that turns my scattered digital life into context-aware home displays

**What it is:** Daylight Station — a self-hosted platform that pulls data from everywhere (Strava, Plex, Google Calendar, Home Assistant, Todoist, etc.) and delivers it to purpose-built interfaces throughout your home.

**Why I built it:** I was drowning in apps. 20 browser tabs for 20 services. My fitness data didn't know about my calendar. My to-do list didn't know I just finished a workout. And I was still doomscrolling.

**What it does:**

- Morning thermal receipt-paper with calendar, weather, and accountability nudges
- Office kiosk with passive "entropy alerts" (things I'm neglecting)
- Garage workout display with live heart rate overlay
- TV app with family photos between episodes
- Telegram bots for meal logging and AI journaling

**The philosophy:** One data backbone, many "taps." The right information, on the right screen, at the right moment.

**Stack:** Node.js, React, Docker, ~20 API integrations

**Status:** Running in my home daily. Open-sourcing for others.

GitHub: https://github.com/kckern/DaylightStation

Would love feedback on the concept. Is "data refinery" a clear metaphor?

---

## Hacker News (Show HN)

**Title:** Show HN: Daylight Station – A self-hosted data refinery for context-aware living

I built a system that pulls data from scattered sources (Strava, Plex, Home Assistant, Google Calendar, etc.) and delivers it to purpose-built interfaces based on context — where you are, what time it is, what you need.

Examples:
- A thermal printer produces a morning "receipt" with calendar, weather, and accountability nudges before you touch a screen
- A garage kiosk overlays live heart rate on workout videos
- The TV shows family photos between episodes instead of algorithmic recommendations
- Telegram bots log meals from photos or voice ("two eggs and toast")

The core idea: instead of checking 20 apps, the right data appears on the right screen at the right moment. I call it a "refinery" because raw data goes in, and high-purity signal comes out through various "taps."

Stack: Node.js (DDD architecture), React, Docker. Pulls from ~20 APIs.

GitHub: https://github.com/kckern/DaylightStation

License: Polyform Noncommercial (free for personal use)

---

## Product Hunt

**Name:** Daylight Station

**Tagline:** A self-hosted data refinery for an intentional life

**Description:**

Your digital life is scattered — calendar in Google, runs in Strava, media on Plex, tasks in Todoist, weight in Withings, home sensors in Home Assistant. Daylight Station pulls from all of it, refines the noise into signal, and delivers context-aware experiences exactly when and where you need them.

**Key Features:**

🖥️ **Room Kiosks** — Purpose-built dashboards for office, garage, kitchen

📺 **TV App** — Plex wrapper with family photos as interstitials

🏃 **Fitness Overlay** — Live heart rate zones on workout videos

🤖 **Telegram Bots** — Log meals by photo, voice, or text

🖨️ **Thermal Printer** — A morning receipt of goals, no screen required

🏠 **Home Assistant** — Ambient lighting and automations

**The Philosophy:**

Stop checking apps. Let the right data come to you, on the right screen, at the right moment. One backbone, many taps.

**Stack:** Self-hosted, Docker, Node.js, React

**Links:**
- GitHub: https://github.com/kckern/DaylightStation
- Docker Hub: https://hub.docker.com/r/kckern/daylight-station

---

## Twitter/X Thread

🧵 I built a "data refinery" for my home. Here's what that means:

1/ Your digital life is scattered: Strava, Plex, Todoist, Home Assistant, Withings, Google Calendar. The data exists. But it doesn't *talk* to each other, and you're still checking 20 apps.

2/ Daylight Station pulls from ALL of it — cloud APIs and self-hosted services — and synthesizes it into context-aware experiences delivered throughout your home.

3/ Morning: A thermal printer in my kitchen prints a "receipt" — today's calendar, weather, and "4 days since last workout." No screen. No notifications. Just paper.

4/ Midday: The office kiosk shows my next meeting, spending trends, and entropy alerts. I don't check it. It's just *there*, keeping me honest.

5/ Evening: Garage workout. The kiosk plays a video with my live heart rate overlaid. When I stop, it prompts for a voice memo. 30 seconds of reflection, attached to today's log.

6/ Night: Family TV time. Between episodes, a photo from 3 years ago appears. Not an ad. Not an algorithm. Just our life.

7/ The philosophy: Stop checking apps. Let the right data find you, on the right screen, at the right moment.

8/ It's open source (Polyform Noncommercial). Self-hosted on Docker.

GitHub: https://github.com/kckern/DaylightStation

If you're drowning in dashboards and data silos, maybe it's time to build a refinery.

---

## Twitter/X Single Post

I built a "data refinery" for my home.

It pulls from Strava, Plex, Home Assistant, Google Calendar, and 15 other sources — then delivers context-aware data to kiosks, TV, Telegram bots, and a thermal printer.

The right info. The right screen. The right moment.

🔗 https://github.com/kckern/DaylightStation

---

## LinkedIn

**I built a system to stop checking apps.**

For years, I've tracked my life across dozens of services — Strava for runs, Todoist for tasks, Withings for weight, Plex for media, Home Assistant for my smart home.

But the value was trapped. Checking my "stats" meant opening 10 apps. My data didn't talk to each other. And despite all this tracking, I was still doomscrolling.

So I built **Daylight Station** — a self-hosted "data refinery" that:

→ Pulls from all my data sources (cloud APIs + self-hosted services)
→ Synthesizes the noise into high-signal insights
→ Delivers them to purpose-built interfaces throughout my home

Examples:
• A thermal printer produces a morning "receipt" with today's schedule and accountability nudges
• An office kiosk shows calendar, spending, and "entropy alerts" (things I'm neglecting)
• A garage display overlays live heart rate on workout videos
• The TV shows family photos between episodes instead of algorithmic recommendations

The philosophy: **One backbone. Many taps.** The right data, on the right screen, at the right moment.

It's open source for personal use: https://github.com/kckern/DaylightStation

If you're drowning in dashboards and data silos, maybe it's time to think about your "last mile."

---

## Reddit: r/datacurator / r/DataHoarder

**Title:** From data hoarding to data refining: How I turned 20 scattered services into one usable system

I've been hoarding personal data for years — fitness logs, weight history, media consumption, tasks, calendar events, location check-ins. It's all there, across Strava, Withings, Plex, Todoist, Google, and a dozen other services.

But I never *used* it. It just sat there.

**Daylight Station** is my attempt to actually *refine* that data into something useful:

- **Lifelog aggregator:** Pulls from 15+ sources into a unified timeline
- **Entropy reports:** Flags things I'm neglecting ("4 days since last workout")
- **Morning receipt:** Thermal printer outputs today's schedule and accountability nudges
- **Context-aware kiosks:** Different rooms show different data based on what I need there

The idea is to move from "I have the data" to "the data works for me."

Self-hosted, Docker-based, pulls from APIs + self-hosted services.

GitHub: https://github.com/kckern/DaylightStation

Anyone else trying to actually *use* all the data you've been hoarding?

---

## Reddit: r/productivity

**Title:** I built a system that surfaces my data instead of making me check apps

The productivity paradox: the more tools you use, the more time you spend managing tools instead of being productive.

I had tasks in Todoist, calendar in Google, fitness in Strava, weight in Withings. Checking my "status" meant opening 5 apps. So I built something different.

**Daylight Station** pulls from all those sources and delivers context-aware information to displays throughout my home:

- **Morning:** A thermal printer outputs today's schedule, weather, and "entropy alerts" (things I'm neglecting) — before I touch a screen
- **Office:** A wall kiosk shows calendar, overdue tasks, and spending trends. I don't check it; it's just there
- **Workout:** The garage display shows my heart rate zones during exercise, then prompts for a reflection memo

The philosophy: **Don't check your data. Let your data find you.**

It's self-hosted (Docker) and open source.

GitHub: https://github.com/kckern/DaylightStation

Has anyone else tried to reduce "app checking" by making data more ambient?

---

## Reddit: r/Telegram

**Title:** I built Telegram bots that log meals and journal entries using AI

Part of a larger project, but figured this community might appreciate the Telegram integration.

**Nutribot:** A meal-logging bot that accepts:
- Text ("two eggs and toast") → AI parses into calories/macros
- Voice memos → Transcribed and parsed
- Photos → AI identifies food and estimates portions
- UPC barcodes → Looks up nutrition data

It gives daily coaching based on trends and lets you revise entries conversationally.

**Journalist:** An AI journaling bot that:
- Knows what you did today (from calendar, fitness, location data)
- Prompts you with specific questions based on your day
- Stores entries in a private, self-hosted database

Both are part of **Daylight Station**, a self-hosted "data refinery" that synthesizes personal data from many sources.

GitHub: https://github.com/kckern/DaylightStation

The bots use OpenAI/Claude APIs for parsing. Happy to share implementation details if anyone's interested.

---

## Reddit: r/Strava

**Title:** I built a system that overlays Strava zones on workout videos

I track outdoor runs on Strava, but for indoor workouts I use fitness videos from my Plex library. I wanted to see my heart rate zones *on screen* while exercising, like a Peloton but with my own content.

**Daylight Station** connects to heart rate sensors (ANT+/Bluetooth via MQTT) and overlays live zone data on workout videos:

- Zone 1-5 indicators based on your HR thresholds
- Multi-participant support (family members working out together)
- Post-workout voice memo prompt for reflection
- Syncs workout data back to your training log

It also pulls your Strava history for "entropy alerts" — if it's been too long since your last run, the office kiosk reminds you.

Self-hosted, Docker-based.

GitHub: https://github.com/kckern/DaylightStation

Anyone else doing DIY fitness tracking setups?

---

## Mastodon / Fediverse

I built a "data refinery" for my home.

It pulls from Strava, Plex, Home Assistant, calendars, and more — then delivers context-aware data to room-specific kiosks, a thermal printer, and Telegram bots.

The philosophy: Stop checking apps. Let the right data find you.

→ Morning: Thermal receipt-paper with schedule + accountability nudges
→ Office: Passive kiosk with calendar + entropy alerts
→ Garage: Workout video with live heart rate overlay
→ TV: Family photos between episodes

Self-hosted, open source (Polyform NC).

https://github.com/kckern/DaylightStation

#selfhosted #homelab #quantifiedself #homeautomation

---

## Dev.to / Hashnode (Technical Blog Post Intro)

**Title:** Building a "Data Refinery" Architecture: How I Synthesize 20 APIs Into Context-Aware Home Displays

Most personal data projects stop at "aggregation" — pull data from APIs, dump it in a database, maybe show it on a dashboard.

I wanted something different: **context-aware delivery**. The right data, on the right screen, at the right moment. Not a dashboard that shows everything, but a system that knows *where I am* and *what I need*.

This post covers the architecture of **Daylight Station**, a self-hosted platform I built to do exactly that.

**The Stack:**
- Node.js backend with Domain-Driven Design (adapters → domains → applications → API)
- React frontends optimized per use case (TV, fitness kiosk, office dashboard)
- MQTT for real-time sensor data
- ESC/POS thermal printer integration
- Telegram webhooks for bot interactions

**Key Concepts:**
- The "refinery" metaphor: raw data in, refined signal out
- "Taps" as output modalities (screens, printer, bots, notifications)
- Context-awareness through room-specific interfaces

[Continue reading →]

GitHub: https://github.com/kckern/DaylightStation

---

## Reddit: r/ADHD

**Title:** I built a system that externalizes my accountability because my brain won't

ADHD tax: I have 20 apps tracking 20 things, and I check none of them. Out of sight, out of mind. My Strava knows I haven't run in a week, but *I* don't know because I never open Strava.

So I built **Daylight Station** — a system that puts my accountability *in my face* without requiring me to remember to check anything.

**How it works:**

- **Office wall kiosk:** Shows "entropy alerts" — things drifting from my goals. "4 days since last workout" is literally on the wall, staring at me.
- **Morning thermal receipt-paper:** Prints automatically. Today's calendar, weather, and nudges. I can't forget to check it because it's *physical paper* next to the coffee maker.
- **Telegram bot nudges:** "You haven't logged dinner" appears in my messages without me initiating.

The philosophy: **externalize the executive function.** Make the environment do the remembering.

It's self-hosted (I know, ironic that I finished building it) and open source.

GitHub: https://github.com/kckern/DaylightStation

Any other ADHD'ers building systems to compensate for working memory?

---

## Reddit: r/getdisciplined

**Title:** I built an "accountability environment" instead of relying on willpower

I kept failing at habits because I relied on *remembering* to check my progress. I'd set up Strava, Todoist, Withings — all the tracking — then never look at it.

**Daylight Station** flips the model. Instead of me checking apps, the data comes to me:

- **Morning receipt:** A thermal printer outputs today's schedule and "entropy alerts" — things I'm neglecting. It's physical. I can't swipe it away.
- **Office kiosk:** Wall-mounted display showing calendar, spending trends, and "4 days since last workout." It's *in my environment*, not hidden in my phone.
- **Post-workout prompt:** When I finish a video, it immediately asks for a voice memo reflection. No friction. No "I'll log it later."

The idea: **build the accountability into the environment** so discipline becomes ambient, not effortful.

Self-hosted, Docker-based. Open source.

GitHub: https://github.com/kckern/DaylightStation

What environmental systems have you built to reduce reliance on willpower?

---

## Reddit: r/digitalminimalism

**Title:** I built a system to reclaim my attention from apps

The irony of digital minimalism: we use apps to track our lives, then those apps compete for our attention with notifications, algorithms, and engagement tricks.

I wanted the *data* without the *distraction*. So I built **Daylight Station**.

**The philosophy:**

Instead of checking 20 apps on my phone, the data comes to *me* through calm, purpose-built interfaces:

- **Thermal printer:** A morning "receipt" with today's schedule and reminders — on paper, not a screen
- **Wall kiosk:** Passive display in my office. I don't interact with it; it just shows what matters
- **TV interstitials:** Family photos between episodes instead of algorithmic recommendations
- **No notifications:** Alerts only where I've explicitly placed a "tap"

The phone stays in the drawer. The data is *in the environment*.

Self-hosted, so no company is monetizing my attention.

GitHub: https://github.com/kckern/DaylightStation

Anyone else building "calm technology" alternatives to attention-grabbing apps?

---

## Reddit: r/nosurf

**Title:** I replaced doomscrolling with a "grounded" feed I control

I couldn't quit scrolling entirely. But I could change *what* I scroll.

**Daylight Station** includes a custom feed that mixes external content (RSS, Reddit) with *my own reality*:

- Every few posts, a family photo from my library appears
- Reminders: "You haven't logged dinner"
- Weight trend: "Down 2 lbs this month"
- Calendar: "Dentist tomorrow at 2pm"

The algorithm is mine. It keeps me *grounded* in my actual life while giving me the novelty hit I apparently need.

Plus, if I've been scrolling too long, it can show: "You've been here 10 minutes."

Part of a larger self-hosted system that synthesizes data from everywhere.

GitHub: https://github.com/kckern/DaylightStation

The "anti-doomscroll" feed is still in development, but the infrastructure is there.

---

## Reddit: r/MiniPCs

**Title:** Using mini PCs as dedicated room kiosks for a custom dashboard system

I've deployed several mini PCs around my house as dedicated kiosk displays, each with a different purpose:

- **Office (Beelink SER5):** Wall-mounted behind a monitor. Shows calendar, weather, finance trends, and "entropy alerts" — things I'm neglecting.
- **Garage (Intel NUC + touchscreen):** Fitness kiosk with workout videos, live heart rate overlay via ANT+ USB dongle, voice memo capture post-workout.
- **Living room (mini PC behind TV):** Custom TV interface with Plex, family photo interstitials, PIP notifications.

They all connect to **Daylight Station**, a self-hosted backend running on a separate server that aggregates data from ~20 sources and serves context-aware views to each kiosk.

**Why mini PCs over Raspberry Pi:**
- x86 compatibility for better browser performance
- Hardware video decode for smooth 4K playback
- More headroom for React apps

**Setup per device:**
- Linux Mint or Ubuntu minimal
- Chromium in kiosk mode (auto-login, auto-start)
- Pointing to room-specific routes on the Daylight Station server

**Power consumption:** ~10-15W each, always-on.

GitHub: https://github.com/kckern/DaylightStation

What mini PCs are you running as dedicated appliances?

---

## Reddit: r/raspberry_pi

**Title:** Using Raspberry Pis as room-specific kiosks for a custom home dashboard system

I've got Pis deployed around my house running custom kiosk displays, each with a different purpose:

- **Office (Pi 4):** Wall-mounted display showing calendar, weather, finance trends, and "entropy alerts"
- **Garage (Pi 4 + touchscreen):** Fitness kiosk with workout videos, live heart rate overlay via ANT+ USB dongle, and voice memo capture
- **Kitchen (Pi Zero + thermal printer):** Prints a morning "receipt" with today's schedule and reminders

They all connect to **Daylight Station**, a self-hosted backend that pulls data from ~20 sources (Strava, Plex, Google Calendar, Home Assistant, etc.) and serves context-aware views to each kiosk.

**Stack per Pi:**
- Raspberry Pi OS Lite
- Chromium in kiosk mode (or Fully Kiosk on Android tablets)
- React frontend served from central Docker host

**Hardware integrations:**
- ANT+ USB stick for heart rate sensors
- ESC/POS thermal printer via network
- MQTT for sensor data

GitHub: https://github.com/kckern/DaylightStation

Happy to share the kiosk setup scripts if anyone's interested.

---

## Reddit: r/privacy / r/privacytoolsIO

**Title:** A self-hosted alternative to letting 20 companies track your life

I track a lot: fitness, weight, tasks, calendar, media consumption. But I hated that this data lived on 20 different company servers, each with their own privacy policy.

**Daylight Station** is my attempt to reclaim that data:

- **Self-hosted backend:** Runs on Docker in my home
- **API ingestion:** Pulls from Strava, Withings, Google, etc. — but stores locally
- **No cloud dependency:** Once ingested, the data lives on my server
- **Unified lifelog:** All my data in one place, under my control

It then displays this data through purpose-built interfaces (kiosks, thermal printer, Telegram bots) without any of it leaving my network.

The trade-off: you still need to connect to external APIs to *get* the data initially. But the synthesis, storage, and display happen entirely locally.

License is Polyform Noncommercial — free for personal use.

GitHub: https://github.com/kckern/DaylightStation

What's your setup for consolidating personal data locally?

---

## Reddit: r/MealPrepSunday / r/nutrition

**Title:** I built a Telegram bot that logs meals from photos, voice, or text

Tracking nutrition is tedious. Opening an app, searching for foods, logging portions — it's friction that kills consistency.

**Nutribot** is a Telegram bot I built that makes logging effortless:

- **Text:** "Two eggs and toast" → AI parses into 340 calories, logs it
- **Voice:** Send a voice memo describing your meal → transcribed and parsed
- **Photo:** Send a picture of your plate → AI identifies foods and estimates portions
- **Barcode:** Send a UPC photo → looks up nutrition data

It gives daily summaries and coaching based on your trends.

Part of a larger system called **Daylight Station** (self-hosted personal data platform), but the Nutribot works via Telegram so you don't need a special app.

Uses OpenAI/Claude APIs for the AI parsing. Self-hosted backend.

GitHub: https://github.com/kckern/DaylightStation

Anyone else using AI to reduce friction in nutrition tracking?

---

## Reddit: r/journaling

**Title:** I built an AI journaling bot that knows what I did today

Traditional journaling prompt: "How was your day?"
My brain: *goes blank*

So I built **Journalist**, a Telegram bot that actually knows my day and prompts me with specifics:

- "You had 3 meetings today. How did the 2pm with Sarah go?"
- "You ran 3.2 miles this morning. How did it feel?"
- "You listened to [album] for 2 hours. What drew you to it?"

It pulls from my calendar, Strava, LastFM, and other sources to build context, then asks targeted questions that are easier to answer than a blank page.

Responses are stored in a private, self-hosted database. It's building a searchable "second brain" over time.

Part of **Daylight Station**, a self-hosted platform for synthesizing personal data.

GitHub: https://github.com/kckern/DaylightStation

Has anyone else experimented with AI-assisted journaling?

---

## Reddit: r/budgeting / r/ynab

**Title:** I built a passive finance display that keeps spending visible without opening apps

I use Buxfer for expense tracking, but I rarely opened it. Out of sight, out of mind.

**Daylight Station** pulls my financial data and displays it on a wall kiosk in my office:

- **Spending chart:** Visual trend of this month vs. budget
- **Category breakdown:** Where money is going
- **Alerts:** "You're $50 over on dining this month"

I don't *check* it — it's just there, in my peripheral vision. The passive visibility keeps spending top of mind.

It's part of a larger self-hosted system that synthesizes data from many sources (calendar, fitness, media, finance) into context-aware displays.

GitHub: https://github.com/kckern/DaylightStation

The Buxfer integration is one adapter; the architecture supports adding others (YNAB, Mint, etc.).

Anyone else doing "ambient" financial displays?

---

## Reddit: r/ChatGPT / r/artificial

**Title:** I integrated AI into my home's "operating system" for journaling and meal logging

I've been building a self-hosted platform that aggregates personal data (calendar, fitness, media, etc.) and displays it on kiosks around my home.

Recently added AI integrations:

**Nutribot (meal logging):**
- Send a photo of your meal → GPT-4V identifies foods, estimates portions, logs calories
- Voice memo: "I had leftover pizza and a salad" → transcribed and parsed
- Daily coaching based on trends

**Journalist (journaling):**
- Bot knows your day (from calendar, fitness, location data)
- Prompts you with specific questions: "You ran 3 miles and had 4 meetings. How are you feeling?"
- Builds a private, searchable "second brain"

**Home control:**
- Voice commands via Telegram: "Turn off the garage lights"
- Passes to Home Assistant via API

All self-hosted. AI calls go to OpenAI/Claude APIs, but the data stays on my server.

GitHub: https://github.com/kckern/DaylightStation

What's your most useful personal AI integration?

---

## Reddit: r/simpleliving

**Title:** I built a system to reduce screen time while staying organized

I wanted the benefits of digital organization (calendar, tasks, fitness tracking) without the downsides (notifications, doomscrolling, constant screen time).

**Daylight Station** is my solution:

- **Thermal printer:** Each morning, a physical receipt prints with today's schedule, weather, and reminders. I read it with coffee. No screen.
- **Wall kiosks:** Passive displays in specific rooms. I don't interact with them; they just show what's relevant. Glance, move on.
- **No phone dependency:** The data I need is *in the environment*, not in my pocket.

The phone stays in a drawer most of the day. If I need to log a meal, I text a Telegram bot. If I need to check my calendar, I glance at the office wall.

It's self-hosted, so no company is optimizing for my "engagement."

GitHub: https://github.com/kckern/DaylightStation

Anyone else building systems to get the benefits of digital tools without the attention cost?

---

## Reddit: r/Oura / r/whoop

**Title:** Integrating ring/band data into a whole-home display system

I use biometric tracking (heart rate, HRV, sleep) and wanted to surface that data *outside* the app — on displays throughout my house.

**Daylight Station** is a self-hosted platform I built that:

- Pulls health data via APIs (Strava, Withings — Oura/Whoop could be added)
- Displays "entropy alerts" on a wall kiosk: "HRV down 15% this week"
- Includes recovery data in morning thermal receipt-paper
- Overlays live heart rate on workout videos in the garage

The idea: stop checking an app for your health data. Make it ambient.

Currently has integrations for Strava and Withings. The architecture is adapter-based, so adding Oura/Whoop would be straightforward.

GitHub: https://github.com/kckern/DaylightStation

Would there be interest in an Oura adapter? Happy to prioritize if people would use it.

---

## Reddit: r/Strava

**Title:** I built a system that overlays Strava zones on workout videos

I track outdoor runs on Strava, but for indoor workouts I use fitness videos from my Plex library. I wanted to see my heart rate zones *on screen* while exercising, like a Peloton but with my own content.

**Daylight Station** connects to heart rate sensors (ANT+/Bluetooth via MQTT) and overlays live zone data on workout videos:

- Zone 1-5 indicators based on your HR thresholds
- Multi-participant support (family members working out together)
- Post-workout voice memo prompt for reflection
- Syncs workout data back to your training log

It also pulls your Strava history for "entropy alerts" — if it's been too long since your last run, the office kiosk reminds you.

Self-hosted, Docker-based.

GitHub: https://github.com/kckern/DaylightStation

Anyone else doing DIY fitness tracking setups?

---

## YouTube Video Script (2-3 minutes)

**[HOOK - 0:00]**

What if your house could tell you what you need to know, exactly when you need to know it?

Not through notifications. Not through apps. Through the environment itself.

**[PROBLEM - 0:15]**

I was drowning in apps. Strava for runs. Todoist for tasks. Withings for weight. Plex for media. Google for calendar. Home Assistant for my smart home.

Twenty services. Twenty browser tabs. And somehow, I was still doomscrolling on my phone instead of using any of it.

The data existed. It just didn't *work* for me.

**[SOLUTION - 0:45]**

So I built Daylight Station. I call it a "data refinery."

It pulls from all those sources — cloud APIs, self-hosted services, sensors — and synthesizes them into context-aware experiences delivered throughout my home.

**[EXAMPLES - 1:00]**

In the morning, this thermal printer in my kitchen outputs a receipt. Today's calendar. The weather. And accountability nudges: "4 days since your last workout."

No screen. No notifications. Just paper.

In my office, this wall kiosk shows my next meeting, spending trends, and things I'm neglecting. I don't check it. It's just *there*.

In the garage, the fitness kiosk plays workout videos with my live heart rate overlaid. When I stop, it prompts for a voice memo. Thirty seconds of reflection, attached to today's log.

And at night, the TV shows family photos between episodes instead of ads.

**[PHILOSOPHY - 1:45]**

The idea is: one backbone, many taps.

The same data appears in different forms depending on where I am and what I need. The right information, on the right screen, at the right moment.

**[CTA - 2:00]**

It's open source. Self-hosted on Docker. Link in the description.

If you're drowning in dashboards and data silos, maybe it's time to build a refinery.

---

## Email Newsletter Announcement

**Subject:** Introducing Daylight Station: A data refinery for your digital life

---

I've been working on something for a while, and it's finally ready to share.

**The problem:** Our digital lives are scattered across dozens of apps and services. Strava knows our runs. Todoist knows our tasks. Plex knows our media. But none of them talk to each other, and checking our "status" means opening 20 tabs.

**What I built:** Daylight Station is a self-hosted "data refinery" that pulls from all those sources — cloud APIs and self-hosted services — and delivers context-aware experiences throughout your home.

**What that looks like:**

→ A thermal printer outputs a morning "receipt" with today's calendar, weather, and accountability nudges — before you touch a screen

→ An office kiosk shows your next meeting, spending trends, and "entropy alerts" (things you're neglecting)

→ A garage display overlays live heart rate on workout videos, then prompts for a voice memo

→ The TV shows family photos between episodes instead of algorithmic recommendations

→ Telegram bots log meals from photos or voice, and help you journal with AI prompts

**The philosophy:** One backbone, many taps. The right data, on the right screen, at the right moment.

It's open source (Polyform Noncommercial) and runs on Docker.

**Links:**
- GitHub: https://github.com/kckern/DaylightStation
- Docker Hub: https://hub.docker.com/r/kckern/daylight-station

If you've been looking for a way to make your data actually *work* for you, give it a look.

— [Your name]

---

## Discord Server Announcement

**📢 Introducing Daylight Station**

A self-hosted "data refinery" that synthesizes your scattered digital life into context-aware experiences.

**What it does:**
- Pulls from 20+ sources (Strava, Plex, Home Assistant, Google Calendar, etc.)
- Delivers refined data to room-specific kiosks, TV, Telegram bots, and a thermal printer
- Shows you the right information at the right moment, without app-checking

**Examples:**
🖨️ Morning thermal receipt-paper with calendar + accountability nudges
🖥️ Office kiosk with passive "entropy alerts"
🏃 Fitness display with live heart rate overlay
📺 TV with family photos between episodes
🤖 Telegram bots for meal logging and AI journaling

**Stack:** Node.js, React, Docker

**Links:**
🔗 GitHub: https://github.com/kckern/DaylightStation
🐳 Docker Hub: https://hub.docker.com/r/kckern/daylight-station

License: Polyform Noncommercial (free for personal use)

Questions? Drop them here 👇

---

## Mastodon / Fediverse

I built a "data refinery" for my home.

It pulls from Strava, Plex, Home Assistant, calendars, and more — then delivers context-aware data to room-specific kiosks, a thermal printer, and Telegram bots.

The philosophy: Stop checking apps. Let the right data find you.

→ Morning: Thermal receipt-paper with schedule + accountability nudges
→ Office: Passive kiosk with calendar + entropy alerts
→ Garage: Workout video with live heart rate overlay
→ TV: Family photos between episodes

Self-hosted, open source (Polyform NC).

https://github.com/kckern/DaylightStation

#selfhosted #homelab #quantifiedself #homeautomation

---

## Reddit: r/datacurator / r/DataHoarder

**Title:** From data hoarding to data refining: How I turned 20 scattered services into one usable system

I've been hoarding personal data for years — fitness logs, weight history, media consumption, tasks, calendar events, location check-ins. It's all there, across Strava, Withings, Plex, Todoist, Google, and a dozen other services.

But I never *used* it. It just sat there.

**Daylight Station** is my attempt to actually *refine* that data into something useful:

- **Lifelog aggregator:** Pulls from 15+ sources into a unified timeline
- **Entropy reports:** Flags things I'm neglecting ("4 days since last workout")
- **Morning receipt:** Thermal printer outputs today's schedule and accountability nudges
- **Context-aware kiosks:** Different rooms show different data based on what I need there

The idea is to move from "I have the data" to "the data works for me."

Self-hosted, Docker-based, pulls from APIs + self-hosted services.

GitHub: https://github.com/kckern/DaylightStation

Anyone else trying to actually *use* all the data you've been hoarding?

---

## Reddit: r/productivity

**Title:** I built a system that surfaces my data instead of making me check apps

The productivity paradox: the more tools you use, the more time you spend managing tools instead of being productive.

I had tasks in Todoist, calendar in Google, fitness in Strava, weight in Withings. Checking my "status" meant opening 5 apps. So I built something different.

**Daylight Station** pulls from all those sources and delivers context-aware information to displays throughout my home:

- **Morning:** A thermal printer outputs today's schedule, weather, and "entropy alerts" (things I'm neglecting) — before I touch a screen
- **Office:** A wall kiosk shows calendar, overdue tasks, and spending trends. I don't check it; it's just there
- **Workout:** The garage display shows my heart rate zones during exercise, then prompts for a reflection memo

The philosophy: **Don't check your data. Let your data find you.**

It's self-hosted (Docker) and open source.

GitHub: https://github.com/kckern/DaylightStation

Has anyone else tried to reduce "app checking" by making data more ambient?

---

## Reddit: r/Telegram

**Title:** I built Telegram bots that log meals and journal entries using AI

Part of a larger project, but figured this community might appreciate the Telegram integration.

**Nutribot:** A meal-logging bot that accepts:
- Text ("two eggs and toast") → AI parses into calories/macros
- Voice memos → Transcribed and parsed
- Photos → AI identifies food and estimates portions
- UPC barcodes → Looks up nutrition data

It gives daily coaching based on trends and lets you revise entries conversationally.

**Journalist:** An AI journaling bot that:
- Knows what you did today (from calendar, fitness, location data)
- Prompts you with specific questions based on your day
- Stores entries in a private, self-hosted database

Both are part of **Daylight Station**, a self-hosted "data refinery" that synthesizes personal data from many sources.

GitHub: https://github.com/kckern/DaylightStation

The bots use OpenAI/Claude APIs for parsing. Happy to share implementation details if anyone's interested.

---

## Media Kit / One-Pager

**DAYLIGHT STATION**
*A self-hosted data refinery for an intentional life*

---

**What It Is**

Daylight Station is a self-hosted platform that aggregates personal data from scattered sources (cloud APIs + self-hosted services) and delivers context-aware experiences throughout your home via purpose-built interfaces.

**The Philosophy**

"One backbone, many taps." Instead of checking 20 apps, the right data appears on the right screen at the right moment. We call it a "data refinery" — raw data goes in, high-purity signal comes out.

**Key Features**

- 🖥️ Room-specific kiosks (office, garage, kitchen)
- 📺 TV app with family photo interstitials
- 🏃 Fitness overlay with live biometrics
- 🤖 Telegram bots (meal logging, AI journaling)
- 🖨️ Thermal printer for morning "receipts"
- 🏠 Home Assistant integration

**Integrations**

Inputs: Google Calendar, Todoist, Strava, Withings, Plex, Immich, Home Assistant, FreshRSS, Gmail, Buxfer, and more.

Outputs: Kiosks, TV, Telegram, thermal printer, push notifications, ambient lighting.

**Technical**

- Stack: Node.js (DDD architecture), React, Docker
- Deployment: Docker Compose, single command
- License: Polyform Noncommercial 1.0.0

**Links**

- GitHub: https://github.com/kckern/DaylightStation
- Docker Hub: https://hub.docker.com/r/kckern/daylight-station

**Contact**

[Your email / Twitter / Discord]

---

**Press Quotes (Suggested)**

"Daylight Station is what happens when a self-hoster gets tired of tab-hopping and builds a unified interface for their entire digital life."

"It's not a dashboard — it's an operating system for intentional living."

"One backbone. Many taps. The right data, on the right screen, at the right moment."
