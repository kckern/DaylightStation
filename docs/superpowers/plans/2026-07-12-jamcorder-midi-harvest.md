# JamCorder MIDI Harvest — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A daily harvester that enumerates, downloads, renames, and archives MIDI recordings from the JamCorder device into `household/history/piano/jamcorder/`.

**Architecture:** Layer-clean, integrating the existing harvester framework: a pure `2_domains/jamcorder` value object parses each `.mid`'s embedded `jmxStoneHdr` timestamp; a `3_applications/jamcorder` use case (with two ports) orchestrates list→dedup→download→save; `1_adapters/jamcorder` adapters do the device HTTP and the filesystem archive; a thin `IHarvester` adapter plugs into the scheduler.

**Tech Stack:** Node ESM (`.mjs`), vitest, `#`-subpath imports, injected `HttpClient` + `FileIO` + `ConfigService`. No new dependencies.

## Global Constraints

- **Layer rules** (`docs/reference/core/layers-of-abstraction/`): `2_domains/` is pure — no I/O, no `fs`, no vendor SDKs, no reading the system clock (`Date.now()`/argless `new Date()`); `new Date(explicitEpochMs)` for formatting an explicit timestamp is permitted (deterministic). `3_applications/` orchestrates via injected ports — never imports `1_adapters/`, never uses `fs`/`path` for data ops, ports live in `3_applications/jamcorder/ports/` (Decision D3). `1_adapters/` do I/O and `extends` their app-layer port (Decision D7). `5_composition/bootstrap.mjs` is the only place adapters are constructed.
- **Import aliases:** `#domains/*` → `backend/src/2_domains/*`, `#apps/*` (alias `#applications/*`) → `backend/src/3_applications/*`, `#adapters/*` → `backend/src/1_adapters/*`, `#system/*` → `backend/src/0_system/*`.
- **Archive layout (exact):** `household/history/piano/jamcorder/YYYY/YYYY-MM/YYYY-MM-DD HH.MM.SS.mid`, household-generic (NOT user-scoped). Local time from each file's embedded `unixtime` + `localOffset` (minutes).
- **Dedup:** by the device list path (`ref.listPath`), checked before download, via a YAML index at `history/piano/jamcorder/_index.yml`.
- **Cadence:** daily, `system/config/jobs.yml` entry `{ id: jamcorder, schedule: '0 4 * * *' }`; routing is by `id` == harvester `serviceId`.
- **Device (config, not code):** host in `household/config/jamcorder.yml` `{ host: 10.0.0.244 }`. List: `POST http://<host>/api/files/list/detailed` `{filepath}` → `{dir, files:[{filename,isDirectory,sizeBytes,modifiedLocalTime}]}` (gzip; Node fetch auto-decompresses). Download: `GET http://<host>/sdcard/<listPath>` → MIDI bytes.
- **Test fixture (already staged):** `tests/fixtures/jamcorder/Jmx-A00005-Jan-02-2026.mid` — a real device recording; header `unixtime 1767406660`, `localOffset -480` → `2026-01-02 18.17.40`.
- Test runner **vitest**: `npx vitest run <path>`. Tests under `tests/isolated/{domain,application,adapter}/jamcorder/…`. Commit after each task. Branch `feat/jamcorder-harvest`.

---

## File Structure

**Create:**
- `backend/src/2_domains/jamcorder/JamCorderStone.mjs` — value object: parse embedded header + derive archive path.
- `backend/src/3_applications/jamcorder/ports/IJamCorderSource.mjs` — port: list + download.
- `backend/src/3_applications/jamcorder/ports/IJamCorderArchive.mjs` — port: has + save + markProcessed.
- `backend/src/3_applications/jamcorder/HarvestJamCorderRecordings.mjs` — use case.
- `backend/src/1_adapters/jamcorder/HttpJamCorderSource.mjs` — device HTTP (extends IJamCorderSource).
- `backend/src/1_adapters/jamcorder/FsJamCorderArchive.mjs` — filesystem archive + index (extends IJamCorderArchive).
- `backend/src/1_adapters/harvester/other/JamCorderHarvester.mjs` — thin IHarvester glue.

**Modify:**
- `backend/src/5_composition/bootstrap.mjs` — construct + `registerHarvester('jamcorder', …)`.
- `data/system/config/jobs.yml` (live data volume) — add the `jamcorder` job.
- `data/household/config/jamcorder.yml` (live data volume) — new config `{ host: 10.0.0.244 }`.

**Tests (create):** one under `tests/isolated/{domain,application,adapter}/jamcorder/` per unit + the staged fixture.

---

## Task 1: `JamCorderStone` domain value object

**Files:**
- Create: `backend/src/2_domains/jamcorder/JamCorderStone.mjs`
- Test: `tests/isolated/domain/jamcorder/JamCorderStone.test.mjs`
- Add (already staged in the working tree): `tests/fixtures/jamcorder/Jmx-A00005-Jan-02-2026.mid`

