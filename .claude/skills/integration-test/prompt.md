# Integration Testing Skill

You are running integration tests for the DaylightStation backend server with concurrent log monitoring and API testing.

## Overview

This skill manages **three concurrent processes** that must cooperate:

1. **Dev Server** - Runs `./dev` in background
2. **Log Monitor** - Tails `dev.log` for real-time debugging
3. **API Client** - Executes curl commands to test endpoints

All processes must start and stop gracefully without orphaning background jobs.

## Process Management Strategy

**CRITICAL:** Use the Bash tool's `run_in_background` parameter for all long-running processes. Track task IDs and use TaskOutput to monitor them.

### Starting Processes

```bash
# 1. Clean up any existing processes
pkill -f "npm run dev" 2>/dev/null || true
pkill -f "nodemon" 2>/dev/null || true

# 2. Clear or create dev.log
> dev.log
```

Then use three separate Bash calls with `run_in_background=true`:

**Thread 1: Dev Server**
```bash
./dev 2>&1 | tee -a dev.log
```

**Thread 2: Log Monitor** (if showLogs=true)
```bash
tail -f -n {logTail} dev.log
```

**Thread 3: API Testing**
Wait for server to start, then execute curl commands.

### Stopping Processes

When done or on error:
1. Kill background tasks using KillShell tool with task IDs
2. Send SIGTERM to any remaining processes
3. Verify cleanup with `ps aux | grep -E "(nodemon|npm run dev|tail)"`

## Action Modes

### 1. START - Start Dev Server with Log Monitoring

**Steps:**

1. **Clean up existing processes**
   ```bash
   pkill -f "npm run dev" 2>/dev/null || true
   pkill -f "nodemon" 2>/dev/null || true
   sleep 1
   ```

2. **Clear dev.log**
   ```bash
   > dev.log
   echo "=== Dev server starting at $(date) ===" >> dev.log
   ```

3. **Start dev server in background**
   Use Bash tool with `run_in_background=true`:
   ```bash
   ./dev 2>&1 | tee -a dev.log
   ```
   Save the task_id for later cleanup.

4. **Wait for server startup**
   Wait {waitForServer} seconds, then verify server is responding:
   ```bash
   sleep {waitForServer}
   curl -s http://localhost:{port}/api/health || echo "Server not ready yet"
   ```

5. **Start log monitor** (if showLogs=true)
   Use Bash tool with `run_in_background=true`:
   ```bash
   tail -f -n {logTail} dev.log
   ```
   Save the task_id.

6. **Report status**
   ```
   ✅ Dev server started (PID: <pid>)
   ✅ Log monitor started (showing last {logTail} lines)

   Server ready at: http://localhost:{port}
   Logs: dev.log

   Use /integration-test with action=test to test endpoints
   Use /integration-test with action=stop to stop all processes
   ```

### 2. TEST - Execute API Tests

**Prerequisite:** Server must be running (either started by this skill or manually)

**Steps:**

