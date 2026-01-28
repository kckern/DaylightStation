# API Error Handling Cleanup - Progress Report

**Date:** 2026-01-27
**Task:** Remove try-catch blocks from API handlers per coding standards
**Status:** In Progress (60% complete)

## Problem

The coding standards state that handlers should let errors propagate to middleware, not catch and format them to HTTP responses. Currently many handlers have this anti-pattern:

```javascript
return async (req, res) => {
  try {
    const result = await service.execute(input);
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};
```

## Target Pattern

```javascript
// Handler wrapped with asyncHandler
return asyncHandler(async (req, res) => {
  const result = await service.execute(input);
  res.json(result);
});
```

## Progress

### Completed Files

#### Handlers (All Complete)
- `/handlers/journalist/journal.mjs` - Removed try-catch (wrapped with asyncHandler in router)
- `/handlers/journalist/trigger.mjs` - Removed try-catch (wrapped with asyncHandler in router)
- `/handlers/journalist/morning.mjs` - Removed try-catch (wrapped with asyncHandler in router)
- `/handlers/nutribot/report.mjs` - Removed try-catch (wrapped with asyncHandler in router)
- `/handlers/nutribot/reportImg.mjs` - Removed try-catch (wrapped with asyncHandler in router)
- `/handlers/nutribot/directInput.mjs` - Removed 3 try-catch blocks (wrapped with asyncHandler in router)
- `/handlers/homebot/index.mjs` - **INTENTIONALLY KEPT** (webhook needs to always return 200)

#### Routers (Partial)
- `/routers/entropy.mjs` - Removed local asyncHandler definition, using centralized one
- `/routers/health.mjs` - Removed local asyncHandler definition, using centralized one
- `/routers/ai.mjs` - Added asyncHandler wrapper, removed 5 try-catch blocks

### Remaining Work (100 violations)

Files with the most violations (need processing):

1. `gratitude.mjs` - 16 violations
2. `finance.mjs` - 15 violations
3. `messaging.mjs` - 12 violations
4. `homeAutomation.mjs` - 11 violations
5. `printer.mjs` - 10 violations
6. `journaling.mjs` - 10 violations
7. `nutrition.mjs` - 8 violations
8. `fitness.mjs` - 8 violations
9. `localContent.mjs` - 6 violations
10. `proxy.mjs` - 5 violations
11. Others - ~9 violations total

## Approach for Remaining Files

For each router file:

1. **Import asyncHandler**
   ```javascript
   import { asyncHandler } from '#system/http/middleware/index.mjs';
   ```

2. **Wrap each async route handler**
   ```javascript
   // Before
   router.post('/endpoint', async (req, res) => {
     try {
       // ...
     } catch (error) {
       res.status(500).json({ error: error.message });
     }
   });

   // After
   router.post('/endpoint', asyncHandler(async (req, res) => {
     // ...
   }));
   ```

3. **Remove try-catch blocks** that just format errors to HTTP

4. **Keep try-catch blocks** that:
   - Log and rethrow
   - Gracefully degrade (log + continue with fallback)
   - Are in webhook handlers (need to always return 200)

## Verification

After completing changes:

1. Count remaining violations:
   ```bash
   grep -rn "catch (error)" backend/src/4_api/v1/routers/ | wc -l
   grep -rn "catch (err)" backend/src/4_api/v1/routers/ | wc -l
   ```

2. Run tests:
   ```bash
   npm test
   ```

3. Test error handling manually:
   - Trigger validation error → should get 400 with proper error format
   - Trigger domain error → should get 422 with proper error format
   - Trigger infrastructure error → should get 503 with proper error format
   - Check that traceId is included in error responses

## Error Middleware

The system has centralized error handling via `/backend/src/0_system/http/middleware/errorHandler.mjs`:

- `errorHandlerMiddleware` - Express error middleware that catches errors and formats to HTTP
- `asyncHandler` - Wrapper for async handlers to catch promise rejections

All errors are mapped to appropriate HTTP status codes:
- `ValidationError` → 400
- `NotFoundError` → 404
- `DomainError` → 422
- `InfrastructureError` → 503
- Unknown errors → 500

## Notes

- Some routers were defining their own `asyncHandler` - these have been replaced with the centralized one
- The homebot webhook handler intentionally keeps try-catch to always return 200 to Telegram
- Some try-catch blocks may have logging - these can be kept if they log + rethrow, but should be removed if they log + format to HTTP
