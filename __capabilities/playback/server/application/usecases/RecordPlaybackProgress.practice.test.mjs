import { describe, it, expect, vi } from 'vitest';
import { RecordPlaybackProgress } from './RecordPlaybackProgress.mjs';
import { MediaProgress } from '../../../../content-catalog/server/domain/entities/MediaProgress.mjs';

function build({ store, economy }) {
  return new RecordPlaybackProgress({
    contentCatalog: { resolveSource: () => null },
    mediaProgressMemory: { findProgress: vi.fn(async () => null), saveProgress: vi.fn(async () => {}) },
    createMediaProgress: (props) => new MediaProgress(props),
    nowTimestamp: () => '2026-11-12 08:00:00',
    nowEpoch: () => 0,
    nowIso: () => '2026-11-12T16:00:00.000Z',
    userVideoProgressStore: store,
    economyService: economy,
    logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  });
}

describe('RecordPlaybackProgress forwards lesson practice', () => {
  it('passes practice and title to the progress store; the economy earn fires once', async () => {
    const record = vi.fn()
      .mockReturnValueOnce({ completedAt: 'x', newlyCompleted: true, credit: { outcome: 'credited' } })
      .mockReturnValueOnce({ completedAt: 'x', newlyCompleted: false, credit: { outcome: 'credited' } });
    const economy = { earn: vi.fn(async () => {}) };
    const uc = build({ store: { record }, economy });
    const practice = { sittingId: 'abc', humanNotes: 10, practiceNotes: 9, playedSec: 60, drillsPassed: 0 };
    const body = { type: 'plex', assetId: 'plex:5', seconds: 590, percent: 95, userId: 'test-learner', engaged: true, title: 'A lesson', practice };
    const { response } = await uc.execute(body);
    await uc.execute(body);
    expect(record.mock.calls[0][0]).toMatchObject({ userId: 'test-learner', practice, title: 'A lesson' });
    expect(economy.earn).toHaveBeenCalledTimes(1);
    expect(response.userProgress.credit.outcome).toBe('credited');
  });

  it('no practice in the body → practice null', async () => {
    const record = vi.fn(() => ({ newlyCompleted: false }));
    await build({ store: { record } }).execute({ type: 'plex', assetId: 'plex:5', seconds: 10, percent: 5, userId: 'test-learner' });
    expect(record.mock.calls[0][0].practice).toBeNull();
  });
});
