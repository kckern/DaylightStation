# Fitness Session E2E Test Design

**Date:** 2026-01-05
**Status:** Approved
**Related code:** `tests/runtime/fitness-session/`, `frontend/src/hooks/fitness/`, `simulation.mjs`

## Overview

End-to-end runtime tests to verify fitness sessions run correctly and persist to file. These tests use Playwright to automate browser interaction and the existing simulation script to generate realistic device data.

## Test Structure

### Setup Phase (beforeAll)
1. Kill any existing dev server (`lsof -ti:5173 -ti:3112 | xargs kill`)
2. Clear `dev.log` for fresh logging
3. Start dev server (`npm run dev`)
4. Wait for both ports (5173 frontend, 3112 backend)
5. Navigate to fitness page

### Teardown Phase (afterAll)
1. Stop dev server
2. Optionally archive logs on failure

## Test Cases

### Test 1: Session File Created
- Count session files before simulation
- Run 2-minute simulation
- Wait 5 seconds for final save
- Verify new session file exists

### Test 2: Valid Structure
- Read latest session file
- Validate required fields: `sessionId`, `startTime`, `endTime`, `durationMs`, `timeline`, `participants`
- Validate timeline has: `timebase`, `series`, `events`

### Test 3: Data Accuracy
- Duration within 10% of expected (2 minutes)
- Tick count within 20% of expected (~24 ticks at 5s intervals)
- Has user series data (heart-rate, zone-id, etc.)

### Test 4: UI Shows Chart
- Navigate to fitness page
- Run short simulation (30s)
- Verify chart component is visible

## Simulation Script Changes

Add `--duration` CLI argument to `simulation.mjs`:

```javascript
const args = process.argv.slice(2);
const durationArg = args.find(a => a.startsWith('--duration='));
const DURATION_SECONDS = durationArg
  ? parseInt(durationArg.split('=')[1], 10)
  : 120; // Default 2 minutes
```

## Helper Utilities

`tests/runtime/fitness-session/fitness-test-utils.mjs` provides:

- `startDevServer()` - Spawns npm run dev, waits for ports
- `stopDevServer()` - Kills processes on 5173/3112
- `clearDevLog()` - Truncates dev.log
- `runSimulation(duration)` - Runs simulation.mjs with duration
- `getSessionFilesForToday()` - Lists today's session files
- `getLatestSessionFile()` - Returns most recent session path
- `readSessionFile(path)` - Parses YAML session file
- `validateSessionStructure(session)` - Validates required fields

## Running Tests

```bash
# Run fitness session tests
npm run rt:fitness

# Or directly
npx playwright test tests/runtime/fitness-session --headed
```

## Success Criteria

- All 4 tests pass consistently
- Session files are created with accurate data
- No regression when cleanupOrphanGuests fix is properly implemented
