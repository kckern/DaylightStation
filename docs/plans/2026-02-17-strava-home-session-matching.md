# Strava-Home Session Matching Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bidirectionally link Strava activities to home fitness sessions by time overlap, enriching both sides with data from the other.

**Architecture:** New private method `#matchHomeSessions()` on StravaHarvester runs after summary generation. It reads home fitness session YAML files from the household history directory, matches by time overlap (±5 min buffer) and participant username, then enriches the Strava summary/archive and home session files.

**Tech Stack:** moment-timezone (already used), loadYamlSafe/saveYaml/listYamlFiles from FileIO.mjs (already imported)

---

### Task 1: Add `fitnessHistoryDir` to constructor

**Files:**
- Modify: `backend/src/1_adapters/harvester/fitness/StravaHarvester.mjs:33-90`
- Test: `tests/isolated/adapter/harvester/fitness/StravaHarvester.test.mjs`

**Step 1: Write the failing test**

Add to the `constructor` describe block in the test file:

```javascript
it('should accept fitnessHistoryDir dependency', async () => {
  const { StravaHarvester } = await import('#adapters/harvester/fitness/StravaHarvester.mjs');

  harvester = new StravaHarvester({
    stravaClient: mockStravaClient,
    lifelogStore: mockLifelogStore,
    configService: mockConfigService,
    fitnessHistoryDir: '/tmp/test-fitness-history',
    logger: mockLogger
  });

  expect(harvester).toBeInstanceOf(StravaHarvester);
});
```

**Step 2: Run test to verify it passes (no changes needed — extra constructor args are ignored)**

Run: `npx jest tests/isolated/adapter/harvester/fitness/StravaHarvester.test.mjs --verbose`

This will pass already since JS destructuring ignores extra keys. But the value isn't stored yet.

**Step 3: Add the private field and constructor wiring**

In `StravaHarvester.mjs`, add private field after line 40:

```javascript
#fitnessHistoryDir;
```

In the constructor destructuring (line 52), add parameter:

```javascript
fitnessHistoryDir = null,
```

After line 82 (after `this.#logger = logger;`), add:

```javascript
this.#fitnessHistoryDir = fitnessHistoryDir;
```

**Step 4: Run tests to verify nothing breaks**

Run: `npx jest tests/isolated/adapter/harvester/fitness/StravaHarvester.test.mjs --verbose`
Expected: All existing tests PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/harvester/fitness/StravaHarvester.mjs tests/isolated/adapter/harvester/fitness/StravaHarvester.test.mjs
git commit -m "feat(strava): add fitnessHistoryDir constructor parameter"
```

---

### Task 2: Implement `#loadHomeSessions()` helper

**Files:**
- Modify: `backend/src/1_adapters/harvester/fitness/StravaHarvester.mjs`
- Test: `tests/isolated/adapter/harvester/fitness/StravaHarvester.test.mjs`

This helper loads all home fitness session YAML files for a given date range and returns them as an array of `{ sessionId, start, end, participants }`.

**Step 1: Write the failing test**

Add a new describe block to the test file:

