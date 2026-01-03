# Production Config Audit

You are auditing the production configuration on a remote server via SSH.

## Configuration Resolution

The skill needs SSH host and paths. Resolve them in this priority order:

1. **From skill parameters** (if provided):
   - `host` parameter
   - `configPath` parameter
   - `dockerComposePath` parameter

2. **From local config file** (if exists):
   - Read `.claude/skills/prod-config-audit/config.local.json` (gitignored)
   - Look for `host`, `configPath`, `dockerComposePath` keys

3. **From environment variables**:
   - `PROD_SSH_HOST`
   - `PROD_CONFIG_PATH`
   - `PROD_DOCKER_COMPOSE_PATH`

4. **Prompt user if missing**:
   - If no host/path found, ask user to provide them or create config.local.json

## Connection Details (After Resolution)

**SSH Target:** `{host}` (e.g., `homeserver.local`, `user@prod.example.com`)
**Config Path:** `{configPath}` (e.g., `/path/to/config`)
**Docker Compose:** `{dockerComposePath}` (e.g., `/path/to/docker-compose.yml`)

## Your Tasks

Based on the parameters provided, perform the following checks:

### 1. Resolve Configuration

**First, determine the host and paths:**

```bash
# Check if config.local.json exists
if [ -f .claude/skills/prod-config-audit/config.local.json ]; then
  # Read from config file
  HOST=$(jq -r '.host // empty' .claude/skills/prod-config-audit/config.local.json)
  CONFIG_PATH=$(jq -r '.configPath // empty' .claude/skills/prod-config-audit/config.local.json)
  DOCKER_COMPOSE_PATH=$(jq -r '.dockerComposePath // empty' .claude/skills/prod-config-audit/config.local.json)
fi

# Override with parameters if provided
HOST=${host:-${HOST:-${PROD_SSH_HOST}}}
CONFIG_PATH=${configPath:-${CONFIG_PATH:-${PROD_CONFIG_PATH}}}
DOCKER_COMPOSE_PATH=${dockerComposePath:-${DOCKER_COMPOSE_PATH:-${PROD_DOCKER_COMPOSE_PATH}}}

# Validate required values
if [ -z "$HOST" ]; then
  echo "❌ SSH host not configured. Provide via:"
  echo "   1. --host parameter"
  echo "   2. .claude/skills/prod-config-audit/config.local.json"
  echo "   3. PROD_SSH_HOST environment variable"
  exit 1
fi

if [ -z "$CONFIG_PATH" ]; then
  echo "⚠️  Config path not specified. Using auto-detection."
fi
```

### 2. Connect to Remote Server

```bash
# Test connection
ssh $HOST "echo 'Connection successful'"

# List config files (try multiple locations if path not specified)
if [ -n "$CONFIG_PATH" ]; then
  ssh $HOST "ls -la $CONFIG_PATH/"
else
  # Auto-detect common locations
  ssh $HOST "ls -la /usr/src/app/config/ 2>/dev/null || ls -la ~/config/ 2>/dev/null || ls -la ./config/ 2>/dev/null"
fi
```

### 3. Check Logging Configuration (if checkLogging=true)

**Read remote logging.yml:**
```bash
ssh $HOST "cat $CONFIG_PATH/logging.yml 2>/dev/null"
```

**What to check:**
- Is `defaultLevel` set? (Should be 'info' or omitted for auto-detection)
- Are component log levels appropriate for production?
  - ✅ Good: `info`, `warn`, `error`
  - ⚠️ Noisy: `debug` (should only be used for troubleshooting)
- Are noisy components (websocket, frontend) set to `warn` or higher?
- Compare with local config if `compareWithLocal=true`

**Report:**
- Current defaultLevel
- Any components set to DEBUG in production
- Recommendations for optimization

### 4. Check Environment Variables (if checkEnvVars=true)

**Read docker-compose.yml:**
```bash
if [ -n "$DOCKER_COMPOSE_PATH" ]; then
  ssh $HOST "cat $DOCKER_COMPOSE_PATH"
else
  # Auto-detect in parent of config directory
  ssh $HOST "cat ${CONFIG_PATH%/config}/docker-compose.yml 2>/dev/null"
fi
```

**What to check:**
- ✅ Is `NODE_ENV=production` set?
- Are there log level overrides? (`LOG_LEVEL_BACKEND`, `LOG_LEVEL_API`, etc.)
- Are volumes mounted correctly?
- Is restart policy set? (Should be `unless-stopped` or `always`)
- Check exposed ports