1. **Verify server is running**
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:{port}/api/health
   ```
   If returns 000 or connection refused, server is not running. Report error and suggest using action=start.

2. **Show recent logs** (if showLogs=true)
   ```bash
   echo "=== Recent logs before test ==="
   tail -n 10 dev.log
   echo ""
   ```

3. **Build curl command based on parameters**

   Base template:
   ```bash
   curl {verbose} {followRedirects} -X {method} \
     -H "Content-Type: application/json" \
     {headers} \
     {data} \
     -w "\n\nHTTP Status: %{http_code}\nTime: %{time_total}s\n" \
     --max-time {curlTimeout} \
     http://localhost:{port}{endpoint}
   ```

   Where:
   - `{verbose}` = `-v` if verbose=true, else empty
   - `{followRedirects}` = `-L` if followRedirects=true, else empty
   - `{method}` = GET, POST, PUT, DELETE, PATCH
   - `{headers}` = Additional `-H` flags from headers parameter
   - `{data}` = `-d '{data}'` if data is provided and method supports body
   - `{endpoint}` = API endpoint path

   **Examples:**
   ```bash
   # GET request
   curl -L -X GET \
     -w "\n\nHTTP Status: %{http_code}\nTime: %{time_total}s\n" \
     --max-time 30 \
     http://localhost:3111/api/health

   # POST request with data
   curl -L -X POST \
     -H "Content-Type: application/json" \
     -d '{"key": "value"}' \
     -w "\n\nHTTP Status: %{http_code}\nTime: %{time_total}s\n" \
     --max-time 30 \
     http://localhost:3111/api/clickup/spaces

   # With custom headers
   curl -L -X GET \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer token123" \
     -w "\n\nHTTP Status: %{http_code}\nTime: %{time_total}s\n" \
     --max-time 30 \
     http://localhost:3111/api/protected
   ```

4. **Execute curl command**
   Run the constructed curl command and capture output.

5. **Show logs after test** (if showLogs=true)
   ```bash
   echo "=== Logs during/after test ==="
   tail -n 15 dev.log
   ```

6. **Analyze response**
   - Check HTTP status code (200-299 = success, 400-499 = client error, 500-599 = server error)
   - Parse JSON response if Content-Type is application/json
   - Show timing information
   - Report any errors from logs

7. **Report results**
   ```
   Test Results for {method} {endpoint}
   =====================================
   Status: {http_code} {status_text}
   Time: {time_total}s

   Response:
   {response_body}

   Recent Logs:
   {relevant_log_lines}
   ```

### 3. STOP - Gracefully Stop All Processes

**Steps:**

1. **List all related processes**
   ```bash
   echo "=== Processes to stop ==="
   ps aux | grep -E "(nodemon|npm run dev|tail.*dev.log)" | grep -v grep
   ```

2. **Kill background tasks**
   If you have task IDs from START action, use KillShell tool for each.

3. **Send SIGTERM to remaining processes**
   ```bash
   pkill -f "npm run dev" 2>/dev/null || true
   pkill -f "nodemon" 2>/dev/null || true
   pkill -f "tail -f.*dev.log" 2>/dev/null || true
   sleep 2
   ```

4. **Force kill if still running**
   ```bash
   pkill -9 -f "nodemon" 2>/dev/null || true
   pkill -9 -f "npm run dev" 2>/dev/null || true
   ```

5. **Verify cleanup**
   ```bash
   ps aux | grep -E "(nodemon|npm run dev|tail.*dev.log)" | grep -v grep || echo "All processes stopped"
   ```

6. **Show log summary**
   ```bash
   echo "=== Session Summary ==="
   echo "Log file: dev.log ($(wc -l < dev.log) lines)"
   echo ""
   echo "Last 20 lines:"
   tail -n 20 dev.log
   ```

7. **Report status**
   ```
   ✅ All processes stopped

   Session logs saved to: dev.log
   Run 'tail -f dev.log' to view logs manually
   ```

### 4. RESTART - Restart Server

Equivalent to STOP followed by START.

### 5. STATUS - Check Current Status

**Steps:**

1. **Check if server is running**
   ```bash
   curl -s -o /dev/null -w "%{http_code}" http://localhost:{port}/api/health
   ```

2. **List running processes**
   ```bash
   ps aux | grep -E "(nodemon|npm run dev|tail.*dev.log)" | grep -v grep
   ```

3. **Check dev.log**
   ```bash
   if [ -f dev.log ]; then
     echo "dev.log: $(wc -l < dev.log) lines, last modified: $(stat -f '%Sm' dev.log)"
   else
     echo "dev.log: Not found"
   fi
   ```

4. **Check port availability**
   ```bash
   lsof -i :{port} | grep LISTEN || echo "Port {port} not in use"
   ```

5. **Report status**
   ```
   Integration Test Status
   =======================
   Server: {RUNNING|STOPPED}
   Port {port}: {IN_USE|AVAILABLE}

   Processes:
   {process_list}

   Logs: dev.log ({line_count} lines)
   Last modified: {timestamp}

   Recent log entries:
   {last_10_lines}
   ```

## Error Handling

### Server Won't Start

```bash
# Check if port is already in use
lsof -i :{port}

