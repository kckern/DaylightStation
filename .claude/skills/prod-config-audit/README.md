# Production Config Audit Skill

Audits production configuration on a remote server via SSH.

## Setup

### Option 1: Local Config File (Recommended)

Create `config.local.json` in this directory (gitignored):

```json
{
  "host": "your-server.example.com",
  "configPath": "/path/to/config",
  "dockerComposePath": "/path/to/docker-compose.yml"
}
```

**Example:**
```bash
# Copy the example
cp config.local.example.json config.local.json

# Edit with your values
vim config.local.json
```

### Option 2: Environment Variables

```bash
export PROD_SSH_HOST="your-server.example.com"
export PROD_CONFIG_PATH="/path/to/config"
export PROD_DOCKER_COMPOSE_PATH="/path/to/docker-compose.yml"
```

### Option 3: Pass as Parameters

```bash
/prod-config-audit --host your-server.example.com --configPath /path/to/config
```

## Usage

### Basic

```bash
# Full audit (uses config.local.json or env vars)
/prod-config-audit

# Specify host and path inline
/prod-config-audit --host homeserver.local --configPath /media/user/DockerDrive/config
```

### Advanced

```bash
# Just check logging
/prod-config-audit --target logging

# Compare with local config
/prod-config-audit --compareWithLocal true

# Get summary only
/prod-config-audit --format summary

# Full detailed audit
/prod-config-audit --target all --format detailed --showRecommendations true
```

## Parameters

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `host` | string | from config/env | SSH host to connect to |
| `configPath` | string | from config/env | Remote config directory path |
| `dockerComposePath` | string | from config/env | Remote docker-compose.yml path |
| `target` | all\|logging\|secrets\|app\|system | all | What to audit |
| `checkSecrets` | boolean | true | Check secrets file (no values shown) |
| `checkLogging` | boolean | true | Check log levels |
| `checkEnvVars` | boolean | true | Check docker-compose env vars |
| `compareWithLocal` | boolean | false | Compare prod vs local |
| `showRecommendations` | boolean | true | Show optimization tips |
| `format` | summary\|detailed\|diff | detailed | Output format |

## SSH Requirements

The skill needs SSH access to your production server:

1. **SSH key authentication** should be set up
2. **Test connection:**
   ```bash
   ssh your-server.example.com "echo Connected"
   ```

3. **User must have access to:**
   - Config files (read access)
   - Docker commands (`docker ps`, `docker logs`)
   - Log files (if checking)

## Security

- **Never commits sensitive data** - config.local.json is gitignored
- **Never displays secret values** - only validates structure
- **Read-only operations** - doesn't modify production config
- **Checks file permissions** - warns about overly permissive files

## What It Checks

### Logging
- Default log level (should be 'info' or auto-detect in production)
- Component log levels (no DEBUG in production for noisy components)
- Log file sizes and rotation needs

### Environment
- NODE_ENV=production is set
- Log level environment variable overrides
- Docker restart policies
- Volume mounts

### Security
- Secrets file exists and has proper permissions
- No world-readable config files

### System Health
- Container is running
- Recent errors in logs
- Resource usage

## Example Output

```
Production Config Audit - prod-server
======================================
Status: ⚠️ WARNINGS

Configuration Files:
✅ config.app.yml - Present
✅ config.secrets.yml - Present (secure permissions)
⚠️ logging.yml - Using debug level

Environment:
✅ NODE_ENV=production
✅ Container running (uptime: 3d 4h)

Issues Found: 2
- ⚠️ health logger set to DEBUG
- ⚠️ websocket logger set to DEBUG

Recommendations:
1. Set defaultLevel to 'info' in logging.yml
2. Set websocket to 'warn' to reduce noise
3. Enable log rotation (dev.log is 45MB)
```
