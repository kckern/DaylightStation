# Weekly Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a screen-framework widget that displays an 8-day photo + calendar grid and records free-form family audio narration for weekly archival.

**Architecture:** Screen-framework widget (`weekly-review`) backed by a new backend API (`/api/v1/weekly-review`) that aggregates Immich photos and calendar events into an 8-day grid. Audio recording reuses the existing Whisper + GPT-4o transcription pipeline. Data stored as YAML transcripts (data volume) and audio files (media volume).

**Tech Stack:** React (frontend widget), Express (backend API), Immich API (photos), OpenAI Whisper + GPT-4o (transcription), Web Audio API (VU meter), MediaRecorder (audio capture), YAML (data persistence).

**Spec:** `docs/superpowers/specs/2026-03-30-weekly-review-design.md`

---

## File Structure

### Backend (new files)

| File | Responsibility |
|------|---------------|
| `backend/src/1_adapters/weekly-review/WeeklyReviewImmichAdapter.mjs` | Query Immich for date-range photos, filter by face tags, group into sessions |
| `backend/src/2_domains/weekly-review/WeeklyReviewAggregator.mjs` | Merge calendar + photos, pick heroes, compute column weights |
| `backend/src/3_applications/weekly-review/WeeklyReviewService.mjs` | Orchestrate bootstrap aggregation, handle recording storage + transcription |
| `backend/src/4_api/v1/routers/weekly-review.mjs` | Express router: `GET /bootstrap`, `POST /recording` |

### Backend (modified files)

| File | Change |
|------|--------|
| `backend/src/app.mjs` | Wire up WeeklyReview services and router |
| `backend/src/4_api/v1/routers/api.mjs` | Add `'/weekly-review': 'weekly-review'` to routeMap |

### Frontend (new files)

| File | Responsibility |
|------|---------------|
| `frontend/src/modules/WeeklyReview/index.js` | Widget registry side-effect registration |
| `frontend/src/modules/WeeklyReview/WeeklyReview.jsx` | Main widget: bootstrap, layout, state |
| `frontend/src/modules/WeeklyReview/WeeklyReview.scss` | All styles |
| `frontend/src/modules/WeeklyReview/components/DayColumn.jsx` | Single day column: header, calendar chips, photo wall |
| `frontend/src/modules/WeeklyReview/components/PhotoWall.jsx` | Masonry photo grid with hero + thumbnails |
| `frontend/src/modules/WeeklyReview/components/RecordingBar.jsx` | Bottom bar: record/stop, VU meter, timer |
| `frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js` | MediaRecorder + AudioContext + base64 upload |

### Frontend (modified files)

| File | Change |
|------|--------|
| `frontend/src/screen-framework/widgets/builtins.js` | Register `weekly-review` widget |

### Tests (new files)

| File | Tests |
|------|-------|
| `tests/isolated/adapter/weekly-review/WeeklyReviewImmichAdapter.test.mjs` | Immich adapter: date filtering, face prioritization, session grouping |
| `tests/isolated/domain/weekly-review/WeeklyReviewAggregator.test.mjs` | Aggregator: hero selection, column weights, calendar merge |
| `tests/isolated/application/weekly-review/WeeklyReviewService.test.mjs` | Service: bootstrap orchestration, recording storage |

### Data (new files)

| File | Purpose |
|------|---------|
| `data/household/screens/weekly-review.yml` | Screen config (created via docker exec at deploy time) |

---

## Task 1: WeeklyReviewImmichAdapter — Test + Implementation

**Files:**
- Create: `backend/src/1_adapters/weekly-review/WeeklyReviewImmichAdapter.mjs`
- Create: `tests/isolated/adapter/weekly-review/WeeklyReviewImmichAdapter.test.mjs`

This adapter queries Immich for photos in a date range, filters by configured face tags, groups by time proximity into sessions, and marks hero candidates.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/isolated/adapter/weekly-review/WeeklyReviewImmichAdapter.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { WeeklyReviewImmichAdapter } from '../../../../backend/src/1_adapters/weekly-review/WeeklyReviewImmichAdapter.mjs';

