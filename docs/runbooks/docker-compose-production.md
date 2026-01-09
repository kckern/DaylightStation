# Production Docker Compose Configuration

## Current Production Setup (homeserver.local)

The production container must use these mount paths:

```yaml
version: '3'
services:
  daylightstation:
    image: kckern/daylight-station:latest
    container_name: daylight-station
    environment:
      - NODE_ENV=production
    ports:
      - 3112:3112
      - 3119:3119
    volumes:
      - /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data:/usr/src/app/data
      - /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media:/usr/src/app/media
    restart: unless-stopped
```

## Deploy Command

```bash
ssh homeserver.local 'docker stop daylight-station && docker rm daylight-station && docker run -d --name daylight-station --restart unless-stopped -p 3112:3112 -p 3119:3119 -v /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data:/usr/src/app/data -v /media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/media:/usr/src/app/media kckern/daylight-station:latest'
```

## Critical Notes

- **Data mount**: Must point to Dropbox sync location (not Docker/DaylightStation/data)
- **Ports**: Both 3112 (main HTTP/WS) and 3119 (secondary API) required
- **Config**: System config at `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/system/`
- **Secrets**: API keys and auth stored in `/media/kckern/DockerDrive/Dropbox/Apps/DaylightStation/data/system/secrets.yml`

## Verification

```bash
# Check container status
ssh homeserver.local 'docker ps | grep daylight'

# Test endpoint directly
curl -s http://10.0.0.10:3112/home/entropy | jq '.summary'

# Check mounts
ssh homeserver.local 'docker exec daylight-station ls -la /usr/src/app/data/system/'
```
