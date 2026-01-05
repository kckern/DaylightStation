# Local Settings Example

Copy this structure to `.claude/settings.local.json` under an `env` key:

```json
{
  "permissions": { ... },
  "env": {
    "mounts": {
      "data": "/path/to/your/data/mount",
      "media": "/path/to/your/media/mount"
    },
    "hosts": {
      "prod": "your-production-hostname",
      "fitness": "your-fitness-client-hostname"
    },
    "ports": {
      "frontend": 3111,
      "backend": 3112,
      "api": 3119
    },
    "docker": {
      "container": "daylight-station"
    }
  }
}
```

## Required Values

| Key | Description |
|-----|-------------|
| `mounts.data` | Path to data directory with YAML files |
| `mounts.media` | Path to media directory |
| `hosts.prod` | Production server hostname |
| `ports.frontend` | Frontend dev server port |
| `ports.backend` | Backend HTTP/WS port |
| `docker.container` | Docker container name |

## Optional Values

| Key | Description |
|-----|-------------|
| `hosts.fitness` | Fitness client hostname (if separate from prod) |
| `ports.api` | Secondary API port |
| `clickup.listIds.*` | ClickUp list IDs for task management |
