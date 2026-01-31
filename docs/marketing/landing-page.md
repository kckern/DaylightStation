# Daylight Station

### A self-hosted data refinery for an intentional life.

Your digital life is scattered across dozens of apps and services. Daylight Station pulls it all together, refines the noise into signal, and delivers it exactly when and where you need it.

[Get Started on GitHub →](https://github.com/kckern/DaylightStation)

![Hero Image](images/hero-dashboard.png)

---

## The Problem

You've tried to take control of your digital life. You self-host Plex. You track runs on Strava. You manage tasks in Todoist. You log weight in Withings. You automate your home with Home Assistant.

But the value is trapped.

- **20 browser tabs** for 20 different services
- **Context switching** every time you want to check something
- **No synthesis** — your fitness data doesn't talk to your calendar
- **Doomscrolling** on apps designed to capture your attention, not serve it

The tools exist. The data exists. What's missing is the **last mile** — an interface that delivers the right information at the right moment, without the noise.

---

## The Solution

Daylight Station is a **data refinery**. It ingests raw data from everywhere your life already lives — cloud APIs, self-hosted services, sensors, calendars — and distills it into high-purity signal.

That signal flows to **purpose-built taps** throughout your home:

- A **kiosk in your office** showing today's calendar and accountability nudges
- A **display in your garage** overlaying heart rate on workout videos
- A **thermal printer in your kitchen** producing a morning receipt of goals
- A **Telegram bot** that logs meals from a photo or voice memo
- A **TV app** that slips family photos between episodes instead of ads

**One backbone. Many taps. Always relevant.**

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

The same data appears in different forms depending on where you are and what you need.

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

**Daylight Station** is open source under the Polyform Noncommercial License.
Built for personal use. Shared for others who want to reclaim their attention.

[GitHub](https://github.com/kckern/DaylightStation) · [Issues](https://github.com/kckern/DaylightStation/issues) · [Docker Hub](https://hub.docker.com/r/kckern/daylight-station)
