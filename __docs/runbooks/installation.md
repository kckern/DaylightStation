# Daylight Station Installation Guide

This guide covers prerequisites, installation, and configuration. Read the "Is This For You?" section first.

---

## Is This For You?

**Don't bother if you don't have:**

- **A server or NAS running 24/7** — Daylight Station needs to be always-on to collect data and serve kiosks. A Raspberry Pi 4, old laptop, NAS, or proper home server works. Your desktop that sleeps at night does not.

- **Docker experience** — If you've never used Docker, start there first. This isn't the project to learn on.

- **At least 2-3 services you already use** — Daylight Station synthesizes data from other sources. If you don't already have Plex, Home Assistant, Strava, Todoist, or similar, there's nothing to synthesize.

- **Comfort with YAML configuration** — No GUI setup wizard (yet). You'll be editing config files.

- **Time to invest** — Initial setup takes 1-4 hours depending on how many integrations you want. This isn't a "docker run and done" project.

**This is probably for you if:**

- You already self-host several services and want them to work together
- You're frustrated with checking multiple apps throughout the day
- You have (or want) dedicated displays in your home
- You're comfortable in a terminal
- You value privacy over convenience

---

## Prerequisites

### Required

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| **Docker** | 20.10+ | Latest |
| **Docker Compose** | v2.0+ | Latest |
| **RAM** | 2 GB available | 4 GB |
| **Storage** | 1 GB + your data | SSD recommended |
| **Network** | Accessible from kiosks | Static IP or DNS |

### Required Services (At Least One)

You need *something* to pull data from. Pick your starting point:

| Service | What It Provides | Difficulty |
|---------|------------------|------------|
| **Plex** | Media library, watch history | Easy |
| **Home Assistant** | Device control, sensors, presence | Medium |
| **Google Calendar** | Events, schedule | Easy (OAuth) |
| **Strava** | Workouts, fitness history | Easy (OAuth) |
| **Todoist** | Tasks | Easy (API key) |

### Optional Services

Add these as you go:

| Service | What It Provides | Notes |
|---------|------------------|-------|
| Withings | Weight, body metrics | OAuth required |
| Buxfer | Finance tracking | Email/password auth |
| Immich | Photo library | Self-hosted |
| FreshRSS | RSS feeds | Self-hosted |
| Audiobookshelf | Audiobook progress | Self-hosted |
| LastFM | Music listening history | API key |
| Gmail | Email summaries | OAuth required |

### Optional Hardware

| Hardware | What It Enables | Notes |
|----------|-----------------|-------|
| **Thermal printer** | Morning receipts | ESC/POS network printer (~$50-100) |
| **ANT+ USB dongle** | Heart rate during workouts | ~$30 |
| **Wall-mounted display** | Room kiosks | Old tablet or mini PC + monitor |
| **MQTT broker** | Sensor integration | Mosquitto on same server |

---

## Installation

### Step 1: Create Project Directory

```bash
mkdir ~/daylight
cd ~/daylight
```

### Step 2: Create Directory Structure

```bash
mkdir -p config data media
```

### Step 3: Download Docker Compose

```bash
curl -O https://raw.githubusercontent.com/kckern/DaylightStation/main/docker/docker-compose.yml
```

### Step 4: Edit Docker Compose

Open `docker-compose.yml` and update the volume paths:

```yaml
services:
  daylightstation:
    image: kckern/daylight-station:latest
    container_name: daylight-station
    environment:
      - NODE_ENV=production
    ports:
      - "3111:3111"   # Frontend
      - "3112:3112"   # Backend API
      - "3113:3113"   # WebSocket
    volumes:
      - ./data:/usr/src/app/data
      - ./media:/usr/src/app/media
    restart: unless-stopped
```

### Step 5: Create Configuration Files

```bash
curl -o config/secrets.yml https://raw.githubusercontent.com/kckern/DaylightStation/main/config/secrets.example.yml
curl -o config/system.yml https://raw.githubusercontent.com/kckern/DaylightStation/main/config/system.example.yml
```

### Step 6: Configure (See Configuration Section Below)

Edit `config/secrets.yml` and `config/system.yml` with your credentials and settings.

### Step 7: Start

```bash
docker-compose up -d
```

### Step 8: Verify

```bash
# Check logs
docker logs daylight-station

# Access frontend
open http://localhost:3111
```

---

## Configuration

### File Structure

```
~/daylight/
├── docker-compose.yml
├── config/
│   ├── secrets.yml        # API keys and credentials (NEVER commit)
│   └── system.yml         # System settings
├── data/
│   ├── households/        # Per-household config
│   │   └── default/
│   │       ├── apps/      # Per-app config
│   │       └── users/     # Per-user profiles
│   └── cache/             # Temporary data
└── media/                 # Media files (optional)
```

### secrets.yml

This file contains all API keys and credentials. **Never commit this file.**

