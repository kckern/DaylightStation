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
});