```javascript
describe('home session matching', () => {
  let StravaHarvester;
  let tmpDir;

  beforeEach(async () => {
    ({ StravaHarvester } = await import('#adapters/harvester/fitness/StravaHarvester.mjs'));
    tmpDir = path.join(os.tmpdir(), `strava-test-${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should match Strava activity to overlapping home session', async () => {
    // Create a home session file: 2026-02-15 19:12-19:20 with participant kckern
    const dateDir = path.join(tmpDir, '2026-02-15');
    fs.mkdirSync(dateDir, { recursive: true });

    const sessionData = {
      sessionId: '20260215191250',
      session: {
        id: '20260215191250',
        date: '2026-02-15',
        start: '2026-02-15 19:12:50',
        end: '2026-02-15 19:20:50',
        duration_seconds: 480,
      },
      timezone: 'America/Los_Angeles',
      participants: {
        kckern: {
          display_name: 'KC Kern',
          hr_device: '40475',
          is_primary: true,
        },
      },
      treasureBox: { totalCoins: 15 },
      timeline: { events: [] },
    };

    // Use saveYaml to write fixture
    const { saveYaml } = await import('#system/utils/FileIO.mjs');
    saveYaml(path.join(dateDir, '20260215191250'), sessionData);

    // Strava activity overlaps: starts 19:10, lasts 10 min (ends 19:20)
    const activity = {
      id: 17418186050,
      start_date: '2026-02-16T03:10:00Z', // UTC = 2026-02-15 19:10 PST
      moving_time: 600,
      type: 'WeightTraining',
      name: 'Evening Weight Training',
      suffer_score: 5,
      device_name: 'Garmin Forerunner 245 Music',
    };

    harvester = new StravaHarvester({
      stravaClient: mockStravaClient,
      lifelogStore: mockLifelogStore,
      configService: mockConfigService,
      fitnessHistoryDir: tmpDir,
      timezone: 'America/Los_Angeles',
      logger: mockLogger,
    });

    // Call the public wrapper for testing
    const matches = await harvester.matchHomeSessions('kckern', [activity]);

    expect(matches).toHaveLength(1);
    expect(matches[0].activityId).toBe(17418186050);
    expect(matches[0].sessionId).toBe('20260215191250');
  });

  it('should NOT match when user is not a participant', async () => {
    const dateDir = path.join(tmpDir, '2026-02-15');
    fs.mkdirSync(dateDir, { recursive: true });

    const sessionData = {
      sessionId: '20260215191250',
      session: {
        id: '20260215191250',
        date: '2026-02-15',
        start: '2026-02-15 19:12:50',
        end: '2026-02-15 19:20:50',
        duration_seconds: 480,
      },
      timezone: 'America/Los_Angeles',
      participants: {
        milo: { display_name: 'Milo', is_primary: true },
      },
      treasureBox: { totalCoins: 10 },
      timeline: { events: [] },
    };

    const { saveYaml } = await import('#system/utils/FileIO.mjs');
    saveYaml(path.join(dateDir, '20260215191250'), sessionData);

    const activity = {
      id: 17418186050,
      start_date: '2026-02-16T03:10:00Z',
      moving_time: 600,
      type: 'WeightTraining',
    };

    harvester = new StravaHarvester({
      stravaClient: mockStravaClient,
      lifelogStore: mockLifelogStore,
      configService: mockConfigService,
      fitnessHistoryDir: tmpDir,
      timezone: 'America/Los_Angeles',
      logger: mockLogger,
    });

    const matches = await harvester.matchHomeSessions('kckern', [activity]);
    expect(matches).toHaveLength(0);
  });

  it('should NOT match when times do not overlap within 5 min buffer', async () => {
    const dateDir = path.join(tmpDir, '2026-02-15');
    fs.mkdirSync(dateDir, { recursive: true });

    const sessionData = {
      sessionId: '20260215150000',
      session: {
        id: '20260215150000',
        date: '2026-02-15',
        start: '2026-02-15 15:00:00',
        end: '2026-02-15 15:10:00',
        duration_seconds: 600,
      },
      timezone: 'America/Los_Angeles',
      participants: {
        kckern: { display_name: 'KC Kern', is_primary: true },
      },
      treasureBox: { totalCoins: 5 },
      timeline: { events: [] },
    };

    const { saveYaml } = await import('#system/utils/FileIO.mjs');
    saveYaml(path.join(dateDir, '20260215150000'), sessionData);

    // Strava activity at 19:10 — way too far from 15:00 session
    const activity = {
      id: 17418186050,
      start_date: '2026-02-16T03:10:00Z',
      moving_time: 600,
      type: 'WeightTraining',
    };

    harvester = new StravaHarvester({
      stravaClient: mockStravaClient,
      lifelogStore: mockLifelogStore,
      configService: mockConfigService,
      fitnessHistoryDir: tmpDir,
      timezone: 'America/Los_Angeles',
      logger: mockLogger,
    });

    const matches = await harvester.matchHomeSessions('kckern', [activity]);
    expect(matches).toHaveLength(0);
  });
});
```

Add imports at the top of the test file:

```javascript
import path from 'path';
import os from 'os';
import fs from 'fs';
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/adapter/harvester/fitness/StravaHarvester.test.mjs --verbose -t "home session matching"`
Expected: FAIL — `harvester.matchHomeSessions is not a function`

**Step 3: Implement `#loadHomeSessions()` and `#matchHomeSessions()` and public wrapper**

