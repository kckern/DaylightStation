# Fitness Codebase Reference

> **Related code:** `frontend/src/hooks/fitness/`, `frontend/src/modules/Fitness/`, `backend/routers/fitness.mjs`

Key file locations, function reference, and codebase conventions for the Fitness app.

---

## Directory Structure

```
frontend/src/
├── apps/fitness/               # App entry point
├── hooks/fitness/              # Core session logic
│   ├── FitnessSession.js       # Main session orchestrator
│   ├── SessionEntity.js        # Per-participation tracking
│   ├── FitnessTimeline.js      # Time-series data storage
│   ├── TreasureBox.js          # Coin/gamification tracking
│   ├── DeviceManager.js        # ANT+ device registration
│   ├── UserManager.js          # Participant roster
│   └── VoiceMemoManager.js     # Voice memo lifecycle
├── modules/Fitness/            # UI components
│   ├── FitnessSidebar/         # Sidebar with chart
│   ├── FitnessPlugins/         # Plugin system
│   └── domain/                 # Chart data builders
└── contexts/FitnessContext.jsx # React context

backend/
├── routers/fitness.mjs         # API routes
└── lib/fitness/                # Backend utilities
```

---

## Key Files

| File | Purpose |
|------|---------|
| `FitnessSession.js` | Session lifecycle, autosave, tick collection |
| `FitnessTimeline.js` | Series storage, RLE encoding, validation |
| `TreasureBox.js` | Zone-based coin accumulation |
| `SessionEntity.js` | Entity registry, grace period transfers |
| `FitnessChart.helpers.js` | Chart data transformations |

---

## Function Reference

### FitnessSession

```javascript
ensureStarted()           // Initialize session if not started
recordDeviceActivity(d)   // Process HR/cadence data from device
createSessionEntity(opts) // Create new participation entity
get summary()             // Build session payload for save
```

### FitnessTimeline

```javascript
tick(payload)                    // Record tick with metrics
getSeries(prefix, id, metric)    // Get series array
getEntitySeries(entityId, metric)// Get entity-specific series
transferEntitySeries(from, to)   // Grace period transfer
```

### TreasureBox

```javascript
recordUserHeartRate(id, hr)      // Process HR for coin calculation
setActiveEntity(deviceId, eid)   // Set active entity for device
transferAccumulator(from, to)    // Transfer coins on grace period
```

---

## Naming Conventions

- **userId:** Stable user identifier (e.g., `"kckern"`)
- **entityId:** Per-session participation ID (e.g., `"entity-1735689600000-abc12"`)
- **deviceId:** ANT+ device identifier (e.g., `"28676"`)
- **Series keys:** `{type}:{id}:{metric}` (e.g., `"user:kckern:heart_rate"`)

---

**TODO:** Expand with more function documentation and examples.
