# AI Agents Smoke Test

Verify the AI agents infrastructure is working correctly.

## Prerequisites

- Dev server running (port 3112)
- OpenAI API key configured in environment

## Quick Smoke Test

### 1. List Available Agents

```bash
curl -s http://localhost:3112/agents | jq
```

**Expected:**
```json
{
  "agents": [
    {
      "id": "echo",
      "description": "A simple echo agent for testing. Echoes messages and can tell the time."
    }
  ]
}
```

### 2. Run Echo Agent

```bash
curl -s -X POST http://localhost:3112/agents/echo/run \
  -H "Content-Type: application/json" \
  -d '{"input": "Hello, what time is it?"}' | jq
```

**Expected:** Response with `output` containing the echoed message and/or current time.

```json
{
  "agentId": "echo",
  "output": "...",
  "toolCalls": [...]
}
```

### 3. Test Background Execution

```bash
curl -s -X POST http://localhost:3112/agents/echo/run-background \
  -H "Content-Type: application/json" \
  -d '{"input": "Process this in background"}' | jq
```

**Expected:**
```json
{
  "taskId": "uuid-here",
  "status": "accepted"
}
```

## Error Cases

### Missing Input

```bash
curl -s -X POST http://localhost:3112/agents/echo/run \
  -H "Content-Type: application/json" \
  -d '{}' | jq
```

**Expected:** 400 Bad Request
```json
{
  "error": "input is required"
}
```

### Unknown Agent

```bash
curl -s -X POST http://localhost:3112/agents/nonexistent/run \
  -H "Content-Type: application/json" \
  -d '{"input": "test"}' | jq
```

**Expected:** 404 Not Found
```json
{
  "error": "Agent not found: nonexistent"
}
```

## Troubleshooting

### Agent Not Listed

Check bootstrap wiring:
```bash
grep -r "createAgentsApiRouter" backend/src/app.mjs
```

Should show the agents router being created and added to v1Routers.

### 500 Error on Run

Check OpenAI API key:
```bash
echo $OPENAI_API_KEY | head -c 10
```

Should show `sk-...` prefix.

Check server logs for Mastra errors:
```bash
tail -100 dev.log | grep -i agent
```

### Connection Refused

Verify dev server is running:
```bash
ss -tlnp | grep 3112
```

## Unit Tests

Run agent unit tests to verify core functionality:

```bash
node --test backend/tests/unit/agents/*.test.mjs
```

**Expected:** 20 tests passing.
