# Log Coverage Analysis

You are analyzing the DaylightStation codebase to find missing logging statements in critical code paths.

## Context

Good logging practices require logs at key points:
- **Error handlers**: All catch blocks, error callbacks, rejection handlers
- **API endpoints**: Request received, response sent, errors
- **WebSocket handlers**: Connection events, message received/sent, errors
- **External integrations**: API calls to Garmin, Strava, Google, etc. with success/failure
- **Data mutations**: File writes, database updates, state changes

## Your Tasks

Based on the parameters provided, identify missing logs in these areas:

### 1. Error Handlers (if checkErrorHandlers=true)

Find error handling code without logging:

**Patterns to search for:**
- `catch (error)` or `catch (err)` blocks
- `.catch(...)` promise handlers
- `error` callback parameters
- `on('error', ...)` event handlers

**What to check:**
- Does the error handler have a log statement?
- Is it using the right level (error/warn)?
- Does it include relevant context (operation, user, resource)?
- Is the error object logged properly?

**Severity:**
- **Critical**: Error handlers in authentication, data persistence, payment processing
- **High**: Error handlers in API routes, core business logic
- **Medium**: Error handlers in background jobs, caching
- **Low**: Error handlers in optional features, fallback scenarios

### 2. API Endpoints (if checkApiEndpoints=true)

Find Express routes missing request/response logging:

**Patterns to search for:**
- `router.get/post/put/delete/patch(...)` in `backend/routers/`
- Route handler functions

**What to check:**
- Is there a log when the request is received? (info level)
- Is there a log when processing succeeds? (info level)
- Is there error logging in the handler? (error level)
- Are important parameters logged (sanitized)?

**Example good pattern:**
```javascript
router.post('/api/fitness/data', async (req, res) => {
  fitnessLogger.info('Fitness data received', {
    userId: req.user.id,
    dataType: req.body.type
  });

  try {
    const result = await processFitnessData(req.body);
    fitnessLogger.info('Fitness data processed', { userId: req.user.id });
    res.json(result);
  } catch (error) {
    fitnessLogger.error('Failed to process fitness data', {
      userId: req.user.id,
      error: error.message
    });
    res.status(500).json({ error: 'Processing failed' });
  }
});
```

### 3. WebSocket Handlers (if checkWebSocketHandlers=true)

Find WebSocket event handlers missing logging:

**Patterns to search for:**
- `ws.on('message', ...)`
- `ws.on('connection', ...)`
- `ws.on('close', ...)`
- `ws.on('error', ...)`
- WebSocket message bus publish/subscribe

**What to check:**
- Connection/disconnection events logged?
- Message types and topics logged?
- Errors in message processing logged?
- Subscription changes logged?

### 4. Integration Calls (if checkIntegrationCalls=true)

Find external API calls without success/failure logging:

**Patterns to search for:**
- `axios.get/post/put/delete(...)`
- `fetch(...)`
- `googleapis.*`
- Garmin, Strava, Todoist client calls

**What to check:**
- Is there a log before the API call? (debug level, with sanitized params)
- Is there a log on success? (info level, with relevant response data)
- Is there a log on failure? (error level, with error details)
- Are retries logged? (warn level)
- Are rate limits logged? (warn level)

**Example good pattern:**
```javascript
async function syncGarminData(userId) {
  garminLogger.debug('Fetching Garmin data', { userId });

  try {
    const data = await garminClient.getActivities(userId);
    garminLogger.info('Garmin data fetched', {
      userId,
      activityCount: data.length
    });
    return data;
  } catch (error) {
    garminLogger.error('Failed to fetch Garmin data', {
      userId,
      error: error.message,
      statusCode: error.response?.status
    });
    throw error;
  }
}
```

### 5. Data Mutations (if checkDataMutations=true)

Find data changes without audit logging:

**Patterns to search for:**
- `saveFile(...)`, `writeFile(...)`
- `fs.writeFile`, `fs.unlink`, `fs.rename`
- State changes in critical data structures
- Configuration updates

**What to check:**
- Is the mutation logged before it happens? (info level)
- Is success confirmed with a log? (info level)
- Is failure logged with details? (error level)
- Does the log include what changed and why?

## Analysis Process

1. **Scan for patterns**: Use Glob and Grep to find code matching the patterns above
2. **Read context**: For each match, read the surrounding code to understand if logging exists
3. **Classify severity**: Determine criticality based on the operation and data involved
4. **Check completeness**: Ensure logs include enough context (user, operation, outcome)
5. **Compare to best practices**: Use the examples above as reference

## Output Formats

### Summary Format
```
Log Coverage Analysis
=====================
Target: {target}
Severity: {severity}

Missing Logs Found:
- Error handlers: {count} ({critical} critical)
- API endpoints: {count} ({critical} critical)
- WebSocket handlers: {count}
- Integration calls: {count}
- Data mutations: {count}

Coverage Score: {percentage}%
Priority: {count} critical issues to address immediately
```

### Detailed Format
For each finding:
```
[CRITICAL/HIGH/MEDIUM/LOW] Missing log in {file}:{line}

Context: {description of what the code does}
Issue: {what logging is missing}
Impact: {why this matters}
Recommendation: {suggested log statement}

Code:
{relevant code snippet}

Suggested addition:
{example log statement to add}
```

### Action Items Format
Prioritized list of changes to make:
```
## Critical (Do First)
- [ ] Add error logging to authentication handler (backend/routers/auth.mjs:45)
- [ ] Add failure logging to Garmin sync (backend/lib/garmin.mjs:123)

## High (Do Soon)
- [ ] Add request logging to /api/fitness/data endpoint (backend/routers/fitness.mjs:67)
...
```

## Generate Tests (if generateTests=true)

Create Jest test cases that verify logging behavior:
```javascript
describe('Fitness data endpoint logging', () => {
  it('should log when fitness data is received', async () => {
    const logSpy = jest.spyOn(fitnessLogger, 'info');
    await request(app).post('/api/fitness/data').send({...});
    expect(logSpy).toHaveBeenCalledWith('Fitness data received', expect.any(Object));
  });

  it('should log error when processing fails', async () => {
    const logSpy = jest.spyOn(fitnessLogger, 'error');
    // Trigger error condition
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Failed'), expect.any(Object));
  });
});
```

## Execution Steps

1. Based on `target` parameter, determine which directories to scan
2. For each enabled check, search for relevant patterns
3. Read files with matches and analyze context
4. Filter by severity threshold
5. Compile findings with recommendations
6. Generate output in requested format
7. If generateTests=true, create test cases

## Important Notes

- Focus on **missing** logs, not bad logs (that's logging-consistency's job)
- Consider the user's perspective: what would you want to see in logs when debugging?
- Balance verbosity with usefulness
- Critical paths (auth, payments, data loss) need comprehensive logging
- Background tasks and optional features can have lighter logging
- When recommending log statements, include relevant context fields
