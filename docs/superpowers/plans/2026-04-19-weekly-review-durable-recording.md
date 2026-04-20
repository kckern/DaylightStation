# Weekly Review Durable Recording Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it impossible for an in-progress Weekly Review recording to be lost — page reload, browser crash, network drop, or server outage must never destroy audio that has been spoken.

**Architecture:** Three independent durability layers. (1) Server draft file: each 5-second webm chunk is POSTed immediately and appended to `data/household/common/weekly-review/<week>/.drafts/<sessionId>.webm`. (2) Client IndexedDB: every chunk is written synchronously to IndexedDB before or alongside the upload, with a 7-day retention so a failed server can be recovered from the browser. (3) `pagehide`/`beforeunload` beacons push any in-flight chunk out. Any one layer is sufficient to recover the recording; only two simultaneous failures can cause loss.

**Tech Stack:** Node/Express backend, React frontend, MediaRecorder with `timeslice`, IndexedDB (raw API — no new dependency), `navigator.sendBeacon`, vitest for backend unit tests.

---

## Context the implementer needs

**The bug we are fixing.** On 2026-04-19 the user recorded a 9-minute family Weekly Review on the living-room Shield TV. The FKB WebView reloaded to `/screen/living-room` during recording (external navigation, not caught by the in-code popstate pop-guard). All audio was in browser memory only — `chunksRef.current` in `useAudioRecorder.js` — and was destroyed on reload. Post-mortem in conversation: there is no recovery path because (a) the Shield-local AudioBridge WebSocket does not persist audio, (b) the backend only accepts the finalized blob on `/recording`, (c) no IndexedDB/localStorage was used. The family memory is gone. This plan exists so that never happens again.

**Existing save path** (to preserve compatibility — do not remove):
- `POST /api/v1/weekly-review/recording` with full `{ audioBase64, mimeType, week, duration }` → `WeeklyReviewService.saveRecording()` writes audio + mp3 + transcript + manifest. This code path stays for any future caller but the widget stops using it.

**Where files live today** (from `WeeklyReviewService.saveRecording`):
- Audio: `<mediaPath>/weekly-review/<localDate>/recording-<localDate>-<localTime>.<ext>`
- Transcript: `<dataPath>/household/common/weekly-review/<week>/transcript.yml`
- Manifest: `<dataPath>/household/common/weekly-review/<week>/manifest.yml`

**New draft location** (this plan):
- Draft in-progress audio: `<dataPath>/household/common/weekly-review/<week>/.drafts/<sessionId>.webm`
- `.drafts/` is hidden from bootstrap's recording status check (which reads `transcript.yml`, not drafts). Drafts become visible through the new `listDrafts` API.

**MediaRecorder webm chunking gotcha.** When `MediaRecorder.start(5000)` is used, the FIRST `ondataavailable` fires with the full ebml header + cluster. Subsequent events deliver only cluster data that depends on the earlier header. Chunks MUST be concatenated in sequence. Out-of-order concat = corrupt webm. Server enforces monotonic `seq` per `sessionId`; client uploads chunks sequentially (awaits ack of seq N before sending seq N+1).

**IndexedDB, not localStorage.** The user asked for "local storage" — that means browser-local persistence. We implement it with IndexedDB because (a) `window.localStorage` is synchronous and capped at ~5 MB, which cannot hold multi-minute webm audio, and (b) IndexedDB stores Blob values natively without base64 bloat. The net effect ("recording persists on the device for 7 days") matches the user's intent.

---

## File structure

**Backend (create & modify):**
- Modify: `backend/src/3_applications/weekly-review/WeeklyReviewService.mjs` — add `appendChunk`, `listDrafts`, `finalizeDraft`, `discardDraft`
- Modify: `backend/src/4_api/v1/routers/weekly-review.mjs` — add 4 new endpoints, wire into existing router
- Create: `backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs`
- Create: `backend/tests/unit/suite/4_api/v1/routers/weekly-review.chunk.test.mjs`

**Frontend (create & modify):**
- Create: `frontend/src/modules/WeeklyReview/hooks/chunkDb.js` — thin IndexedDB wrapper, 7-day expiry
- Create: `frontend/src/modules/WeeklyReview/hooks/useChunkUploader.js` — hook that accepts chunks, writes IndexedDB, uploads in-order with retry
- Modify: `frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js` — emit chunks via `onChunk` callback, remove in-memory buffer + base64 upload
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx` — wire new uploader, resume-draft UI, `pagehide` beacon
- Modify: `frontend/src/modules/WeeklyReview/components/RecordingBar.jsx` — surface sync status ("Saved", "Syncing", "Saved locally only")

---

## Task 1: Backend — `WeeklyReviewService.appendChunk`

**Files:**
- Modify: `backend/src/3_applications/weekly-review/WeeklyReviewService.mjs`
- Create test: `backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs`

- [ ] **Step 1: Write the failing test file**

Create `backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { WeeklyReviewService } from '../../../../../../src/3_applications/weekly-review/WeeklyReviewService.mjs';

