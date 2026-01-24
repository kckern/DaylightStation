# Development Log Error Audit Report
**Date:** January 23, 2026  
**Log File:** dev.log  
**Analysis Period:** 16:59:00 - 17:00:28

## Executive Summary

This audit identified **5 major error categories** affecting the development environment. While most are non-critical (warnings and configuration issues), there are **2 critical errors** and **multiple unhandled promise rejections** that should be addressed.

---

## Critical Errors (Priority: High)

### 1. **WebSocket Connection Errors**
- **Count:** 2 occurrences
- **Timestamps:** 2026-01-24T00:59:00.546Z, 2026-01-24T00:59:00.558Z
- **Source:** Frontend
- **Event:** `console.error`

```json
{
  "level": "error",
  "event": "console.error",
  "data": {
    "args": ["[WebSocketService] Error:", {"isTrusted": true}]
  }
}
```

**Impact:** WebSocket functionality appears to be failing on frontend initialization. This could affect real-time features like playback synchronization, live updates, and event streaming.

**Recommendation:** 
- Investigate WebSocket service initialization
- Check for CORS or connection issues
- Verify WebSocket server is properly configured and listening

---

### 2. **Menu Logging Configuration Missing**
- **Count:** 8 occurrences
- **Timestamps:** Multiple throughout session (01:00:03 - 01:00:18)
- **Source:** Frontend API calls
- **Event:** `unhandledrejection`

```json
{
  "reason": "HTTP 501: Not Implemented - {\"error\":\"Menu logging not configured\"}",
  "errorType": "Error"
}
```

**Impact:** Every menu selection triggers an unhandled promise rejection. This creates console spam and indicates incomplete feature implementation.

**Recommendation:**
- Either implement menu logging functionality
- Or remove/stub the menu logging API calls if not needed
- Add proper error handling to prevent unhandled rejections

---

### 3. **Talk Content Not Found (404)**
- **Count:** 1 occurrence
- **Timestamp:** 2026-01-24T01:00:18.759Z
- **Source:** Frontend API call
- **Event:** `unhandledrejection`

```json
{
  "reason": "HTTP 404: Not Found - {\"error\":\"Talk not found\",\"path\":\"ldsgc202510\"}",
  "errorType": "Error"
}
```

**Impact:** User attempted to access content (ldsgc202510) that doesn't exist, resulting in an unhandled rejection.

**Recommendation:**
- Add proper error handling for missing content
- Display user-friendly error message
- Consider validating content IDs before making API calls

---

## Warning-Level Issues (Priority: Medium)

### 4. **React PropType Validation Error**
- **Count:** 1 occurrence
- **Timestamp:** 2026-01-24T00:59:42.978Z
- **Source:** Frontend (SinglePlayer component)
- **Event:** `console.error`

```text
Invalid prop `plex` of type `number` supplied to `SinglePlayer`, expected `string`.
```

**Impact:** Type mismatch in React component props. While not breaking functionality, this violates component contracts and could cause unexpected behavior.

**Location:** `SinglePlayer.jsx:88:28`

**Recommendation:**
- Fix prop type: Convert number to string before passing to SinglePlayer
- Or update PropTypes definition if number is the correct type
- Review data flow from parent components

---

### 5. **Playback Transport Capability Missing**
- **Count:** 6 occurrences
- **Timestamps:** Multiple throughout session
- **Source:** Frontend playback system
- **Event:** `playback.transport-capability-missing`

```json
{
  "event": "playback.transport-capability-missing",
  "data": {
    "payload": {"capability": "getMediaEl"}
  }
}
```

**Impact:** Playback system is requesting a capability (`getMediaEl`) that isn't available. This suggests incomplete transport layer implementation.

**Recommendation:**
- Implement `getMediaEl` capability in the transport layer
- Or remove the capability requirement if not needed
- Document expected capabilities for transport implementations

---

### 6. **Audio Shader Dimension Discrepancies**
- **Count:** 6 occurrences
- **Timestamps:** 2026-01-24T00:59:43.041Z - 00:59:43.775Z
- **Source:** Frontend audio shader
- **Event:** `audio-shader.dimensions`

```json
{
  "event": "audio-shader.dimensions",
  "data": {
    "discrepancy": {"top": 177, "left": 342, "bottom": 177, "right": 342},
    "hasGap": true
  }
}
```

**Impact:** Audio shader component is not filling the full viewport, leaving gaps. This is a UI/UX issue affecting the visual display.

**Recommendation:**
- Review audio shader positioning CSS
- Ensure container dimensions match viewport
- Consider if gaps are intentional design or a bug

---

## Configuration Issues (Priority: Low)

### 7. **Home Assistant Disabled**
- **Count:** 2 occurrences (fitness module, home-automation module)
- **Timestamp:** 16:59:00.720, 16:59:00.741
- **Source:** Backend
- **Event:** `fitness.homeassistant.disabled`, `homeAutomation.homeassistant.disabled`

