import { describe, it, expect, vi } from 'vitest';
import { SessionGroupingService } from './SessionGroupingService.mjs';

const H = (h, m) => Date.parse(`2026-06-05T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00-07:00`);
const sess = (id, start, durMin, riders, media = null, coins = 0) => ({
  sessionId: id, date: '2026-06-05', startTime: start, durationMs: durMin * 60000,
  participants: Object.fromEntries(riders.map(r => [r, { displayName: r }])), media, totalCoins: coins,
});

const sessions = [
  sess('s1', H(14,54), 5.5, ['milo'], null, 60),
  sess('s3', H(16,22), 37.5, ['alan','milo'], null, 1139),
  sess('s7', H(19,10), 46.4, ['kckern','milo'],
       { primary: { contentId: 'plex:674286', title: 'Looney Tunes Racing' } }, 2745),
];

describe('SessionGroupingService', () => {
  it('groups sessions and enriches only non-video groups via the registry', async () => {
    const registry = { enrich: vi.fn(async () => [{ type: 'cycle-game', count: 13, items: [] }]) };
    const svc = new SessionGroupingService({ activityRegistry: registry });
    const groups = await svc.group(sessions, 'household');

    // s1+s3 merge (overlap on milo), s7 is video standalone
    expect(groups.map(g => g.id)).toEqual(['group:s1', 's7']);

    // enrich called once — only for the non-video group
    expect(registry.enrich).toHaveBeenCalledTimes(1);
    expect(registry.enrich).toHaveBeenCalledWith(expect.objectContaining({ id: 'group:s1' }), 'household');

    expect(groups[0].activities).toEqual([{ type: 'cycle-game', count: 13, items: [] }]);
    expect(groups[1].activities).toEqual([]); // video group untouched
  });

  it('skips enrichment when enrich:false', async () => {
    const registry = { enrich: vi.fn(async () => [{ type: 'x', count: 1, items: [] }]) };
    const svc = new SessionGroupingService({ activityRegistry: registry });
    const groups = await svc.group(sessions, 'household', { enrich: false });
    expect(registry.enrich).not.toHaveBeenCalled();
    expect(groups[0].activities).toEqual([]);
  });

  it('works with no registry (returns groups, no enrichment)', async () => {
    const svc = new SessionGroupingService({});
    const groups = await svc.group(sessions, 'household');
    expect(groups.map(g => g.id)).toEqual(['group:s1', 's7']);
    expect(groups[0].activities).toEqual([]);
  });

  it('does not let a failing provider crash grouping (logs + continues)', async () => {
    const warn = vi.fn();
    const registry = { enrich: vi.fn(async () => { throw new Error('boom'); }) };
    const svc = new SessionGroupingService({ activityRegistry: registry, logger: { warn } });
    const groups = await svc.group(sessions, 'household');
    expect(groups[0].activities).toEqual([]); // stays empty on failure
    expect(warn).toHaveBeenCalled();
  });
});