describe('WeeklyReviewImmichAdapter', () => {
  let adapter;
  let mockClient;
  let mockLogger;

  const MOCK_ASSETS = [
    {
      id: 'asset-1',
      type: 'IMAGE',
      localDateTime: '2026-03-23T14:00:00.000Z',
      people: [{ name: 'Felix' }],
    },
    {
      id: 'asset-2',
      type: 'IMAGE',
      localDateTime: '2026-03-23T14:30:00.000Z',
      people: [{ name: 'Felix' }, { name: 'Alan' }],
    },
    {
      id: 'asset-3',
      type: 'IMAGE',
      localDateTime: '2026-03-23T19:00:00.000Z',
      people: [],
    },
    {
      id: 'asset-4',
      type: 'VIDEO',
      localDateTime: '2026-03-23T14:15:00.000Z',
      people: [],
    },
    {
      id: 'asset-5',
      type: 'IMAGE',
      localDateTime: '2026-03-25T10:00:00.000Z',
      people: [{ name: 'Stranger' }],
    },
    {
      id: 'asset-6',
      type: 'IMAGE',
      localDateTime: '2026-03-25T10:30:00.000Z',
      people: [{ name: 'Felix' }],
    },
  ];

  beforeEach(() => {
    mockClient = {
      searchMetadata: jest.fn().mockResolvedValue({ items: MOCK_ASSETS, total: MOCK_ASSETS.length }),
    };
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    adapter = new WeeklyReviewImmichAdapter({
      priorityPeople: ['Felix', 'Alan', 'Soren', 'Milo'],
      proxyPath: '/proxy/immich',
      sessionGapMinutes: 120,
    }, {
      client: mockClient,
      logger: mockLogger,
    });
  });

  describe('constructor', () => {
    it('throws if client is not provided', () => {
      expect(() => new WeeklyReviewImmichAdapter({}, {})).toThrow('client');
    });
  });

  describe('getPhotosForDateRange', () => {
    it('queries Immich with correct date range', async () => {
      await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');

      expect(mockClient.searchMetadata).toHaveBeenCalledWith(
        expect.objectContaining({
          takenAfter: '2026-03-23T00:00:00.000Z',
          takenBefore: '2026-03-31T00:00:00.000Z',
          type: 'IMAGE',
        })
      );
    });

    it('filters out non-IMAGE assets', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const allIds = result.flatMap(day => day.photos.map(p => p.id));
      expect(allIds).not.toContain('asset-4');
    });

    it('groups photos by date', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const mar23 = result.find(d => d.date === '2026-03-23');
      const mar25 = result.find(d => d.date === '2026-03-25');
      expect(mar23.photos.length).toBe(3);
      expect(mar25.photos.length).toBe(2);
    });

    it('sorts face-tagged photos first, multi-face before single', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const mar23 = result.find(d => d.date === '2026-03-23');
      // asset-2 has 2 family faces, asset-1 has 1, asset-3 has 0
      expect(mar23.photos[0].id).toBe('asset-2');
      expect(mar23.photos[1].id).toBe('asset-1');
      expect(mar23.photos[2].id).toBe('asset-3');
    });

    it('only counts configured priority people as face matches', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const mar25 = result.find(d => d.date === '2026-03-25');
      // asset-6 has Felix (priority), asset-5 has Stranger (not priority)
      expect(mar25.photos[0].id).toBe('asset-6');
      expect(mar25.photos[1].id).toBe('asset-5');
    });

    it('groups photos into sessions by time proximity', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const mar23 = result.find(d => d.date === '2026-03-23');
      // asset-1 (14:00) and asset-2 (14:30) are within 2 hours → session 0
      // asset-3 (19:00) is 4.5 hours later → session 1
      expect(mar23.sessions.length).toBe(2);
      expect(mar23.sessions[0].count).toBe(2);
      expect(mar23.sessions[1].count).toBe(1);
    });

    it('marks hero photo for days with 3+ photos', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const mar23 = result.find(d => d.date === '2026-03-23');
      const mar25 = result.find(d => d.date === '2026-03-25');
      expect(mar23.photos.some(p => p.isHero)).toBe(true);
      expect(mar25.photos.some(p => p.isHero)).toBe(false);
    });

    it('includes proxy URLs for thumbnail and original', async () => {
      const result = await adapter.getPhotosForDateRange('2026-03-23', '2026-03-30');
      const photo = result.find(d => d.date === '2026-03-23').photos[0];
      expect(photo.thumbnail).toBe('/proxy/immich/assets/asset-2/thumbnail');
      expect(photo.original).toBe('/proxy/immich/assets/asset-2/original');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/isolated/adapter/weekly-review/WeeklyReviewImmichAdapter.test.mjs --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/1_adapters/weekly-review/WeeklyReviewImmichAdapter.mjs

/**
 * Queries Immich for photos in a date range, filters by face tags,
 * groups into sessions, and marks hero candidates.
 */
export class WeeklyReviewImmichAdapter {
  #client;
  #priorityPeople;
  #proxyPath;
  #sessionGapMs;
  #logger;

  constructor(config = {}, deps = {}) {
    if (!deps.client) {
      throw new Error('WeeklyReviewImmichAdapter requires client dependency');
    }
    this.#client = deps.client;
    this.#priorityPeople = (config.priorityPeople || []).map(n => n.toLowerCase());
    this.#proxyPath = config.proxyPath || '/proxy/immich';
    this.#sessionGapMs = (config.sessionGapMinutes || 120) * 60 * 1000;
    this.#logger = deps.logger || console;
  }

  /**
   * Fetch and process photos for a date range.
   * @param {string} startDate - ISO date string (YYYY-MM-DD), inclusive
   * @param {string} endDate - ISO date string (YYYY-MM-DD), inclusive
   * @returns {Array<{ date, photos, sessions, photoCount }>}
   */
  async getPhotosForDateRange(startDate, endDate) {
    const takenAfter = new Date(`${startDate}T00:00:00.000Z`).toISOString();
    // endDate is inclusive, so search up to end of next day
    const endPlusOne = new Date(`${endDate}T00:00:00.000Z`);
    endPlusOne.setDate(endPlusOne.getDate() + 1);
    const takenBefore = endPlusOne.toISOString();

    this.#logger.debug?.('weekly-review.immich.search', { startDate, endDate, takenAfter, takenBefore });

    const result = await this.#client.searchMetadata({
      takenAfter,
      takenBefore,
      type: 'IMAGE',
      size: 500,
    });

    const assets = result.items || result || [];

    // Group by date
    const byDate = new Map();
    for (const asset of assets) {
      if (asset.type !== 'IMAGE') continue;
      const date = asset.localDateTime.slice(0, 10);
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(asset);
    }

    // Build days array for the full range
    const days = [];
    const cursor = new Date(`${startDate}T00:00:00.000Z`);
    const end = new Date(`${endDate}T00:00:00.000Z`);

    while (cursor <= end) {
      const dateStr = cursor.toISOString().slice(0, 10);
      const dayAssets = byDate.get(dateStr) || [];
      const processed = this.#processDay(dateStr, dayAssets);
      days.push(processed);
      cursor.setDate(cursor.getDate() + 1);
    }

    this.#logger.info?.('weekly-review.immich.done', {
      totalPhotos: assets.filter(a => a.type === 'IMAGE').length,
      days: days.length,
    });

    return days;
  }

  #processDay(date, assets) {
    // Score and sort: priority faces first, multi-face before single
    const scored = assets.map(asset => {
      const people = (asset.people || []).map(p => p.name);
      const priorityCount = people.filter(name =>
        this.#priorityPeople.includes(name.toLowerCase())
      ).length;
      return { asset, people, priorityCount };
    });

    scored.sort((a, b) => b.priorityCount - a.priorityCount);

    // Group into sessions by time proximity
    const sessions = this.#groupSessions(scored);

    // Build photo objects
    const photos = scored.map((item, index) => ({
      id: item.asset.id,
      thumbnail: `${this.#proxyPath}/assets/${item.asset.id}/thumbnail`,
      original: `${this.#proxyPath}/assets/${item.asset.id}/original`,
      people: item.people,
      isHero: assets.length >= 3 && index === 0,
      sessionIndex: this.#findSessionIndex(sessions, item.asset),
      takenAt: item.asset.localDateTime,
    }));

    return {
      date,
      photos,
      photoCount: photos.length,
      sessions: sessions.map((s, i) => ({
        index: i,
        count: s.length,
        timeRange: this.#formatTimeRange(s),
      })),
    };
  }

  #groupSessions(scored) {
    if (scored.length === 0) return [];

    // Sort by time for grouping (separate from priority sort)
    const byTime = [...scored].sort((a, b) =>
      new Date(a.asset.localDateTime) - new Date(b.asset.localDateTime)
    );

    const sessions = [[byTime[0]]];
    for (let i = 1; i < byTime.length; i++) {
      const prev = new Date(byTime[i - 1].asset.localDateTime);
      const curr = new Date(byTime[i].asset.localDateTime);
      if (curr - prev > this.#sessionGapMs) {
        sessions.push([byTime[i]]);
      } else {
        sessions[sessions.length - 1].push(byTime[i]);
      }
    }
    return sessions;
  }

  #findSessionIndex(sessions, asset) {
    for (let i = 0; i < sessions.length; i++) {
      if (sessions[i].some(s => s.asset.id === asset.id)) return i;
    }
    return 0;
  }

  #formatTimeRange(session) {
    if (session.length === 0) return '';
    const times = session.map(s => new Date(s.asset.localDateTime));
    const earliest = new Date(Math.min(...times));
    const latest = new Date(Math.max(...times));
    const fmt = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (earliest.getTime() === latest.getTime()) return fmt(earliest);
    return `${fmt(earliest)} – ${fmt(latest)}`;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/adapter/weekly-review/WeeklyReviewImmichAdapter.test.mjs --no-coverage`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/weekly-review/WeeklyReviewImmichAdapter.mjs tests/isolated/adapter/weekly-review/WeeklyReviewImmichAdapter.test.mjs
git commit -m "feat(weekly-review): add Immich adapter with face priority and session grouping"
```

