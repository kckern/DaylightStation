# Daylight Station

**Where your apps finally meet.**

A self-hosted data refinery for an intentional life.

[Get Started on GitHub →](https://github.com/kckern/DaylightStation)

![Hero Image](images/hero-dashboard.png)

---

## The Problem

Your calendar lives in Google. Your runs live in Strava. Your weight lives in Withings. Your movies live in Plex. Your home lives in Home Assistant.

They've never been in the same room.

- **20 services** that don't know about each other
- **20 browser tabs** you cycle through like a chore
- **Zero synthesis** — your fitness data has never met your calendar
- **Doomscrolling** on apps designed to capture your attention, not serve it

The tools exist. The data exists. What's missing is the place where they finally meet.

---

## The Solution

**Daylight Station is that room.**

A self-hosted data refinery that pulls from everywhere your life already lives — cloud APIs, self-hosted services, sensors, calendars — and finally lets them work together.

When your apps meet, you get:

- A **kiosk in your office** that knows your calendar *and* your workout streak
- A **display in your garage** that overlays your heart rate on workout videos
- A **thermal printer in your kitchen** that gives you the morning briefing *before* you touch a screen
- A **Telegram bot** that logs meals from a photo *and* coaches you based on your trends
- A **TV app** that slips family photos between episodes instead of ads

**Where your apps finally meet. One backbone. Many taps.**

---

## How It Works

```
        ┌─────────────────────────────────┐
        │           YOUR LIFE             │
        │  Calendar · Fitness · Media ·   │
        │  Tasks · Health · Home · News   │
        └───────────────┬─────────────────┘
                        │
                        ▼
        ┌─────────────────────────────────┐
        │        DAYLIGHT STATION         │
        │                                 │
        │   Ingest → Refine → Deliver     │
        │                                 │
        └───────────────┬─────────────────┘
                        │
          ┌─────────────┼─────────────┐
          ▼             ▼             ▼
     ┌─────────┐  ┌──────────┐  ┌─────────┐
     │ Kiosks  │  │   Bots   │  │ Printer │
     │   TV    │  │  Alerts  │  │  Voice  │
     └─────────┘  └──────────┘  └─────────┘
```

**Inputs:** Google Calendar, Todoist, Strava, Withings, Plex, Immich, Home Assistant, FreshRSS, Gmail, and more.

**Outputs:** Room-specific dashboards, Telegram bots, thermal printouts, TV overlays, push notifications, ambient lighting, voice assistants.

Your apps meet at Daylight Station. What comes out depends on where you are and what you need.

---

## A Day With Daylight Station

### Morning

You wake up. Instead of reaching for your phone, you grab the thermal receipt-paper from the kitchen printer:

> **Wednesday, January 29**
>
> ☀️ 45°F, clear skies
>
> **Today:** 3 meetings, dentist at 2pm
> **Overdue:** Reply to Mom's email
> **Streak:** 🏃 4 days since last run
>
> *"The chief task in life is simply this: to identify and separate matters so that I can say clearly to myself which are externals not under my control, and which have to do with the choices I actually control."* — Epictetus

No notifications. No algorithms. Just your day, on paper.

![Morning Receipt](images/morning-receipt.jpg)

---

### Midday

At your office desk, the wall-mounted kiosk shows:

- Your next meeting in 45 minutes
- Weather forecast for the afternoon
- A spending chart (you're $200 under budget this month)
- An entropy alert: "4 days since last workout"

You don't check it. It's just *there*, in your peripheral vision, keeping you honest.

![Office Kiosk](images/office-kiosk.png)

---

### Evening

You head to the garage for a workout. The fitness kiosk shows your library of workout videos. You pick one, and as it plays:

- Your heart rate appears in the corner (via chest strap sensor)
- Zone indicators show when you're in fat burn vs. cardio
- Other family members' heart rates appear if they're working out too

When you stop the video, a voice memo prompt appears: *"How did it go?"*

You speak for 30 seconds. It's attached to today's workout log.

![Fitness Kiosk](images/fitness-kiosk.png)

---

### Night

The family watches a show on the TV app. Between episodes, instead of an ad, a photo from three years ago appears: the kids at the beach.

A small notification slides in: "Dad is 5 minutes away." A map shows his route. The movie doesn't pause.

When you finally grab your phone to doomscroll, the feed isn't pure Reddit. Every few posts, you see:

- A family photo from Immich
- A reminder: "You haven't logged dinner"
- Your weight trend for the month

The algorithm is yours.

---

## What It Connects To

### Inputs

| Category | Sources |
|----------|---------|
| Calendar & Tasks | Google Calendar, Todoist, ClickUp |
| Health & Fitness | Strava, Withings, Garmin, ANT+/Bluetooth sensors |
| Media | Plex, Audiobookshelf, YouTube |
| Photos | Immich |
| Finance | Buxfer |
| News & Reading | FreshRSS, Goodreads |
| Home | Home Assistant, MQTT |
| Communication | Gmail, Telegram |

### Outputs

| Tap | Description |
|-----|-------------|
| Room Kiosks | Wall-mounted tablets with context-specific dashboards |
| TV App | Media browser with photo interstitials and PIP overlays |
| Fitness Kiosk | Workout videos with live biometric overlay |
| Telegram Bots | Meal logging, AI journaling, home control |
| Thermal Printer | Physical morning receipt |
| Home Assistant | Ambient lighting and automations |
| Push/WebSocket | Real-time alerts to any client |

---

## Get Started

Daylight Station runs on Docker. If you can run Plex, you can run this.

```bash
mkdir daylight && cd daylight
curl -O https://raw.githubusercontent.com/kckern/DaylightStation/main/docker/docker-compose.yml
curl -O https://raw.githubusercontent.com/kckern/DaylightStation/main/config/secrets.example.yml
curl -O https://raw.githubusercontent.com/kckern/DaylightStation/main/config/system.example.yml
docker-compose up -d
```

[View on GitHub](https://github.com/kckern/DaylightStation) · [Read the Docs](https://github.com/kckern/DaylightStation/tree/main/docs) · [Docker Hub](https://hub.docker.com/r/kckern/daylight-station)

---

**Daylight Station** is open source under the MIT License.

Where your apps finally meet. Built for personal use. Shared for everyone who wants their data to work together.

[GitHub](https://github.com/kckern/DaylightStation) · [Issues](https://github.com/kckern/DaylightStation/issues) · [Docker Hub](https://hub.docker.com/r/kckern/daylight-station)
