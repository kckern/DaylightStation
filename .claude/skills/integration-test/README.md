# Integration Testing Skill

Foundation for integration testing with concurrent dev server, log monitoring, and API testing.

## Overview

This skill manages three concurrent processes that work together:

1. **Dev Server** (`./dev`) - Runs your backend server
2. **Log Monitor** (`tail -f dev.log`) - Shows real-time logs
3. **API Client** (`curl`) - Tests endpoints while server runs

All processes start and stop gracefully without leaving orphaned background jobs.

## Quick Start

### Start Dev Server with Monitoring

```bash
/integration-test
```

This will:
- Start the dev server in the background
- Monitor logs in real-time
- Wait for server to be ready
- Show you the status

### Test an Endpoint

```bash
/integration-test action=test endpoint=/api/health
```

### Stop Everything

```bash
/integration-test action=stop
```

## Common Usage Patterns

### Basic Health Check Flow

```bash
# 1. Start server
/integration-test action=start

# 2. Test health endpoint
/integration-test action=test endpoint=/api/health

# 3. Stop server
/integration-test action=stop
```

### Testing Multiple Endpoints

```bash
# Start once
/integration-test action=start

# Run multiple tests
/integration-test action=test endpoint=/api/health
/integration-test action=test endpoint=/api/clickup/spaces
/integration-test action=test endpoint=/api/weather

# Stop when done
/integration-test action=stop
```

### Testing POST Requests

```bash
/integration-test action=test endpoint=/api/clickup/tasks method=POST data='{"name":"Test Task","space_id":"123"}'
```

### Testing with Authentication

```bash
/integration-test action=test endpoint=/api/protected headers='{"Authorization":"Bearer YOUR_TOKEN"}'
```

### Check Current Status

```bash
/integration-test action=status
```

This shows:
- Whether server is running
- Active processes
- Log file status
- Recent log entries

## Parameters

### Common Parameters

- `action` - What to do (default: `start`)
  - `start` - Start dev server with log monitoring
  - `test` - Execute API test
  - `stop` - Stop all processes
  - `restart` - Restart server
  - `status` - Check current status

- `endpoint` - API endpoint to test (e.g., `/api/health`)
- `method` - HTTP method (`GET`, `POST`, `PUT`, `DELETE`, `PATCH`)
- `data` - JSON data for POST/PUT/PATCH requests
- `headers` - Additional HTTP headers as JSON string

### Advanced Parameters

- `port` - Backend port (default: `3111`)
- `logTail` - Number of log lines to show initially (default: `20`)
- `waitForServer` - Seconds to wait for startup (default: `5`)
- `showLogs` - Show live log output (default: `true`)
- `followRedirects` - Follow HTTP redirects (default: `true`)
- `verbose` - Show detailed curl output (default: `false`)
- `curlTimeout` - Request timeout in seconds (default: `30`)

## Examples

### Test GET Request

```bash
/integration-test action=test endpoint=/api/clickup/spaces method=GET
```

### Test POST Request with Data

```bash
/integration-test action=test endpoint=/api/weather method=POST data='{"zip":"90210"}'
```

### Verbose Testing for Debugging

```bash
/integration-test action=test endpoint=/api/health verbose=true showLogs=true
```

### Start with More Logs

```bash
/integration-test action=start logTail=50 waitForServer=10
```

### Test with Custom Headers

```bash
/integration-test action=test endpoint=/api/protected method=GET headers='{"Authorization":"Bearer abc123","X-Custom":"value"}'
```

## Troubleshooting

### Server Won't Start

Check if port is already in use:
```bash
lsof -i :3111
```

Kill the process or use a different port:
```bash
/integration-test action=start port=3112
```

### Server Not Responding

Increase wait time:
```bash
/integration-test action=start waitForServer=10
```

Check status:
```bash
/integration-test action=status
```

### Processes Not Stopping

Force stop:
```bash
pkill -f "npm run dev"
pkill -f "nodemon"
```

Or restart:
```bash
/integration-test action=restart
```

### View Logs Manually

```bash
tail -f dev.log
```

Or search for errors:
```bash
grep -i error dev.log | tail -n 20
```

## How It Works

### Process Management

The skill uses the Bash tool's `run_in_background` parameter to manage long-running processes:

1. **Server Process** - Runs `./dev` piped to `dev.log`
2. **Log Monitor** - Runs `tail -f dev.log` to show real-time output
3. **Task Tracking** - Saves task IDs for graceful shutdown

### Graceful Shutdown

When stopping:
1. Kills background tasks by task ID
2. Sends SIGTERM to remaining processes
3. Force kills if needed (after delay)
4. Verifies all processes are gone

### Log Management

- All output from `./dev` is captured to `dev.log`
- Logs persist across sessions
- You can archive or clear `dev.log` manually

## Integration Test Workflow

**Recommended pattern for integration testing:**

```bash
# 1. Start server
/integration-test action=start

# 2. Run your tests
/integration-test action=test endpoint=/api/health
/integration-test action=test endpoint=/api/clickup/spaces
# ... more tests

# 3. Check for errors in logs
grep -i error dev.log

# 4. Stop server
/integration-test action=stop
```

## Tips

1. **Always stop when done** - Prevents orphaned processes eating resources
2. **Use status to check** - Before starting, verify nothing is already running
3. **Archive logs** - `dev.log` can grow large over time
4. **Increase timeout for slow endpoints** - Use `curlTimeout` parameter
5. **Monitor logs during development** - Use `showLogs=true` to see real-time output

## Advanced: Building Automated Test Suites

You can chain multiple test commands to build automated test suites:

```bash
# Start server once
/integration-test action=start waitForServer=5

# Run test suite
/integration-test action=test endpoint=/api/health
/integration-test action=test endpoint=/api/clickup/spaces
/integration-test action=test endpoint=/api/weather method=POST data='{"zip":"90210"}'

# Check logs for errors
grep -i "error\|exception" dev.log

# Stop server
/integration-test action=stop
```

This skill provides the foundation for more sophisticated integration testing workflows.

## Files

- `skill.json` - Skill metadata and parameters
- `prompt.md` - Detailed instructions for Claude
- `README.md` - This file (user documentation)

## Version

1.0.0 - Initial release