---

## Task 2: WeeklyReviewAggregator — Test + Implementation

**Files:**
- Create: `backend/src/2_domains/weekly-review/WeeklyReviewAggregator.mjs`
- Create: `tests/isolated/domain/weekly-review/WeeklyReviewAggregator.test.mjs`

This domain service merges photo data with calendar events and computes column weights for the frontend grid.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/isolated/domain/weekly-review/WeeklyReviewAggregator.test.mjs
import { describe, it, expect } from '@jest/globals';
import { WeeklyReviewAggregator } from '../../../../backend/src/2_domains/weekly-review/WeeklyReviewAggregator.mjs';

describe('WeeklyReviewAggregator', () => {
  const PHOTO_DAYS = [
    { date: '2026-03-23', photos: [{ id: 'p1' }, { id: 'p2' }, { id: 'p3' }], photoCount: 3, sessions: [{ index: 0, count: 3 }] },
    { date: '2026-03-24', photos: [{ id: 'p4' }], photoCount: 1, sessions: [{ index: 0, count: 1 }] },
    { date: '2026-03-25', photos: [], photoCount: 0, sessions: [] },
    { date: '2026-03-26', photos: Array.from({ length: 12 }, (_, i) => ({ id: `p${10 + i}` })), photoCount: 12, sessions: [] },
    { date: '2026-03-27', photos: [], photoCount: 0, sessions: [] },
    { date: '2026-03-28', photos: [{ id: 'p30' }, { id: 'p31' }], photoCount: 2, sessions: [] },
    { date: '2026-03-29', photos: [{ id: 'p40' }], photoCount: 1, sessions: [] },
    { date: '2026-03-30', photos: [], photoCount: 0, sessions: [] },
  ];

  const CALENDAR_EVENTS = [
    { date: '2026-03-23', events: [{ summary: 'Soccer', time: '10:00', calendar: 'family' }] },
    { date: '2026-03-28', events: [{ summary: 'Birthday Party', time: '14:00', calendar: 'family' }] },
  ];

  describe('aggregate', () => {
    it('merges photos and calendar into 8-day structure', () => {
      const result = WeeklyReviewAggregator.aggregate(PHOTO_DAYS, CALENDAR_EVENTS);
      expect(result.days.length).toBe(8);
      expect(result.days[0].date).toBe('2026-03-23');
      expect(result.days[0].calendar).toEqual([{ summary: 'Soccer', time: '10:00', calendar: 'family' }]);
      expect(result.days[0].photos.length).toBe(3);
    });

    it('assigns column weights proportional to content density', () => {
      const result = WeeklyReviewAggregator.aggregate(PHOTO_DAYS, CALENDAR_EVENTS);
      const weights = result.days.map(d => d.columnWeight);
      // Day with 12 photos should have highest weight
      const mar26Weight = result.days.find(d => d.date === '2026-03-26').columnWeight;
      const mar25Weight = result.days.find(d => d.date === '2026-03-25').columnWeight;
      expect(mar26Weight).toBeGreaterThan(mar25Weight);
    });

    it('gives empty days a minimum weight so they remain visible', () => {
      const result = WeeklyReviewAggregator.aggregate(PHOTO_DAYS, CALENDAR_EVENTS);
      const emptyDay = result.days.find(d => d.date === '2026-03-25');
      expect(emptyDay.columnWeight).toBeGreaterThan(0);
    });

    it('days without calendar events get empty array', () => {
      const result = WeeklyReviewAggregator.aggregate(PHOTO_DAYS, CALENDAR_EVENTS);
      const mar24 = result.days.find(d => d.date === '2026-03-24');
      expect(mar24.calendar).toEqual([]);
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/isolated/domain/weekly-review/WeeklyReviewAggregator.test.mjs --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/2_domains/weekly-review/WeeklyReviewAggregator.mjs

const MIN_COLUMN_WEIGHT = 0.5;

export class WeeklyReviewAggregator {
  /**
   * Merge photo days and calendar events into a unified 8-day structure
   * with column weights for frontend layout.
   *
   * @param {Array} photoDays - From WeeklyReviewImmichAdapter.getPhotosForDateRange()
   * @param {Array<{ date, events }>} calendarDays - Calendar events grouped by date
   * @returns {{ days: Array<{ date, label, dayOfWeek, calendar, photos, photoCount, sessions, columnWeight }> }}
   */
  static aggregate(photoDays, calendarDays) {
    const calendarByDate = new Map();
    for (const day of calendarDays) {
      calendarByDate.set(day.date, day.events || []);
    }

    const maxPhotoCount = Math.max(1, ...photoDays.map(d => d.photoCount));

    const days = photoDays.map(photoDay => {
      const date = new Date(`${photoDay.date}T12:00:00Z`);
      const contentScore = photoDay.photoCount + (calendarByDate.get(photoDay.date)?.length || 0);
      const columnWeight = Math.max(MIN_COLUMN_WEIGHT, contentScore / maxPhotoCount);

      return {
        date: photoDay.date,
        label: date.toLocaleDateString('en-US', { weekday: 'short' }),
        dayOfWeek: date.getDay(),
        calendar: calendarByDate.get(photoDay.date) || [],
        photos: photoDay.photos,
        photoCount: photoDay.photoCount,
        sessions: photoDay.sessions,
        columnWeight,
      };
    });

    return { days };
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/domain/weekly-review/WeeklyReviewAggregator.test.mjs --no-coverage`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/weekly-review/WeeklyReviewAggregator.mjs tests/isolated/domain/weekly-review/WeeklyReviewAggregator.test.mjs
git commit -m "feat(weekly-review): add aggregator for merging photos + calendar with column weights"
```

---

## Task 3: WeeklyReviewService — Test + Implementation

**Files:**
- Create: `backend/src/3_applications/weekly-review/WeeklyReviewService.mjs`
- Create: `tests/isolated/application/weekly-review/WeeklyReviewService.test.mjs`

Orchestrates the bootstrap call (aggregates Immich + calendar) and handles recording storage + transcription.

- [ ] **Step 1: Write the failing tests**

```javascript
// tests/isolated/application/weekly-review/WeeklyReviewService.test.mjs
import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { WeeklyReviewService } from '../../../../backend/src/3_applications/weekly-review/WeeklyReviewService.mjs';

describe('WeeklyReviewService', () => {
  let service;
  let mockImmichAdapter;
  let mockCalendarData;
  let mockTranscriptionService;
  let mockLogger;

  const PHOTO_DAYS = [
    { date: '2026-03-23', photos: [{ id: 'p1' }], photoCount: 1, sessions: [] },
    { date: '2026-03-24', photos: [], photoCount: 0, sessions: [] },
    { date: '2026-03-25', photos: [], photoCount: 0, sessions: [] },
    { date: '2026-03-26', photos: [], photoCount: 0, sessions: [] },
    { date: '2026-03-27', photos: [], photoCount: 0, sessions: [] },
    { date: '2026-03-28', photos: [], photoCount: 0, sessions: [] },
    { date: '2026-03-29', photos: [], photoCount: 0, sessions: [] },
    { date: '2026-03-30', photos: [], photoCount: 0, sessions: [] },
  ];

  beforeEach(() => {
    mockImmichAdapter = {
      getPhotosForDateRange: jest.fn().mockResolvedValue(PHOTO_DAYS),
    };
    mockCalendarData = {
      getEventsForDateRange: jest.fn().mockResolvedValue([
        { date: '2026-03-23', events: [{ summary: 'Soccer', time: '10:00', calendar: 'family' }] },
      ]),
    };
    mockTranscriptionService = {
      transcribe: jest.fn().mockResolvedValue({
        transcriptRaw: 'raw text',
        transcriptClean: 'Clean text.',
      }),
    };
    mockLogger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };

    service = new WeeklyReviewService({
      dataPath: '/tmp/test-data',
      mediaPath: '/tmp/test-media',
    }, {
      immichAdapter: mockImmichAdapter,
      calendarData: mockCalendarData,
      transcriptionService: mockTranscriptionService,
      logger: mockLogger,
    });
  });

  describe('bootstrap', () => {
    it('returns aggregated 8-day structure', async () => {
      const result = await service.bootstrap('2026-03-23');
      expect(result.week).toBe('2026-03-23');
      expect(result.days.length).toBe(8);
      expect(mockImmichAdapter.getPhotosForDateRange).toHaveBeenCalledWith('2026-03-23', '2026-03-30');
      expect(mockCalendarData.getEventsForDateRange).toHaveBeenCalledWith('2026-03-23', '2026-03-30');
    });

    it('defaults to current week if no week param', async () => {
      const result = await service.bootstrap();
      expect(result.week).toBeDefined();
      expect(result.days.length).toBe(8);
    });

    it('includes recording status when recording exists', async () => {
      // Mock fs check for existing recording — we'll test this via integration
      const result = await service.bootstrap('2026-03-23');
      expect(result).toHaveProperty('recording');
    });
  });

  describe('saveRecording', () => {
    it('calls transcription service with audio data', async () => {
      const result = await service.saveRecording({
        audioBase64: 'dGVzdA==',
        mimeType: 'audio/webm',
        week: '2026-03-23',
        duration: 120,
      });

      expect(mockTranscriptionService.transcribe).toHaveBeenCalled();
      expect(result.ok).toBe(true);
      expect(result.transcript).toBeDefined();
    });

    it('rejects if audioBase64 is missing', async () => {
      await expect(service.saveRecording({ week: '2026-03-23' }))
        .rejects.toThrow('audioBase64 required');
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/isolated/application/weekly-review/WeeklyReviewService.test.mjs --no-coverage`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/3_applications/weekly-review/WeeklyReviewService.mjs
import path from 'path';
import fs from 'fs';
import { WeeklyReviewAggregator } from '#domains/weekly-review/WeeklyReviewAggregator.mjs';
import { writeBinary, saveYamlToPath, loadYamlFromPath } from '#system/utils/FileIO.mjs';

export class WeeklyReviewService {
  #dataPath;
  #mediaPath;
  #immichAdapter;
  #calendarData;
  #transcriptionService;
  #logger;

  constructor(config = {}, deps = {}) {
    this.#dataPath = config.dataPath;
    this.#mediaPath = config.mediaPath;
    this.#immichAdapter = deps.immichAdapter;
    this.#calendarData = deps.calendarData;
    this.#transcriptionService = deps.transcriptionService;
    this.#logger = deps.logger || console;
  }

  /**
   * Bootstrap: aggregate photos + calendar for an 8-day window.
   * @param {string} [weekStart] - ISO date (YYYY-MM-DD). Defaults to 7 days ago.
   */
  async bootstrap(weekStart) {
    const start = weekStart || this.#defaultWeekStart();
    const end = this.#addDays(start, 7);

    this.#logger.info?.('weekly-review.bootstrap', { week: start });

    const [photoDays, calendarDays] = await Promise.all([
      this.#immichAdapter.getPhotosForDateRange(start, end),
      this.#calendarData.getEventsForDateRange(start, end),
    ]);

    const { days } = WeeklyReviewAggregator.aggregate(photoDays, calendarDays);
    const recording = this.#getRecordingStatus(start);

    return { week: start, days, recording };
  }

  /**
   * Save audio recording and transcribe.
   */
  async saveRecording({ audioBase64, mimeType, week, duration }) {
    if (!audioBase64) throw new Error('audioBase64 required');

    this.#logger.info?.('weekly-review.recording.start', { week, duration });

    // Strip data URI prefix if present
    const base64Data = audioBase64.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    // Save audio to media volume
    const ext = mimeType === 'audio/ogg' ? 'ogg' : 'webm';
    const audioPath = path.join(this.#mediaPath, 'weekly-review', week, `recording.${ext}`);
    writeBinary(audioPath, buffer);

    // Transcribe
    const { transcriptRaw, transcriptClean } = await this.#transcriptionService.transcribe(buffer, {
      mimeType: mimeType || 'audio/webm',
      prompt: 'Family weekly review. Members discuss their week: activities, events, feelings, and memories.',
    });

    // Save transcript
    const transcriptData = {
      week,
      recordedAt: new Date().toISOString(),
      duration,
      transcriptRaw,
      transcriptClean,
    };
    const transcriptPath = path.join(this.#dataPath, 'household', 'common', 'weekly-review', week, 'transcript.yml');
    saveYamlToPath(transcriptPath, transcriptData);

    // Save manifest
    const manifestPath = path.join(this.#dataPath, 'household', 'common', 'weekly-review', week, 'manifest.yml');
    saveYamlToPath(manifestPath, {
      week,
      generatedAt: new Date().toISOString(),
      duration,
    });

    this.#logger.info?.('weekly-review.recording.saved', { week, duration, transcriptLength: transcriptClean?.length });

    return { ok: true, transcript: { raw: transcriptRaw, clean: transcriptClean, duration } };
  }

  #getRecordingStatus(week) {
    try {
      const transcriptPath = path.join(this.#dataPath, 'household', 'common', 'weekly-review', week, 'transcript.yml');
      const data = loadYamlFromPath(transcriptPath);
      if (data) {
        return { exists: true, recordedAt: data.recordedAt, duration: data.duration };
      }
    } catch {
      // No recording yet
    }
    return { exists: false };
  }

  #defaultWeekStart() {
    const now = new Date();
    const daysAgo = new Date(now);
    daysAgo.setDate(now.getDate() - 7);
    return daysAgo.toISOString().slice(0, 10);
  }

  #addDays(dateStr, days) {
    const d = new Date(`${dateStr}T00:00:00Z`);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx jest tests/isolated/application/weekly-review/WeeklyReviewService.test.mjs --no-coverage`
Expected: All tests PASS (the fs-dependent tests may need mocking — adjust if needed)

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/weekly-review/WeeklyReviewService.mjs tests/isolated/application/weekly-review/WeeklyReviewService.test.mjs
git commit -m "feat(weekly-review): add service for bootstrap orchestration and recording storage"
```

---

## Task 4: API Router

**Files:**
- Create: `backend/src/4_api/v1/routers/weekly-review.mjs`

- [ ] **Step 1: Write the router**

```javascript
// backend/src/4_api/v1/routers/weekly-review.mjs
import express from 'express';

export function createWeeklyReviewRouter(config) {
  const { weeklyReviewService, logger = console } = config;
  const router = express.Router();

  /**
   * GET /bootstrap
   * Returns aggregated 8-day grid with photos + calendar + recording status.
   * Query: ?week=2026-03-23 (optional, defaults to current week)
   */
  router.get('/bootstrap', async (req, res) => {
    try {
      const { week } = req.query;
      const data = await weeklyReviewService.bootstrap(week || undefined);
      res.json(data);
    } catch (err) {
      logger.error?.('weekly-review.bootstrap.error', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  /**
   * POST /recording
   * Save and transcribe audio recording.
   * Body: { audioBase64, mimeType, week, duration }
   */
  router.post('/recording', async (req, res) => {
    try {
      const { audioBase64, mimeType, week, duration } = req.body || {};
      if (!audioBase64 || typeof audioBase64 !== 'string') {
        return res.status(400).json({ ok: false, error: 'audioBase64 required' });
      }
      if (!week) {
        return res.status(400).json({ ok: false, error: 'week required' });
      }

      const result = await weeklyReviewService.saveRecording({ audioBase64, mimeType, week, duration });
      res.json(result);
    } catch (err) {
      logger.error?.('weekly-review.recording.error', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/4_api/v1/routers/weekly-review.mjs
git commit -m "feat(weekly-review): add API router with bootstrap and recording endpoints"
```

---

## Task 5: Wire into app.mjs and api.mjs

**Files:**
- Modify: `backend/src/app.mjs`
- Modify: `backend/src/4_api/v1/routers/api.mjs`

- [ ] **Step 1: Add route mapping in api.mjs**

In `backend/src/4_api/v1/routers/api.mjs`, add to the `routeMap` object:

```javascript
'/weekly-review': 'weekly-review',
```

- [ ] **Step 2: Wire services and router in app.mjs**

In `backend/src/app.mjs`, add near the other service instantiations (after the immich/calendar setup):

```javascript
// === Weekly Review ===
import { WeeklyReviewImmichAdapter } from '#adapters/weekly-review/WeeklyReviewImmichAdapter.mjs';
import { WeeklyReviewService } from '#applications/weekly-review/WeeklyReviewService.mjs';
import { createWeeklyReviewRouter } from './4_api/v1/routers/weekly-review.mjs';
```

In the service setup section (after immichConfig is defined):

```javascript
let weeklyReviewRouter = null;
if (immichConfig) {
  const weeklyReviewImmichAdapter = new WeeklyReviewImmichAdapter(
    {
      priorityPeople: [], // Loaded from screen config at request time, or from household config
      proxyPath: '/api/v1/proxy/immich',
    },
    { client: immichClient, logger: rootLogger.child({ module: 'weekly-review-immich' }) }
  );

  const weeklyReviewService = new WeeklyReviewService(
    { dataPath: dataBasePath, mediaPath: mediaBasePath },
    {
      immichAdapter: weeklyReviewImmichAdapter,
      calendarData: { getEventsForDateRange: async (start, end) => calendarExtractor.getEventsForRange(start, end) },
      transcriptionService: sharedAiGateway ? {
        transcribe: async (buffer, opts) => {
          const raw = await sharedAiGateway.transcribe(buffer, {
            filename: 'weekly-review.webm',
            contentType: opts.mimeType,
            prompt: opts.prompt,
          });
          const clean = await sharedAiGateway.chat(
            [
              { role: 'system', content: 'Clean up this family conversation transcript. Fix spelling, grammar, and punctuation. Preserve the natural conversational tone. Do not add or remove content.' },
              { role: 'user', content: raw },
            ],
            { temperature: 0.2, maxTokens: 4000 }
          );
          return { transcriptRaw: raw, transcriptClean: clean };
        },
      } : null,
      logger: rootLogger.child({ module: 'weekly-review' }),
    }
  );

  weeklyReviewRouter = createWeeklyReviewRouter({
    weeklyReviewService,
    logger: rootLogger.child({ module: 'weekly-review-api' }),
  });
}
```

Add to `v1Routers` object:

```javascript
'weekly-review': weeklyReviewRouter,
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/app.mjs backend/src/4_api/v1/routers/api.mjs
git commit -m "feat(weekly-review): wire adapter, service, and router into app bootstrap"
```

---

## Task 6: useAudioRecorder Hook

**Files:**
- Create: `frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js`

Self-contained recording hook reusing the patterns from `useVoiceMemoRecorder.js` but without fitness-specific dependencies.

- [ ] **Step 1: Write the hook**

```javascript
// frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js
import { useState, useRef, useCallback, useEffect } from 'react';
import getLogger from '@/lib/logging/Logger.js';

const logger = getLogger().child({ component: 'weekly-review-recorder' });

const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onloadend = () => resolve(reader.result);
  reader.onerror = reject;
  reader.readAsDataURL(blob);
});

const LEVEL_SAMPLE_INTERVAL_MS = 50;
const SILENCE_WARNING_MS = 5000;

export function useAudioRecorder({ onRecordingComplete }) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [silenceWarning, setSilenceWarning] = useState(false);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const chunksRef = useRef([]);
  const startTimeRef = useRef(null);
  const timerRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const levelRafRef = useRef(null);
  const lastLevelAtRef = useRef(0);
  const silenceStartRef = useRef(null);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current);
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    analyserRef.current = null;
    mediaRecorderRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startLevelMonitor = useCallback((stream) => {
    try {
      const audioContext = new AudioContext();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      const source = audioContext.createMediaStreamSource(stream);
      source.connect(analyser);
      const dataArray = new Uint8Array(analyser.frequencyBinCount);

      audioContextRef.current = audioContext;
      analyserRef.current = analyser;

      const sample = () => {
        if (!analyserRef.current) return;
        analyserRef.current.getByteTimeDomainData(dataArray);
        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
          const centered = (dataArray[i] - 128) / 128;
          sumSquares += centered * centered;
        }
        const rms = Math.sqrt(sumSquares / dataArray.length);
        const db = rms > 0 ? 20 * Math.log10(rms) : -60;
        const normalized = Math.max(0, Math.min(1, (db + 60) / 60));

        const now = performance.now();
        if (now - lastLevelAtRef.current >= LEVEL_SAMPLE_INTERVAL_MS) {
          lastLevelAtRef.current = now;
          setMicLevel(normalized);

          // Silence detection
          if (normalized < 0.02) {
            if (!silenceStartRef.current) silenceStartRef.current = now;
            if (now - silenceStartRef.current > SILENCE_WARNING_MS) {
              setSilenceWarning(true);
            }
          } else {
            silenceStartRef.current = null;
            setSilenceWarning(false);
          }
        }
        levelRafRef.current = requestAnimationFrame(sample);
      };
      levelRafRef.current = requestAnimationFrame(sample);
    } catch (err) {
      logger.warn('recorder.level-monitor-failed', { error: err.message });
    }
  }, []);

  const startRecording = useCallback(async () => {
    try {
      setError(null);
      setSilenceWarning(false);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
        cleanup();
        setIsRecording(false);
        setMicLevel(0);
        setSilenceWarning(false);

        logger.info('recorder.stopped', { duration: elapsed, blobSize: blob.size });

        if (blob.size > 0 && onRecordingComplete) {
          const base64 = await blobToBase64(blob);
          onRecordingComplete({ audioBase64: base64, mimeType: 'audio/webm', duration: elapsed });
        }
      };

      startLevelMonitor(stream);
      startTimeRef.current = Date.now();
      setDuration(0);
      recorder.start();
      setIsRecording(true);

      timerRef.current = setInterval(() => {
        setDuration(Math.round((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      logger.info('recorder.started');
    } catch (err) {
      logger.error('recorder.start-failed', { error: err.message });
      setError(`Microphone error: ${err.message}`);
      cleanup();
    }
  }, [cleanup, startLevelMonitor, onRecordingComplete]);

  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop();
    }
  }, []);

  return { isRecording, duration, micLevel, silenceWarning, error, startRecording, stopRecording };
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js
git commit -m "feat(weekly-review): add useAudioRecorder hook with VU meter and silence detection"
```

---

## Task 7: RecordingBar Component

**Files:**
- Create: `frontend/src/modules/WeeklyReview/components/RecordingBar.jsx`

- [ ] **Step 1: Write the component**

```jsx
// frontend/src/modules/WeeklyReview/components/RecordingBar.jsx
import React, { useMemo } from 'react';

const formatTime = (seconds) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
};

export default function RecordingBar({
  weekLabel,
  isRecording,
  duration,
  micLevel,
  silenceWarning,
  uploading,
  existingRecording,
  error,
  onStart,
  onStop,
}) {
  const vuBars = useMemo(() => {
    const count = 20;
    const filled = Math.round(micLevel * count);
    return Array.from({ length: count }, (_, i) => i < filled);
  }, [micLevel]);

  const barClass = `recording-bar${silenceWarning ? ' silence-warning' : ''}`;

  return (
    <div className={barClass}>
      <div className="recording-bar-left">
        <span className="week-label">{weekLabel}</span>
        {!isRecording && existingRecording?.exists && (
          <span className="existing-badge">{formatTime(existingRecording.duration)} recorded</span>
        )}
      </div>

      <div className="recording-bar-right">
        {isRecording && (
          <>
            <span className="recording-dot">●</span>
            <span className="recording-timer">{formatTime(duration)}</span>
            <div className="vu-meter">
              {vuBars.map((filled, i) => (
                <div key={i} className={`vu-bar${filled ? ' filled' : ''}`} />
              ))}
            </div>
          </>
        )}

        {error && <span className="recording-error">{error}</span>}

        {uploading ? (
          <span className="uploading-status">Transcribing...</span>
        ) : isRecording ? (
          <button className="recording-stop-btn" onClick={onStop}>
            ■ Stop
          </button>
        ) : (
          <button className="recording-start-btn" onClick={onStart}>
            ● Record
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/modules/WeeklyReview/components/RecordingBar.jsx
git commit -m "feat(weekly-review): add RecordingBar component with VU meter and timer"
```

---

## Task 8: PhotoWall + DayColumn Components

**Files:**
- Create: `frontend/src/modules/WeeklyReview/components/PhotoWall.jsx`
- Create: `frontend/src/modules/WeeklyReview/components/DayColumn.jsx`

- [ ] **Step 1: Write PhotoWall**

```jsx
// frontend/src/modules/WeeklyReview/components/PhotoWall.jsx
import React from 'react';

export default function PhotoWall({ photos }) {
  if (!photos || photos.length === 0) {
    return <div className="photo-wall-empty">—</div>;
  }

  const hero = photos.find(p => p.isHero);
  const rest = photos.filter(p => !p.isHero);

  if (hero) {
    return (
      <div className="photo-wall photo-wall--with-hero">
        <div className="photo-hero">
          <img src={hero.thumbnail} alt="" loading="lazy" />
          {hero.people.length > 0 && (
            <div className="photo-people">{hero.people.join(', ')}</div>
          )}
        </div>
        <div className="photo-thumbs">
          {rest.map(photo => (
            <div key={photo.id} className="photo-thumb">
              <img src={photo.thumbnail} alt="" loading="lazy" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="photo-wall">
      {photos.map(photo => (
        <div key={photo.id} className="photo-thumb">
          <img src={photo.thumbnail} alt="" loading="lazy" />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Write DayColumn**

```jsx
// frontend/src/modules/WeeklyReview/components/DayColumn.jsx
import React from 'react';
import PhotoWall from './PhotoWall.jsx';

export default function DayColumn({ day, isFocused, isToday }) {
  const dateNum = new Date(`${day.date}T12:00:00Z`).getDate();
  const columnClass = [
    'day-column',
    isFocused && 'day-column--focused',
    isToday && 'day-column--today',
    day.photoCount === 0 && 'day-column--empty',
  ].filter(Boolean).join(' ');

  return (
    <div
      className={columnClass}
      style={{ flex: day.columnWeight }}
    >
      <div className="day-header">
        <span className="day-label">{day.label}</span>
        <span className="day-date">{dateNum}</span>
      </div>

      {day.calendar.length > 0 && (
        <div className="day-calendar">
          {day.calendar.map((event, i) => (
            <div key={i} className="calendar-chip">
              {event.summary}
            </div>
          ))}
        </div>
      )}

      <div className="day-photos">
        <PhotoWall photos={day.photos} />
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/WeeklyReview/components/PhotoWall.jsx frontend/src/modules/WeeklyReview/components/DayColumn.jsx
git commit -m "feat(weekly-review): add DayColumn and PhotoWall components"
```

---

## Task 9: Main WeeklyReview Widget + Styles

**Files:**
- Create: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx`
- Create: `frontend/src/modules/WeeklyReview/WeeklyReview.scss`

- [ ] **Step 1: Write the main widget**

```jsx
// frontend/src/modules/WeeklyReview/WeeklyReview.jsx
import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { DaylightAPI } from '@/lib/api.mjs';
import DayColumn from './components/DayColumn.jsx';
import RecordingBar from './components/RecordingBar.jsx';
import { useAudioRecorder } from './hooks/useAudioRecorder.js';
import './WeeklyReview.scss';

const logger = getLogger().child({ component: 'weekly-review' });

export default function WeeklyReview() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [focusedDay, setFocusedDay] = useState(0);
  const [uploading, setUploading] = useState(false);
  const containerRef = useRef(null);

  const handleRecordingComplete = useCallback(async ({ audioBase64, mimeType, duration }) => {
    if (!data?.week) return;
    setUploading(true);
    try {
      logger.info('recording.uploading', { week: data.week, duration });
      const result = await DaylightAPI('/api/v1/weekly-review/recording', {
        audioBase64,
        mimeType,
        week: data.week,
        duration,
      }, 'POST');
      logger.info('recording.complete', { week: data.week, ok: result.ok });
      // Update recording status
      setData(prev => ({
        ...prev,
        recording: { exists: true, recordedAt: new Date().toISOString(), duration },
      }));
    } catch (err) {
      logger.error('recording.upload-failed', { error: err.message });
    } finally {
      setUploading(false);
    }
  }, [data?.week]);

  const {
    isRecording, duration: recordingDuration, micLevel, silenceWarning,
    error: recorderError, startRecording, stopRecording,
  } = useAudioRecorder({ onRecordingComplete: handleRecordingComplete });

  useEffect(() => {
    const fetchBootstrap = async () => {
      try {
        const result = await DaylightAPI('/api/v1/weekly-review/bootstrap');
        setData(result);
        logger.info('bootstrap.loaded', { week: result.week, dayCount: result.days?.length });
      } catch (err) {
        logger.error('bootstrap.failed', { error: err.message });
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    fetchBootstrap();
  }, []);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!data?.days) return;
      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          setFocusedDay(prev => Math.max(0, prev - 1));
          break;
        case 'ArrowRight':
          e.preventDefault();
          setFocusedDay(prev => Math.min(data.days.length - 1, prev + 1));
          break;
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (isRecording) {
            stopRecording();
          } else {
            startRecording();
          }
          break;
      }
    };

    const container = containerRef.current;
    if (container) {
      container.addEventListener('keydown', handleKeyDown);
      return () => container.removeEventListener('keydown', handleKeyDown);
    }
  }, [data, isRecording, startRecording, stopRecording]);

  // Focus on mount
  useEffect(() => {
    containerRef.current?.focus();
  }, [loading]);

  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), []);

  const weekLabel = useMemo(() => {
    if (!data?.days?.length) return '';
    const first = data.days[0];
    const last = data.days[data.days.length - 1];
    const fmtDate = (d) => {
      const dt = new Date(`${d}T12:00:00Z`);
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };
    return `Week of ${fmtDate(first.date)} – ${fmtDate(last.date)}`;
  }, [data]);

  if (loading) {
    return <div className="weekly-review weekly-review--loading">Loading...</div>;
  }

  if (error) {
    return <div className="weekly-review weekly-review--error">Failed to load: {error}</div>;
  }

  return (
    <div className="weekly-review" ref={containerRef} tabIndex={0}>
      <div className="weekly-review-grid">
        {data.days.map((day, i) => (
          <DayColumn
            key={day.date}
            day={day}
            isFocused={i === focusedDay}
            isToday={day.date === todayStr}
          />
        ))}
      </div>

      <RecordingBar
        weekLabel={weekLabel}
        isRecording={isRecording}
        duration={recordingDuration}
        micLevel={micLevel}
        silenceWarning={silenceWarning}
        uploading={uploading}
        existingRecording={data.recording}
        error={recorderError}
        onStart={startRecording}
        onStop={stopRecording}
      />
    </div>
  );
}
```

- [ ] **Step 2: Write styles**

```scss
// frontend/src/modules/WeeklyReview/WeeklyReview.scss

.weekly-review {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #1a1a1a;
  color: #e0e0e0;
  outline: none;
  overflow: hidden;

  &--loading,
  &--error {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 1.4rem;
    color: #888;
  }
}

// === 8-Day Grid ===

.weekly-review-grid {
  flex: 1;
  display: flex;
  gap: 8px;
  padding: 16px 16px 8px;
  min-height: 0;
  overflow: hidden;
}

// === Day Column ===

.day-column {
  display: flex;
  flex-direction: column;
  background: #2a2a2a;
  border: 2px solid #333;
  border-radius: 10px;
  overflow: hidden;
  min-width: 60px;
  transition: border-color 0.2s ease, flex 0.3s ease;

  &--focused {
    border-color: #4da6ff;
    box-shadow: 0 0 12px rgba(77, 166, 255, 0.25);
  }

  &--today {
    border-color: #4caf50;

    .day-header {
      background: #2a4a2a;

      .day-label {
        color: #aaffaa;
      }
    }
  }

  &--empty {
    opacity: 0.5;
  }
}

.day-header {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 6px;
  background: #333;
  border-bottom: 1px solid #444;
  flex-shrink: 0;

  .day-label {
    font-size: 0.85rem;
    font-weight: 700;
    color: #ccc;
  }

  .day-date {
    font-size: 1rem;
    font-weight: 600;
  }
}

.day-calendar {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 6px;
  flex-shrink: 0;
}

.calendar-chip {
  font-size: 0.65rem;
  background: #3a5a3a;
  color: #aaffaa;
  border-radius: 4px;
  padding: 2px 6px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.day-photos {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  padding: 6px;
}

// === Photo Wall ===

.photo-wall {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(60px, 1fr));
  gap: 4px;
  height: 100%;

  &--with-hero {
    display: grid;
    grid-template-columns: 2fr 1fr;
    grid-template-rows: 1fr;
    gap: 4px;
    height: 100%;
  }
}

.photo-wall-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #555;
  font-style: italic;
}

.photo-hero {
  position: relative;
  border-radius: 6px;
  overflow: hidden;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .photo-people {
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    padding: 2px 6px;
    background: rgba(0, 0, 0, 0.6);
    font-size: 0.6rem;
    color: #ddd;
  }
}

.photo-thumbs {
  display: flex;
  flex-direction: column;
  gap: 4px;
  overflow: hidden;
}

.photo-thumb {
  border-radius: 4px;
  overflow: hidden;
  flex: 1;
  min-height: 30px;

  img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }
}

// === Recording Bar ===

.recording-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #2a2a2a;
  border-top: 1px solid #444;
  flex-shrink: 0;
  gap: 12px;
  transition: background 0.3s ease;

  &.silence-warning {
    background: #3a3520;
  }
}

.recording-bar-left {
  display: flex;
  align-items: center;
  gap: 12px;

  .week-label {
    font-size: 0.9rem;
    color: #888;
  }

  .existing-badge {
    font-size: 0.75rem;
    color: #4caf50;
    background: rgba(76, 175, 80, 0.15);
    padding: 2px 8px;
    border-radius: 4px;
  }
}

.recording-bar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.recording-dot {
  color: #e53935;
  font-size: 1.2rem;
  animation: pulse 1s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.recording-timer {
  font-size: 1rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  min-width: 40px;
}

.vu-meter {
  display: flex;
  gap: 2px;
  align-items: center;
  height: 20px;
}

.vu-bar {
  width: 4px;
  height: 100%;
  background: #444;
  border-radius: 2px;
  transition: background 0.05s ease;

  &.filled {
    background: #4caf50;
  }

  &.filled:nth-child(n+15) {
    background: #ff9800;
  }

  &.filled:nth-child(n+18) {
    background: #e53935;
  }
}

.recording-start-btn,
.recording-stop-btn {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.2s ease;
}

.recording-start-btn {
  background: #c0392b;
  color: white;

  &:hover {
    background: #e74c3c;
  }
}

.recording-stop-btn {
  background: #555;
  color: white;

  &:hover {
    background: #666;
  }
}

.uploading-status {
  font-size: 0.85rem;
  color: #999;
  font-style: italic;
}

.recording-error {
  font-size: 0.8rem;
  color: #e53935;
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/WeeklyReview/WeeklyReview.jsx frontend/src/modules/WeeklyReview/WeeklyReview.scss
git commit -m "feat(weekly-review): add main widget component with grid layout and recording"
```

---

## Task 10: Widget Registration + Builtin Registration

**Files:**
- Create: `frontend/src/modules/WeeklyReview/index.js`
- Modify: `frontend/src/screen-framework/widgets/builtins.js`

- [ ] **Step 1: Write module index**

```javascript
// frontend/src/modules/WeeklyReview/index.js
import { getWidgetRegistry } from '@/screen-framework/widgets/registry.js';
import WeeklyReview from './WeeklyReview.jsx';

const registry = getWidgetRegistry();
registry.register('weekly-review', WeeklyReview);
```

- [ ] **Step 2: Add to builtins.js**

In `frontend/src/screen-framework/widgets/builtins.js`, add the import and registration:

```javascript
import '../../../modules/WeeklyReview/index.js';
```

Add this import at the end of the existing imports in `builtins.js`. The side-effect import triggers the `index.js` which calls `registry.register()`.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/WeeklyReview/index.js frontend/src/screen-framework/widgets/builtins.js
git commit -m "feat(weekly-review): register widget in screen-framework builtins"
```

---

## Task 11: Screen Config + Integration Test

**Files:**
- No source files — this task creates the screen YAML config and does a manual smoke test.

- [ ] **Step 1: Create screen YAML config**

Write the screen config into the Docker data volume:

```bash
sudo docker exec daylight-station sh -c "mkdir -p data/household/screens && cat > data/household/screens/weekly-review.yml << 'ENDOFYAML'
screen: weekly-review
route: /weekly-review
theme:
  panel-bg: rgba(0,0,0,0.6)
  panel-radius: 8px
  font-color: \"#e0e0e0\"
layout:
  children:
    - widget: weekly-review
config:
  immich:
    priority_people:
      - Felix
      - Alan
      - Soren
      - Milo
  calendars:
    primary: family
    fallback:
      - personal
      - work
ENDOFYAML"
```

- [ ] **Step 2: Verify the screen config is served by the API**

```bash
curl -s http://localhost:3111/api/v1/screens/weekly-review | head -20
```

Expected: JSON output with `screen: "weekly-review"` and layout config.

- [ ] **Step 3: Verify the bootstrap API returns data**

```bash
curl -s http://localhost:3111/api/v1/weekly-review/bootstrap | head -40
```

Expected: JSON with `week`, `days` array (8 entries), and `recording` object.

- [ ] **Step 4: Commit** (no source changes — this is a config/deployment step)

Document the smoke test results. If anything fails, debug and fix before proceeding.

---

## Task 12: CalendarData Adapter for WeeklyReview

**Files:**
- Create: `backend/src/1_adapters/weekly-review/WeeklyReviewCalendarAdapter.mjs`

The WeeklyReviewService expects a `calendarData.getEventsForDateRange(start, end)` interface. This adapter wraps the existing calendar data reading pattern.

- [ ] **Step 1: Write the adapter**

```javascript
// backend/src/1_adapters/weekly-review/WeeklyReviewCalendarAdapter.mjs

/**
 * Reads calendar events from the household data store for a date range.
 * Wraps the existing userDataService calendar reading pattern.
 */
export class WeeklyReviewCalendarAdapter {
  #userDataService;
  #householdId;
  #logger;

  constructor(config = {}, deps = {}) {
    this.#userDataService = deps.userDataService;
    this.#householdId = config.householdId;
    this.#logger = deps.logger || console;
  }

  /**
   * Get calendar events grouped by date for a date range.
   * @param {string} startDate - YYYY-MM-DD
   * @param {string} endDate - YYYY-MM-DD
   * @returns {Array<{ date, events }>}
   */
  async getEventsForDateRange(startDate, endDate) {
    let raw;
    try {
      raw = await this.#userDataService.readHouseholdSharedData(this.#householdId, 'calendar');
    } catch {
      try {
        raw = await this.#userDataService.readHouseholdAppData(this.#householdId, 'common', 'calendar');
      } catch {
        this.#logger.warn?.('weekly-review.calendar.no-data');
        return [];
      }
    }

    if (!raw) return [];

    const results = [];
    const cursor = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);

    while (cursor <= end) {
      const dateStr = cursor.toISOString().slice(0, 10);
      let dayEvents = [];

      if (Array.isArray(raw)) {
        // Old format: flat array with date/datetime fields
        dayEvents = raw.filter(e => {
          const eventDate = (e.date || e.datetime || '').slice(0, 10);
          return eventDate === dateStr;
        }).map(e => ({
          summary: e.summary || 'Untitled',
          time: e.time || null,
          endTime: e.endTime || null,
          calendar: e.calendarName || e.calendar || null,
          allDay: e.allday || e.allDay || false,
        }));
      } else if (raw[dateStr]) {
        // New format: date-keyed object
        dayEvents = (raw[dateStr] || []).map(e => ({
          summary: e.summary || 'Untitled',
          time: e.time || null,
          endTime: e.endTime || null,
          calendar: e.calendarName || e.calendar || null,
          allDay: e.allday || e.allDay || false,
        }));
      }

      if (dayEvents.length > 0) {
        results.push({ date: dateStr, events: dayEvents });
      }

      cursor.setDate(cursor.getDate() + 1);
    }

    this.#logger.debug?.('weekly-review.calendar.loaded', { startDate, endDate, totalEvents: results.reduce((s, d) => s + d.events.length, 0) });
    return results;
  }
}
```

- [ ] **Step 2: Update app.mjs wiring to use this adapter**

Replace the inline `calendarData` object in the app.mjs wiring (from Task 5) with:

```javascript
import { WeeklyReviewCalendarAdapter } from '#adapters/weekly-review/WeeklyReviewCalendarAdapter.mjs';

const weeklyReviewCalendarAdapter = new WeeklyReviewCalendarAdapter(
  { householdId },
  { userDataService, logger: rootLogger.child({ module: 'weekly-review-calendar' }) }
);
```

Then pass `calendarData: weeklyReviewCalendarAdapter` to `WeeklyReviewService`.

- [ ] **Step 3: Commit**

```bash
git add backend/src/1_adapters/weekly-review/WeeklyReviewCalendarAdapter.mjs backend/src/app.mjs
git commit -m "feat(weekly-review): add calendar adapter for date-range event queries"
```