```json
{
  "event": "fitness.homeassistant.disabled",
  "data": {"reason": "Missing baseUrl or token configuration"}
}
```

**Impact:** Home Assistant integration is not configured. This is expected in dev mode without secrets configured.

**Recommendation:** No action needed unless Home Assistant features are required for development.

---

### 8. **Cron Jobs Registry Missing**
- **Count:** 1 occurrence
- **Timestamp:** 16:59:00.765
- **Source:** Backend cron system
- **Event:** `cron.registry.missing`

```json
{
  "event": "cron.registry.missing",
  "data": {"message": "No job definitions found in system/jobs or system/cron-jobs"}
}
```

**Impact:** No scheduled jobs are defined. This is expected in a new/dev environment.

**Recommendation:** No action needed unless cron jobs are required for development.

---

### 9. **Nutribot Icons Not Found**
- **Count:** 1 occurrence
- **Timestamp:** 16:59:01.374
- **Source:** Backend nutribot module
- **Event:** `nutribot.icons.load_failed`

```json
{
  "event": "nutribot.icons.load_failed",
  "data": {"error": "ENOENT: no such file or directory, scandir 'media/img/icons/food'"}
}
```

**Impact:** Food icon directory is missing. This will cause missing images in nutribot UI.

**Recommendation:**
- Create the missing directory: `media/img/icons/food`
- Or update the icon path configuration
- Populate with food icons if needed

---

## Deprecation Warnings (Priority: Low - Informational)

### 10. **Legacy Media Routes (108 occurrences)**
- **Pattern:** `/media/plex/img/*` → `/api/v1/media/plex/img/*`
- **Count:** 108 hits tracked in session
- **Source:** Backend routing layer
- **Event:** `legacy.route.deprecated`

**Impact:** Frontend is still using deprecated URL patterns. System works but migration is pending.

**Example:**
```
GET /media/plex/img/545064 
→ Should be: /api/v1/media/plex/img/545064
```

**Recommendation:**
- Update frontend to use new `/api/v1/media/*` endpoints
- This is technical debt that should be addressed in a dedicated migration task

---

## Statistics Summary

| Category | Count | Severity |
|----------|-------|----------|
| WebSocket Errors | 2 | Critical |
| Unhandled Promise Rejections | 9 | Critical |
| React PropType Errors | 1 | Medium |
| Transport Capability Warnings | 6 | Medium |
| Audio Shader Warnings | 6 | Medium |
| Configuration Warnings | 4 | Low |
| Legacy Route Deprecations | 108 | Low |

---

## Recommended Action Plan

### Immediate (This Sprint)
1. **Fix Menu Logging**: Either implement or remove the feature to eliminate 8 unhandled rejections
2. **WebSocket Service**: Debug and fix WebSocket connection errors
3. **Error Handling**: Add proper try-catch around API calls to prevent unhandled rejections

### Short Term (Next Sprint)
4. **PropType Validation**: Fix the `plex` prop type mismatch in SinglePlayer
5. **Transport Capability**: Implement or remove `getMediaEl` capability requirement
6. **Audio Shader**: Fix dimension calculation to eliminate gaps

### Long Term (Backlog)
7. **Legacy Routes Migration**: Create a ticket to migrate all media routes to `/api/v1/` pattern
8. **Missing Assets**: Create nutribot icons directory and populate with assets

### Non-Issues (No Action)
- Home Assistant disabled warnings (expected in dev)
- Cron registry missing (expected in dev)
- Scheduler disabled warnings (expected in dev)

---

## Notes

- **Overall System Health:** Development environment is functional but has several rough edges
- **User Impact:** Most errors are developer-facing. End users would experience degraded UX (console errors, missing features)
- **Test Coverage:** Consider adding error boundary components and more robust error handling throughout the frontend
- **Logging Quality:** JSON structured logging is excellent and made this audit straightforward

---

## Appendix: Sample Error Traces

### WebSocket Error Stack
```
Location: Frontend WebSocketService
Trigger: On initial connection
Error Type: TrustedEvent (connection failure)
```

### Menu Logging Error Stack
```javascript
Error: HTTP 501: Not Implemented - {"error":"Menu logging not configured"}
    at DaylightAPI (http://localhost:3111/src/lib/api.mjs:41:15)
    at async logMenuSelection (http://localhost:3111/src/modules/Menu/Menu.jsx:34:5)
```

### PropType Error Location
```
Component: SinglePlayer (http://localhost:3111/src/modules/Player/components/SinglePlayer.jsx:88:28)
Parent Chain: Player2 → MenuStack → TVAppContent → TVAppWrapper → MenuNavigationProvider → TVApp
```