Add to `StravaHarvester.mjs` before the `#delay()` method:

```javascript
/**
 * Load home fitness sessions for a date range
 * @private
 * @param {string[]} dates - Array of YYYY-MM-DD date strings
 * @returns {Array<Object>} Session objects with parsed start/end times
 */
#loadHomeSessions(dates) {
  if (!this.#fitnessHistoryDir) return [];

  const sessions = [];

  for (const date of dates) {
    const dateDir = path.join(this.#fitnessHistoryDir, date);
    const files = listYamlFiles(dateDir);

    for (const filename of files) {
      const filePath = path.join(dateDir, `${filename}.yml`);
      const data = loadYamlSafe(filePath);
      if (!data?.session?.start || !data?.participants) continue;

      sessions.push({
        sessionId: data.sessionId || data.session?.id,
        start: moment.tz(data.session.start, data.timezone || this.#timezone),
        end: data.session.end
          ? moment.tz(data.session.end, data.timezone || this.#timezone)
          : moment.tz(data.session.start, data.timezone || this.#timezone)
              .add(data.session.duration_seconds || 0, 'seconds'),
        participants: Object.keys(data.participants || {}),
        coins: data.treasureBox?.totalCoins ?? 0,
        media: (data.timeline?.events || [])
          .filter(e => e.type === 'media')
          .map(e => e.data?.title)
          .filter(Boolean)
          .join(', ') || null,
        filePath,
      });
    }
  }

  return sessions;
}

/**
 * Match Strava activities to home fitness sessions by time overlap
 * @private
 * @param {string} username - DaylightStation username
 * @param {Array} activities - Strava activity objects
 * @returns {Array<{ activityId, sessionId, session }>} Matched pairs
 */
#findMatches(username, activities) {
  const BUFFER_MS = 5 * 60 * 1000; // 5 minutes

  // Collect unique dates from activities
  const dates = [...new Set(activities.map(a =>
    moment(a.start_date).tz(this.#timezone).format('YYYY-MM-DD')
  ))];

  const homeSessions = this.#loadHomeSessions(dates);
  if (homeSessions.length === 0) return [];

  const matches = [];

  for (const activity of activities) {
    if (!activity?.id || !activity?.start_date) continue;

    const actStart = moment(activity.start_date).tz(this.#timezone);
    const actEnd = actStart.clone().add(activity.moving_time || 0, 'seconds');

    // Expand window by buffer
    const actStartBuffered = actStart.clone().subtract(BUFFER_MS, 'ms');
    const actEndBuffered = actEnd.clone().add(BUFFER_MS, 'ms');

    let bestMatch = null;
    let bestOverlap = 0;

    for (const session of homeSessions) {
      // Check participant
      if (!session.participants.includes(username)) continue;

      // Check time overlap with buffer
      const overlapStart = moment.max(actStartBuffered, session.start);
      const overlapEnd = moment.min(actEndBuffered, session.end);
      const overlapMs = overlapEnd.diff(overlapStart);

      if (overlapMs > 0 && overlapMs > bestOverlap) {
        bestOverlap = overlapMs;
        bestMatch = session;
      }
    }

    if (bestMatch) {
      matches.push({
        activityId: activity.id,
        sessionId: bestMatch.sessionId,
        session: bestMatch,
        activity,
      });
    }
  }

  return matches;
}

/**
 * Public wrapper for matching (used by tests and potential CLI)
 * @param {string} username
 * @param {Array} activities
 * @returns {Promise<Array>}
 */
async matchHomeSessions(username, activities) {
  return this.#findMatches(username, activities);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/adapter/harvester/fitness/StravaHarvester.test.mjs --verbose`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/harvester/fitness/StravaHarvester.mjs tests/isolated/adapter/harvester/fitness/StravaHarvester.test.mjs
