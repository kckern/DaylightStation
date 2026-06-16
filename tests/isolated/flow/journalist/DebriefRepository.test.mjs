// tests/isolated/flow/journalist/DebriefRepository.test.mjs
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

describe('DebriefRepository — headline persistence', () => {
  let DebriefRepository;
  let dataPath;

  beforeEach(async () => {
    dataPath = mkdtempSync(path.join(tmpdir(), 'debrief-repo-test-'));
    const module = await import('#backend/src/1_adapters/journalist/DebriefRepository.mjs');
    DebriefRepository = module.DebriefRepository;
  });

  afterEach(() => {
    rmSync(dataPath, { recursive: true, force: true });
  });

  const build = () =>
    new DebriefRepository({
      dataPath,
      logger: { info: vi.fn(), error: vi.fn() },
    });

  it('round-trips the headline through debriefs.yml', async () => {
    const repo = build();
    await repo.appendDebrief({
      date: '2026-06-10',
      summary: '🌅 Morning\n• 9:23a music',
      headline: 'Media rebuild finally hit green across the board',
      summaries: [],
    });

    const stored = await repo.getDebriefByDate('2026-06-10');
    expect(stored).not.toBeNull();
    expect(stored.headline).toBe('Media rebuild finally hit green across the board');
    expect(stored.summary).toBe('🌅 Morning\n• 9:23a music');
  });

  it('omits the headline key entirely when none was generated', async () => {
    const repo = build();
    await repo.appendDebrief({
      date: '2026-06-10',
      summary: '🌅 Morning\n• 9:23a music',
      headline: null,
      summaries: [],
    });

    const stored = await repo.getDebriefByDate('2026-06-10');
    expect(stored).not.toBeNull();
    expect('headline' in stored).toBe(false);
  });
});