#### Minimum Viable Configuration

Start with just what you need:

```yaml
# === REQUIRED FOR BASIC OPERATION ===

# Pick ONE AI provider (for Nutribot/Journalist)
OPENAI_API_KEY: sk-your-key-here
# OR
# ANTHROPIC_API_KEY: sk-ant-your-key-here

# === ADD BASED ON WHAT YOU USE ===

# If you use Plex:
PLEX_TOKEN: your-plex-token

# If you use Home Assistant:
HOME_ASSISTANT_TOKEN: your-long-lived-access-token

# If you use Google Calendar:
GOOGLE_CLIENT_ID: your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET: your-client-secret
GOOGLE_REFRESH_TOKEN: your-refresh-token

# If you use Strava:
STRAVA_CLIENT_ID: your-client-id
STRAVA_CLIENT_SECRET: your-client-secret

# If you use Todoist:
TODOIST_KEY: your-api-key

# If you want Telegram bots:
TELEGRAM_NUTRIBOT_TOKEN: your-bot-token
TELEGRAM_JOURNALIST_BOT_TOKEN: your-bot-token
TELEGRAM_HOMEBOT_TOKEN: your-bot-token

# If you use Withings:
WITHINGS_CLIENT: your-client-id
WITHINGS_SECRET: your-client-secret

# If you use Buxfer (finance):
BUXFER_EMAIL: your-email
BUXFER_PW: your-password

# If you want weather:
OPEN_WEATHER_API_KEY: your-api-key
```

### system.yml

System-level configuration:

```yaml
version: "1.0"

# Household (multi-tenant support)
households:
  default: default

# Paths (usually don't need to change in Docker)
paths:
  data: /usr/src/app/data
  media: /usr/src/app/media
  cache: /usr/src/app/data/cache

# Your location (for weather, sunrise/sunset)
location:
  lat: 47.6062        # Your latitude
  lng: -122.3321      # Your longitude
  timezone: America/Los_Angeles

# Network (adjust if needed)
network:
  api_host: localhost
  api_port: 3112
  websocket_port: 3113

# Hardware services (optional)
services:
  # Thermal printer (if you have one)
  printer:
    host: 10.0.0.50   # Printer IP
    port: 9100

  # MQTT broker (if you have one)
  mqtt:
    host: mosquitto   # Or IP address
    port: 1883

  # Home Assistant (if you use it)
  home_assistant:
    host: http://homeassistant.local
    port: 8123

  # TV control (if using Fully Kiosk)
  tv:
    host: 10.0.0.11
    port_kiosk: 2323
```

---

## Getting API Keys

### Plex Token

1. Sign in to Plex web app
2. Open any media item
3. Click "Get Info" → "View XML"
4. Look for `X-Plex-Token=` in the URL

Or use: https://github.com/pkkid/python-plexapi/wiki/Plex-Token

### Home Assistant Long-Lived Token

1. Go to your HA instance
2. Click your profile (bottom left)
3. Scroll to "Long-Lived Access Tokens"
4. Create token, copy immediately (shown once)