### 5. Validate Secrets Configuration (if checkSecrets=true)

**IMPORTANT: Never display secret values! Only check structure.**

```bash
# Check if secrets file exists
ssh $HOST "test -f $CONFIG_PATH/config.secrets.yml && echo 'EXISTS' || echo 'MISSING'"

# Check file permissions (should be restrictive)
ssh $HOST "ls -l $CONFIG_PATH/config.secrets.yml 2>/dev/null | awk '{print \$1, \$3, \$4}'"
```

**What to check:**
- Does secrets file exist?
- File permissions (should be readable only by owner: `-rw-------` or `-rw-r-----`)
- Warn if permissions are too open (world-readable)

**DO NOT:**
- Display actual secret values
- Read the contents of secrets files
- Log sensitive information

### 6. Check App Configuration (if target includes 'app')

```bash
ssh $HOST "test -f $CONFIG_PATH/config.app.yml && echo 'EXISTS' || echo 'MISSING'"
```

### 6. Compare with Local Config (if compareWithLocal=true)

**Read local config:**
- Read `/Users/kckern/Documents/GitHub/DaylightStation/config/logging.yml`
- Compare defaultLevel, component levels
- Highlight differences

**Report format:**
```
Config Differences (Local → Production):
- defaultLevel: debug → info ✅ (Correct for production)
- backend: debug → info ✅
- websocket: info → warn ✅ (Less noisy)
- health: debug → debug ⚠️ (Should be info in production)
```

### 7. System Health Checks

```bash
# Get container name from docker-compose or use common pattern
CONTAINER_NAME=$(ssh $HOST "docker ps --format '{{.Names}}' | grep -i daylight" | head -1)

# Check if container is running
ssh $HOST "docker ps | grep -i daylight"

# Check container logs (last 20 lines) for errors
ssh $HOST "docker logs $CONTAINER_NAME --tail 20 2>&1 | grep -i 'error\|warn\|fatal'"

# Check log file size (if logging to file in config dir)
ssh $HOST "ls -lh $CONFIG_PATH/../*.log 2>/dev/null | head -5"
```

## Output Formats

### Summary Format
```
Production Config Audit - {host}
==========================================
Status: ✅ HEALTHY / ⚠️ WARNINGS / ❌ ISSUES

Configuration Files:
✅ config.app.yml - Present
✅ config.secrets.yml - Present (secure permissions)
✅ logging.yml - Present

Environment:
✅ NODE_ENV=production
✅ Log level: info (auto-detected)

Issues Found: 2
- ⚠️ health logger set to DEBUG (should be INFO)
- ⚠️ Log file size: 45MB (recommend rotation)

Recommendations: 3
[List recommendations]
```

### Detailed Format
Break down each section with:
- Current configuration
- Expected production values
- Specific issues with file paths and line numbers
- Detailed recommendations

### Diff Format
Show side-by-side comparison of local vs production config with color coding:
- 🟢 Good production settings
- 🟡 Acceptable but could be optimized
- 🔴 Issues that need attention

## Recommendations to Check For

**Logging:**
- Suggest setting noisy components to `warn` or `error`
- Recommend log rotation if files are large
- Suggest enabling Loggly for centralized logging

**Environment:**
- Ensure NODE_ENV=production
- Check restart policies
- Validate volume mounts

**Security:**
- Check secrets file permissions
- Warn about exposed ports
- Check if sensitive data might be logged

**Performance:**
- Suggest log level adjustments for high-traffic endpoints
- Recommend debug logging only for troubleshooting

## Execution Steps

1. Test SSH connection to homeserver.local
2. Locate config directory (try both absolute and relative paths)
3. Read config files based on `target` parameter
4. Validate each config based on enabled checks
5. Compare with local if requested
6. Generate report in requested format
7. Provide actionable recommendations

## Error Handling

- If SSH fails, provide clear instructions on checking SSH keys/config
- If files are missing, suggest where they should be
- If permissions denied, explain how to fix
- Gracefully handle missing files (report as missing, not error)

## Important Notes

- **NEVER display secret values** from config.secrets.yml
- Use non-interactive SSH (no prompts)
- Handle both absolute and relative paths
- Be helpful with fixing instructions, not just reporting problems
- Prioritize security and production best practices
