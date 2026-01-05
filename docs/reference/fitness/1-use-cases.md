# Fitness Use Cases

> **Related code:** `frontend/src/apps/fitness/`, `backend/routers/fitness.mjs`

Problem statements, requirements, and user experience flows for the Fitness app.

---

## Primary Use Cases

### Family Workout Sessions

**Problem:** Families want to exercise together with real-time feedback on heart rate zones and gamified motivation.

**Solution:** ANT+ heart rate monitors connect to the system, displaying live heart rate, zone classification, and coin rewards on a shared TV display.

### Guest Participation

**Problem:** Visitors should be able to join workouts without creating permanent profiles.

**Solution:** Guest assignment system allows temporary device assignment with independent coin tracking via Session Entities.

### Progress Tracking

**Problem:** Users want to see historical workout data and trends.

**Solution:** Session data persists to YAML files with timeline series for post-session analysis.

---

## User Flows

### Start Workout
1. Navigate to Fitness app
2. Put on ANT+ heart rate monitor
3. System detects device and assigns to user
4. Workout begins automatically when HR data received

### Assign Guest
1. During active session, open guest assignment menu
2. Select device to reassign
3. Enter guest name or select existing guest profile
4. Guest starts fresh with 0 coins

### End Workout
1. Session auto-ends after 3 minutes of inactivity
2. Or manual end via UI
3. Final save persists all data to backend

---

**TODO:** Expand with detailed user stories and acceptance criteria.
