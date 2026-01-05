# DaylightStation

A self-hosted personal life management platform. Aggregates fitness, health, finance, media, and productivity data into a unified dashboard with real-time tracking and home automation.

![License](https://img.shields.io/badge/license-ISC-blue)
![Docker Pulls](https://img.shields.io/docker/pulls/kckern/daylightstation)

## Features

### Fitness & Health
- **Real-time workout tracking** with pose detection and live metrics
- **Multi-platform sync** from Strava, Garmin, Withings, and custom FitSync
- **Vibration sensor support** via MQTT for equipment integration

### Nutrition
- **NutriBot** - Telegram-based AI nutrition assistant
- **Food logging** with barcode scanning and meal planning

### Media & Entertainment
- **Plex integration** for media streaming and consumption tracking
- **YouTube playback** with yt-dlp support

### Finance
- **Buxfer integration** for expense tracking and budgets

### Productivity
- **Task aggregation** from Todoist, Google Calendar, ClickUp
- **Email summaries** from Gmail

### Home Automation
- **Home Assistant integration** for smart device control
- **MQTT messaging** for IoT devices

### Lifelog
- **Unified timeline** extracting events from all integrated services

## Quick Start

### Prerequisites

- Docker and Docker Compose
- External services you want to integrate (Plex, Home Assistant, etc.)

### 1. Create project directory

```bash
mkdir daylightstation && cd daylightstation
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
# Edit secrets.yml and system.yml with your API keys and settings
```

### 4. Start

```bash
docker-compose up -d
```

### 5. Access

Open `http://localhost:3111` in your browser.

## Configuration

### Required Files

| File | Purpose |
|------|---------|
| `secrets.yml` | API keys, tokens, and credentials for integrations |
| `system.yml` | Application settings, household configuration, feature flags |

### Key Settings

**secrets.yml:**
```yaml
strava:
  client_id: "your-client-id"
  client_secret: "your-secret"
  refresh_token: "your-token"

openai:
  api_key: "sk-..."

plex:
  token: "your-plex-token"
  server_url: "http://your-plex-server:32400"
```

**system.yml:**
```yaml
household:
  id: "my-household"
  head: "username"

features:
  fitness: true
  nutrition: true
  media: true
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3112` | Backend API port |
| `FRONTEND_PORT` | `3111` | Frontend UI port |
| `NODE_ENV` | `production` | Environment mode |

### Data & Media Mounts

Configure volume mounts in `docker-compose.yml` for persistent storage:
- `/usr/src/app/data` - YAML configuration and user data
- `/usr/src/app/media` - Media files (optional)

## Architecture

DaylightStation is a Node.js application with:
- **Frontend**: React 18 + Vite + Mantine UI
- **Backend**: Express.js + WebSocket
- **Infrastructure**: Docker (Alpine Linux)

```
┌─────────────┐     ┌─────────────┐
│   Frontend  │────▶│   Backend   │────▶ External APIs
│   (React)   │◀────│  (Express)  │      (Strava, Plex, etc.)
└─────────────┘ WS  └─────────────┘
```

For detailed architecture, see [docs/ai-context/architecture.md](docs/ai-context/architecture.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup and guidelines.

## License

ISC License. See [LICENSE](LICENSE) for details.

## Links

- [Documentation](docs/)
- [Report Issues](https://github.com/kckern/DaylightStation/issues)
- [Docker Hub](https://hub.docker.com/r/kckern/daylightstation)
