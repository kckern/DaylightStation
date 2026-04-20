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
});
