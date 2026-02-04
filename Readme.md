# Daylight Station — Where your apps finally meet.

**A self-hosted data refinery for an intentional life.**

Your calendar lives in Google. Your runs live in Strava. Your photos live in Immich. Your comics live in Komga. Your media lives in Plex. Your home lives in Home Assistant. They've never been in the same room—until now. Daylight Station is where your scattered digital life finally comes together. Self-hosted and fully yours, it connects to your other self-hosted services and pulls from cloud APIs, refines the noise into signal, and delivers context-aware experiences exactly when and where you need them. No middleman. No algorithms optimizing for someone else's engagement metrics. Just your data, working for you.

![License](https://img.shields.io/badge/license-Polyform%20Noncommercial-blue)
![Docker Pulls](https://img.shields.io/docker/pulls/kckern/daylight-station)

## Why are you checking your apps? They should be checking on you.

Daylight Station flips the script—your data comes to you through purpose-built interfaces, like wall-mounted displays, TV apps, and Telegram bots—and even thermal receipt printouts, widgets, and voice assistants. Each shows exactly what matters for that moment and place.

When your apps finally meet, new things become possible:

- Your office display knows it's been 4 days since your last workout
- Family photos appear between TV episodes instead of ads
- Your heart rate overlays on workout videos in real-time
- A morning debrief arrives via Telegram, summarizing yesterday's activities and prompting you to journal via voice memo
- A grounded feed replaces doomscrolling—Reddit posts interleaved with family photos, overdue todos, and health nudges
- Your morning alarm plays a personalized program: inbox summary, calendar, todos, then news from your subscribed podcasts and YouTube channels

Same data you already have. Now it works together.

## What It Connects To

### Inputs

| Category | Sources |
|----------|---------|
| **Calendar** | Google Calendar |
| **Tasks** | Todoist |
| **Fitness** | Strava |
| **Media** | Plex, Audiobookshelf |
| **Photos** | Immich |
| **Home** | Home Assistant |
| **Messaging** | Telegram |

Also supports: Buxfer, ClickUp, FreshRSS, Garmin, GitHub, Gmail, Goodreads, LastFM, Letterboxd, Reddit, Withings, weather APIs, and more.

### Outputs

| Interface | Example |
|-----------|---------|
| **Wall-mounted displays** | Household dashboard, fitness kiosk with real-time heart rate overlay |
| **TV app** | Media browser with photo interstitials, ambient music playlists |
| **Telegram bots** | Meal logging, AI journaling |
| **Thermal printer** | Morning "newspaper", on-demand notifications and reports |
| **Voice briefings** | Morning alarm that reads your inbox, calendar, and todos |
| **Grounded feed** | Boonscrolling: news and social mixed with photos, todos, and health nudges |
| **Home Assistant** | Ambient lighting, automations |
| **WebSocket** | Real-time push to any client |

Bathroom speaker, bedroom alarm, kitchen display—your data meets you where you are.

## Quick Start

```yaml
# docker-compose.yml
services:
  daylight:
    image: kckern/daylight-station:latest
    ports:
      - "3111:3111"
    volumes:
      - ./data:/data
    environment:
      - DAYLIGHT_DATA_PATH=/data
```

```bash
mkdir daylight && cd daylight
# Add your config files to ./data (see docs/configuration.md)
docker-compose up -d
```

Open `http://localhost:3111`

## Architecture

See [docs/reference/core/backend-architecture.md](docs/reference/core/backend-architecture.md) for technical details.

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

**Source-available. Free for personal use. Licensable for social proof and commercial rights.**

DaylightStation is released under the [Polyform Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0).

| Use Case | License Required |
|----------|------------------|
| Personal, noncommercial use | Free (Freeloader) |
| Social features + badge | Paid personal license ($1-$50/mo) |
| Installation/consulting services | Commercial Installer license |
| Pre-install on hardware | Commercial Distributor license |

See [docs/reference/licensing.md](docs/reference/licensing.md) for the full licensing model, badge verification, and FAQ.

## Links

- [Documentation](docs/)
- [Docker Hub](https://hub.docker.com/r/kckern/daylight-station)
- [Report Issues](https://github.com/kckern/DaylightStation/issues)