### Google OAuth (Calendar, Gmail)

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create project → Enable Calendar API and/or Gmail API
3. Create OAuth credentials (Web application type)
4. Set redirect URI to `http://localhost:3111/auth/google/callback`
5. Use a tool like [oauth2-cli](https://github.com/feross/oauth2-cli) to get refresh token

### Strava OAuth

1. Go to [Strava API Settings](https://www.strava.com/settings/api)
2. Create application
3. Use OAuth flow to get refresh token (similar to Google)

### Todoist API Key

1. Go to [Todoist Integrations](https://todoist.com/app/settings/integrations)
2. Scroll to "API token"
3. Copy token

### Telegram Bot Tokens

1. Message [@BotFather](https://t.me/botfather) on Telegram
2. Send `/newbot`
3. Follow prompts, save the token
4. Repeat for each bot (Nutribot, Journalist, Homebot)

### OpenAI API Key

1. Go to [OpenAI API Keys](https://platform.openai.com/api-keys)
2. Create new key
3. Copy immediately (shown once)

### OpenWeather API Key

1. Go to [OpenWeatherMap](https://openweathermap.org/api)
2. Sign up / sign in
3. Go to API Keys section
4. Copy your key

---

## Verifying Installation

### Check Container Status

```bash
docker ps | grep daylight
```

Should show container running.

### Check Logs

```bash
docker logs daylight-station --tail 50
```

Look for:
- `Server started on port 3112` (backend)
- `Frontend serving on port 3111`
- No red error messages

### Test API

```bash
curl http://localhost:3112/api/v1/health
```

Should return `{"status":"ok"}` or similar.

### Access Frontend

Open `http://localhost:3111` in browser.

---

## Kiosk Setup

### Option 1: Fully Kiosk Browser (Android Tablet)

1. Install [Fully Kiosk Browser](https://www.fully-kiosk.com/) on Android device
2. Configure URL: `http://YOUR_SERVER:3111/office` (or `/fitness`, `/tv`)
3. Enable kiosk mode
4. Mount tablet on wall

### Option 2: Mini PC / Raspberry Pi

1. Install minimal Linux (Ubuntu Server, Raspberry Pi OS Lite)
2. Install Chromium
3. Configure auto-login and kiosk mode:

```bash
# /etc/xdg/lxsession/LXDE-pi/autostart (Raspberry Pi)
@chromium-browser --kiosk --noerrdialogs --disable-infobars http://YOUR_SERVER:3111/office
```

4. Connect to display
5. Mount or place in room

### Room-Specific URLs

| Room | URL | Purpose |
|------|-----|---------|
| Office | `/office` | Calendar, weather, entropy, finance |
| Garage/Gym | `/fitness` | Workout videos, heart rate overlay |
| Living Room | `/tv` | Media browser, photo interstitials |
| Kitchen | `/home` | Family dashboard (coming soon) |

---

## Thermal Printer Setup

### Requirements

- ESC/POS compatible network thermal printer
- Common models: Epson TM-T88, MUNBYN, similar receipt printers
- Must support network connection (Ethernet or WiFi)

### Configuration

In `system.yml`:

```yaml
services:
  printer:
    host: 10.0.0.50   # Printer's IP address
    port: 9100        # Standard ESC/POS port
```

### Test Print

```bash
curl -X POST http://localhost:3112/api/v1/printer/test
```

### Morning Receipt

The morning receipt prints automatically if configured, or can be triggered manually.

---

## Telegram Bots Setup

### 1. Create Bots

Create three bots via [@BotFather](https://t.me/botfather):
- Nutribot (meal logging)
- Journalist (AI journaling)
- Homebot (home control)

### 2. Add Tokens to secrets.yml

```yaml
TELEGRAM_NUTRIBOT_TOKEN: 123456789:ABC...
TELEGRAM_JOURNALIST_BOT_TOKEN: 123456789:DEF...
TELEGRAM_HOMEBOT_TOKEN: 123456789:GHI...
```

### 3. Set Webhooks

After starting Daylight Station, the webhooks should auto-configure. If not:

```bash
# Replace with your bot token and your public URL
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://YOUR_PUBLIC_URL/api/v1/nutribot/webhook"
```

### 4. Start Chatting

Message your bot on Telegram. For Nutribot, try:
- "Two eggs and toast for breakfast"
- Send a photo of your meal
- Send a voice memo describing what you ate

---

## Troubleshooting

### Container Won't Start

```bash
docker logs daylight-station
```

Common issues:
- **Port already in use:** Change ports in docker-compose.yml
- **Volume permissions:** `chmod -R 777 data/` (not ideal, but works)
- **Missing secrets.yml:** Must exist even if empty

### Can't Access Frontend

1. Check container is running: `docker ps`
2. Check port mapping: `docker port daylight-station`
3. Check firewall: `sudo ufw allow 3111`
4. Try localhost first: `http://localhost:3111`

### API Errors

Check which integrations are failing:

```bash
docker logs daylight-station 2>&1 | grep -i error
```

Common issues:
- **Invalid API key:** Double-check secrets.yml
- **OAuth expired:** Re-authenticate and get new refresh token
- **Rate limited:** Wait and retry

### Kiosk Not Connecting

1. Ensure server IP is reachable from kiosk network
2. Check firewall allows connections
3. Try IP address instead of hostname
4. Check browser console for errors

### Thermal Printer Not Working

1. Verify printer IP: `ping 10.0.0.50`
2. Verify port: `nc -zv 10.0.0.50 9100`
3. Check printer is ESC/POS compatible
4. Try test print via API

---

## Updating

### Pull Latest Image

```bash
docker-compose pull
docker-compose up -d
```

### Check for Breaking Changes

Before updating, check the [changelog](https://github.com/kckern/DaylightStation/releases) for breaking changes that might require config updates.

### Backup First

```bash
cp -r data/ data-backup-$(date +%Y%m%d)/
cp -r config/ config-backup-$(date +%Y%m%d)/
```

---

## Getting Help

- **GitHub Issues:** [Report bugs or request features](https://github.com/kckern/DaylightStation/issues)
- **Documentation:** [Full docs](https://github.com/kckern/DaylightStation/tree/main/docs)
- **Source Code:** [Explore the codebase](https://github.com/kckern/DaylightStation)

---

## Next Steps

Once running:

1. **Start simple** — Get one integration working (e.g., Plex or Calendar)
2. **Add a kiosk** — Set up one room display
3. **Add more integrations** — One at a time, verify each works
4. **Set up bots** — Nutribot is the most useful day-to-day
5. **Add hardware** — Thermal printer, then sensors if interested
