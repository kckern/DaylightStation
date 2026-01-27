# Fitness Context

## Purpose

Heart rate-based fitness tracking with gamification. Users wear heart rate monitors, earn coins based on zone intensity, and video playback is governed by participation requirements.

## Key Concepts

| Term | Definition |
|------|------------|
| **Session** | A workout period with participants, devices, and timeline |
| **Profile** | Persistent user identity (e.g., "kckern") |
| **Entity** | A participation instance in a session - allows same profile to rejoin |
| **Zone** | Heart rate intensity level (cool, active, warm, hot, fire) |
| **TreasureBox** | Coin accumulation system - higher zones earn more coins |
| **Governance** | Policy engine that locks video until requirements met |
| **Ledger** | Device-to-participant assignment tracking |
| **Roster** | Current session participants with their states |

## Exports

| Export | Location | Used By |
|--------|----------|---------|
| FitnessContext | `context/FitnessContext.jsx` | FitnessApp internal |
| Fitness modules | `modules/Fitness/*` | FitnessApp |
| useFitness hooks | `hooks/fitness/*` | FitnessApp |

## Imports

| Import | From | Purpose |
|--------|------|---------|
| Player | `modules/Player/` | Video playback |
| ContentScroller | `modules/ContentScroller/` | Content display |
| WebSocket | foundations | Real-time HR data |
| DaylightLogger | foundations | Event logging |

## File Locations

### Frontend
- `frontend/src/Apps/FitnessApp.jsx` - Main app entry
- `frontend/src/modules/Fitness/` - UI components (36 files)
- `frontend/src/hooks/fitness/` - Domain hooks
  - `FitnessSession.js` - Session management
  - `TreasureBox.js` - Coin accumulation
  - `GovernanceEngine.js` - Policy enforcement
  - `ParticipantRoster.js` - Participant tracking
  - `DeviceManager.js` - Device management
- `frontend/src/context/FitnessContext.jsx` - State management

### Backend
- `backend/routers/fitness.mjs` - API endpoints (~45KB)
- `backend/lib/fitsync.mjs` - Fitness data sync

### Config
- `data/households/{hid}/apps/fitness/config.yml`
  - `governance.policies` - Video lock policies
  - `governance.grace_period_seconds` - Time before enforcement
  - `treasure_box.zones` - Zone definitions with coin rates
  - `devices` - Heart rate monitor definitions

## Identifier Rules

**CRITICAL:** Always use `userId` as dictionary keys, never `name`.

```javascript
// ✅ CORRECT
const userZoneMap = {};
roster.forEach(entry => {
  userZoneMap[entry.userId] = entry.zoneId;
});

// ❌ WRONG - names are not unique, case-sensitive
const userZoneMap = {};
roster.forEach(entry => {
  userZoneMap[entry.name] = entry.zoneId;
});
```

| Identifier | Format | Example | Use For |
|------------|--------|---------|---------|
| userId | lowercase string | "kckern", "milo" | Dictionary keys, lookups |
| entityId | entity-{ts}-{hash} | "entity-1735689600000-abc" | Session participation instance |
| deviceId | string | "42" | Physical device reference |
| name | any case string | "KC Kern" | Display ONLY |

## Common Tasks

- **Debug governance not triggering:** Check `dev.log` for `governance.evaluate` events, verify `userZoneMap` keys match `activeParticipants`
- **Add new zone:** Update config YAML `treasure_box.zones`, ensure `zoneRankMap` is rebuilt
- **Fix coin accumulation:** Check TreasureBox.js `processTick`, verify zone lookup uses userId
- **Session restart issues:** Check entity ID generation, grace period transfer logic

## Related Docs

- `docs/design/session-entity-justification.md`
- `docs/design/fitness-identifier-contract.md`
- `docs/postmortem-governance-entityid-failure.md`