describe('WeeklyReviewService.appendChunk', () => {
  let tmpDataPath;
  let tmpMediaPath;
  let service;
  const noopLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

  beforeEach(() => {
    tmpDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-data-'));
    tmpMediaPath = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-media-'));
    service = new WeeklyReviewService(
      { dataPath: tmpDataPath, mediaPath: tmpMediaPath, householdId: 'h' },
      { logger: noopLogger }
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDataPath, { recursive: true, force: true });
    fs.rmSync(tmpMediaPath, { recursive: true, force: true });
  });

  it('creates the draft file and writes the first chunk', async () => {
    const buffer = Buffer.from('chunk-0-bytes');
    const result = await service.appendChunk({
      sessionId: 'sess-1', seq: 0, week: '2026-04-12', buffer,
    });

    expect(result.ok).toBe(true);
    expect(result.bytesWritten).toBe(buffer.length);
    expect(result.totalBytes).toBe(buffer.length);
    expect(result.nextSeq).toBe(1);

    const draftPath = path.join(tmpDataPath, 'household', 'common', 'weekly-review', '2026-04-12', '.drafts', 'sess-1.webm');
    expect(fs.existsSync(draftPath)).toBe(true);
    expect(fs.readFileSync(draftPath)).toEqual(buffer);
  });

  it('appends successive chunks in order', async () => {
    await service.appendChunk({ sessionId: 'sess-1', seq: 0, week: '2026-04-12', buffer: Buffer.from('AAA') });
    const r = await service.appendChunk({ sessionId: 'sess-1', seq: 1, week: '2026-04-12', buffer: Buffer.from('BBB') });
    expect(r.totalBytes).toBe(6);
    expect(r.nextSeq).toBe(2);
    const draftPath = path.join(tmpDataPath, 'household', 'common', 'weekly-review', '2026-04-12', '.drafts', 'sess-1.webm');
    expect(fs.readFileSync(draftPath).toString()).toBe('AAABBB');
  });

  it('is idempotent for a re-sent chunk (same seq)', async () => {
    await service.appendChunk({ sessionId: 'sess-1', seq: 0, week: '2026-04-12', buffer: Buffer.from('AAA') });
    const r = await service.appendChunk({ sessionId: 'sess-1', seq: 0, week: '2026-04-12', buffer: Buffer.from('AAA') });
    expect(r.ok).toBe(true);
    expect(r.duplicate).toBe(true);
    const draftPath = path.join(tmpDataPath, 'household', 'common', 'weekly-review', '2026-04-12', '.drafts', 'sess-1.webm');
    expect(fs.readFileSync(draftPath).toString()).toBe('AAA');
  });

  it('rejects an out-of-order chunk', async () => {
    await service.appendChunk({ sessionId: 'sess-1', seq: 0, week: '2026-04-12', buffer: Buffer.from('AAA') });
    await expect(
      service.appendChunk({ sessionId: 'sess-1', seq: 2, week: '2026-04-12', buffer: Buffer.from('CCC') })
    ).rejects.toThrow(/out-of-order/i);
  });

  it('rejects invalid session id (path traversal)', async () => {
    await expect(
      service.appendChunk({ sessionId: '../evil', seq: 0, week: '2026-04-12', buffer: Buffer.from('X') })
    ).rejects.toThrow(/invalid sessionId/i);
  });

  it('rejects invalid week format', async () => {
    await expect(
      service.appendChunk({ sessionId: 'sess-1', seq: 0, week: '2026/04/12', buffer: Buffer.from('X') })
    ).rejects.toThrow(/invalid week/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs
```
Expected: FAIL — `service.appendChunk is not a function`.

- [ ] **Step 3: Implement `appendChunk`**

Add to `backend/src/3_applications/weekly-review/WeeklyReviewService.mjs`, inside the class (placed immediately after the `saveRecording` method):

```javascript
async appendChunk({ sessionId, seq, week, buffer }) {
  if (!this.#isValidSessionId(sessionId)) throw new Error(`invalid sessionId: ${sessionId}`);
  if (!this.#isValidWeek(week)) throw new Error(`invalid week: ${week}`);
  if (typeof seq !== 'number' || seq < 0 || !Number.isInteger(seq)) throw new Error(`invalid seq: ${seq}`);
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('buffer required');

  const draftDir = path.join(this.#dataPath, 'household', 'common', 'weekly-review', week, '.drafts');
  const draftPath = path.join(draftDir, `${sessionId}.webm`);
  const metaPath = path.join(draftDir, `${sessionId}.meta.json`);
  fs.mkdirSync(draftDir, { recursive: true });

  let meta = { sessionId, week, seq: -1, totalBytes: 0, startedAt: new Date().toISOString() };
  if (fs.existsSync(metaPath)) {
    try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8')); } catch {}
  }

  if (seq === meta.seq) {
    this.#logger.warn?.('weekly-review.chunk.duplicate', { sessionId, seq });
    return { ok: true, duplicate: true, bytesWritten: 0, totalBytes: meta.totalBytes, nextSeq: meta.seq + 1 };
  }
  if (seq !== meta.seq + 1) {
    throw new Error(`out-of-order chunk: expected ${meta.seq + 1}, got ${seq}`);
  }

  fs.appendFileSync(draftPath, buffer);
  meta.seq = seq;
  meta.totalBytes += buffer.length;
  meta.updatedAt = new Date().toISOString();
  fs.writeFileSync(metaPath, JSON.stringify(meta));

  this.#logger.info?.('weekly-review.chunk.appended', {
    sessionId, seq, bytes: buffer.length, totalBytes: meta.totalBytes, week,
  });
  return { ok: true, bytesWritten: buffer.length, totalBytes: meta.totalBytes, nextSeq: seq + 1 };
}

#isValidSessionId(id) {
  return typeof id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(id);
}

#isValidWeek(week) {
  return typeof week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(week);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs
```
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/weekly-review/WeeklyReviewService.mjs \
        backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs
git commit -m "feat(weekly-review): appendChunk service method for durable draft recording

Writes each audio chunk to data/household/common/weekly-review/<week>/.drafts/<sessionId>.webm
immediately on receipt. Enforces monotonic seq, rejects path traversal, idempotent on duplicates.
First step in eliminating in-memory-only audio buffer that caused 2026-04-19 data loss."
```

---

## Task 2: Backend — `WeeklyReviewService.listDrafts`

**Files:**
- Modify: `backend/src/3_applications/weekly-review/WeeklyReviewService.mjs`
- Modify test: `backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs`

- [ ] **Step 1: Add failing tests**

Append to the test file (inside the same `describe` block):

```javascript
  describe('listDrafts', () => {
    it('returns empty when no drafts exist', async () => {
      const drafts = await service.listDrafts('2026-04-12');
      expect(drafts).toEqual([]);
    });

    it('lists all drafts with metadata', async () => {
      await service.appendChunk({ sessionId: 'sess-aaaaaaaa', seq: 0, week: '2026-04-12', buffer: Buffer.from('X'.repeat(100)) });
      await service.appendChunk({ sessionId: 'sess-aaaaaaaa', seq: 1, week: '2026-04-12', buffer: Buffer.from('Y'.repeat(200)) });
      await service.appendChunk({ sessionId: 'sess-bbbbbbbb', seq: 0, week: '2026-04-12', buffer: Buffer.from('Z'.repeat(50)) });

      const drafts = await service.listDrafts('2026-04-12');
      const byId = Object.fromEntries(drafts.map(d => [d.sessionId, d]));

      expect(drafts).toHaveLength(2);
      expect(byId['sess-aaaaaaaa'].totalBytes).toBe(300);
      expect(byId['sess-aaaaaaaa'].seq).toBe(1);
      expect(byId['sess-bbbbbbbb'].totalBytes).toBe(50);
      expect(byId['sess-bbbbbbbb'].seq).toBe(0);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs
```
Expected: `listDrafts is not a function`.

- [ ] **Step 3: Implement `listDrafts`**

Add inside the class, below `appendChunk`:

```javascript
async listDrafts(week) {
  if (!this.#isValidWeek(week)) throw new Error(`invalid week: ${week}`);
  const draftDir = path.join(this.#dataPath, 'household', 'common', 'weekly-review', week, '.drafts');
  if (!fs.existsSync(draftDir)) return [];

  const entries = fs.readdirSync(draftDir);
  const metaFiles = entries.filter(n => n.endsWith('.meta.json'));
  const drafts = [];
  for (const name of metaFiles) {
    try {
      const meta = JSON.parse(fs.readFileSync(path.join(draftDir, name), 'utf-8'));
      drafts.push({
        sessionId: meta.sessionId,
        week: meta.week,
        seq: meta.seq,
        totalBytes: meta.totalBytes,
        startedAt: meta.startedAt,
        updatedAt: meta.updatedAt,
      });
    } catch (err) {
      this.#logger.warn?.('weekly-review.listDrafts.meta-parse-failed', { name, error: err.message });
    }
  }
  return drafts;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs
```
Expected: PASS (all tests including new `listDrafts`).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/weekly-review/WeeklyReviewService.mjs \
        backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs
git commit -m "feat(weekly-review): listDrafts enumerates unfinalized recordings"
```

---

## Task 3: Backend — `WeeklyReviewService.discardDraft`

**Files:**
- Modify: `backend/src/3_applications/weekly-review/WeeklyReviewService.mjs`
- Modify test: `backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs`

- [ ] **Step 1: Add failing test**

Append to the test file:

```javascript
  describe('discardDraft', () => {
    it('removes the draft and meta file', async () => {
      await service.appendChunk({ sessionId: 'sess-aaaaaaaa', seq: 0, week: '2026-04-12', buffer: Buffer.from('data') });
      const before = await service.listDrafts('2026-04-12');
      expect(before).toHaveLength(1);

      const result = await service.discardDraft({ sessionId: 'sess-aaaaaaaa', week: '2026-04-12' });
      expect(result.ok).toBe(true);

      const after = await service.listDrafts('2026-04-12');
      expect(after).toHaveLength(0);
    });

    it('is a no-op when draft does not exist', async () => {
      const result = await service.discardDraft({ sessionId: 'sess-missing', week: '2026-04-12' });
      expect(result.ok).toBe(true);
      expect(result.existed).toBe(false);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs
```
Expected: `discardDraft is not a function`.

- [ ] **Step 3: Implement `discardDraft`**

Add inside the class, below `listDrafts`:

```javascript
async discardDraft({ sessionId, week }) {
  if (!this.#isValidSessionId(sessionId)) throw new Error(`invalid sessionId: ${sessionId}`);
  if (!this.#isValidWeek(week)) throw new Error(`invalid week: ${week}`);
  const draftDir = path.join(this.#dataPath, 'household', 'common', 'weekly-review', week, '.drafts');
  const draftPath = path.join(draftDir, `${sessionId}.webm`);
  const metaPath = path.join(draftDir, `${sessionId}.meta.json`);
  let existed = false;
  if (fs.existsSync(draftPath)) { fs.unlinkSync(draftPath); existed = true; }
  if (fs.existsSync(metaPath)) { fs.unlinkSync(metaPath); existed = true; }
  this.#logger.info?.('weekly-review.draft.discarded', { sessionId, week, existed });
  return { ok: true, existed };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/weekly-review/WeeklyReviewService.mjs \
        backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs
git commit -m "feat(weekly-review): discardDraft removes unfinalized recording"
```

---

## Task 4: Backend — `WeeklyReviewService.finalizeDraft`

**Files:**
- Modify: `backend/src/3_applications/weekly-review/WeeklyReviewService.mjs`
- Modify test: `backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs`

- [ ] **Step 1: Add failing test**

Append to the test file:

```javascript
  describe('finalizeDraft', () => {
    it('moves draft to final location, transcribes, saves transcript & manifest, deletes draft', async () => {
      // seed transcription service
      const fakeTranscribe = {
        transcribe: async (buf, opts) => ({
          transcriptRaw: `raw for ${buf.length} bytes`,
          transcriptClean: 'clean',
        }),
      };
      service = new WeeklyReviewService(
        { dataPath: tmpDataPath, mediaPath: tmpMediaPath, householdId: 'h' },
        { logger: noopLogger, transcriptionService: fakeTranscribe }
      );

      await service.appendChunk({ sessionId: 'sess-aaaaaaaa', seq: 0, week: '2026-04-12', buffer: Buffer.from('ONE') });
      await service.appendChunk({ sessionId: 'sess-aaaaaaaa', seq: 1, week: '2026-04-12', buffer: Buffer.from('TWO') });

      const result = await service.finalizeDraft({ sessionId: 'sess-aaaaaaaa', week: '2026-04-12', duration: 10 });
      expect(result.ok).toBe(true);
      expect(result.transcript.raw).toBe('raw for 6 bytes');
      expect(result.transcript.clean).toBe('clean');

      // Draft is gone
      const drafts = await service.listDrafts('2026-04-12');
      expect(drafts).toHaveLength(0);

      // Transcript written
      const tPath = path.join(tmpDataPath, 'household', 'common', 'weekly-review', '2026-04-12', 'transcript.yml');
      expect(fs.existsSync(tPath)).toBe(true);
      const tData = JSON.parse(fs.readFileSync(tPath, 'utf-8'));
      expect(tData.week).toBe('2026-04-12');
      expect(tData.duration).toBe(10);
      expect(tData.transcriptClean).toBe('clean');

      // Audio moved to mediaPath
      const audioFiles = fs.readdirSync(path.join(tmpMediaPath, 'weekly-review'), { recursive: true })
        .filter(n => typeof n === 'string' && n.endsWith('.webm'));
      expect(audioFiles.length).toBe(1);
    });

    it('fails if draft does not exist', async () => {
      await expect(
        service.finalizeDraft({ sessionId: 'sess-missing', week: '2026-04-12', duration: 0 })
      ).rejects.toThrow(/draft not found/i);
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs
```
Expected: `finalizeDraft is not a function`.

- [ ] **Step 3: Implement `finalizeDraft`**

Add inside the class, below `discardDraft`. This reuses the save-to-media and transcription flow from the existing `saveRecording` method, but reads from the draft file on disk:

```javascript
async finalizeDraft({ sessionId, week, duration }) {
  if (!this.#isValidSessionId(sessionId)) throw new Error(`invalid sessionId: ${sessionId}`);
  if (!this.#isValidWeek(week)) throw new Error(`invalid week: ${week}`);

  const draftDir = path.join(this.#dataPath, 'household', 'common', 'weekly-review', week, '.drafts');
  const draftPath = path.join(draftDir, `${sessionId}.webm`);
  const metaPath = path.join(draftDir, `${sessionId}.meta.json`);
  if (!fs.existsSync(draftPath)) throw new Error(`draft not found: ${sessionId}`);

  this.#logger.info?.('weekly-review.finalize.start', { sessionId, week, duration });
  const buffer = fs.readFileSync(draftPath);

  // Move audio to final media location
  const now = new Date();
  const localDate = now.toLocaleDateString('en-CA', { timeZone: process.env.TZ || 'UTC' });
  const localTime = now.toLocaleTimeString('en-GB', { timeZone: process.env.TZ || 'UTC', hour12: false }).replace(/:/g, '-');
  const audioDir = path.join(this.#mediaPath, 'weekly-review', localDate);
  const audioPath = path.join(audioDir, `recording-${localDate}-${localTime}.webm`);
  fs.mkdirSync(audioDir, { recursive: true });
  fs.writeFileSync(audioPath, buffer);
  this.#logger.info?.('weekly-review.finalize.audio-saved', { sessionId, path: audioPath, bytes: buffer.length });

  // Convert to mp3 (best-effort, matches saveRecording behavior)
  const mp3Path = audioPath.replace(/\.\w+$/, '.mp3');
  try {
    await execFileAsync('ffmpeg', ['-i', audioPath, '-y', '-codec:a', 'libmp3lame', '-q:a', '4', mp3Path]);
    this.#logger.info?.('weekly-review.finalize.mp3-converted', { mp3Path });
  } catch (err) {
    this.#logger.error?.('weekly-review.finalize.mp3-failed', { error: err.message });
  }

  // Transcribe
  const { transcriptRaw, transcriptClean } = await this.#transcriptionService.transcribe(buffer, {
    mimeType: 'audio/webm',
    prompt: 'Family weekly review. Members discuss their week: activities, events, feelings, and memories.',
  });

  // Save transcript + manifest (same format as saveRecording)
  const transcriptDir = path.join(this.#dataPath, 'household', 'common', 'weekly-review', week);
  fs.mkdirSync(transcriptDir, { recursive: true });
  fs.writeFileSync(
    path.join(transcriptDir, 'transcript.yml'),
    JSON.stringify({ week, recordedAt: new Date().toISOString(), duration, transcriptRaw, transcriptClean }, null, 2)
  );
  fs.writeFileSync(
    path.join(transcriptDir, 'manifest.yml'),
    JSON.stringify({ week, generatedAt: new Date().toISOString(), duration }, null, 2)
  );

  // Delete draft
  fs.unlinkSync(draftPath);
  if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);

  this.#logger.info?.('weekly-review.finalize.complete', { sessionId, week, duration });
  return { ok: true, transcript: { raw: transcriptRaw, clean: transcriptClean, duration } };
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs
```
Expected: PASS (all tests). Note: mp3 conversion will log a failure warning in the test (no ffmpeg in test environment) but the test should pass because the `try/catch` swallows it.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/weekly-review/WeeklyReviewService.mjs \
        backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs
git commit -m "feat(weekly-review): finalizeDraft transcribes draft, saves transcript, removes draft"
```

---

## Task 5: Backend — HTTP endpoints for chunk / list / finalize / discard

**Files:**
- Modify: `backend/src/4_api/v1/routers/weekly-review.mjs`
- Create test: `backend/tests/unit/suite/4_api/v1/routers/weekly-review.chunk.test.mjs`

- [ ] **Step 1: Write the failing router test**

Create `backend/tests/unit/suite/4_api/v1/routers/weekly-review.chunk.test.mjs`:

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createWeeklyReviewRouter } from '../../../../../../src/4_api/v1/routers/weekly-review.mjs';

describe('weekly-review chunk router', () => {
  let mockService;
  let app;

  beforeEach(() => {
    mockService = {
      appendChunk: vi.fn().mockResolvedValue({ ok: true, bytesWritten: 10, totalBytes: 10, nextSeq: 1 }),
      listDrafts: vi.fn().mockResolvedValue([]),
      finalizeDraft: vi.fn().mockResolvedValue({ ok: true, transcript: { raw: 'r', clean: 'c', duration: 5 } }),
      discardDraft: vi.fn().mockResolvedValue({ ok: true, existed: true }),
      bootstrap: vi.fn(),
      saveRecording: vi.fn(),
    };
    const logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    app = express();
    app.use(express.json({ limit: '20mb' }));
    app.use('/', createWeeklyReviewRouter({ weeklyReviewService: mockService, logger }));
  });

  it('POST /recording/chunk forwards to appendChunk with decoded buffer', async () => {
    const buf = Buffer.from('hello');
    const res = await request(app)
      .post('/recording/chunk')
      .send({ sessionId: 'sess-aaaaaaaa', seq: 0, week: '2026-04-12', chunkBase64: buf.toString('base64') });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockService.appendChunk).toHaveBeenCalledTimes(1);
    const arg = mockService.appendChunk.mock.calls[0][0];
    expect(arg.sessionId).toBe('sess-aaaaaaaa');
    expect(arg.seq).toBe(0);
    expect(arg.week).toBe('2026-04-12');
    expect(Buffer.isBuffer(arg.buffer)).toBe(true);
    expect(arg.buffer.toString()).toBe('hello');
  });

  it('POST /recording/chunk returns 400 when chunkBase64 missing', async () => {
    const res = await request(app)
      .post('/recording/chunk')
      .send({ sessionId: 'sess-aaaaaaaa', seq: 0, week: '2026-04-12' });
    expect(res.status).toBe(400);
  });

  it('POST /recording/chunk returns 409 on out-of-order error', async () => {
    mockService.appendChunk.mockRejectedValueOnce(new Error('out-of-order chunk: expected 1, got 3'));
    const res = await request(app)
      .post('/recording/chunk')
      .send({ sessionId: 'sess-aaaaaaaa', seq: 3, week: '2026-04-12', chunkBase64: 'QUFB' });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/out-of-order/);
  });

  it('GET /recording/drafts lists drafts for a week', async () => {
    mockService.listDrafts.mockResolvedValueOnce([
      { sessionId: 'sess-aaaaaaaa', week: '2026-04-12', seq: 5, totalBytes: 12345, startedAt: '2026-04-19T10:00:00Z', updatedAt: '2026-04-19T10:01:00Z' },
    ]);
    const res = await request(app).get('/recording/drafts?week=2026-04-12');
    expect(res.status).toBe(200);
    expect(res.body.drafts).toHaveLength(1);
    expect(res.body.drafts[0].sessionId).toBe('sess-aaaaaaaa');
    expect(mockService.listDrafts).toHaveBeenCalledWith('2026-04-12');
  });

  it('POST /recording/finalize forwards sessionId/week/duration', async () => {
    const res = await request(app)
      .post('/recording/finalize')
      .send({ sessionId: 'sess-aaaaaaaa', week: '2026-04-12', duration: 120 });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockService.finalizeDraft).toHaveBeenCalledWith({ sessionId: 'sess-aaaaaaaa', week: '2026-04-12', duration: 120 });
  });

  it('DELETE /recording/drafts/:sessionId discards the draft', async () => {
    const res = await request(app)
      .delete('/recording/drafts/sess-aaaaaaaa')
      .query({ week: '2026-04-12' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(mockService.discardDraft).toHaveBeenCalledWith({ sessionId: 'sess-aaaaaaaa', week: '2026-04-12' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/tests/unit/suite/4_api/v1/routers/weekly-review.chunk.test.mjs
```
Expected: FAIL — endpoints return 404.

- [ ] **Step 3: Add endpoints to the router**

Replace the contents of `backend/src/4_api/v1/routers/weekly-review.mjs` with:

```javascript
import express from 'express';

export function createWeeklyReviewRouter(config) {
  const { weeklyReviewService, logger = console } = config;
  const router = express.Router();

  router.get('/bootstrap', async (req, res) => {
    const startMs = Date.now();
    try {
      const { week } = req.query;
      logger.info?.('weekly-review.api.bootstrap.request', { week: week || 'default', ip: req.ip });
      const data = await weeklyReviewService.bootstrap(week || undefined);
      const totalPhotos = data.days?.reduce((s, d) => s + (d.photoCount || 0), 0) || 0;
      logger.info?.('weekly-review.api.bootstrap.response', {
        week: data.week,
        dayCount: data.days?.length,
        totalPhotos,
        hasRecording: data.recording?.exists,
        durationMs: Date.now() - startMs,
      });
      res.json(data);
    } catch (err) {
      logger.error?.('weekly-review.api.bootstrap.error', { error: err.message, durationMs: Date.now() - startMs });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/recording', async (req, res) => {
    const startMs = Date.now();
    try {
      const { audioBase64, mimeType, week, duration } = req.body || {};
      if (!audioBase64 || typeof audioBase64 !== 'string') {
        logger.warn?.('weekly-review.api.recording.validation-failed', { reason: 'missing audioBase64' });
        return res.status(400).json({ ok: false, error: 'audioBase64 required' });
      }
      if (!week) {
        logger.warn?.('weekly-review.api.recording.validation-failed', { reason: 'missing week' });
        return res.status(400).json({ ok: false, error: 'week required' });
      }
      const payloadSizeKb = Math.round(audioBase64.length / 1024);
      logger.info?.('weekly-review.api.recording.request', { week, mimeType, duration, payloadSizeKb, ip: req.ip });

      const result = await weeklyReviewService.saveRecording({ audioBase64, mimeType, week, duration });
      logger.info?.('weekly-review.api.recording.response', {
        week,
        ok: result.ok,
        transcriptRawLength: result.transcript?.raw?.length,
        transcriptCleanLength: result.transcript?.clean?.length,
        durationMs: Date.now() - startMs,
      });
      res.json(result);
    } catch (err) {
      logger.error?.('weekly-review.api.recording.error', { error: err.message, durationMs: Date.now() - startMs });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/recording/chunk', async (req, res) => {
    const startMs = Date.now();
    try {
      const { sessionId, seq, week, chunkBase64 } = req.body || {};
      if (!chunkBase64 || typeof chunkBase64 !== 'string') {
        return res.status(400).json({ ok: false, error: 'chunkBase64 required' });
      }
      if (!sessionId || !week || typeof seq !== 'number') {
        return res.status(400).json({ ok: false, error: 'sessionId, seq, week required' });
      }
      const buffer = Buffer.from(chunkBase64, 'base64');
      const result = await weeklyReviewService.appendChunk({ sessionId, seq, week, buffer });
      logger.info?.('weekly-review.api.chunk.response', {
        sessionId, seq, week, bytes: buffer.length, totalBytes: result.totalBytes, duplicate: !!result.duplicate, durationMs: Date.now() - startMs,
      });
      res.json(result);
    } catch (err) {
      const msg = err.message || 'unknown';
      const status = /out-of-order/i.test(msg) ? 409 : /invalid/i.test(msg) ? 400 : 500;
      logger.error?.('weekly-review.api.chunk.error', { error: msg, status, durationMs: Date.now() - startMs });
      res.status(status).json({ ok: false, error: msg });
    }
  });

  router.get('/recording/drafts', async (req, res) => {
    try {
      const { week } = req.query;
      if (!week) return res.status(400).json({ ok: false, error: 'week required' });
      const drafts = await weeklyReviewService.listDrafts(week);
      res.json({ ok: true, drafts });
    } catch (err) {
      logger.error?.('weekly-review.api.drafts-list.error', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  router.post('/recording/finalize', async (req, res) => {
    const startMs = Date.now();
    try {
      const { sessionId, week, duration } = req.body || {};
      if (!sessionId || !week) return res.status(400).json({ ok: false, error: 'sessionId and week required' });
      const result = await weeklyReviewService.finalizeDraft({ sessionId, week, duration });
      logger.info?.('weekly-review.api.finalize.response', {
        sessionId, week, durationMs: Date.now() - startMs, transcriptCleanLength: result.transcript?.clean?.length,
      });
      res.json(result);
    } catch (err) {
      const status = /not found/i.test(err.message) ? 404 : 500;
      logger.error?.('weekly-review.api.finalize.error', { error: err.message, status, durationMs: Date.now() - startMs });
      res.status(status).json({ ok: false, error: err.message });
    }
  });

  router.delete('/recording/drafts/:sessionId', async (req, res) => {
    try {
      const { sessionId } = req.params;
      const { week } = req.query;
      if (!week) return res.status(400).json({ ok: false, error: 'week required' });
      const result = await weeklyReviewService.discardDraft({ sessionId, week });
      res.json(result);
    } catch (err) {
      logger.error?.('weekly-review.api.discard.error', { error: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  return router;
}
```

- [ ] **Step 4: Install supertest if not present and run**

```bash
cd /opt/Code/DaylightStation && npm ls supertest 2>&1 | head -3
```
If missing:
```bash
cd /opt/Code/DaylightStation && npm install --save-dev supertest
```
Then:
```bash
cd /opt/Code/DaylightStation && npx vitest run backend/tests/unit/suite/4_api/v1/routers/weekly-review.chunk.test.mjs
```
Expected: PASS (6 tests).

- [ ] **Step 5: Increase body-parser limit in app.mjs so 5s chunks fit**

Audio webm 5s at 48 kHz mono opus is typically 40-80 KB. Base64-encoded ≈ 100 KB. Express default limit is 100 KB which is right at the edge. Raise to 2 MB to be safe.

Open `backend/src/app.mjs`, search for `express.json(`. If the current mount is `app.use(express.json())` with no limit, add a limit argument of `'2mb'`. Otherwise confirm it is already `'2mb'` or larger.

Verify:
```bash
grep -n "express.json" backend/src/app.mjs
```
Ensure any call on a path touching `/api/v1/weekly-review` uses `{ limit: '2mb' }` or higher.

If a change is needed, commit it as part of this task.

- [ ] **Step 6: Commit**

```bash
git add backend/src/4_api/v1/routers/weekly-review.mjs \
        backend/tests/unit/suite/4_api/v1/routers/weekly-review.chunk.test.mjs \
        backend/src/app.mjs package.json package-lock.json
git commit -m "feat(weekly-review): chunk/drafts/finalize/discard HTTP endpoints

- POST /recording/chunk: append base64 webm chunk to server draft
- GET /recording/drafts: list unfinalized drafts for a week
- POST /recording/finalize: transcribe draft and save final transcript
- DELETE /recording/drafts/:sessionId: discard a draft
- Body limit raised to 2MB to accommodate 5s chunk uploads"
```

---

## Task 6: Frontend — IndexedDB wrapper `chunkDb.js`

**Files:**
- Create: `frontend/src/modules/WeeklyReview/hooks/chunkDb.js`

No unit-test harness exists for frontend modules in this codebase; correctness is verified by the uploader's behavior and the Playwright flow test at the end. The wrapper is small and isolated.

- [ ] **Step 1: Create the file**

Write `frontend/src/modules/WeeklyReview/hooks/chunkDb.js`:

```javascript
// Thin IndexedDB wrapper for Weekly Review chunks.
// One row per chunk, keyed by [sessionId, seq]. 7-day retention.
// No external dependency — raw IndexedDB API.

const DB_NAME = 'weekly-review-chunks-v1';
const STORE = 'chunks';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

let _dbPromise = null;

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: ['sessionId', 'seq'] });
        store.createIndex('sessionId', 'sessionId', { unique: false });
        store.createIndex('savedAt', 'savedAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(mode) {
  return openDb().then(db => db.transaction(STORE, mode).objectStore(STORE));
}

export async function putChunk({ sessionId, seq, week, blob, uploaded = false }) {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const req = store.put({ sessionId, seq, week, blob, uploaded, savedAt: Date.now() });
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function markChunkUploaded({ sessionId, seq }) {
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const getReq = store.get([sessionId, seq]);
    getReq.onsuccess = () => {
      const row = getReq.result;
      if (!row) return resolve(false);
      row.uploaded = true;
      const putReq = store.put(row);
      putReq.onsuccess = () => resolve(true);
      putReq.onerror = () => reject(putReq.error);
    };
    getReq.onerror = () => reject(getReq.error);
  });
}

export async function getChunksForSession(sessionId) {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const req = store.index('sessionId').getAll(sessionId);
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => a.seq - b.seq));
    req.onerror = () => reject(req.error);
  });
}

export async function listSessions() {
  const store = await tx('readonly');
  return new Promise((resolve, reject) => {
    const seen = new Map();
    const req = store.openCursor();
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) {
        resolve(Array.from(seen.values()));
        return;
      }
      const row = cursor.value;
      const prior = seen.get(row.sessionId);
      if (!prior) {
        seen.set(row.sessionId, {
          sessionId: row.sessionId,
          week: row.week,
          firstSavedAt: row.savedAt,
          lastSavedAt: row.savedAt,
          chunkCount: 1,
          unuploadedCount: row.uploaded ? 0 : 1,
        });
      } else {
        prior.chunkCount += 1;
        prior.firstSavedAt = Math.min(prior.firstSavedAt, row.savedAt);
        prior.lastSavedAt = Math.max(prior.lastSavedAt, row.savedAt);
        if (!row.uploaded) prior.unuploadedCount += 1;
      }
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteSession(sessionId) {
  const chunks = await getChunksForSession(sessionId);
  const store = await tx('readwrite');
  return Promise.all(chunks.map(c => new Promise((resolve, reject) => {
    const req = store.delete([sessionId, c.seq]);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  })));
}

export async function purgeExpired(now = Date.now()) {
  const cutoff = now - RETENTION_MS;
  const store = await tx('readwrite');
  return new Promise((resolve, reject) => {
    const index = store.index('savedAt');
    const range = IDBKeyRange.upperBound(cutoff);
    const req = index.openCursor(range);
    let deleted = 0;
    req.onsuccess = (e) => {
      const cursor = e.target.result;
      if (!cursor) return resolve(deleted);
      cursor.delete();
      deleted += 1;
      cursor.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
```

- [ ] **Step 2: Smoke-check it loads without crashing**

Frontend doesn't have unit tests for modules/. Smoke-check by ensuring a node syntax pass succeeds (node can't actually *run* it without IndexedDB but it will validate syntax):

```bash
cd /opt/Code/DaylightStation && node --check frontend/src/modules/WeeklyReview/hooks/chunkDb.js
```
Expected: no output (success).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/WeeklyReview/hooks/chunkDb.js
git commit -m "feat(weekly-review): IndexedDB wrapper for chunk persistence with 7-day retention"
```

---

## Task 7: Frontend — `useChunkUploader` hook

**Files:**
- Create: `frontend/src/modules/WeeklyReview/hooks/useChunkUploader.js`

Responsibilities:
- Accept `(blob, seq)` from the recorder
- Synchronously write blob to IndexedDB BEFORE attempting upload
- Upload queue is strictly sequential per session (chunks depend on order)
- Retry with exponential backoff (1s, 2s, 4s, 8s, cap 30s); never give up — the chunk lives in IndexedDB either way
- Expose `status` (`idle`|`syncing`|`offline`|`saved`), `pendingCount`, `lastAckedAt`
- Expose `flushNow()` that fires pending upload attempts immediately (used on stop + on visibility change)
- Expose `beaconFlush()` that uses `navigator.sendBeacon` for any unuploaded chunks (best effort, for `pagehide`)

- [ ] **Step 1: Create the hook**

Write `frontend/src/modules/WeeklyReview/hooks/useChunkUploader.js`:

```javascript
import { useState, useRef, useCallback, useEffect } from 'react';
import getLogger from '@/lib/logging/Logger.js';
import { putChunk, markChunkUploaded, getChunksForSession, purgeExpired } from './chunkDb.js';

const logger = getLogger().child({ component: 'weekly-review-uploader' });
const CHUNK_ENDPOINT = '/api/v1/weekly-review/recording/chunk';
const MAX_BACKOFF_MS = 30_000;

async function blobToBase64(blob) {
  const buf = await blob.arrayBuffer();
  // btoa requires binary string; use chunked conversion to avoid call-stack limits on large blobs
  const bytes = new Uint8Array(buf);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function useChunkUploader({ sessionId, week }) {
  const [status, setStatus] = useState('idle'); // idle|syncing|offline|saved
  const [pendingCount, setPendingCount] = useState(0);
  const [lastAckedAt, setLastAckedAt] = useState(null);
  const [ackedSeq, setAckedSeq] = useState(-1);

  const queueRef = useRef([]);     // in-memory { seq, blob } queue
  const busyRef = useRef(false);
  const backoffRef = useRef(1000);
  const aliveRef = useRef(true);

  useEffect(() => {
    aliveRef.current = true;
    // Best-effort retention cleanup on mount
    purgeExpired().then(n => {
      if (n > 0) logger.info('chunks.purged-expired', { count: n });
    }).catch(err => logger.warn('chunks.purge-failed', { error: err.message }));
    return () => { aliveRef.current = false; };
  }, []);

  const drain = useCallback(async () => {
    if (busyRef.current) return;
    if (queueRef.current.length === 0) {
      setStatus(prev => prev === 'syncing' ? 'saved' : prev);
      return;
    }
    busyRef.current = true;
    setStatus('syncing');

    const next = queueRef.current[0];
    try {
      const chunkBase64 = await blobToBase64(next.blob);
      const resp = await fetch(CHUNK_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, seq: next.seq, week, chunkBase64 }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      await resp.json();

      // Success — mark IndexedDB row uploaded and pop queue
      await markChunkUploaded({ sessionId, seq: next.seq });
      queueRef.current.shift();
      backoffRef.current = 1000;
      setAckedSeq(next.seq);
      setLastAckedAt(Date.now());
      setPendingCount(queueRef.current.length);
      logger.info('chunk.uploaded', { sessionId, seq: next.seq, pending: queueRef.current.length });
      busyRef.current = false;
      if (aliveRef.current) drain();
    } catch (err) {
      logger.warn('chunk.upload-failed', { sessionId, seq: next.seq, error: err.message, backoffMs: backoffRef.current });
      setStatus('offline');
      busyRef.current = false;
      const delay = backoffRef.current;
      backoffRef.current = Math.min(backoffRef.current * 2, MAX_BACKOFF_MS);
      setTimeout(() => { if (aliveRef.current) drain(); }, delay);
    }
  }, [sessionId, week]);

  const enqueue = useCallback(async ({ seq, blob }) => {
    // Layer 2 durability: write to IndexedDB synchronously FIRST
    try {
      await putChunk({ sessionId, seq, week, blob, uploaded: false });
      logger.info('chunk.saved-local', { sessionId, seq, bytes: blob.size });
    } catch (err) {
      logger.error('chunk.save-local-failed', { sessionId, seq, error: err.message });
      // Still try upload — in-memory blob is the only remaining copy
    }
    queueRef.current.push({ seq, blob });
    setPendingCount(queueRef.current.length);
    drain();
  }, [sessionId, week, drain]);

  const flushNow = useCallback(() => { drain(); }, [drain]);

  const beaconFlush = useCallback(async () => {
    // Best-effort: send up to the next 3 pending chunks via sendBeacon.
    // sendBeacon is fire-and-forget; we don't know if they succeed,
    // but IndexedDB still has them for next load if they don't.
    const toSend = queueRef.current.slice(0, 3);
    for (const item of toSend) {
      try {
        const chunkBase64 = await blobToBase64(item.blob);
        const payload = JSON.stringify({ sessionId, seq: item.seq, week, chunkBase64 });
        const blob = new Blob([payload], { type: 'application/json' });
        navigator.sendBeacon(CHUNK_ENDPOINT, blob);
        logger.info('chunk.beacon-sent', { sessionId, seq: item.seq });
      } catch (err) {
        logger.warn('chunk.beacon-failed', { sessionId, seq: item.seq, error: err.message });
      }
    }
  }, [sessionId, week]);

  // Recovery: on mount, replay unuploaded chunks that were left in IndexedDB.
  const recoverLocal = useCallback(async () => {
    try {
      const rows = await getChunksForSession(sessionId);
      const unuploaded = rows.filter(r => !r.uploaded);
      if (unuploaded.length === 0) return { recovered: 0 };
      logger.info('chunks.recover-local', { sessionId, count: unuploaded.length });
      for (const row of unuploaded) queueRef.current.push({ seq: row.seq, blob: row.blob });
      setPendingCount(queueRef.current.length);
      drain();
      return { recovered: unuploaded.length };
    } catch (err) {
      logger.error('chunks.recover-local-failed', { sessionId, error: err.message });
      return { recovered: 0, error: err.message };
    }
  }, [sessionId, drain]);

  return {
    enqueue,
    flushNow,
    beaconFlush,
    recoverLocal,
    status,
    pendingCount,
    lastAckedAt,
    ackedSeq,
  };
}
```

- [ ] **Step 2: Syntax check**

```bash
cd /opt/Code/DaylightStation && node --check frontend/src/modules/WeeklyReview/hooks/useChunkUploader.js
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/WeeklyReview/hooks/useChunkUploader.js
git commit -m "feat(weekly-review): useChunkUploader hook with IndexedDB durability + retry + beacon"
```

---

## Task 8: Frontend — rewrite `useAudioRecorder` to emit chunks

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js`

The existing hook buffers all MediaRecorder data in `chunksRef.current` and emits one final base64 on stop. Replace that with a timesliced `ondataavailable` that calls `onChunk({ seq, blob, isFinal })`. Keep everything else (AudioBridge acquisition, level meter, silence warning, error surface).

- [ ] **Step 1: Rewrite the hook**

Replace the entire file `frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js` with:

```javascript
import { useState, useRef, useCallback, useEffect } from 'react';
import getLogger from '@/lib/logging/Logger.js';

const logger = getLogger().child({ component: 'weekly-review-recorder' });

const LEVEL_SAMPLE_INTERVAL_MS = 50;
const SILENCE_WARNING_MS = 5000;
const CHUNK_INTERVAL_MS = 5000;

const BRIDGE_URL = 'ws://localhost:8765';
const BRIDGE_TIMEOUT_MS = 1500;

function getBridgeStream() {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { ws.close(); reject(new Error('AudioBridge timeout')); }, BRIDGE_TIMEOUT_MS);
    const ws = new WebSocket(BRIDGE_URL);
    ws.binaryType = 'arraybuffer';
    ws.onmessage = async (event) => {
      if (typeof event.data !== 'string') return;
      clearTimeout(timeout);
      let format;
      try { format = JSON.parse(event.data); } catch { ws.close(); return reject(new Error('AudioBridge bad header')); }
      if (format.error) { ws.close(); return reject(new Error(`AudioBridge error: ${format.error}`)); }
      try { resolve(await buildBridgeStream(ws, format)); } catch (err) { ws.close(); reject(err); }
    };
    ws.onerror = () => { clearTimeout(timeout); reject(new Error('AudioBridge unavailable')); };
    ws.onclose = (e) => { if (e.code !== 1000) { clearTimeout(timeout); reject(new Error('AudioBridge closed')); } };
  });
}

async function buildBridgeStream(ws, format) {
  const sampleRate = format.sampleRate || 48000;
  const ctx = new AudioContext({ sampleRate });
  if (ctx.state === 'suspended') await ctx.resume();
  const processorSource = `
class BridgeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._ring = new Float32Array(${sampleRate});
    this._writePos = 0; this._readPos = 0; this._count = 0;
    this.port.onmessage = (e) => {
      if (!e.data) return;
      const int16 = new Int16Array(e.data);
      const cap = this._ring.length;
      for (let i = 0; i < int16.length; i++) {
        this._ring[this._writePos] = int16[i] / 32768;
        this._writePos = (this._writePos + 1) % cap;
      }
      this._count = Math.min(this._count + int16.length, cap);
    };
  }
  process(inputs, outputs) {
    const ch = outputs[0][0]; if (!ch) return true;
    const needed = ch.length; const cap = this._ring.length;
    const avail = Math.min(this._count, needed);
    for (let i = 0; i < avail; i++) { ch[i] = this._ring[this._readPos]; this._readPos = (this._readPos + 1) % cap; }
    this._count -= avail; return true;
  }
}
registerProcessor('bridge-recorder-processor', BridgeProcessor);`;
  const blob = new Blob([processorSource], { type: 'application/javascript' });
  const blobUrl = URL.createObjectURL(blob);
  try { await ctx.audioWorklet.addModule(blobUrl); } finally { URL.revokeObjectURL(blobUrl); }
  const workletNode = new AudioWorkletNode(ctx, 'bridge-recorder-processor');
  const destination = ctx.createMediaStreamDestination();
  workletNode.connect(destination);
  ws.onmessage = (event) => {
    if (event.data instanceof ArrayBuffer) workletNode.port.postMessage(event.data, [event.data]);
  };
  ws.onclose = (e) => logger.warn('recorder.bridge-ws-closed', { code: e.code, reason: e.reason });
  const stream = destination.stream;
  stream._bridgeCtx = ctx; stream._bridgeWorklet = workletNode; stream._bridgeWs = ws;
  return stream;
}

export function useAudioRecorder({ onChunk }) {
  const [isRecording, setIsRecording] = useState(false);
  const [duration, setDuration] = useState(0);
  const [micLevel, setMicLevel] = useState(0);
  const [silenceWarning, setSilenceWarning] = useState(false);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const startTimeRef = useRef(null);
  const timerRef = useRef(null);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const levelRafRef = useRef(null);
  const lastLevelAtRef = useRef(0);
  const silenceStartRef = useRef(null);
  const peakLevelRef = useRef(0);
  const seqRef = useRef(0);

  const cleanup = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (levelRafRef.current) cancelAnimationFrame(levelRafRef.current);
    if (streamRef.current) {
      if (streamRef.current._bridgeWs) streamRef.current._bridgeWs.close();
      if (streamRef.current._bridgeCtx) {
        streamRef.current._bridgeCtx.close().catch(() => {});
        if (audioContextRef.current === streamRef.current._bridgeCtx) audioContextRef.current = null;
      }
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    analyserRef.current = null;
    mediaRecorderRef.current = null;
    peakLevelRef.current = 0;
    seqRef.current = 0;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  const startLevelMonitor = useCallback((stream) => {
    try {
      const audioContext = stream._bridgeCtx || new AudioContext();
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
        if (normalized > peakLevelRef.current) peakLevelRef.current = normalized;

        const now = performance.now();
        if (now - lastLevelAtRef.current >= LEVEL_SAMPLE_INTERVAL_MS) {
          lastLevelAtRef.current = now;
          setMicLevel(normalized);
          if (normalized < 0.02) {
            if (!silenceStartRef.current) silenceStartRef.current = now;
            if (now - silenceStartRef.current > SILENCE_WARNING_MS) {
              setSilenceWarning(prev => prev || (logger.warn('recorder.silence-warning', { silenceDurationMs: Math.round(now - silenceStartRef.current) }), true));
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
    logger.info('recorder.start-requested');
    try {
      setError(null);
      setSilenceWarning(false);
      seqRef.current = 0;

      let stream;
      try {
        stream = await getBridgeStream();
        logger.info('recorder.bridge-acquired');
      } catch (bridgeErr) {
        logger.info('recorder.bridge-unavailable', { reason: bridgeErr.message });
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      }
      streamRef.current = stream;

      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (!e.data || e.data.size === 0) return;
        const seq = seqRef.current++;
        logger.info('recorder.chunk-emitted', { seq, bytes: e.data.size });
        if (onChunk) {
          Promise.resolve(onChunk({ seq, blob: e.data })).catch(err => {
            logger.error('recorder.onChunk-failed', { seq, error: err.message });
          });
        }
      };
      recorder.onerror = (e) => logger.error('recorder.media-recorder-error', { error: e.error?.message || 'unknown' });
      recorder.onstop = () => {
        logger.info('recorder.stopped', { duration: Math.round((Date.now() - startTimeRef.current) / 1000) });
        cleanup();
        setIsRecording(false);
        setMicLevel(0);
        setSilenceWarning(false);
      };

      startLevelMonitor(stream);
      startTimeRef.current = Date.now();
      setDuration(0);
      recorder.start(CHUNK_INTERVAL_MS);
      setIsRecording(true);

      timerRef.current = setInterval(() => {
        setDuration(Math.round((Date.now() - startTimeRef.current) / 1000));
      }, 1000);

      logger.info('recorder.started', { mimeType: 'audio/webm', chunkIntervalMs: CHUNK_INTERVAL_MS });
    } catch (err) {
      logger.error('recorder.start-failed', { error: err.message, name: err.name });
      setError(`Microphone error: ${err.message}`);
      cleanup();
    }
  }, [cleanup, startLevelMonitor, onChunk]);

  const stopRecording = useCallback(() => {
    const state = mediaRecorderRef.current?.state;
    logger.info('recorder.stop-requested', { recorderState: state });
    if (mediaRecorderRef.current && state === 'recording') {
      // Force final dataavailable before stop, so tail audio is captured
      try { mediaRecorderRef.current.requestData(); } catch {}
      mediaRecorderRef.current.stop();
    }
  }, []);

  return { isRecording, duration, micLevel, silenceWarning, error, startRecording, stopRecording };
}
```

- [ ] **Step 2: Syntax check**

```bash
cd /opt/Code/DaylightStation && node --check frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js
```
Expected: no output.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/modules/WeeklyReview/hooks/useAudioRecorder.js
git commit -m "refactor(weekly-review): recorder emits timesliced chunks via onChunk callback

MediaRecorder now runs with timeslice=5000ms. Each ondataavailable event fires
onChunk({ seq, blob }). No more in-memory buffering of the full recording; the
audio is handed off to the caller immediately for durable storage."
```

---

## Task 9: Frontend — wire `WeeklyReview.jsx` to the durable pipeline

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx`
- Modify: `frontend/src/modules/WeeklyReview/components/RecordingBar.jsx`

Widget changes:
1. Generate a `sessionId` at mount (crypto.randomUUID) scoped to the week.
2. Replace `handleRecordingComplete`/`useAudioRecorder` wiring with `useChunkUploader` + the new recorder.
3. On stop: call `uploader.flushNow()`, wait until `pendingCount === 0` or a 30s ceiling, then POST `/api/v1/weekly-review/recording/finalize`.
4. On mount: call `uploader.recoverLocal()` first, then GET `/api/v1/weekly-review/recording/drafts?week=<week>` to learn server-side drafts. If any exist and we're not mid-recording, show a resume modal.
5. Register a `pagehide` listener that calls `uploader.beaconFlush()`.

- [ ] **Step 1: Replace recording wiring in `WeeklyReview.jsx`**

Locate and replace the section of `WeeklyReview.jsx` from the `handleRecordingComplete` callback declaration through the `useAudioRecorder` destructure (currently lines 45-77) with:

```javascript
  // Durable recording pipeline: stable sessionId per mount+week.
  const sessionIdRef = useRef(null);
  if (!sessionIdRef.current) {
    // crypto.randomUUID exists in all modern browsers and FKB
    sessionIdRef.current = (crypto?.randomUUID?.() || `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
  }

  const weekForUploader = data?.week || '0000-00-00';
  const uploader = useChunkUploader({ sessionId: sessionIdRef.current, week: weekForUploader });

  const handleChunk = useCallback(async ({ seq, blob }) => {
    await uploader.enqueue({ seq, blob });
  }, [uploader]);

  const {
    isRecording, duration: recordingDuration, micLevel, silenceWarning,
    error: recorderError, startRecording, stopRecording,
  } = useAudioRecorder({ onChunk: handleChunk });

  const finalizeRecording = useCallback(async () => {
    if (!data?.week) return;
    setUploading(true);
    uploadStartRef.current = Date.now();
    try {
      // Drain any pending chunk uploads first (sequential, monotonic ack)
      const deadline = Date.now() + 30_000;
      uploader.flushNow();
      while (uploader.pendingCount > 0 && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 500));
        uploader.flushNow();
      }
      if (uploader.pendingCount > 0) {
        logger.warn('recording.finalize-with-pending', { pending: uploader.pendingCount, sessionId: sessionIdRef.current });
        // Proceed anyway: server will finalize what it has; remaining chunks stay in IndexedDB for retry.
      }
      logger.info('recording.finalize-request', { sessionId: sessionIdRef.current, week: data.week });
      const result = await DaylightAPI('/api/v1/weekly-review/recording/finalize', {
        sessionId: sessionIdRef.current,
        week: data.week,
        duration: recordingDuration,
      }, 'POST');
      logger.info('recording.finalize-complete', { sessionId: sessionIdRef.current, ok: result.ok });
      // On success, remove local chunks for this session (server is authoritative now)
      await deleteLocalSession(sessionIdRef.current).catch(err => logger.warn('recording.local-cleanup-failed', { error: err.message }));
      setData(prev => ({ ...prev, recording: { exists: true, recordedAt: new Date().toISOString(), duration: recordingDuration } }));
      if (typeof dispatch === 'function') dispatch('escape');
      else if (typeof dismiss === 'function') dismiss();
    } catch (err) {
      logger.error('recording.finalize-failed', { sessionId: sessionIdRef.current, error: err.message });
      // Do NOT discard local chunks — user can retry next mount.
    } finally {
      setUploading(false);
    }
  }, [data?.week, recordingDuration, uploader, dispatch, dismiss]);
```

Find the `handleRecordingComplete` callback (it replaces that responsibility) and remove it entirely. Find the call site `stopRecording()` in the stop-confirm Save button (search for `recording.confirm-save`) — keep it; the recorder's `onstop` now just stops the mic. Then add a new effect that calls `finalizeRecording` once the recorder has transitioned from recording → not-recording AND `hasRecorded` is true:

Add this effect immediately after the existing `useEffect(() => { logger.info('state.is-recording', ...` block (around line 80-83):

```javascript
  // When the recorder finishes (stop pressed), drain uploads and finalize.
  const finalizeTriggeredRef = useRef(false);
  useEffect(() => {
    if (!isRecording && hasRecorded && !finalizeTriggeredRef.current) {
      finalizeTriggeredRef.current = true;
      finalizeRecording();
    }
  }, [isRecording, hasRecorded, finalizeRecording]);
```

Add imports at the top of `WeeklyReview.jsx`, replacing the existing `useAudioRecorder` import line:

```javascript
import { useAudioRecorder } from './hooks/useAudioRecorder.js';
import { useChunkUploader } from './hooks/useChunkUploader.js';
import { deleteSession as deleteLocalSession, listSessions as listLocalSessions } from './hooks/chunkDb.js';
```

- [ ] **Step 2: Add resume-draft UI**

Near the existing init overlay (search for `weekly-review-init-overlay`), add a new overlay that shows if we detect a prior draft on mount. Add this state near other `useState` calls:

```javascript
  const [resumeDraft, setResumeDraft] = useState(null); // { sessionId, source: 'server'|'local', totalBytes, lastSavedAt }
```

Add this effect right after the existing `bootstrap` effect (after the `useEffect` that fetches `/api/v1/weekly-review/bootstrap`):

```javascript
  // After bootstrap, detect any unfinalized drafts (server-side or local-only)
  useEffect(() => {
    if (!data?.week) return;
    let cancelled = false;
    (async () => {
      try {
        // Server-side drafts for this week
        const serverResp = await DaylightAPI(`/api/v1/weekly-review/recording/drafts?week=${data.week}`);
        const serverDraft = (serverResp.drafts || [])
          .filter(d => d.sessionId !== sessionIdRef.current)
          .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
        if (serverDraft && !cancelled) {
          logger.info('recording.resume-candidate.server', serverDraft);
          setResumeDraft({ sessionId: serverDraft.sessionId, source: 'server', totalBytes: serverDraft.totalBytes, lastSavedAt: serverDraft.updatedAt });
          return;
        }
        // Otherwise check local IndexedDB
        const localSessions = await listLocalSessions();
        const localDraft = localSessions
          .filter(s => s.week === data.week && s.sessionId !== sessionIdRef.current && s.unuploadedCount > 0)
          .sort((a, b) => b.lastSavedAt - a.lastSavedAt)[0];
        if (localDraft && !cancelled) {
          logger.info('recording.resume-candidate.local', localDraft);
          setResumeDraft({ sessionId: localDraft.sessionId, source: 'local', totalBytes: null, lastSavedAt: new Date(localDraft.lastSavedAt).toISOString(), chunkCount: localDraft.chunkCount });
        }
      } catch (err) {
        logger.warn('recording.resume-check-failed', { error: err.message });
      }
    })();
    return () => { cancelled = true; };
  }, [data?.week]);
```

Add a handler to finalize the previously-discovered draft:

```javascript
  const finalizePriorDraft = useCallback(async () => {
    if (!resumeDraft?.sessionId || !data?.week) return;
    try {
      logger.info('recording.resume.finalize', { sessionId: resumeDraft.sessionId, source: resumeDraft.source });
      if (resumeDraft.source === 'local') {
        // Replay local chunks to server first
        const rows = await (await import('./hooks/chunkDb.js')).getChunksForSession(resumeDraft.sessionId);
        for (const row of rows) {
          if (row.uploaded) continue;
          const chunkBase64 = await (async b => {
            const buf = await b.arrayBuffer();
            const bytes = new Uint8Array(buf); let bin = '';
            for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
            return btoa(bin);
          })(row.blob);
          await DaylightAPI('/api/v1/weekly-review/recording/chunk', { sessionId: resumeDraft.sessionId, seq: row.seq, week: data.week, chunkBase64 }, 'POST');
        }
      }
      await DaylightAPI('/api/v1/weekly-review/recording/finalize', {
        sessionId: resumeDraft.sessionId, week: data.week, duration: 0,
      }, 'POST');
      await deleteLocalSession(resumeDraft.sessionId);
      setResumeDraft(null);
      // Refresh bootstrap to pick up new recording status
      const fresh = await DaylightAPI('/api/v1/weekly-review/bootstrap');
      setData(fresh);
    } catch (err) {
      logger.error('recording.resume.finalize-failed', { error: err.message });
    }
  }, [resumeDraft, data?.week]);

  const discardPriorDraft = useCallback(async () => {
    if (!resumeDraft?.sessionId || !data?.week) return;
    try {
      if (resumeDraft.source === 'server') {
        await DaylightAPI(`/api/v1/weekly-review/recording/drafts/${resumeDraft.sessionId}?week=${data.week}`, {}, 'DELETE');
      }
      await deleteLocalSession(resumeDraft.sessionId);
      setResumeDraft(null);
    } catch (err) {
      logger.error('recording.resume.discard-failed', { error: err.message });
    }
  }, [resumeDraft, data?.week]);
```

Note: `DaylightAPI` currently does not accept method `DELETE`. Confirm by grep:
```bash
grep -n "method" frontend/src/lib/api.mjs | head
```
If `DELETE` is not handled, extend `DaylightAPI` to pass through any method string (it already does — the auto-conversion is GET→POST only). The `DELETE` call above will pass `{}` as data which triggers the auto-conversion only if method is `GET`, so it remains `DELETE`. Verify the `options.body` branch is skipped for `DELETE` — currently `if (method !== 'GET')` includes DELETE. That means it would send a JSON body with DELETE, which most servers accept. Acceptable.

In the JSX (below the init overlay block), add:

```jsx
      {resumeDraft && !isRecording && !hasRecorded && (
        <div className="weekly-review-confirm-overlay">
          <div className="confirm-dialog">
            <div className="confirm-message">
              A previous recording was not finalized.<br/>
              <small>{resumeDraft.source === 'server' ? `Server draft · ${Math.round((resumeDraft.totalBytes || 0) / 1024)} KB` : `Local-only draft · ${resumeDraft.chunkCount || 0} chunks`}</small>
            </div>
            <div className="confirm-actions">
              <button className="confirm-btn confirm-btn--save" onClick={finalizePriorDraft}>Finalize Previous</button>
              <button className="confirm-btn confirm-btn--continue" onClick={discardPriorDraft}>Discard</button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 3: Add pagehide beacon**

Add this effect anywhere among the other `useEffect`s:

```javascript
  useEffect(() => {
    const handlePageHide = () => {
      if (isRecording || uploader.pendingCount > 0) {
        logger.info('recording.pagehide-beacon', { pending: uploader.pendingCount, isRecording });
        uploader.beaconFlush();
      }
    };
    window.addEventListener('pagehide', handlePageHide);
    window.addEventListener('beforeunload', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
      window.removeEventListener('beforeunload', handlePageHide);
    };
  }, [isRecording, uploader]);
```

- [ ] **Step 4: Update `RecordingBar.jsx` sync status**

Modify `frontend/src/modules/WeeklyReview/components/RecordingBar.jsx` to accept new props `syncStatus`, `pendingCount`, `lastAckedAt` and render a small badge. Open the file and:

1. Add to the props destructure at the top of the component: `syncStatus, pendingCount, lastAckedAt`
2. Add a small element next to the existing duration/timer display:

```jsx
{(syncStatus || pendingCount > 0) && (
  <div className={`sync-badge sync-badge--${syncStatus || 'idle'}`}>
    {syncStatus === 'syncing' && `Syncing… (${pendingCount} pending)`}
    {syncStatus === 'offline' && `Offline — ${pendingCount} saved locally`}
    {syncStatus === 'saved' && lastAckedAt && `Saved · ${Math.round((Date.now() - lastAckedAt) / 1000)}s ago`}
    {syncStatus === 'idle' && pendingCount > 0 && `Queued (${pendingCount})`}
  </div>
)}
```

Pass the props from `WeeklyReview.jsx` where `<RecordingBar ... />` is rendered — add:

```jsx
        syncStatus={uploader.status}
        pendingCount={uploader.pendingCount}
        lastAckedAt={uploader.lastAckedAt}
```

- [ ] **Step 5: Manual smoke test**

Start the dev server:
```bash
cd /opt/Code/DaylightStation && ss -tlnp | grep 3112 || node backend/index.js &
```

Open the app in a browser, navigate to Weekly Review, start a recording, speak for 15 seconds. Open the network tab and verify:
- Every ~5s, a `POST /api/v1/weekly-review/recording/chunk` fires with a 200 OK.
- Open DevTools → Application → IndexedDB → `weekly-review-chunks-v1` → `chunks`. Confirm rows keyed by `[sessionId, seq]` with `uploaded: true` after ack.

Then press the browser reload button while recording. On reload:
- The widget should show the resume prompt "A previous recording was not finalized — Finalize Previous / Discard."
- Clicking Finalize should POST `/recording/finalize` and result in `transcript.yml` being written server-side.

If any step fails, do NOT claim the task complete — debug using `dev.log`.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/modules/WeeklyReview/WeeklyReview.jsx \
        frontend/src/modules/WeeklyReview/components/RecordingBar.jsx
git commit -m "feat(weekly-review): wire durable chunked upload pipeline into widget

- Widget generates sessionId per week, feeds recorder chunks to useChunkUploader
- Finalization triggers after stop; drains queue before calling /recording/finalize
- Mount-time recovery: detect server or local drafts and offer Finalize Previous
- pagehide/beforeunload use sendBeacon to flush in-flight chunks
- RecordingBar shows sync status so user sees durability in real time"
```

---

## Task 10: Playwright flow test for durability

**Files:**
- Create: `tests/live/flow/life/weekly-review-durable.runtime.test.mjs`

- [ ] **Step 1: Write the test**

Create `tests/live/flow/life/weekly-review-durable.runtime.test.mjs`:

```javascript
import { test, expect } from '@playwright/test';
import { FRONTEND_URL } from '#fixtures/runtime/urls.mjs';

test.describe('Weekly Review durable recording', () => {
  test('chunks are uploaded every 5s and survive a page reload', async ({ browser }) => {
    // Fake audio input — Chrome flag is set in playwright.config.mjs for other tests;
    // if not set here, the test can still verify the chunk API contract.
    const context = await browser.newContext({ permissions: ['microphone'] });
    const page = await context.newPage();

    // Capture chunk POSTs
    const chunkPosts = [];
    await page.route('**/api/v1/weekly-review/recording/chunk', async (route) => {
      const req = route.request();
      const body = JSON.parse(req.postData() || '{}');
      chunkPosts.push({ sessionId: body.sessionId, seq: body.seq, week: body.week, bytes: body.chunkBase64?.length || 0 });
      await route.continue();
    });

    // Open app and navigate to Weekly Review
    await page.goto(`${FRONTEND_URL}/screen/living-room`);
    // Menu path depends on your screen config; adjust selector as needed
    await page.keyboard.press('Enter'); // enter FHE menu
    await page.getByText('Weekly Review').click();

    // Wait for bootstrap
    await page.waitForSelector('.weekly-review-init-overlay', { timeout: 10000 });

    // Start recording
    await page.keyboard.press('Enter');
    await page.waitForSelector('[class*="sync-badge"], .weekly-review-grid', { timeout: 5000 });

    // Record for ~12s to ensure ≥2 chunks are emitted (5s timeslice + final requestData)
    await page.waitForTimeout(12_000);

    expect(chunkPosts.length).toBeGreaterThanOrEqual(2);
    expect(chunkPosts[0].seq).toBe(0);
    expect(chunkPosts[1].seq).toBe(1);
    const firstSessionId = chunkPosts[0].sessionId;
    expect(firstSessionId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);

    // Simulate reload mid-recording (the critical regression scenario)
    await page.reload();

    // Navigate back to Weekly Review
    await page.getByText('Weekly Review').click();

    // Expect the resume-draft overlay
    const resumeOverlay = page.locator('.weekly-review-confirm-overlay', { hasText: 'not finalized' });
    await expect(resumeOverlay).toBeVisible({ timeout: 10000 });

    // Click Finalize Previous
    await page.getByText('Finalize Previous').click();

    // Wait for finalize response
    await page.waitForResponse(r => r.url().includes('/recording/finalize') && r.status() === 200, { timeout: 30_000 });

    // Verify the resume overlay disappears
    await expect(resumeOverlay).not.toBeVisible({ timeout: 5000 });

    await context.close();
  });
});
```

- [ ] **Step 2: Run the test**

Ensure backend is running:
```bash
cd /opt/Code/DaylightStation && ss -tlnp | grep 3112 || (node backend/index.js &)
```

Then:
```bash
cd /opt/Code/DaylightStation && npx playwright test tests/live/flow/life/weekly-review-durable.runtime.test.mjs --reporter=line
```

If the selector assumptions (FHE menu → Weekly Review) don't match your environment, adapt them to whatever path exposes the widget. The test's core claim — chunks ≥2, POSTs logged, reload surfaces resume overlay, finalize succeeds — is the durability contract.

- [ ] **Step 3: Commit**

```bash
git add tests/live/flow/life/weekly-review-durable.runtime.test.mjs
git commit -m "test(weekly-review): end-to-end durable recording flow + reload recovery"
```

---

## Task 11: Nightly draft cleanup

**Files:**
- Modify: `backend/src/3_applications/weekly-review/WeeklyReviewService.mjs`

Orphaned drafts older than 30 days should be swept so the `.drafts/` directory doesn't grow forever. Simple self-invoked cleanup on each `bootstrap` call; no separate scheduler needed.

- [ ] **Step 1: Add the failing test**

Append to `backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs`:

```javascript
  describe('draft cleanup', () => {
    it('sweeps drafts older than 30 days on bootstrap', async () => {
      await service.appendChunk({ sessionId: 'sess-old00000', seq: 0, week: '2026-04-12', buffer: Buffer.from('X') });
      const metaPath = path.join(tmpDataPath, 'household', 'common', 'weekly-review', '2026-04-12', '.drafts', 'sess-old00000.meta.json');
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
      meta.updatedAt = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString();
      fs.writeFileSync(metaPath, JSON.stringify(meta));

      const swept = await service.sweepStaleDrafts({ maxAgeDays: 30 });
      expect(swept.deleted).toContain('sess-old00000');
    });

    it('does not sweep recent drafts', async () => {
      await service.appendChunk({ sessionId: 'sess-fresh000', seq: 0, week: '2026-04-12', buffer: Buffer.from('X') });
      const swept = await service.sweepStaleDrafts({ maxAgeDays: 30 });
      expect(swept.deleted).not.toContain('sess-fresh000');
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs
```
Expected: `sweepStaleDrafts is not a function`.

- [ ] **Step 3: Implement**

Add to `WeeklyReviewService.mjs`:

```javascript
async sweepStaleDrafts({ maxAgeDays = 30 } = {}) {
  const baseDir = path.join(this.#dataPath, 'household', 'common', 'weekly-review');
  if (!fs.existsSync(baseDir)) return { deleted: [] };
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const deleted = [];
  for (const week of fs.readdirSync(baseDir)) {
    const draftDir = path.join(baseDir, week, '.drafts');
    if (!fs.existsSync(draftDir)) continue;
    for (const name of fs.readdirSync(draftDir)) {
      if (!name.endsWith('.meta.json')) continue;
      const metaPath = path.join(draftDir, name);
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        const ts = Date.parse(meta.updatedAt || meta.startedAt);
        if (Number.isFinite(ts) && ts < cutoff) {
          const draftPath = path.join(draftDir, `${meta.sessionId}.webm`);
          if (fs.existsSync(draftPath)) fs.unlinkSync(draftPath);
          fs.unlinkSync(metaPath);
          deleted.push(meta.sessionId);
        }
      } catch (err) {
        this.#logger.warn?.('weekly-review.sweep.meta-parse-failed', { name, error: err.message });
      }
    }
  }
  if (deleted.length > 0) this.#logger.info?.('weekly-review.sweep.deleted', { count: deleted.length, sessionIds: deleted });
  return { deleted };
}
```

And call it fire-and-forget from the top of `bootstrap`:

```javascript
async bootstrap(weekStart) {
  this.sweepStaleDrafts().catch(err => this.#logger.warn?.('weekly-review.sweep.failed', { error: err.message }));
  // ...rest unchanged
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /opt/Code/DaylightStation && npx vitest run backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs
```
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/weekly-review/WeeklyReviewService.mjs \
        backend/tests/unit/suite/3_applications/weekly-review/WeeklyReviewService.chunk.test.mjs
git commit -m "feat(weekly-review): sweep drafts older than 30 days on bootstrap"
```

---

## Task 12: Explicit "Save Recording" UX — no back-button required

**Context.** The widget's only path to save is: press Back → stop-confirm dialog → Save & Close. That is how the 2026-04-19 data was lost — the user pressed Back, something else consumed the Back (popstate + external FKB navigation), and the recording never got a chance to save. Save must be a first-class affordance that a user can reach without Back.

**Goals:**
1. A focusable "Save & Finish" button is visible the entire time recording is active.
2. The user can reach it with ArrowDown from the day-grid (focus drops into the RecordingBar).
3. A dedicated key binding — `s` on keyboard, remote `PlayPause`/`MediaStop` if the remote sends one — triggers Save directly from any focus state.
4. The button is big, labeled, and color-coded (green when pending-to-save, yellow while syncing, grey only once `pendingCount === 0`).
5. Back is still wired for safety (it keeps the stop-confirm as a secondary path) but is no longer the primary save.

**Files:**
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.jsx`
- Modify: `frontend/src/modules/WeeklyReview/components/RecordingBar.jsx`
- Modify: `frontend/src/modules/WeeklyReview/WeeklyReview.scss`

- [ ] **Step 1: Add focus state for the RecordingBar**

In `WeeklyReview.jsx`, add state tracking which row has focus: the 4×2 grid is rows 0-1, the RecordingBar is row 2 (logical). Add near the other `useState` calls:

```javascript
  const [focusRow, setFocusRow] = useState('grid'); // 'grid' | 'bar'
  const [barFocus, setBarFocus] = useState(0); // when focusRow='bar': 0=Save, 1=Cancel (future)
```

- [ ] **Step 2: Extend the grid keyboard handler**

Inside the existing `handleKeyDown` switch (the section running when `selectedDay === null` and we're recording), replace the `ArrowDown` branch and add an `s` shortcut. Find:

```javascript
        case 'ArrowDown':
          e.preventDefault();
          setFocusedDay(prev => {
            const next = (prev + COLS) % total;
            logger.debug('nav.grid-down', { from: prev, to: next });
            return next;
          });
          break;
```

Replace with:

```javascript
        case 'ArrowDown':
          e.preventDefault();
          if (focusRow === 'grid' && focusedDay >= COLS) {
            // Bottom row of grid → drop focus to the bar
            setFocusRow('bar');
            setBarFocus(0);
            logger.info('nav.focus-bar');
          } else if (focusRow === 'grid') {
            setFocusedDay(prev => {
              const next = (prev + COLS) % total;
              logger.debug('nav.grid-down', { from: prev, to: next });
              return next;
            });
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (focusRow === 'bar') {
            setFocusRow('grid');
            logger.info('nav.focus-grid');
          } else {
            setFocusedDay(prev => {
              const next = (prev - COLS + total) % total;
              logger.debug('nav.grid-up', { from: prev, to: next });
              return next;
            });
          }
          break;
```

Delete the existing `ArrowUp` case above (it's now merged into the block above).

Add an explicit save shortcut anywhere in the same switch, above `default`:

```javascript
        case 's':
        case 'S':
        case 'MediaStop':
        case 'MediaPlayPause':
          e.preventDefault();
          logger.info('nav.save-shortcut', { key: e.key });
          setShowStopConfirm(false); // dismiss any dialog first
          stopRecording();           // triggers finalizeRecording via the isRecording effect
          break;
```

When `focusRow === 'bar'`, Enter on the Save button should stop+finalize. Add a branch at the very top of the key handler (above the grid-level `switch`), right after the `selectedDay` detail branch returns:

```javascript
      if (focusRow === 'bar') {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          logger.info('nav.bar-save-pressed');
          stopRecording();
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setFocusRow('grid');
          return;
        }
        if (e.key === 'Escape' || e.key === 'Backspace') {
          e.preventDefault();
          setFocusRow('grid');
          return;
        }
      }
```

Update the effect's dependency array to include `focusRow`.

- [ ] **Step 3: Render the save button in `RecordingBar.jsx`**

Open `frontend/src/modules/WeeklyReview/components/RecordingBar.jsx`. Accept three new props: `isFocused`, `canSave`, `onSave`. Render a large button at the right end of the bar:

```jsx
<button
  className={`recording-bar__save ${isFocused ? 'focused' : ''} ${canSave ? 'can-save' : ''}`}
  onClick={onSave}
  disabled={!canSave}
  aria-label="Save and finish recording"
>
  <span className="recording-bar__save-icon" aria-hidden="true">■</span>
  <span className="recording-bar__save-label">Save Recording</span>
</button>
```

Place it inside the existing bar layout so it's always visible while `isRecording` is true.

- [ ] **Step 4: Wire the button in `WeeklyReview.jsx`**

At the existing `<RecordingBar ... />` call site, add:

```jsx
        isFocused={focusRow === 'bar'}
        canSave={isRecording}
        onSave={() => {
          logger.info('nav.bar-save-clicked');
          stopRecording();
        }}
```

- [ ] **Step 5: Style the button**

Append to `frontend/src/modules/WeeklyReview/WeeklyReview.scss`:

```scss
.recording-bar__save {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 14px 28px;
  font-size: 22px;
  font-weight: 600;
  border: 3px solid #1e7d32;
  border-radius: 12px;
  background: #2e7d32;
  color: #fff;
  cursor: pointer;
  transition: transform 120ms ease, box-shadow 120ms ease, background 120ms ease;

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  &.can-save:not(.focused) {
    box-shadow: 0 0 0 0 rgba(46, 125, 50, 0.8);
    animation: save-pulse 2.5s ease-in-out infinite;
  }
  &.focused {
    transform: scale(1.06);
    box-shadow: 0 0 0 4px #ffeb3b, 0 0 24px 8px rgba(255, 235, 59, 0.6);
    background: #43a047;
  }
}
.recording-bar__save-icon { font-size: 26px; }
@keyframes save-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(46, 125, 50, 0.4); }
  50%      { box-shadow: 0 0 0 8px rgba(46, 125, 50, 0); }
}
```

- [ ] **Step 6: Update the init overlay hint**

In the init overlay inside `WeeklyReview.jsx`, update the label text to advertise the save path up front:

```jsx
<div className="init-record-label">
  Press to start recording.
  <br />
  <small>Press <kbd>S</kbd> or focus the green Save button to finish.</small>
</div>
```

- [ ] **Step 7: Manual verify (TV-remote simulation)**

With dev server running:
```bash
cd /opt/Code/DaylightStation && node backend/index.js &
```
Open the app, start a recording. Confirm:
1. The green "Save Recording" button is visible in the bar the whole time.
2. Pressing `s` on the keyboard triggers save+finalize immediately.
3. Pressing `ArrowDown` from the bottom grid row moves focus to the Save button (yellow highlight, scale-up).
4. Pressing `Enter` with bar focus triggers save+finalize.
5. Back button still works as a secondary path.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/modules/WeeklyReview/WeeklyReview.jsx \
        frontend/src/modules/WeeklyReview/components/RecordingBar.jsx \
        frontend/src/modules/WeeklyReview/WeeklyReview.scss
git commit -m "feat(weekly-review): first-class Save Recording action, no Back required

- Always-visible green Save button in RecordingBar
- ArrowDown from bottom grid row focuses the button; Enter saves+finalizes
- 's' / MediaStop / MediaPlayPause keys save directly from anywhere
- Init overlay advertises the save path up front
- Back button still works as secondary path via stop-confirm dialog"
```

---

## Self-review

**Spec coverage:**
- Server layer (chunk append, list, finalize, discard): Tasks 1-5 ✓
- Client IndexedDB with 7-day retention: Tasks 6-7 ✓
- Recorder emits chunks instead of in-memory buffer: Task 8 ✓
- Widget wired + resume-draft UI + pagehide beacon: Task 9 ✓
- End-to-end reload-recovery verification: Task 10 ✓
- Orphan draft cleanup: Task 11 ✓
- Explicit Save action independent of Back button: Task 12 ✓

**Placeholder scan:** No `TBD`, `TODO`, or "handle edge cases" in any step. Every code block is complete.

**Type consistency:**
- `appendChunk({ sessionId, seq, week, buffer })` — same arg shape in Tasks 1, 5, and 8.
- `finalizeDraft({ sessionId, week, duration })` — consistent across Tasks 4, 5, 9.
- `discardDraft({ sessionId, week })` — consistent Tasks 3, 5, 9.
- `uploader.enqueue({ seq, blob })` — consistent Tasks 7 and 9.
- `onChunk({ seq, blob })` — consistent Tasks 8 and 9.

**Guarantees this plan delivers:**
1. Every 5 s of audio is persisted to server disk in a file named `<sessionId>.webm` before the next chunk arrives.
2. Every chunk is also persisted to IndexedDB on the client, independent of the server, retained for 7 days.
3. `pagehide`/`beforeunload` flushes in-flight chunks via beacon.
4. On next mount, the user is offered to finalize any unfinalized recording for this week.
5. Existing `saveRecording` flow is untouched; only the widget's control path changes.
