import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { WeeklyReviewService } from '#apps/weekly-review/WeeklyReviewService.mjs';

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
      sessionId: 'sess-aaaa',
      seq: 0,
      week: '2026-04-12',
      buffer,
    });

    expect(result.ok).toBe(true);
    expect(result.bytesWritten).toBe(buffer.length);
    expect(result.totalBytes).toBe(buffer.length);
    expect(result.nextSeq).toBe(1);

    const draftPath = path.join(tmpDataPath, 'household', 'common', 'weekly-review', '2026-04-12', '.drafts', 'sess-aaaa.webm');
    expect(fs.existsSync(draftPath)).toBe(true);
    expect(fs.readFileSync(draftPath)).toEqual(buffer);
  });

  it('appends successive chunks in order', async () => {
    await service.appendChunk({ sessionId: 'sess-1234', seq: 0, week: '2026-04-12', buffer: Buffer.from('AAA') });
    const r = await service.appendChunk({ sessionId: 'sess-1234', seq: 1, week: '2026-04-12', buffer: Buffer.from('BBB') });
    expect(r.totalBytes).toBe(6);
    expect(r.nextSeq).toBe(2);
    const draftPath = path.join(tmpDataPath, 'household', 'common', 'weekly-review', '2026-04-12', '.drafts', 'sess-1234.webm');
    expect(fs.readFileSync(draftPath).toString()).toBe('AAABBB');
  });

  it('is idempotent for a re-sent chunk (same seq)', async () => {
    await service.appendChunk({ sessionId: 'sess-5678', seq: 0, week: '2026-04-12', buffer: Buffer.from('AAA') });
    const r = await service.appendChunk({ sessionId: 'sess-5678', seq: 0, week: '2026-04-12', buffer: Buffer.from('AAA') });
    expect(r.ok).toBe(true);
    expect(r.duplicate).toBe(true);
    const draftPath = path.join(tmpDataPath, 'household', 'common', 'weekly-review', '2026-04-12', '.drafts', 'sess-5678.webm');
    expect(fs.readFileSync(draftPath).toString()).toBe('AAA');
  });

  it('rejects an out-of-order chunk', async () => {
    await service.appendChunk({ sessionId: 'sess-9abc', seq: 0, week: '2026-04-12', buffer: Buffer.from('AAA') });
    await expect(
      service.appendChunk({ sessionId: 'sess-9abc', seq: 2, week: '2026-04-12', buffer: Buffer.from('CCC') })
    ).rejects.toThrow(/out-of-order/i);
  });

  it('rejects invalid session id (path traversal)', async () => {
    await expect(
      service.appendChunk({ sessionId: '../evil', seq: 0, week: '2026-04-12', buffer: Buffer.from('X') })
    ).rejects.toThrow(/invalid sessionId/i);
  });

  it('rejects invalid week format', async () => {
    await expect(
      service.appendChunk({ sessionId: 'sess-defg', seq: 0, week: '2026/04/12', buffer: Buffer.from('X') })
    ).rejects.toThrow(/invalid week/i);
  });

  it('rejects empty buffer', async () => {
    await expect(
      service.appendChunk({ sessionId: 'sess-aaaa', seq: 0, week: '2026-04-12', buffer: Buffer.alloc(0) })
    ).rejects.toThrow(/buffer required/i);
  });

  it('rejects non-Buffer input', async () => {
    await expect(
      service.appendChunk({ sessionId: 'sess-aaaa', seq: 0, week: '2026-04-12', buffer: 'not-a-buffer' })
    ).rejects.toThrow(/buffer required/i);
  });

  it('rejects negative seq', async () => {
    await expect(
      service.appendChunk({ sessionId: 'sess-aaaa', seq: -1, week: '2026-04-12', buffer: Buffer.from('X') })
    ).rejects.toThrow(/invalid seq/i);
  });

  it('rejects non-integer seq', async () => {
    await expect(
      service.appendChunk({ sessionId: 'sess-aaaa', seq: 1.5, week: '2026-04-12', buffer: Buffer.from('X') })
    ).rejects.toThrow(/invalid seq/i);
  });

  it('rejects NaN seq', async () => {
    await expect(
      service.appendChunk({ sessionId: 'sess-aaaa', seq: NaN, week: '2026-04-12', buffer: Buffer.from('X') })
    ).rejects.toThrow(/invalid seq/i);
  });

  it('recovers from draft/meta desync by truncating to meta.totalBytes', async () => {
    await service.appendChunk({ sessionId: 'sess-aaaa', seq: 0, week: '2026-04-12', buffer: Buffer.from('AAA') });
    // Simulate desync: manually append extra bytes to the draft file without updating meta
    const draftPath = path.join(tmpDataPath, 'household', 'common', 'weekly-review', '2026-04-12', '.drafts', 'sess-aaaa.webm');
    fs.appendFileSync(draftPath, Buffer.from('GARBAGE'));
    // Now incoming seq 1 should trigger desync recovery, truncate draft back to 3 bytes, then append
    const r = await service.appendChunk({ sessionId: 'sess-aaaa', seq: 1, week: '2026-04-12', buffer: Buffer.from('BBB') });
    expect(r.ok).toBe(true);
    expect(r.totalBytes).toBe(6);
    expect(fs.readFileSync(draftPath).toString()).toBe('AAABBB');
  });

  it('refuses to append when meta is corrupt and draft is non-empty', async () => {
    await service.appendChunk({ sessionId: 'sess-aaaa', seq: 0, week: '2026-04-12', buffer: Buffer.from('AAA') });
    // Corrupt the meta file
    const metaPath = path.join(tmpDataPath, 'household', 'common', 'weekly-review', '2026-04-12', '.drafts', 'sess-aaaa.meta.json');
    fs.writeFileSync(metaPath, '{ this is not valid json');
    await expect(
      service.appendChunk({ sessionId: 'sess-aaaa', seq: 1, week: '2026-04-12', buffer: Buffer.from('BBB') })
    ).rejects.toThrow(/meta unreadable/i);
  });

  it('truncates stale draft when starting a new session (seq=0, no meta)', async () => {
    // Seed a stale draft with no meta file
    const draftDir = path.join(tmpDataPath, 'household', 'common', 'weekly-review', '2026-04-12', '.drafts');
    fs.mkdirSync(draftDir, { recursive: true });
    const draftPath = path.join(draftDir, 'sess-fresh00.webm');
    fs.writeFileSync(draftPath, Buffer.from('STALE-GARBAGE'));
    // Start a new session with seq 0
    const r = await service.appendChunk({ sessionId: 'sess-fresh00', seq: 0, week: '2026-04-12', buffer: Buffer.from('FRESH') });
    expect(r.ok).toBe(true);
    expect(r.totalBytes).toBe(5);
    expect(fs.readFileSync(draftPath).toString()).toBe('FRESH');
  });

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
});