git commit -m "feat(strava): add home session matching by time overlap"
```

---

### Task 3: Implement enrichment logic

**Files:**
- Modify: `backend/src/1_adapters/harvester/fitness/StravaHarvester.mjs`
- Test: `tests/isolated/adapter/harvester/fitness/StravaHarvester.test.mjs`

**Step 1: Write the failing test**

Add to the `home session matching` describe block:

```javascript
it('should enrich Strava summary with home session data', async () => {
  const dateDir = path.join(tmpDir, '2026-02-15');
  fs.mkdirSync(dateDir, { recursive: true });

  const sessionData = {
    sessionId: '20260215191250',
    session: {
      id: '20260215191250',
      date: '2026-02-15',
      start: '2026-02-15 19:12:50',
      end: '2026-02-15 19:20:50',
      duration_seconds: 480,
    },
    timezone: 'America/Los_Angeles',
    participants: {
      kckern: { display_name: 'KC Kern', is_primary: true },
    },
    treasureBox: { totalCoins: 15 },
    timeline: {
      events: [
        { timestamp: 123, type: 'media', data: { title: 'Mario Kart 8' } },
      ],
    },
  };

  const { saveYaml } = await import('#system/utils/FileIO.mjs');
  saveYaml(path.join(dateDir, '20260215191250'), sessionData);

  const activity = {
    id: 17418186050,
    start_date: '2026-02-16T03:10:00Z',
    moving_time: 600,
    type: 'WeightTraining',
    name: 'Evening Weight Training',
    suffer_score: 5,
    device_name: 'Garmin Forerunner 245 Music',
  };

  // Pre-populate summary so enrichment can modify it
  const existingSummary = {
    '2026-02-15': [
      { id: 17418186050, title: 'Evening Weight Training', type: 'WeightTraining' },
    ],
  };
  mockLifelogStore.load.mockResolvedValue(existingSummary);

  harvester = new StravaHarvester({
    stravaClient: mockStravaClient,
    lifelogStore: mockLifelogStore,
    configService: mockConfigService,
    fitnessHistoryDir: tmpDir,
    timezone: 'America/Los_Angeles',
    logger: mockLogger,
  });

  await harvester.applyHomeSessionEnrichment('kckern', [activity]);

  // Check that summary was re-saved with enrichment
  const saveCalls = mockLifelogStore.save.mock.calls;
  const summarySave = saveCalls.find(c => c[1] === 'strava');
  expect(summarySave).toBeTruthy();

  const savedSummary = summarySave[2];
  const enrichedEntry = savedSummary['2026-02-15'].find(a => a.id === 17418186050);
  expect(enrichedEntry.homeSessionId).toBe('20260215191250');
  expect(enrichedEntry.homeCoins).toBe(15);
  expect(enrichedEntry.homeMedia).toBe('Mario Kart 8');
});