**Interfaces:**
- Produces: `class JamCorderStone` with `static fromMidiBuffer(buffer) → JamCorderStone` (throws `ValidationError` if the `jmxStoneHdr` is absent/unparseable/missing time); readonly getters `unixtime`, `localOffsetMin`, `jamcorderName`, `performerName`, `assetUuid`, `assetIdx`; `archiveRelPath() → string` (e.g. `"2026/2026-01/2026-01-02 18.17.40.mid"`).

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/domain/jamcorder/JamCorderStone.test.mjs
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { JamCorderStone } from '#domains/jamcorder/JamCorderStone.mjs';

const FIXTURE = readFileSync(new URL('../../../fixtures/jamcorder/Jmx-A00005-Jan-02-2026.mid', import.meta.url));

describe('JamCorderStone', () => {
  it('parses the embedded jmxStoneHdr timestamp + metadata', () => {
    const s = JamCorderStone.fromMidiBuffer(FIXTURE);
    expect(s.unixtime).toBe(1767406660);
    expect(s.localOffsetMin).toBe(-480);
    expect(s.jamcorderName).toBe('Living Room Baby Grand');
    expect(s.performerName).toBe('Kern Family');
    expect(s.assetUuid).toBe('aa7eef01-73e8-f1cf-a823-3072c39d53cf');
    expect(s.assetIdx).toBe(5);
  });

  it('derives the local-time archive rel path', () => {
    const s = JamCorderStone.fromMidiBuffer(FIXTURE);
    expect(s.archiveRelPath()).toBe('2026/2026-01/2026-01-02 18.17.40.mid');
  });

  it('throws when the buffer has no jmxStoneHdr', () => {
    expect(() => JamCorderStone.fromMidiBuffer(Buffer.from('MThd not a jamcorder file'))).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/domain/jamcorder/JamCorderStone.test.mjs`
Expected: FAIL — cannot resolve `#domains/jamcorder/JamCorderStone.mjs`.

- [ ] **Step 3: Write minimal implementation**

```javascript
// backend/src/2_domains/jamcorder/JamCorderStone.mjs
/**
 * JamCorderStone — value object parsed from a JamCorder .mid recording.
 *
 * Each recording embeds a sequencer-specific MIDI meta event (0xFF 0x7F) whose
 * payload is a JSON header `jmxStoneHdr{…}` carrying an SNTP-synced timestamp
 * (`time.unixtime`, `time.localOffset` minutes) plus device/performer metadata.
 *
 * Layer: DOMAIN value object (2_domains/jamcorder). Pure — parses a provided
 * buffer, no I/O, no system clock.
 *
 * @module domains/jamcorder/JamCorderStone
 */
import { ValidationError } from '#domains/core/errors/ValidationError.mjs';

const pad2 = (n) => String(n).padStart(2, '0');

export class JamCorderStone {
  #unixtime; #localOffsetMin; #jamcorderName; #performerName; #assetUuid; #assetIdx;

  constructor({ unixtime, localOffsetMin, jamcorderName, performerName, assetUuid, assetIdx }) {
    this.#unixtime = unixtime;
    this.#localOffsetMin = localOffsetMin;
    this.#jamcorderName = jamcorderName;
    this.#performerName = performerName;
    this.#assetUuid = assetUuid;
    this.#assetIdx = assetIdx;
    Object.freeze(this);
  }

  /**
   * @param {Buffer} buffer - raw .mid bytes
   * @returns {JamCorderStone}
   * @throws {ValidationError} if the jmxStoneHdr is missing or invalid
   */
  static fromMidiBuffer(buffer) {
    const text = Buffer.isBuffer(buffer) ? buffer.toString('latin1') : String(buffer ?? '');
    const marker = text.indexOf('jmxStoneHdr');
    if (marker === -1) {
      throw new ValidationError('jmxStoneHdr not found in MIDI buffer', { code: 'JAMCORDER_NO_HEADER' });
    }
    const braceStart = text.indexOf('{', marker);
    if (braceStart === -1) {
      throw new ValidationError('jmxStoneHdr JSON start not found', { code: 'JAMCORDER_NO_HEADER' });
    }
    let depth = 0, end = -1;
    for (let i = braceStart; i < text.length; i++) {
      const c = text[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) {
      throw new ValidationError('jmxStoneHdr JSON not terminated', { code: 'JAMCORDER_BAD_HEADER' });
    }
    let hdr;
    try {
      hdr = JSON.parse(text.slice(braceStart, end + 1));
    } catch (err) {
      throw new ValidationError(`jmxStoneHdr JSON parse failed: ${err.message}`, { code: 'JAMCORDER_BAD_HEADER' });
    }
    const unixtime = hdr?.time?.unixtime;
    const localOffsetMin = hdr?.time?.localOffset;
    if (typeof unixtime !== 'number' || typeof localOffsetMin !== 'number') {
      throw new ValidationError('jmxStoneHdr missing time.unixtime/localOffset', { code: 'JAMCORDER_BAD_HEADER' });
    }
    return new JamCorderStone({
      unixtime,
      localOffsetMin,
      jamcorderName: hdr?.identities?.jamcorderName ?? null,
      performerName: hdr?.identities?.performerName ?? null,
      assetUuid: hdr?.asset?.assetUuid ?? null,
      assetIdx: hdr?.asset?.assetIdx ?? null,
    });
  }

  get unixtime() { return this.#unixtime; }
  get localOffsetMin() { return this.#localOffsetMin; }
  get jamcorderName() { return this.#jamcorderName; }
  get performerName() { return this.#performerName; }
  get assetUuid() { return this.#assetUuid; }
  get assetIdx() { return this.#assetIdx; }

  /**
   * Archive-relative path in local recording time:
   *   "YYYY/YYYY-MM/YYYY-MM-DD HH.MM.SS.mid"
   * Deterministic: shifts the explicit epoch by localOffset and reads UTC parts.
   * @returns {string}
   */
  archiveRelPath() {
    const ms = (this.#unixtime + this.#localOffsetMin * 60) * 1000;
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const mo = pad2(d.getUTCMonth() + 1);
    const stamp = `${y}-${mo}-${pad2(d.getUTCDate())} ${pad2(d.getUTCHours())}.${pad2(d.getUTCMinutes())}.${pad2(d.getUTCSeconds())}`;
    return `${y}/${y}-${mo}/${stamp}.mid`;
  }
}

export default JamCorderStone;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/domain/jamcorder/JamCorderStone.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/2_domains/jamcorder/JamCorderStone.mjs tests/isolated/domain/jamcorder/JamCorderStone.test.mjs tests/fixtures/jamcorder/Jmx-A00005-Jan-02-2026.mid
git commit -m "feat(jamcorder): add JamCorderStone value object (embedded header parse + archive path)"
```

---

## Task 2: Ports + `HarvestJamCorderRecordings` use case

**Files:**
- Create: `backend/src/3_applications/jamcorder/ports/IJamCorderSource.mjs`
- Create: `backend/src/3_applications/jamcorder/ports/IJamCorderArchive.mjs`
- Create: `backend/src/3_applications/jamcorder/HarvestJamCorderRecordings.mjs`
- Test: `tests/isolated/application/jamcorder/HarvestJamCorderRecordings.test.mjs`

**Interfaces:**
- Consumes: `JamCorderStone` (Task 1).
- Produces:
  - `IJamCorderSource`: `async listRecordings() → Array<{listPath:string, downloadPath:string}>`; `async download(ref) → Buffer`.
  - `IJamCorderArchive`: `has(ref) → boolean`; `async save(relPath:string, buffer:Buffer) → void`; `async markProcessed(ref, relPath:string) → void`.
  - `class HarvestJamCorderRecordings` `constructor({ source, archive, logger })`; `async execute() → { count:number, status:'success'|'error', reason?:string }`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/application/jamcorder/HarvestJamCorderRecordings.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { HarvestJamCorderRecordings } from '#apps/jamcorder/HarvestJamCorderRecordings.mjs';

const FIXTURE = readFileSync(new URL('../../../fixtures/jamcorder/Jmx-A00005-Jan-02-2026.mid', import.meta.url));
const refA = { listPath: '/JAMC/2026/s1/A.mid', downloadPath: '/sdcard/JAMC/2026/s1/A.mid' };
const refB = { listPath: '/JAMC/2026/s1/B.mid', downloadPath: '/sdcard/JAMC/2026/s1/B.mid' };

function fakeArchive(seen = new Set()) {
  const saved = [];
  return {
    saved,
    has: (ref) => seen.has(ref.listPath),
    save: vi.fn(async (relPath, buf) => { saved.push({ relPath, len: buf.length }); }),
    markProcessed: vi.fn(async (ref) => { seen.add(ref.listPath); }),
  };
}
const silent = { info() {}, warn() {}, error() {}, debug() {} };

describe('HarvestJamCorderRecordings', () => {
  it('downloads only new recordings and saves them at the derived path', async () => {
    const source = { listRecordings: async () => [refA, refB], download: async () => FIXTURE };
    const archive = fakeArchive(new Set([refB.listPath])); // B already processed
    const res = await new HarvestJamCorderRecordings({ source, archive, logger: silent }).execute();
    expect(res).toEqual({ count: 1, status: 'success' });
    expect(archive.save).toHaveBeenCalledTimes(1);
    expect(archive.saved[0].relPath).toBe('2026/2026-01/2026-01-02 18.17.40.mid');
    expect(archive.markProcessed).toHaveBeenCalledWith(refA, '2026/2026-01/2026-01-02 18.17.40.mid');
  });

  it('returns status error and writes nothing when listing fails', async () => {
    const source = { listRecordings: async () => { throw new Error('ECONNREFUSED'); }, download: async () => FIXTURE };
    const archive = fakeArchive();
    const res = await new HarvestJamCorderRecordings({ source, archive, logger: silent }).execute();
    expect(res.status).toBe('error');
    expect(res.count).toBe(0);
    expect(archive.save).not.toHaveBeenCalled();
  });

  it('skips an unparseable file without failing the run', async () => {
    const source = {
      listRecordings: async () => [refA, refB],
      download: async (ref) => (ref === refA ? Buffer.from('garbage') : FIXTURE),
    };
    const archive = fakeArchive();
    const res = await new HarvestJamCorderRecordings({ source, archive, logger: silent }).execute();
    expect(res).toEqual({ count: 1, status: 'success' }); // only B saved
    expect(archive.save).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/application/jamcorder/HarvestJamCorderRecordings.test.mjs`
Expected: FAIL — cannot resolve `#apps/jamcorder/HarvestJamCorderRecordings.mjs`.

- [ ] **Step 3: Write the ports + use case**

```javascript
// backend/src/3_applications/jamcorder/ports/IJamCorderSource.mjs
/**
 * Port: what the harvest use case needs from the JamCorder device.
 * @module applications/jamcorder/ports/IJamCorderSource
 */
export class IJamCorderSource {
  /** @returns {Promise<Array<{listPath:string, downloadPath:string}>>} */
  async listRecordings() { throw new Error('IJamCorderSource.listRecordings must be implemented'); }
  /** @param {{listPath:string, downloadPath:string}} ref @returns {Promise<Buffer>} */
  async download(_ref) { throw new Error('IJamCorderSource.download must be implemented'); }
}
export default IJamCorderSource;
```

```javascript
// backend/src/3_applications/jamcorder/ports/IJamCorderArchive.mjs
/**
 * Port: how the harvest use case persists recordings + tracks what's been saved.
 * @module applications/jamcorder/ports/IJamCorderArchive
 */
export class IJamCorderArchive {
  /** @param {{listPath:string}} ref @returns {boolean} */
  has(_ref) { throw new Error('IJamCorderArchive.has must be implemented'); }
  /** @param {string} relPath @param {Buffer} buffer @returns {Promise<void>} */
  async save(_relPath, _buffer) { throw new Error('IJamCorderArchive.save must be implemented'); }
  /** @param {{listPath:string}} ref @param {string} relPath @returns {Promise<void>} */
  async markProcessed(_ref, _relPath) { throw new Error('IJamCorderArchive.markProcessed must be implemented'); }
}
export default IJamCorderArchive;
```

```javascript
// backend/src/3_applications/jamcorder/HarvestJamCorderRecordings.mjs
/**
 * Use case: enumerate JamCorder recordings, download the new ones, parse each
 * one's embedded timestamp, and archive it. Orchestration only — all I/O is via
 * the injected source/archive ports.
 *
 * Layer: APPLICATION (3_applications/jamcorder).
 * @module applications/jamcorder/HarvestJamCorderRecordings
 */
import { JamCorderStone } from '#domains/jamcorder/JamCorderStone.mjs';

export class HarvestJamCorderRecordings {
  #source; #archive; #logger;

  constructor({ source, archive, logger = console }) {
    if (!source) throw new Error('HarvestJamCorderRecordings requires source');
    if (!archive) throw new Error('HarvestJamCorderRecordings requires archive');
    this.#source = source;
    this.#archive = archive;
    this.#logger = logger;
  }

  /** @returns {Promise<{count:number, status:'success'|'error', reason?:string}>} */
  async execute() {
    let refs;
    try {
      refs = await this.#source.listRecordings();
    } catch (err) {
      this.#logger.warn?.('jamcorder.list.failed', { error: err.message });
      return { count: 0, status: 'error', reason: err.message };
    }

    const fresh = refs.filter((ref) => !this.#archive.has(ref));
    let saved = 0;
    for (const ref of fresh) {
      try {
        const buffer = await this.#source.download(ref);
        const relPath = JamCorderStone.fromMidiBuffer(buffer).archiveRelPath();
        await this.#archive.save(relPath, buffer);
        await this.#archive.markProcessed(ref, relPath);
        saved += 1;
        this.#logger.info?.('jamcorder.saved', { listPath: ref.listPath, relPath });
      } catch (err) {
        this.#logger.warn?.('jamcorder.file.failed', { listPath: ref.listPath, error: err.message });
      }
    }
    this.#logger.info?.('jamcorder.harvest.done', { found: refs.length, fresh: fresh.length, saved });
    return { count: saved, status: 'success' };
  }
}

export default HarvestJamCorderRecordings;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/application/jamcorder/HarvestJamCorderRecordings.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/3_applications/jamcorder
git add tests/isolated/application/jamcorder/HarvestJamCorderRecordings.test.mjs
git commit -m "feat(jamcorder): add source/archive ports + HarvestJamCorderRecordings use case"
```

---

## Task 3: `HttpJamCorderSource` adapter

**Files:**
- Create: `backend/src/1_adapters/jamcorder/HttpJamCorderSource.mjs`
- Test: `tests/isolated/adapter/jamcorder/HttpJamCorderSource.test.mjs`

**Context:** Recursively lists `/JAMC` via the device POST API and downloads a file's bytes. Uses the injected `HttpClient`: `requestRaw('POST', url, { body, responseType:'json' })` → `{ ok, status, data }` (non-throwing on non-2xx; throws on network error) and `downloadBuffer(url) → Buffer`. `listPath` uses the `/JAMC/…` space; `downloadPath` prefixes `/sdcard`. Recursion is depth-capped; only `.mid` files are returned.

**Interfaces:**
- Consumes: `IJamCorderSource` (Task 2).
- Produces: `class HttpJamCorderSource extends IJamCorderSource` `constructor({ httpClient, host, logger })`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/adapter/jamcorder/HttpJamCorderSource.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { HttpJamCorderSource } from '#adapters/jamcorder/HttpJamCorderSource.mjs';

// Fake device tree: /JAMC → 2026/ → s1/ → A.mid, B.mid (+ a non-mid file ignored)
const TREE = {
  '/JAMC': [{ filename: '2026/', isDirectory: true }, { filename: 'other/', isDirectory: true }],
  '/JAMC/2026': [{ filename: 's1/', isDirectory: true }],
  '/JAMC/2026/s1': [
    { filename: 'A.mid', isDirectory: false },
    { filename: 'B.mid', isDirectory: false },
    { filename: 'notes.txt', isDirectory: false },
  ],
  '/JAMC/other': [],
};

function fakeHttp() {
  return {
    requestRaw: vi.fn(async (_method, _url, { body }) => {
      const files = TREE[body.filepath] ?? [];
      return { ok: true, status: 200, data: { dir: body.filepath + '/', files } };
    }),
    downloadBuffer: vi.fn(async (url) => Buffer.from('MID:' + url)),
  };
}
const silent = { info() {}, warn() {}, error() {}, debug() {} };

describe('HttpJamCorderSource', () => {
  it('recursively enumerates .mid files with list + download paths', async () => {
    const src = new HttpJamCorderSource({ httpClient: fakeHttp(), host: '10.0.0.244', logger: silent });
    const refs = await src.listRecordings();
    expect(refs).toEqual([
      { listPath: '/JAMC/2026/s1/A.mid', downloadPath: '/sdcard/JAMC/2026/s1/A.mid' },
      { listPath: '/JAMC/2026/s1/B.mid', downloadPath: '/sdcard/JAMC/2026/s1/B.mid' },
    ]);
  });

  it('downloads via the /sdcard URL and returns the buffer', async () => {
    const http = fakeHttp();
    const src = new HttpJamCorderSource({ httpClient: http, host: '10.0.0.244', logger: silent });
    const buf = await src.download({ listPath: '/JAMC/2026/s1/A.mid', downloadPath: '/sdcard/JAMC/2026/s1/A.mid' });
    expect(http.downloadBuffer).toHaveBeenCalledWith('http://10.0.0.244/sdcard/JAMC/2026/s1/A.mid');
    expect(buf.toString()).toBe('MID:http://10.0.0.244/sdcard/JAMC/2026/s1/A.mid');
  });

  it('throws when a directory listing is not ok (surfaced to the use case)', async () => {
    const http = fakeHttp();
    http.requestRaw = vi.fn(async () => ({ ok: false, status: 500, data: null }));
    const src = new HttpJamCorderSource({ httpClient: http, host: '10.0.0.244', logger: silent });
    await expect(src.listRecordings()).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/jamcorder/HttpJamCorderSource.test.mjs`
Expected: FAIL — cannot resolve `#adapters/jamcorder/HttpJamCorderSource.mjs`.

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/1_adapters/jamcorder/HttpJamCorderSource.mjs
/**
 * HttpJamCorderSource — talks to the JamCorder device over HTTP.
 *   list:     POST http://<host>/api/files/list/detailed  {filepath}
 *   download: GET  http://<host>/sdcard/<listPath>
 * Layer: ADAPTER (1_adapters/jamcorder). Injected HttpClient.
 * @module adapters/jamcorder/HttpJamCorderSource
 */
import { IJamCorderSource } from '#apps/jamcorder/ports/IJamCorderSource.mjs';

const ROOT = '/JAMC';
const MAX_DEPTH = 5; // JAMC → year → session → file is 3; cap generously

export class HttpJamCorderSource extends IJamCorderSource {
  #httpClient; #host; #logger;

  constructor({ httpClient, host, logger = console }) {
    super();
    if (!httpClient) throw new Error('HttpJamCorderSource requires httpClient');
    if (!host) throw new Error('HttpJamCorderSource requires host');
    this.#httpClient = httpClient;
    this.#host = host;
    this.#logger = logger;
  }

  async listRecordings() {
    const out = [];
    await this.#walk(ROOT, 0, out);
    return out;
  }

  async download(ref) {
    return this.#httpClient.downloadBuffer(`http://${this.#host}${ref.downloadPath}`);
  }

  async #walk(dirPath, depth, out) {
    if (depth > MAX_DEPTH) return;
    const files = await this.#listDir(dirPath);
    for (const entry of files) {
      const name = String(entry.filename || '').replace(/\/+$/, '');
      if (!name) continue;
      const childListPath = `${dirPath}/${name}`;
      if (entry.isDirectory) {
        await this.#walk(childListPath, depth + 1, out);
      } else if (name.toLowerCase().endsWith('.mid')) {
        out.push({ listPath: childListPath, downloadPath: `/sdcard${childListPath}` });
      }
    }
  }

  async #listDir(filepath) {
    const resp = await this.#httpClient.requestRaw(
      'POST',
      `http://${this.#host}/api/files/list/detailed`,
      { body: { filepath }, responseType: 'json' },
    );
    if (!resp || !resp.ok) {
      throw new Error(`JamCorder list failed for ${filepath}: HTTP ${resp?.status}`);
    }
    return Array.isArray(resp.data?.files) ? resp.data.files : [];
  }
}

export default HttpJamCorderSource;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/adapter/jamcorder/HttpJamCorderSource.test.mjs`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/jamcorder/HttpJamCorderSource.mjs tests/isolated/adapter/jamcorder/HttpJamCorderSource.test.mjs
git commit -m "feat(jamcorder): add HttpJamCorderSource (recursive list + download)"
```

---

## Task 4: `FsJamCorderArchive` adapter

**Files:**
- Create: `backend/src/1_adapters/jamcorder/FsJamCorderArchive.mjs`
- Test: `tests/isolated/adapter/jamcorder/FsJamCorderArchive.test.mjs`

**Context:** Writes `.mid` bytes under `history/piano/jamcorder/<relPath>` via `FileIO.writeBinary` (which ensures parent dirs), and maintains the dedup index at `history/piano/jamcorder/_index.yml` via `FileIO.loadYamlSafe`/`saveYaml` (which append `.yml` to a base path). The base dir comes from the injected `configService.getHouseholdPath('history/piano/jamcorder')`. The index (`listPath → relPath`) is loaded synchronously at construction. `save` is idempotent (skips write if the target already exists).

**Interfaces:**
- Consumes: `IJamCorderArchive` (Task 2), `FileIO` (`#system/utils/FileIO.mjs`).
- Produces: `class FsJamCorderArchive extends IJamCorderArchive` `constructor({ configService, logger })`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/adapter/jamcorder/FsJamCorderArchive.test.mjs
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FsJamCorderArchive } from '#adapters/jamcorder/FsJamCorderArchive.mjs';

let dir;
const cfg = () => ({ getHouseholdPath: (rel) => path.join(dir, rel) });
const silent = { info() {}, warn() {}, error() {}, debug() {} };
const ref = { listPath: '/JAMC/2026/s1/A.mid' };
const rel = '2026/2026-01/2026-01-02 18.17.40.mid';

beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'jamc-')); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe('FsJamCorderArchive', () => {
  it('saves the .mid at the nested rel path and records it in the index', async () => {
    const a = new FsJamCorderArchive({ configService: cfg(), logger: silent });
    expect(a.has(ref)).toBe(false);
    await a.save(rel, Buffer.from('MThd-bytes'));
    await a.markProcessed(ref, rel);
    const full = path.join(dir, 'history/piano/jamcorder', rel);
    expect(existsSync(full)).toBe(true);
    expect(readFileSync(full).toString()).toBe('MThd-bytes');
    expect(a.has(ref)).toBe(true);
  });

  it('a fresh instance sees the persisted index (dedup across runs)', async () => {
    const a1 = new FsJamCorderArchive({ configService: cfg(), logger: silent });
    await a1.save(rel, Buffer.from('x'));
    await a1.markProcessed(ref, rel);
    const a2 = new FsJamCorderArchive({ configService: cfg(), logger: silent });
    expect(a2.has(ref)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/jamcorder/FsJamCorderArchive.test.mjs`
Expected: FAIL — cannot resolve `#adapters/jamcorder/FsJamCorderArchive.mjs`.

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/1_adapters/jamcorder/FsJamCorderArchive.mjs
/**
 * FsJamCorderArchive — persists JamCorder .mid recordings under
 * household/history/piano/jamcorder/<relPath> and maintains a dedup index
 * (device listPath → archive relPath) at .../piano/jamcorder/_index.yml.
 * Layer: ADAPTER (1_adapters/jamcorder). All FS via FileIO.
 * @module adapters/jamcorder/FsJamCorderArchive
 */
import path from 'node:path';
import { IJamCorderArchive } from '#apps/jamcorder/ports/IJamCorderArchive.mjs';
import { writeBinary, fileExists, loadYamlSafe, saveYaml } from '#system/utils/FileIO.mjs';

const REL_ROOT = 'history/piano/jamcorder';

export class FsJamCorderArchive extends IJamCorderArchive {
  #configService; #logger; #index;

  constructor({ configService, logger = console }) {
    super();
    if (!configService) throw new Error('FsJamCorderArchive requires configService');
    this.#configService = configService;
    this.#logger = logger;
    const loaded = loadYamlSafe(this.#indexBase());
    this.#index = (loaded && typeof loaded === 'object' && !Array.isArray(loaded)) ? loaded : {};
  }

  has(ref) {
    return Object.prototype.hasOwnProperty.call(this.#index, ref.listPath);
  }

  async save(relPath, buffer) {
    const full = path.join(this.#baseDir(), relPath);
    if (fileExists(full)) return; // idempotent
    writeBinary(full, buffer);
  }

  async markProcessed(ref, relPath) {
    this.#index[ref.listPath] = relPath;
    saveYaml(this.#indexBase(), this.#index);
  }

  #baseDir() {
    return this.#configService.getHouseholdPath(REL_ROOT);
  }

  #indexBase() {
    // saveYaml/loadYamlSafe append `.yml` to this base path
    return path.join(this.#baseDir(), '_index');
  }
}

export default FsJamCorderArchive;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/adapter/jamcorder/FsJamCorderArchive.test.mjs`
Expected: PASS (2 tests). If `loadYamlSafe`/`saveYaml` do NOT append `.yml` in this codebase, switch `#indexBase()` to return the full `_index.yml` path and use `saveYamlToPath` — but the established convention (YamlSessionDatastore et al.) is base-path + auto `.yml`; verify by the passing round-trip test.

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/jamcorder/FsJamCorderArchive.mjs tests/isolated/adapter/jamcorder/FsJamCorderArchive.test.mjs
git commit -m "feat(jamcorder): add FsJamCorderArchive (binary write + dedup index)"
```

---

## Task 5: `JamCorderHarvester` (thin IHarvester glue)

**Files:**
- Create: `backend/src/1_adapters/harvester/other/JamCorderHarvester.mjs`
- Test: `tests/isolated/adapter/jamcorder/JamCorderHarvester.test.mjs`

**Context:** The scheduler-facing adapter. Implements the existing `IHarvester` contract (`serviceId`, `category`, `harvest`, `getStatus`, `getParams`) and delegates `harvest()` to the injected `HarvestJamCorderRecordings` use case. `serviceId` is `'jamcorder'` (must match the `jobs.yml` job `id`).

**Interfaces:**
- Consumes: `IHarvester` + `HarvesterCategory` (`#adapters/harvester/ports/IHarvester.mjs`), `HarvestJamCorderRecordings` (Task 2).
- Produces: `class JamCorderHarvester extends IHarvester` `constructor({ harvestUseCase, logger })`.

- [ ] **Step 1: Write the failing test**

```javascript
// tests/isolated/adapter/jamcorder/JamCorderHarvester.test.mjs
import { describe, it, expect, vi } from 'vitest';
import { JamCorderHarvester } from '#adapters/harvester/other/JamCorderHarvester.mjs';

describe('JamCorderHarvester', () => {
  it('exposes serviceId jamcorder / category other and delegates harvest', async () => {
    const harvestUseCase = { execute: vi.fn().mockResolvedValue({ count: 3, status: 'success' }) };
    const h = new JamCorderHarvester({ harvestUseCase });
    expect(h.serviceId).toBe('jamcorder');
    expect(h.category).toBe('other');
    const res = await h.harvest('household', {});
    expect(res).toEqual({ count: 3, status: 'success' });
    expect(harvestUseCase.execute).toHaveBeenCalledTimes(1);
    expect(h.getStatus()).toMatchObject({ state: 'closed' });
    expect(h.getParams()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/isolated/adapter/jamcorder/JamCorderHarvester.test.mjs`
Expected: FAIL — cannot resolve `#adapters/harvester/other/JamCorderHarvester.mjs`.

- [ ] **Step 3: Write the implementation**

```javascript
// backend/src/1_adapters/harvester/other/JamCorderHarvester.mjs
/**
 * JamCorderHarvester — thin IHarvester adapter that plugs the JamCorder harvest
 * use case into the scheduler. serviceId 'jamcorder' must match the jobs.yml id.
 * Layer: ADAPTER (1_adapters/harvester). Delegates all work to the use case.
 * @module adapters/harvester/other/JamCorderHarvester
 */
import { IHarvester, HarvesterCategory } from '../ports/IHarvester.mjs';

export class JamCorderHarvester extends IHarvester {
  #harvestUseCase; #logger;

  constructor({ harvestUseCase, logger = console }) {
    super();
    if (!harvestUseCase) throw new Error('JamCorderHarvester requires harvestUseCase');
    this.#harvestUseCase = harvestUseCase;
    this.#logger = logger;
  }

  get serviceId() { return 'jamcorder'; }
  get category() { return HarvesterCategory.OTHER; }

  async harvest(_username, _options = {}) {
    return this.#harvestUseCase.execute();
  }

  getStatus() {
    return { state: 'closed', failures: 0, lastFailure: null, cooldownUntil: null };
  }

  getParams() { return []; }
}

export default JamCorderHarvester;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/isolated/adapter/jamcorder/JamCorderHarvester.test.mjs`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add backend/src/1_adapters/harvester/other/JamCorderHarvester.mjs tests/isolated/adapter/jamcorder/JamCorderHarvester.test.mjs
git commit -m "feat(jamcorder): add thin JamCorderHarvester (IHarvester -> use case)"
```

---

## Task 6: Bootstrap wiring + config

**Files:**
- Modify: `backend/src/5_composition/bootstrap.mjs` (inside `createHarvesterServices`, near the other `registerHarvester(...)` calls)
- Create (live data volume, via `docker exec`): `data/household/config/jamcorder.yml`
- Modify (live data volume, via `docker exec`): `data/system/config/jobs.yml`
- Test: `node --check` + the full jamcorder suite.

**Context:** Wire the three adapters + use case and register the harvester. The device host comes from the household config `jamcorder` app (`configService.getHouseholdAppConfig(hid, 'jamcorder')?.host`), defaulting to `10.0.0.244`. Guard on `httpClient` existing (same pattern as the other harvesters). Config-file edits happen on the live data volume during the deploy phase (controller-run), not in the repo.

- [ ] **Step 1: Read the harvester-registration region of bootstrap.mjs**

Read `backend/src/5_composition/bootstrap.mjs` around `createHarvesterServices` (the `registerHarvester` helper + the resolved-config block + the `OTHER` harvesters). Confirm `httpClient`, `configService`, and a default household id are in scope.

- [ ] **Step 2: Add the imports (top of bootstrap.mjs, with the other adapter imports)**

```javascript
import { HttpJamCorderSource } from '#adapters/jamcorder/HttpJamCorderSource.mjs';
import { FsJamCorderArchive } from '#adapters/jamcorder/FsJamCorderArchive.mjs';
import { HarvestJamCorderRecordings } from '#apps/jamcorder/HarvestJamCorderRecordings.mjs';
import { JamCorderHarvester } from '#adapters/harvester/other/JamCorderHarvester.mjs';
```

- [ ] **Step 3: Register the harvester (inside `createHarvesterServices`, among the OTHER harvesters)**

```javascript
  // JamCorder — daily MIDI harvest from the networked piano recorder.
  if (httpClient) {
    registerHarvester('jamcorder', () => {
      const jamcorderCfg = configService?.getHouseholdAppConfig?.(null, 'jamcorder') || {};
      const host = jamcorderCfg.host || '10.0.0.244';
      const source = new HttpJamCorderSource({ httpClient, host, logger });
      const archive = new FsJamCorderArchive({ configService, logger });
      const harvestUseCase = new HarvestJamCorderRecordings({ source, archive, logger });
      return new JamCorderHarvester({ harvestUseCase, logger });
    });
  }
```

- [ ] **Step 4: Verify syntax + full jamcorder suite**

Run: `node --check backend/src/5_composition/bootstrap.mjs`
Expected: OK.
Run: `npx vitest run tests/isolated/domain/jamcorder tests/isolated/application/jamcorder tests/isolated/adapter/jamcorder`
Expected: PASS (all).

- [ ] **Step 5: Commit the code**

```bash
git add backend/src/5_composition/bootstrap.mjs
git commit -m "feat(jamcorder): wire JamCorder harvester into bootstrap"
```

- [ ] **Step 6: (Controller-run, deploy phase) create the config files on the live data volume**

These are NOT repo files — they live in the mounted data volume, written via the container:

```bash
# device host config
sudo docker exec daylight-station sh -c 'cat > data/household/config/jamcorder.yml << "EOF"
host: 10.0.0.244
EOF'

# add the daily job to system/config/jobs.yml (append a list entry; verify existing shape first)
sudo docker exec daylight-station sh -c 'cat data/system/config/jobs.yml'
# then append (or hand-edit) an entry:
#   - id: jamcorder
#     name: JamCorder MIDI Harvest
#     module: harvester
#     schedule: '0 4 * * *'
#     enabled: true
```

Then chown any newly-created files to `node:node` (docker exec runs as root) and redeploy so the harvester + job load. Verify: boot logs show `harvester.bootstrap.registered { serviceId: 'jamcorder' }`, and a manual trigger (`POST /api/v1/…` scheduler run, or wait for the schedule) produces files under `history/piano/jamcorder/`.

---

## Self-Review

- **Spec coverage:** embedded-timestamp parse + archive path (`JamCorderStone`, Task 1) ✓; recursive enumerate + download (`HttpJamCorderSource`, Task 3) ✓; dedup index + binary write to `history/piano/jamcorder/` (`FsJamCorderArchive`, Task 4) ✓; orchestration + offline/per-file error handling (`HarvestJamCorderRecordings`, Task 2) ✓; scheduler integration (`JamCorderHarvester` + bootstrap + jobs.yml, Tasks 5–6) ✓; config host out of code (Task 6) ✓; layer adherence (domain pure, ports in app, adapters extend, bootstrap wires) ✓.
- **Type consistency:** ref shape `{listPath, downloadPath}` is produced by `HttpJamCorderSource.listRecordings` (T3), consumed by `HarvestJamCorderRecordings` (T2) and `FsJamCorderArchive.has/markProcessed` (T4, keyed on `listPath`). `archiveRelPath()` string (T1) flows to `archive.save(relPath, …)` (T2→T4). `HarvestResult {count,status}` from the use case (T2) is returned unchanged by `JamCorderHarvester.harvest` (T5). `getHouseholdPath` (T4) matches the ConfigService signature.
- **Placeholders:** none — every code/test step is complete and verified against the real fixture (Task 1 code was run against `tests/fixtures/jamcorder/Jmx-A00005-Jan-02-2026.mid` producing `2026/2026-01/2026-01-02 18.17.40.mid`). The Task 4 note about `loadYamlSafe`/`saveYaml` `.yml`-appending is a verify-by-test instruction with an explicit fallback, not a gap.
