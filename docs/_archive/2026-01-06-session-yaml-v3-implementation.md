# Session YAML v3 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement the v3 session YAML schema to reduce storage bloat by ~40-50%, improve queryability, and achieve schema consistency.

**Architecture:** Create a `SessionSerializerV3.js` module that transforms runtime session data into the v3 format. Update `PersistenceManager.js` to use it. Update `backend/routers/fitness.mjs` to read/write v3 format while maintaining API compatibility.

**Tech Stack:** JavaScript (ES modules), YAML (js-yaml), Jest for testing

**Design Reference:** `docs/_wip/plans/2026-01-06-session-yaml-v3-schema-design.md`

---

## Task 1: Create SessionSerializerV3 with Session Block

**Files:**
- Create: `frontend/src/hooks/fitness/SessionSerializerV3.js`
- Create: `tests/unit/fitness/session-serializer-v3.unit.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/fitness/session-serializer-v3.unit.test.mjs
import { describe, it, expect } from '@jest/globals';
import { SessionSerializerV3 } from '../../../frontend/src/hooks/fitness/SessionSerializerV3.js';

describe('SessionSerializerV3', () => {
  describe('serializeSession', () => {
    it('creates session block with required fields', () => {
      const input = {
        sessionId: '20260106114853',
        startTime: 1767728933431,
        endTime: 1767732533431,
        timezone: 'America/Los_Angeles'
      };

      const result = SessionSerializerV3.serialize(input);

      expect(result.version).toBe(3);
      expect(result.session.id).toBe('20260106114853');
      expect(result.session.date).toBe('2026-01-06');
      expect(result.session.start).toMatch(/^2026-01-06 \d{1,2}:\d{2}:\d{2}$/);
      expect(result.session.end).toMatch(/^2026-01-06 \d{1,2}:\d{2}:\d{2}$/);
      expect(result.session.duration_seconds).toBe(3600);
      expect(result.session.timezone).toBe('America/Los_Angeles');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/fitness/session-serializer-v3.unit.test.mjs -v`
Expected: FAIL with "Cannot find module"

**Step 3: Write minimal implementation**