it('should enrich home session file with Strava data', async () => {
  const dateDir = path.join(tmpDir, '2026-02-15');
  fs.mkdirSync(dateDir, { recursive: true });

  const sessionData = {
    sessionId: '20260215191250',
    session: {
      id: '20260215191250',
      date: '2026-02-15',
      start: '2026-02-15 19:12:50',
      end: '2026-02-15 19:20:50',
      duration_seconds: 480,
    },
    timezone: 'America/Los_Angeles',
    participants: {
      kckern: { display_name: 'KC Kern', is_primary: true },
    },
    treasureBox: { totalCoins: 15 },
    timeline: { events: [] },
  };

  const { saveYaml, loadYamlSafe } = await import('#system/utils/FileIO.mjs');
  const sessionPath = path.join(dateDir, '20260215191250');
  saveYaml(sessionPath, sessionData);

  const activity = {
    id: 17418186050,
    start_date: '2026-02-16T03:10:00Z',
    moving_time: 600,
    type: 'WeightTraining',
    name: 'Evening Weight Training',
    suffer_score: 5,
    device_name: 'Garmin Forerunner 245 Music',
  };

  mockLifelogStore.load.mockResolvedValue({
    '2026-02-15': [{ id: 17418186050, type: 'WeightTraining' }],
  });

  harvester = new StravaHarvester({
    stravaClient: mockStravaClient,
    lifelogStore: mockLifelogStore,
    configService: mockConfigService,
    fitnessHistoryDir: tmpDir,
    timezone: 'America/Los_Angeles',
    logger: mockLogger,
  });

  await harvester.applyHomeSessionEnrichment('kckern', [activity]);

  // Read back the home session file
  const updated = loadYamlSafe(sessionPath);
  expect(updated.participants.kckern.strava).toBeDefined();
  expect(updated.participants.kckern.strava.activityId).toBe(17418186050);
  expect(updated.participants.kckern.strava.type).toBe('WeightTraining');
  expect(updated.participants.kckern.strava.sufferScore).toBe(5);
  expect(updated.participants.kckern.strava.deviceName).toBe('Garmin Forerunner 245 Music');
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/adapter/harvester/fitness/StravaHarvester.test.mjs --verbose -t "should enrich"`
Expected: FAIL — `harvester.applyHomeSessionEnrichment is not a function`

**Step 3: Implement `#applyEnrichment()` and public wrapper**

Add to `StravaHarvester.mjs`:

```javascript
/**
 * Apply enrichment from matches to both Strava and home session data
 * @private
 * @param {string} username
 * @param {Array} matches - Output from #findMatches
 */
async #applyEnrichment(username, matches) {
  if (matches.length === 0) return;

  // 1. Enrich Strava summary
  const summary = await this.#lifelogStore.load(username, 'strava') || {};
  for (const match of matches) {
    const date = moment(match.activity.start_date).tz(this.#timezone).format('YYYY-MM-DD');
    const entries = summary[date];
    if (!entries) continue;

    const entry = entries.find(e => e.id === match.activityId);
    if (entry) {
      entry.homeSessionId = match.sessionId;
      entry.homeCoins = match.session.coins;
      if (match.session.media) entry.homeMedia = match.session.media;
    }
  }
  await this.#lifelogStore.save(username, 'strava', summary);

  // 2. Enrich Strava archive files
  for (const match of matches) {
    const date = moment(match.activity.start_date).tz(this.#timezone).format('YYYY-MM-DD');
    const typeRaw = match.activity.type || match.activity.sport_type || 'activity';
    const safeType = typeRaw.replace(/\s+/g, '').replace(/[^A-Za-z0-9_-]/g, '') || 'activity';
    const archiveName = `strava/${date}_${safeType}_${match.activityId}`;

    const archive = await this.#lifelogStore.load(username, archiveName);
    if (archive?.data) {
      archive.data.homeSessionId = match.sessionId;
      archive.data.homeCoins = match.session.coins;
      if (match.session.media) archive.data.homeMedia = match.session.media;
      await this.#lifelogStore.save(username, archiveName, archive);
    }
  }

  // 3. Enrich home session files
  for (const match of matches) {
    const data = loadYamlSafe(match.session.filePath);
    if (!data?.participants) continue;

    // Find the participant matching username
    if (data.participants[username]) {
      data.participants[username].strava = {
        activityId: match.activityId,
        type: match.activity.type || match.activity.sport_type || null,
        sufferScore: match.activity.suffer_score || null,
        deviceName: match.activity.device_name || null,
      };

      // saveYaml expects path without .yml — strip if filePath has it
      const savePath = match.session.filePath.replace(/\.yml$/, '');
      saveYaml(savePath, data);
    }
  }

  this.#logger.info?.('strava.homeMatch.complete', {
    username,
    matchCount: matches.length,
    sessionIds: matches.map(m => m.sessionId),
  });
}

/**
 * Public wrapper: find matches and apply enrichment
 * @param {string} username
 * @param {Array} activities
 */
async applyHomeSessionEnrichment(username, activities) {
  const matches = this.#findMatches(username, activities);
  await this.#applyEnrichment(username, matches);
  return matches;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/adapter/harvester/fitness/StravaHarvester.test.mjs --verbose`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/harvester/fitness/StravaHarvester.mjs tests/isolated/adapter/harvester/fitness/StravaHarvester.test.mjs
git commit -m "feat(strava): enrich both Strava and home session data on match"
```

---

### Task 4: Wire into `harvest()` flow

**Files:**
- Modify: `backend/src/1_adapters/harvester/fitness/StravaHarvester.mjs:109-200`

**Step 1: Add matching call to `harvest()` method**

After the `#ageOutOldFiles` call (line 165), add:

```javascript
// 7. Match home fitness sessions (bidirectional enrichment)
if (this.#fitnessHistoryDir) {
  try {
    const homeMatches = await this.applyHomeSessionEnrichment(username, enrichedActivities);
    if (homeMatches.length > 0) {
      this.#logger.info?.('strava.harvest.homeMatches', {
        username,
        matchCount: homeMatches.length,
      });
    }
  } catch (err) {
    // Non-fatal — log and continue
    this.#logger.warn?.('strava.harvest.homeMatchError', {
      username,
      error: this.#cleanErrorMessage(err),
    });
  }
}
```

**Step 2: Run all tests**

Run: `npx jest tests/isolated/adapter/harvester/fitness/StravaHarvester.test.mjs --verbose`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add backend/src/1_adapters/harvester/fitness/StravaHarvester.mjs
git commit -m "feat(strava): wire home session matching into harvest flow"
```

---

### Task 5: Wire `fitnessHistoryDir` in bootstrap

**Files:**
- Modify: `backend/src/0_system/bootstrap.mjs:2800-2806`

**Step 1: Update the constructor call in `createHarvesterServices`**

Change the StravaHarvester instantiation from:

```javascript
registerHarvester('strava', () => new StravaHarvester({
  stravaClient,
  lifelogStore,
  authStore,
  configService,
  logger,
}));
```

To:

```javascript
registerHarvester('strava', () => new StravaHarvester({
  stravaClient,
  lifelogStore,
  authStore,
  configService,
  fitnessHistoryDir: configService.getHouseholdPath('history/fitness'),
  logger,
}));
```

**Step 2: Run all tests**

Run: `npx jest tests/isolated/adapter/harvester/fitness/StravaHarvester.test.mjs --verbose`
Expected: All tests PASS

**Step 3: Commit**

```bash
git add backend/src/0_system/bootstrap.mjs
git commit -m "feat(strava): pass fitnessHistoryDir from bootstrap"
```

---

### Task 6: Backlog matching for recent unmatched entries

**Files:**
- Modify: `backend/src/1_adapters/harvester/fitness/StravaHarvester.mjs`
- Test: `tests/isolated/adapter/harvester/fitness/StravaHarvester.test.mjs`

**Step 1: Write the failing test**

```javascript
it('should retry matching for recent summary entries missing homeSessionId', async () => {
  const dateDir = path.join(tmpDir, '2026-02-15');
  fs.mkdirSync(dateDir, { recursive: true });

  const sessionData = {
    sessionId: '20260215191250',
    session: {
      id: '20260215191250',
      date: '2026-02-15',
      start: '2026-02-15 19:12:50',
      end: '2026-02-15 19:20:50',
      duration_seconds: 480,
    },
    timezone: 'America/Los_Angeles',
    participants: {
      kckern: { display_name: 'KC Kern', is_primary: true },
    },
    treasureBox: { totalCoins: 20 },
    timeline: { events: [] },
  };

  const { saveYaml } = await import('#system/utils/FileIO.mjs');
  saveYaml(path.join(dateDir, '20260215191250'), sessionData);

  // Summary has an entry WITHOUT homeSessionId (simulating previous harvest before home session existed)
  const existingSummary = {
    '2026-02-15': [
      {
        id: 17418186050,
        title: 'Evening Weight Training',
        type: 'WeightTraining',
        startTime: '07:10 pm',
        minutes: 10,
        // No homeSessionId — this should get matched on backlog pass
      },
    ],
  };
  mockLifelogStore.load.mockResolvedValue(existingSummary);

  harvester = new StravaHarvester({
    stravaClient: mockStravaClient,
    lifelogStore: mockLifelogStore,
    configService: mockConfigService,
    fitnessHistoryDir: tmpDir,
    timezone: 'America/Los_Angeles',
    logger: mockLogger,
  });

  // Call backlog matching with no new activities — it should still find the unmatched summary entry
  // We need to reconstruct a minimal activity from the summary for matching
  await harvester.matchBacklog('kckern', 7);

  const saveCalls = mockLifelogStore.save.mock.calls;
  const summarySave = saveCalls.find(c => c[1] === 'strava');
  expect(summarySave).toBeTruthy();

  const savedSummary = summarySave[2];
  const entry = savedSummary['2026-02-15'].find(a => a.id === 17418186050);
  expect(entry.homeSessionId).toBe('20260215191250');
});
```

**Step 2: Run test to verify it fails**

Run: `npx jest tests/isolated/adapter/harvester/fitness/StravaHarvester.test.mjs --verbose -t "should retry"`
Expected: FAIL — `harvester.matchBacklog is not a function`

**Step 3: Implement `matchBacklog()`**

Add to `StravaHarvester.mjs`:

```javascript
/**
 * Scan recent summary entries for unmatched activities and retry matching.
 * Reconstructs minimal activity objects from summary data for time overlap check.
 * @param {string} username
 * @param {number} [daysBack=7]
 */
async matchBacklog(username, daysBack = 7) {
  if (!this.#fitnessHistoryDir) return;

  const summary = await this.#lifelogStore.load(username, 'strava') || {};
  const cutoff = moment().subtract(daysBack, 'days').format('YYYY-MM-DD');

  // Find unmatched entries in recent dates
  const unmatchedActivities = [];
  for (const [date, entries] of Object.entries(summary)) {
    if (date < cutoff) continue;
    for (const entry of entries) {
      if (entry.homeSessionId) continue; // Already matched

      // Reconstruct minimal activity from summary data
      // Parse startTime (e.g., "07:10 pm") back to a full datetime
      const startMoment = moment.tz(`${date} ${entry.startTime}`, 'YYYY-MM-DD hh:mm a', this.#timezone);
      if (!startMoment.isValid()) continue;

      unmatchedActivities.push({
        id: entry.id,
        start_date: startMoment.toISOString(),
        moving_time: (entry.minutes || 0) * 60,
        type: entry.type,
        suffer_score: entry.suffer_score,
        device_name: entry.device_name,
      });
    }
  }

  if (unmatchedActivities.length === 0) return;

  const matches = this.#findMatches(username, unmatchedActivities);
  await this.#applyEnrichment(username, matches);

  if (matches.length > 0) {
    this.#logger.info?.('strava.backlog.matched', {
      username,
      matchCount: matches.length,
      checkedCount: unmatchedActivities.length,
    });
  }
}
```

Then update the `harvest()` method's step 7 block to also call backlog:

```javascript
// 7. Match home fitness sessions (bidirectional enrichment)
if (this.#fitnessHistoryDir) {
  try {
    const homeMatches = await this.applyHomeSessionEnrichment(username, enrichedActivities);
    // Also retry recent unmatched entries
    await this.matchBacklog(username, 7);
    if (homeMatches.length > 0) {
      this.#logger.info?.('strava.harvest.homeMatches', {
        username,
        matchCount: homeMatches.length,
      });
    }
  } catch (err) {
    this.#logger.warn?.('strava.harvest.homeMatchError', {
      username,
      error: this.#cleanErrorMessage(err),
    });
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/adapter/harvester/fitness/StravaHarvester.test.mjs --verbose`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add backend/src/1_adapters/harvester/fitness/StravaHarvester.mjs tests/isolated/adapter/harvester/fitness/StravaHarvester.test.mjs
git commit -m "feat(strava): add backlog matching for recently unmatched entries"
```