# If port is in use, suggest killing the process
echo "Port {port} is in use by PID {pid}"
echo "Kill with: kill {pid}"
```

### Server Crashes During Test

Monitor dev.log for errors:
```bash
grep -i "error\|fatal\|exception" dev.log | tail -n 20
```

Report the error and suggest:
1. Check dev.log for stack traces
2. Verify environment variables
3. Check database/API connectivity

### Curl Timeout

If curl times out:
1. Check if server is still running
2. Show recent logs for errors
3. Suggest increasing curlTimeout parameter

### Process Cleanup Fails

If processes won't stop:
```bash
# Nuclear option - find and force kill everything
ps aux | grep -E "(nodemon|npm run dev)" | grep -v grep | awk '{print $2}' | xargs kill -9 2>/dev/null || true
```

## Common Test Scenarios

### Health Check
```
action: test
endpoint: /api/health
method: GET
```

### List ClickUp Spaces
```
action: test
endpoint: /api/clickup/spaces
method: GET
```

### Create Task
```
action: test
endpoint: /api/clickup/tasks
method: POST
data: {"name": "Test Task", "space_id": "123"}
```

### Test Error Handling
```
action: test
endpoint: /api/nonexistent
method: GET
# Should return 404, check logs for proper error logging
```

## Integration Test Workflow

**Typical usage pattern:**

1. **Start server with monitoring**
   ```
   /integration-test action=start showLogs=true
   ```

2. **Run multiple tests**
   ```
   /integration-test action=test endpoint=/api/health
   /integration-test action=test endpoint=/api/clickup/spaces
   /integration-test action=test endpoint=/api/weather method=POST data={"zip":"90210"}
   ```

3. **Check logs for issues**
   ```bash
   grep -i "error" dev.log
   tail -f dev.log  # Watch live
   ```

4. **Stop when done**
   ```
   /integration-test action=stop
   ```

## Advanced Usage

### Testing with Authentication

```
action: test
endpoint: /api/protected
method: GET
headers: {"Authorization": "Bearer <token>"}
```

### Testing Large Payloads

```
action: test
endpoint: /api/upload
method: POST
data: <large_json_string>
verbose: true
```

### Debugging Server Startup

```
action: start
waitForServer: 10
showLogs: true
logTail: 50
```

Then immediately check status:
```
action: status
```

### Load Testing (Multiple Requests)

Start server once, then run multiple test actions:
```bash
for i in {1..10}; do
  /integration-test action=test endpoint=/api/health
done
```

Monitor dev.log for performance issues.

## Important Notes

1. **Always clean up** - Use action=stop when done to prevent orphaned processes
2. **Port conflicts** - If port 3111 is in use, change the port parameter
3. **Log rotation** - dev.log can grow large; archive or clear periodically
4. **Background tasks** - All long-running commands MUST use `run_in_background=true`
5. **Task IDs** - Save task IDs from background processes to enable proper cleanup
6. **Graceful shutdown** - Always try SIGTERM before SIGKILL

## Process Lifecycle Summary

```
START:
  1. Kill any existing processes
  2. Clear dev.log
  3. Start ./dev in background (save task_id)
  4. Start tail -f dev.log in background (save task_id)
  5. Wait for server ready
  6. Report status

TEST:
  1. Verify server is running
  2. Show pre-test logs
  3. Execute curl command
  4. Show post-test logs
  5. Analyze and report results

STOP:
  1. Kill background tasks by task_id
  2. Send SIGTERM to remaining processes
  3. Force kill if needed
  4. Verify all processes stopped
  5. Show log summary
```

This ensures all three threads (server, logs, client) cooperate correctly and shut down gracefully.
