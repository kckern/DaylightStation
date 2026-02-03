# Daylight Station — Where your apps finally meet.

A self-hosted data refinery for an intentional life.

Your calendar lives in Google. Your runs live in Strava. Your weight lives in Withings. Your photos live in Immich. Your comics live in Komga. Your media lives in Plex. Your home lives in Home Assistant. They've never been in the same room—until now. Daylight Station is where your scattered digital life finally comes together. Self-hosted and fully yours, it pulls your data from the cloud, refines the noise into signal, and delivers context-aware experiences exactly when and where you need them. No middleman. No algorithms optimizing for someone else's engagement metrics. Just your data, working for you.

![License](https://img.shields.io/badge/license-Polyform%20Noncommercial-blue)
![Docker Pulls](https://img.shields.io/docker/pulls/kckern/daylight-station)

## One Backbone. Many Taps.

Your morning thermal receipt-paper shows today's calendar, the weather, and "it's been 4 days since your last workout." The office kiosk displays your upcoming meetings and flags overdue tasks. When you finish a workout, the garage display prompts for a voice memo. At dinner, a family photo slides in between TV episodes instead of ads.

Same data. Different moments. Always relevant.

- **Kiosk displays** — Purpose-built interfaces for each room
- **Telegram bots** — Log meals by voice, journal with AI prompts
- **Thermal printer** — A morning receipt of goals before you touch a screen
- **TV overlays** — Dad's ETA appears without pausing the movie
- **Push notifications** — Alerts that matter, filtered from noise

## What It Connects To

### Inputs (The Crude)

Daylight Station ingests data from wherever your life already lives:

| Category | Sources |
|----------|---------|
| **Calendar & Tasks** | Google Calendar, Todoist, ClickUp |
| **Health & Fitness** | Strava, Withings, Garmin, MQTT sensors |
| **Media** | Plex, Audiobookshelf, YouTube |
| **Photos & Memories** | Immich |
| **Finance** | Buxfer |
| **News & Reading** | FreshRSS, Goodreads |
| **Home** | Home Assistant, MQTT |
| **Communication** | Gmail, Telegram |

### Outputs (The Taps)

Refined data flows to purpose-built interfaces:

| Tap | What It Does |
|-----|--------------|
| **Room Kiosks** | Mounted tablets with context-specific dashboards |
| **TV App** | Media browser with family photo interstitials |
| **Fitness Kiosk** | Workout videos with live heart rate overlay |
| **Telegram Bots** | Nutribot (meal logging), Journalist (AI journaling) |
| **Thermal Printer** | Physical morning receipt—no screen required |
| **Home Assistant** | Ambient lighting, automations, device control |
| **WebSocket Events** | Real-time push to any connected client |

## Quick Start

### Prerequisites

- Docker and Docker Compose
- A data directory for configuration and persistence
- API credentials for services you want to connect

### 1. Create project directory

```bash
mkdir daylight && cd daylight
```

### 2. Download configuration

```bash
curl -O https://raw.githubusercontent.com/kckern/DaylightStation/main/docker/docker-compose.yml
curl -O https://raw.githubusercontent.com/kckern/DaylightStation/main/config/secrets.example.yml
curl -O https://raw.githubusercontent.com/kckern/DaylightStation/main/config/system.example.yml
```

### 3. Configure

```bash
mv secrets.example.yml secrets.yml
mv system.example.yml system.yml
```

Edit `secrets.yml` with your API keys (Strava, Plex, OpenAI, etc.)
Edit `system.yml` with your household settings and feature flags.

### 4. Start

```bash
docker-compose up -d
```

### 5. Access

Open `http://localhost:3111` in your browser.

See [Configuration Guide](docs/configuration.md) for detailed setup of individual integrations.

## Architecture

Daylight Station follows a refinery model: raw data comes in, gets processed through domain logic, and flows out to purpose-built taps.

```
┌─────────────────────────────────────────────────────────────────┐
│                        INPUTS (Crude)                           │
│  Strava · Google · Todoist · Plex · Home Assistant · MQTT · ... │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     REFINERY (Backend)                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Adapters │→ │ Domains  │→ │   Apps   │→ │   API    │        │
│  │ (ingest) │  │ (logic)  │  │(use cases)│  │ (serve)  │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       OUTPUTS (Taps)                            │
│  Kiosks · TV · Telegram Bots · Thermal Printer · Notifications  │
└─────────────────────────────────────────────────────────────────┘
```

- **Adapters** pull from external APIs and self-hosted services
- **Domains** contain business logic (fitness, nutrition, finance, etc.)
- **Applications** orchestrate use cases across domains
- **API** serves refined data to any client that can speak HTTP/WebSocket

Frontend apps are purpose-built React interfaces, each optimized for a specific context (office dashboard, TV remote, gym kiosk).

## Screenshots

### Office Kiosk
A wall-mounted dashboard showing calendar, weather, finance trends, and entropy alerts ("4 days since last workout").

![Office Kiosk](docs/screenshots/office-kiosk.png)

### Fitness Kiosk
Garage display with workout video, live heart rate zones, and participant tracking via ANT+/Bluetooth sensors.

![Fitness Kiosk](docs/screenshots/fitness-kiosk.png)

### TV App
Living room media browser with Plex integration. Family photos appear as interstitials between episodes.

![TV App](docs/screenshots/tv-app.png)

### Morning Receipt
Thermal printer output: today's calendar, weather, goals, and accountability nudges—before you touch a screen.

![Morning Receipt](docs/screenshots/morning-receipt.jpg)

### Nutribot
Telegram bot for meal logging. Send a photo, voice memo, or text like "two eggs and toast" and get instant calorie tracking with AI-powered coaching.

![Nutribot](docs/screenshots/nutribot.png)

## Configuration

| File | Purpose |
|------|---------|
| `secrets.yml` | API keys and credentials for integrations |
| `system.yml` | Household settings, users, feature flags |

See [Configuration Guide](docs/configuration.md) for detailed setup.

## Contributing

Daylight Station is built for personal use first, open-sourced for others who share the philosophy. Contributions welcome—especially new adapters, output taps, and documentation.

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup.

## License

Polyform Noncommercial 1.0.0. Free for personal and non-commercial use. See [LICENSE](LICENSE) for details.

## Links

- [Documentation](docs/)
- [Docker Hub](https://hub.docker.com/r/kckern/daylight-station)
- [Report Issues](https://github.com/kckern/DaylightStation/issues)