```javascript
// frontend/src/hooks/fitness/SessionSerializerV3.js
import moment from 'moment-timezone';

/**
 * Serialize session data to v3 YAML format.
 * @see docs/_wip/plans/2026-01-06-session-yaml-v3-schema-design.md
 */
export class SessionSerializerV3 {
  /**
   * Format unix ms timestamp to human-readable string.
   * @param {number} unixMs
   * @param {string} timezone
   * @returns {string} 'YYYY-MM-DD h:mm:ss' format
   */
  static formatTimestamp(unixMs, timezone) {
    const tz = timezone || 'UTC';
    return moment(unixMs).tz(tz).format('YYYY-MM-DD H:mm:ss');
  }

  /**
   * Extract date portion from session ID (YYYYMMDDHHmmss).
   * @param {string} sessionId
   * @returns {string} 'YYYY-MM-DD'
   */
  static extractDate(sessionId) {
    if (!sessionId || sessionId.length < 8) return null;
    const y = sessionId.slice(0, 4);
    const m = sessionId.slice(4, 6);
    const d = sessionId.slice(6, 8);
    return `${y}-${m}-${d}`;
  }

  /**
   * Serialize session data to v3 format.
   * @param {Object} data - Raw session data
   * @returns {Object} v3 formatted session
   */
  static serialize(data) {
    const {
      sessionId,
      startTime,
      endTime,
      timezone = 'UTC'
    } = data;

    const durationSeconds = Math.round((endTime - startTime) / 1000);

    return {
      version: 3,
      session: {
        id: sessionId,
        date: this.extractDate(sessionId),
        start: this.formatTimestamp(startTime, timezone),
        end: this.formatTimestamp(endTime, timezone),
        duration_seconds: durationSeconds,
        timezone
      }
    };
  }
}
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/fitness/session-serializer-v3.unit.test.mjs -v`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/SessionSerializerV3.js tests/unit/fitness/session-serializer-v3.unit.test.mjs
git commit -m "feat(fitness): add SessionSerializerV3 with session block"
```

---

## Task 2: Add Totals Block Serialization

**Files:**
- Modify: `frontend/src/hooks/fitness/SessionSerializerV3.js`
- Modify: `tests/unit/fitness/session-serializer-v3.unit.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/fitness/session-serializer-v3.unit.test.mjs
describe('totals block', () => {
  it('serializes treasure box to totals', () => {
    const input = {
      sessionId: '20260106114853',
      startTime: 1767728933431,
      endTime: 1767732533431,
      timezone: 'America/Los_Angeles',
      treasureBox: {
        totalCoins: 913,
        buckets: { blue: 0, green: 270, yellow: 400, orange: 228, red: 15 }
      }
    };

    const result = SessionSerializerV3.serialize(input);

    expect(result.totals).toBeDefined();
    expect(result.totals.coins).toBe(913);
    expect(result.totals.buckets).toEqual({ blue: 0, green: 270, yellow: 400, orange: 228, red: 15 });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/fitness/session-serializer-v3.unit.test.mjs -v`
Expected: FAIL - totals is undefined

**Step 3: Add totals serialization**

```javascript
// Add to serialize() method in SessionSerializerV3.js after session block
const { treasureBox } = data;

const output = {
  version: 3,
  session: { /* ... existing ... */ }
};

if (treasureBox) {
  output.totals = {
    coins: treasureBox.totalCoins || 0,
    buckets: treasureBox.buckets || {}
  };
}

return output;
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/fitness/session-serializer-v3.unit.test.mjs -v`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/SessionSerializerV3.js tests/unit/fitness/session-serializer-v3.unit.test.mjs
git commit -m "feat(fitness): add totals block to v3 serializer"
```

---

## Task 3: Add Derived Stats Computation

**Files:**
- Modify: `frontend/src/hooks/fitness/SessionSerializerV3.js`
- Modify: `tests/unit/fitness/session-serializer-v3.unit.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/fitness/session-serializer-v3.unit.test.mjs
describe('computeDerivedStats', () => {
  it('computes HR stats from series', () => {
    const hrSeries = [71, 75, 80, 90, 100, 110, 120, 130, 125, null, null];

    const stats = SessionSerializerV3.computeHrStats(hrSeries);

    expect(stats.min).toBe(71);
    expect(stats.max).toBe(130);
    expect(stats.avg).toBe(100); // (71+75+80+90+100+110+120+130+125)/9 = 100.1 -> 100
  });

  it('computes zone time from zone series', () => {
    // 5-second intervals: 3 ticks in 'c', 2 in 'a', 1 in 'w'
    const zoneSeries = ['c', 'c', 'c', 'a', 'a', 'w'];

    const zoneTime = SessionSerializerV3.computeZoneTime(zoneSeries, 5);

    expect(zoneTime.cool).toBe(15);   // 3 * 5
    expect(zoneTime.active).toBe(10); // 2 * 5
    expect(zoneTime.warm).toBe(5);    // 1 * 5
  });

  it('computes active seconds from HR series', () => {
    // HR present at ticks 0-4, then null for ticks 5-7
    const hrSeries = [71, 75, 80, 90, 100, null, null, null];

    const activeSeconds = SessionSerializerV3.computeActiveSeconds(hrSeries, 5);

    expect(activeSeconds).toBe(25); // 5 ticks * 5 seconds
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/fitness/session-serializer-v3.unit.test.mjs -v`
Expected: FAIL - computeHrStats is not a function

**Step 3: Implement derived stats**

```javascript
// Add static methods to SessionSerializerV3.js

/**
 * Compute HR statistics from a heart rate series.
 * @param {Array<number|null>} hrSeries
 * @returns {{min: number, max: number, avg: number}}
 */
static computeHrStats(hrSeries) {
  const validValues = (hrSeries || []).filter(v => Number.isFinite(v) && v > 0);
  if (validValues.length === 0) {
    return { min: 0, max: 0, avg: 0 };
  }
  const min = Math.min(...validValues);
  const max = Math.max(...validValues);
  const sum = validValues.reduce((a, b) => a + b, 0);
  const avg = Math.round(sum / validValues.length);
  return { min, max, avg };
}

/**
 * Compute time spent in each zone from zone series.
 * @param {Array<string|null>} zoneSeries - Zone IDs ('c', 'a', 'w', 'h', etc.)
 * @param {number} intervalSeconds
 * @returns {Object} Zone name -> seconds
 */
static computeZoneTime(zoneSeries, intervalSeconds = 5) {
  const ZONE_MAP = { c: 'cool', a: 'active', w: 'warm', h: 'hot', fire: 'fire' };
  const counts = {};
  (zoneSeries || []).forEach(z => {
    if (z == null) return;
    const zoneName = ZONE_MAP[z] || z;
    counts[zoneName] = (counts[zoneName] || 0) + intervalSeconds;
  });
  return counts;
}

/**
 * Compute active seconds (time with valid HR data).
 * @param {Array<number|null>} hrSeries
 * @param {number} intervalSeconds
 * @returns {number}
 */
static computeActiveSeconds(hrSeries, intervalSeconds = 5) {
  const validCount = (hrSeries || []).filter(v => Number.isFinite(v) && v > 0).length;
  return validCount * intervalSeconds;
}
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/fitness/session-serializer-v3.unit.test.mjs -v`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/SessionSerializerV3.js tests/unit/fitness/session-serializer-v3.unit.test.mjs
git commit -m "feat(fitness): add derived stats computation to v3 serializer"
```

---

## Task 4: Add Participants Block Serialization

**Files:**
- Modify: `frontend/src/hooks/fitness/SessionSerializerV3.js`
- Modify: `tests/unit/fitness/session-serializer-v3.unit.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/fitness/session-serializer-v3.unit.test.mjs
describe('participants block', () => {
  it('serializes participant with derived stats', () => {
    const input = {
      sessionId: '20260106114853',
      startTime: 1767728933431,
      endTime: 1767732533431,
      timezone: 'America/Los_Angeles',
      participants: {
        kckern: {
          display_name: 'Keith',
          is_primary: true,
          is_guest: false,
          hr_device: '40475',
          cadence_device: '49904'
        }
      },
      timeline: {
        timebase: { intervalMs: 5000 },
        series: {
          'user:kckern:heart_rate': [71, 75, 80, 90, 100],
          'user:kckern:zone_id': ['c', 'c', 'a', 'a', 'a'],
          'user:kckern:coins_total': [0, 1, 2, 3, 5],
          'user:kckern:heart_beats': [5.9, 12.2, 18.9, 26.4, 34.7]
        }
      }
    };

    const result = SessionSerializerV3.serialize(input);

    expect(result.participants.kckern).toBeDefined();
    expect(result.participants.kckern.display_name).toBe('Keith');
    expect(result.participants.kckern.coins_earned).toBe(5);
    expect(result.participants.kckern.hr_stats.min).toBe(71);
    expect(result.participants.kckern.hr_stats.max).toBe(100);
    expect(result.participants.kckern.zone_time_seconds.cool).toBe(10);
    expect(result.participants.kckern.zone_time_seconds.active).toBe(15);
    expect(result.participants.kckern.total_beats).toBeCloseTo(34.7, 1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/fitness/session-serializer-v3.unit.test.mjs -v`
Expected: FAIL - participants is undefined

**Step 3: Implement participants serialization**

```javascript
// Add to serialize() method in SessionSerializerV3.js

/**
 * Extract user ID from series key (e.g., 'user:kckern:heart_rate' -> 'kckern')
 */
static extractUserIdFromKey(key) {
  const match = key.match(/^user:([^:]+):/);
  return match ? match[1] : null;
}

/**
 * Get the last non-null value from a series.
 */
static getLastValue(series) {
  for (let i = (series || []).length - 1; i >= 0; i--) {
    if (series[i] != null) return series[i];
  }
  return 0;
}

/**
 * Decode RLE series if needed.
 */
static decodeSeries(series) {
  if (typeof series === 'string') {
    try {
      const parsed = JSON.parse(series);
      const decoded = [];
      for (const entry of parsed) {
        if (Array.isArray(entry)) {
          const [value, count] = entry;
          for (let i = 0; i < count; i++) decoded.push(value);
        } else {
          decoded.push(entry);
        }
      }
      return decoded;
    } catch {
      return [];
    }
  }
  return series || [];
}

// In serialize():
static serialize(data) {
  // ... existing session and totals code ...

  const { participants: participantsMeta, timeline } = data;
  const intervalSeconds = (timeline?.timebase?.intervalMs || 5000) / 1000;
  const series = timeline?.series || {};

  // Build participants block
  const participants = {};

  if (participantsMeta) {
    Object.entries(participantsMeta).forEach(([userId, meta]) => {
      const hrSeries = this.decodeSeries(series[`user:${userId}:heart_rate`]);
      const zoneSeries = this.decodeSeries(series[`user:${userId}:zone_id`]);
      const coinsSeries = this.decodeSeries(series[`user:${userId}:coins_total`]);
      const beatsSeries = this.decodeSeries(series[`user:${userId}:heart_beats`]);

      participants[userId] = {
        display_name: meta.display_name,
        is_primary: meta.is_primary || false,
        is_guest: meta.is_guest || false,
        ...(meta.hr_device && { hr_device: meta.hr_device }),
        ...(meta.cadence_device && { cadence_device: meta.cadence_device }),
        coins_earned: this.getLastValue(coinsSeries),
        active_seconds: this.computeActiveSeconds(hrSeries, intervalSeconds),
        zone_summary: this.computeZoneSummary(coinsSeries, zoneSeries),
        zone_time_seconds: this.computeZoneTime(zoneSeries, intervalSeconds),
        hr_stats: this.computeHrStats(hrSeries),
        total_beats: this.getLastValue(beatsSeries)
      };
    });
  }

  output.participants = participants;
  return output;
}
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/fitness/session-serializer-v3.unit.test.mjs -v`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/SessionSerializerV3.js tests/unit/fitness/session-serializer-v3.unit.test.mjs
git commit -m "feat(fitness): add participants block with derived stats"
```

---

## Task 5: Add Timeline Serialization with Nested Structure

**Files:**
- Modify: `frontend/src/hooks/fitness/SessionSerializerV3.js`
- Modify: `tests/unit/fitness/session-serializer-v3.unit.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/fitness/session-serializer-v3.unit.test.mjs
describe('timeline block', () => {
  it('nests series by participants/equipment/global', () => {
    const input = {
      sessionId: '20260106114853',
      startTime: 1767728933431,
      endTime: 1767732533431,
      timezone: 'America/Los_Angeles',
      timeline: {
        timebase: { intervalMs: 5000, tickCount: 5 },
        series: {
          'user:kckern:heart_rate': [71, 75, 80, 90, 100],
          'user:kckern:zone_id': ['c', 'c', 'a', 'a', 'a'],
          'user:kckern:coins_total': [0, 1, 2, 3, 5],
          'user:kckern:heart_beats': [5.9, 12.2, 18.9, 26.4, 34.7],
          'device:49904:rpm': [null, null, 60, 65, 70],
          'device:49904:rotations': [null, null, 5, 10.5, 16.3],
          'global:coins_total': [0, 1, 2, 3, 5]
        }
      }
    };

    const result = SessionSerializerV3.serialize(input);

    expect(result.timeline.interval_seconds).toBe(5);
    expect(result.timeline.tick_count).toBe(5);
    expect(result.timeline.encoding).toBe('rle');

    // Participants nested
    expect(result.timeline.participants.kckern.hr).toBeDefined();
    expect(result.timeline.participants.kckern.zone).toBeDefined();

    // Equipment nested
    expect(result.timeline.equipment['49904'].rpm).toBeDefined();

    // Global
    expect(result.timeline.global.coins).toBeDefined();
  });

  it('drops empty/trivial series', () => {
    const input = {
      sessionId: '20260106114853',
      startTime: 1767728933431,
      endTime: 1767732533431,
      timezone: 'America/Los_Angeles',
      timeline: {
        timebase: { intervalMs: 5000, tickCount: 5 },
        series: {
          'user:kckern:heart_rate': [71, 75, 80, 90, 100],
          'device:12345:power': [null, null, null, null, null],
          'device:12345:rotations': [0, 0, 0, 0, 0]
        }
      }
    };

    const result = SessionSerializerV3.serialize(input);

    expect(result.timeline.participants.kckern.hr).toBeDefined();
    expect(result.timeline.equipment['12345']).toBeUndefined(); // All nulls/zeros dropped
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/fitness/session-serializer-v3.unit.test.mjs -v`
Expected: FAIL - timeline structure doesn't match

**Step 3: Implement timeline serialization**

```javascript
// Add to SessionSerializerV3.js

/**
 * Check if series is empty/trivial (all null or all zero).
 */
static isEmptySeries(series) {
  const decoded = this.decodeSeries(series);
  if (!decoded || decoded.length === 0) return true;
  return decoded.every(v => v == null || v === 0);
}

/**
 * Encode series to RLE format.
 */
static encodeSeries(series) {
  if (!Array.isArray(series) || series.length === 0) return null;

  const rle = [];
  for (const value of series) {
    const last = rle[rle.length - 1];
    if (Array.isArray(last) && last[0] === value) {
      last[1] += 1;
    } else if (last === value) {
      rle[rle.length - 1] = [value, 2];
    } else {
      rle.push(value);
    }
  }
  return JSON.stringify(rle);
}

/**
 * Map v2 series key to v3 nested structure.
 */
static mapSeriesKey(key) {
  // user:kckern:heart_rate -> { type: 'participants', id: 'kckern', metric: 'hr' }
  // device:49904:rpm -> { type: 'equipment', id: '49904', metric: 'rpm' }
  // global:coins_total -> { type: 'global', id: null, metric: 'coins' }

  const METRIC_MAP = {
    heart_rate: 'hr',
    zone_id: 'zone',
    coins_total: 'coins',
    heart_beats: 'beats'
  };

  const parts = key.split(':');
  if (parts.length < 2) return null;

  const [prefix, id, ...metricParts] = parts;
  const rawMetric = metricParts.join(':') || id; // global:coins_total has metric in id position
  const metric = METRIC_MAP[rawMetric] || rawMetric;

  if (prefix === 'user') {
    return { type: 'participants', id, metric };
  } else if (prefix === 'device' || prefix === 'bike') {
    return { type: 'equipment', id: id.replace('device_', ''), metric };
  } else if (prefix === 'global') {
    return { type: 'global', id: null, metric: METRIC_MAP[id] || id };
  }
  return null;
}

// In serialize(), add timeline block:
static serialize(data) {
  // ... existing code ...

  // Build timeline block
  const timelineOutput = {
    interval_seconds: Math.round((timeline?.timebase?.intervalMs || 5000) / 1000),
    tick_count: timeline?.timebase?.tickCount || 0,
    encoding: 'rle',
    participants: {},
    equipment: {},
    global: {}
  };

  Object.entries(series).forEach(([key, values]) => {
    // Skip empty series
    if (this.isEmptySeries(values)) return;

    const mapped = this.mapSeriesKey(key);
    if (!mapped) return;

    const { type, id, metric } = mapped;
    const encoded = typeof values === 'string' ? values : this.encodeSeries(values);

    if (type === 'participants') {
      if (!timelineOutput.participants[id]) timelineOutput.participants[id] = {};
      timelineOutput.participants[id][metric] = encoded;
    } else if (type === 'equipment') {
      if (!timelineOutput.equipment[id]) timelineOutput.equipment[id] = {};
      timelineOutput.equipment[id][metric] = encoded;
    } else if (type === 'global') {
      timelineOutput.global[metric] = encoded;
    }
  });

  // Remove empty sections
  if (Object.keys(timelineOutput.equipment).length === 0) delete timelineOutput.equipment;
  if (Object.keys(timelineOutput.global).length === 0) delete timelineOutput.global;

  output.timeline = timelineOutput;
  return output;
}
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/fitness/session-serializer-v3.unit.test.mjs -v`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/SessionSerializerV3.js tests/unit/fitness/session-serializer-v3.unit.test.mjs
git commit -m "feat(fitness): add nested timeline structure with empty series filtering"
```

---

## Task 6: Add Events Grouping by Type

**Files:**
- Modify: `frontend/src/hooks/fitness/SessionSerializerV3.js`
- Modify: `tests/unit/fitness/session-serializer-v3.unit.test.mjs`

**Step 1: Write the failing test**

```javascript
// Add to tests/unit/fitness/session-serializer-v3.unit.test.mjs
describe('events block', () => {
  it('groups events by audio/video/voice_memos', () => {
    const input = {
      sessionId: '20260106114853',
      startTime: 1767728933431,
      endTime: 1767732533431,
      timezone: 'America/Los_Angeles',
      timeline: {
        events: [
          { type: 'media_start', timestamp: 1767729000000, data: { source: 'music_player', title: 'Song 1', artist: 'Artist', plex_id: '123', durationSeconds: 200 } },
          { type: 'media_start', timestamp: 1767730000000, data: { source: 'video_player', title: 'Video 1', show: 'Show', plex_id: '456', durationSeconds: 300 } },
          { type: 'voice_memo_start', timestamp: 1767731000000, data: { memoId: 'memo_123', durationSeconds: 60, transcriptPreview: 'Test memo' } }
        ]
      }
    };

    const result = SessionSerializerV3.serialize(input);

    expect(result.events.audio).toHaveLength(1);
    expect(result.events.audio[0].title).toBe('Song 1');
    expect(result.events.video).toHaveLength(1);
    expect(result.events.video[0].title).toBe('Video 1');
    expect(result.events.voice_memos).toHaveLength(1);
    expect(result.events.voice_memos[0].id).toBe('memo_123');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/fitness/session-serializer-v3.unit.test.mjs -v`
Expected: FAIL - events structure wrong

**Step 3: Implement events grouping**

```javascript
// Add to SessionSerializerV3.js

/**
 * Serialize an audio event.
 */
static serializeAudioEvent(event, timezone) {
  const d = event.data || {};
  return {
    at: this.formatTimestamp(event.timestamp, timezone),
    title: d.title,
    ...(d.artist && { artist: d.artist }),
    ...(d.album && { album: d.album }),
    plex_id: d.plexId || d.plex_id || d.mediaId,
    duration_seconds: d.durationSeconds || d.duration_seconds
  };
}

/**
 * Serialize a video event.
 */
static serializeVideoEvent(event, timezone) {
  const d = event.data || {};
  return {
    at: this.formatTimestamp(event.timestamp, timezone),
    title: d.title,
    ...(d.show && { show: d.show }),
    ...(d.season && { season: d.season }),
    plex_id: d.plexId || d.plex_id || d.mediaId,
    duration_seconds: d.durationSeconds || d.duration_seconds,
    ...(d.labels?.length && { labels: d.labels })
  };
}

/**
 * Serialize a voice memo event.
 */
static serializeVoiceMemoEvent(event, timezone) {
  const d = event.data || {};
  return {
    at: this.formatTimestamp(event.timestamp, timezone),
    id: d.memoId || d.id,
    duration_seconds: d.durationSeconds || d.duration_seconds,
    transcript: d.transcriptPreview || d.transcript
  };
}

// In serialize(), add events block:
static serialize(data) {
  // ... existing code ...

  const rawEvents = timeline?.events || [];
  const eventsOutput = { audio: [], video: [], voice_memos: [] };

  rawEvents.forEach(event => {
    const source = event.data?.source;
    const type = event.type;

    if (type === 'media_start' && source === 'music_player') {
      eventsOutput.audio.push(this.serializeAudioEvent(event, timezone));
    } else if (type === 'media_start' && source === 'video_player') {
      eventsOutput.video.push(this.serializeVideoEvent(event, timezone));
    } else if (type === 'voice_memo_start' || type === 'voice_memo') {
      eventsOutput.voice_memos.push(this.serializeVoiceMemoEvent(event, timezone));
    }
  });

  // Remove empty sections
  if (eventsOutput.audio.length === 0) delete eventsOutput.audio;
  if (eventsOutput.video.length === 0) delete eventsOutput.video;
  if (eventsOutput.voice_memos.length === 0) delete eventsOutput.voice_memos;

  if (Object.keys(eventsOutput).length > 0) {
    output.events = eventsOutput;
  }

  return output;
}
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/fitness/session-serializer-v3.unit.test.mjs -v`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/SessionSerializerV3.js tests/unit/fitness/session-serializer-v3.unit.test.mjs
git commit -m "feat(fitness): add events grouping by type (audio/video/voice_memos)"
```

---

## Task 7: Integrate with PersistenceManager

**Files:**
- Modify: `frontend/src/hooks/fitness/PersistenceManager.js`
- Create: `tests/unit/fitness/persistence-manager-v3.unit.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/unit/fitness/persistence-manager-v3.unit.test.mjs
import { describe, it, expect, vi } from '@jest/globals';
import { PersistenceManager } from '../../../frontend/src/hooks/fitness/PersistenceManager.js';

describe('PersistenceManager v3 integration', () => {
  it('uses SessionSerializerV3 to build payload', () => {
    const pm = new PersistenceManager();
    pm.setLogCallback(() => {});
    pm.setSeriesLengthValidator(() => ({ ok: true }));

    const sessionData = {
      sessionId: '20260106114853',
      startTime: 1767728933431,
      endTime: 1767732533431,
      timezone: 'America/Los_Angeles',
      treasureBox: { totalCoins: 100, buckets: {} },
      timeline: { timebase: { intervalMs: 5000, tickCount: 10 }, series: {} }
    };

    const payload = pm.buildPayload(sessionData);

    expect(payload.version).toBe(3);
    expect(payload.session).toBeDefined();
    expect(payload.session.id).toBe('20260106114853');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/fitness/persistence-manager-v3.unit.test.mjs -v`
Expected: FAIL

**Step 3: Integrate SessionSerializerV3**

```javascript
// In PersistenceManager.js, add import and modify buildPayload:
import { SessionSerializerV3 } from './SessionSerializerV3.js';

// In the class:
buildPayload(sessionData) {
  // Use v3 serializer
  return SessionSerializerV3.serialize(sessionData);
}
```

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/fitness/persistence-manager-v3.unit.test.mjs -v`
Expected: PASS

**Step 5: Commit**

```bash
git add frontend/src/hooks/fitness/PersistenceManager.js tests/unit/fitness/persistence-manager-v3.unit.test.mjs
git commit -m "feat(fitness): integrate SessionSerializerV3 with PersistenceManager"
```

---

## Task 8: Update Backend to Handle v3 Format

**Files:**
- Modify: `backend/routers/fitness.mjs`
- Create: `tests/assembly/fitness-session-v3.assembly.test.mjs`

**Step 1: Write the failing test**

```javascript
// tests/assembly/fitness-session-v3.assembly.test.mjs
import { describe, it, expect, beforeAll } from '@jest/globals';
import { prepareSessionForPersistence } from '../../backend/routers/fitness.mjs';

describe('fitness.mjs v3 format', () => {
  it('passes through v3 session format unchanged', () => {
    const v3Session = {
      version: 3,
      session: {
        id: '20260106114853',
        date: '2026-01-06',
        start: '2026-01-06 19:48:53',
        end: '2026-01-06 20:48:53',
        duration_seconds: 3600,
        timezone: 'America/Los_Angeles'
      },
      totals: { coins: 100, buckets: {} },
      participants: {},
      timeline: { interval_seconds: 5, tick_count: 10, encoding: 'rle', participants: {} }
    };

    const result = prepareSessionForPersistence(v3Session);

    expect(result.version).toBe(3);
    expect(result.session.id).toBe('20260106114853');
    expect(result.totals).toBeDefined();
  });
});
```

**Step 2: Run test to verify behavior**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/assembly/fitness-session-v3.assembly.test.mjs -v`
Expected: Should pass if v3 format is passed through

**Step 3: Update backend if needed**

The `prepareSessionForPersistence` function should already pass through v3 format since it spreads the input. Verify and add any version-specific handling if needed.

**Step 4: Run test to verify it passes**

Run: `NODE_OPTIONS=--experimental-vm-modules npx jest tests/assembly/fitness-session-v3.assembly.test.mjs -v`
Expected: PASS

**Step 5: Commit**

```bash
git add backend/routers/fitness.mjs tests/assembly/fitness-session-v3.assembly.test.mjs
git commit -m "feat(fitness): ensure backend handles v3 session format"
```

---

## Task 9: Update Reference Documentation

**Files:**
- Modify: `docs/reference/fitness/features/sessions.md`

**Step 1: Update the saved data format section**

Replace the v2 YAML example with v3 format and update field reference tables.

**Step 2: Commit**

```bash
git add docs/reference/fitness/features/sessions.md
git commit -m "docs(fitness): update sessions.md for v3 YAML format"
```

---

## Task 10: Run Full Test Suite and Verify

**Step 1: Run all assembly tests**

```bash
npm run test:assembly
```
Expected: All passing

**Step 2: Run unit tests**

```bash
NODE_OPTIONS=--experimental-vm-modules npx jest tests/unit/fitness --coverage
```
Expected: All passing, good coverage on new code

**Step 3: Manual verification**

Start dev server, run a short fitness session, verify the saved YAML matches v3 schema.

**Step 4: Final commit**

```bash
git add -A
git commit -m "chore(fitness): session YAML v3 implementation complete"
```

---

## Summary

| Task | Description | Est. Time |
|------|-------------|-----------|
| 1 | SessionSerializerV3 with session block | 5 min |
| 2 | Totals block | 3 min |
| 3 | Derived stats computation | 5 min |
| 4 | Participants block | 10 min |
| 5 | Timeline nested structure | 10 min |
| 6 | Events grouping | 5 min |
| 7 | PersistenceManager integration | 5 min |
| 8 | Backend v3 handling | 5 min |
| 9 | Documentation update | 5 min |
| 10 | Full verification | 10 min |

**Total: ~60 minutes**
