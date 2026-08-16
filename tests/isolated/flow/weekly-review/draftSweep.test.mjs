/**
 * finalizeDraft renames a draft to `{sessionId}.processing-{stamp}.webm` and only
 * deletes it AFTER transcription returns. If transcription throws, the renamed
 * file is orphaned — and its .meta.json is already gone, so sweepStaleDrafts,
 * which walks meta files, can never see it. A 26MB orphan from 2026-06-13
 * survived 60+ days in the committable tree that way.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { WeeklyReviewService } from '#apps/weekly-review/WeeklyReviewService.mjs';

const WEEK = '2026-06-13';
const OLD_MS = Date.now() - 60 * 24 * 60 * 60 * 1000;

describe('sweepStaleDrafts — orphaned processing files', () => {
  let tmp; let svc; let draftDir;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wr-sweep-'));
    svc = new WeeklyReviewService({
      householdDir: path.join(tmp, 'household'),
      mediaPath: path.join(tmp, 'media'),
      logger: { warn() {}, info() {} },
    });
    draftDir = path.join(tmp, 'media', 'weekly-review', WEEK, '.drafts');
    fs.mkdirSync(draftDir, { recursive: true });
  });

  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('sweeps a stale .processing- file that has no meta beside it', async () => {
    const orphan = path.join(draftDir, `abc.processing-${OLD_MS}.webm`);
    fs.writeFileSync(orphan, 'x');
    fs.utimesSync(orphan, OLD_MS / 1000, OLD_MS / 1000);

    await svc.sweepStaleDrafts({ maxAgeDays: 30 });

    expect(fs.existsSync(orphan)).toBe(false);
  });

  it('leaves a recent .processing- file alone', async () => {
    const fresh = path.join(draftDir, 'def.processing-999.webm');
    fs.writeFileSync(fresh, 'x');

    await svc.sweepStaleDrafts({ maxAgeDays: 30 });

    expect(fs.existsSync(fresh)).toBe(true);
  });
});
