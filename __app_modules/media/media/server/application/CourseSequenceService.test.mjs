import { describe, it, expect, vi } from 'vitest';
import { CourseSequenceService } from './CourseSequenceService.mjs';

const done = { percent: 100 };
const course = (contentId, title, extra = {}) => ({ title, play: { contentId }, uid: `u-${contentId}`, ...extra });

function build({ list, tree, progress = {}, random = () => 0 }) {
  let saved = null;
  const logger = { info: vi.fn(), warn: vi.fn(), debug: vi.fn() };
  const service = new CourseSequenceService({
    loadList: vi.fn(async () => structuredClone(list)),
    saveList: vi.fn(async (doc) => { saved = doc; }),
    listChildren: vi.fn(async (id) => (tree[id] || []).map(c => (typeof c === 'string' ? { id: c, title: c } : c))),
    loadProgress: vi.fn(async () => new Map(Object.entries(progress))),
    random,
    today: () => '2026-10-29',
    newUid: () => 'new-uid',
    logger,
  });
  return { service, logger, saved: () => saved };
}

const POOL = 'plex:648916';

describe('CourseSequenceService', () => {
  it('retires a course whose episodes are all watched or skipped', async () => {
    const { service, saved, logger } = build({
      list: { metadata: { pool: POOL }, items: [course('plex:A', 'Econ'), course('plex:B', 'Sermon'), course('plex:C', 'Nietzsche')] },
      tree: { 'plex:A': ['plex:a1', 'plex:a2'], 'plex:B': ['plex:b1'], 'plex:C': ['plex:c1'] },
      progress: { 'plex:a1': done, 'plex:a2': { percent: 1, skipped: true } },
    });
    const result = await service.run();
    expect(result.retired).toEqual(['plex:A']);
    expect(saved().items[0]).toMatchObject({ watched: true, completed: '2026-10-29' });
    expect(logger.info).toHaveBeenCalledWith('media.courses.retired', expect.objectContaining({ contentId: 'plex:A' }));
  });

  it('keeps one course queued: auto-picks an untouched pool season when only one is left', async () => {
    const { service, saved, logger } = build({
      list: { metadata: { pool: POOL }, items: [course('plex:B', 'Sermon')] },
      tree: {
        'plex:B': ['plex:b1', 'plex:b2'],
        [POOL]: [{ id: 'plex:B', title: 'Sermon' }, { id: 'plex:S1', title: 'Started' }, { id: 'plex:S2', title: 'Astronomy' }],
        'plex:S1': ['plex:s1e1'],
        'plex:S2': ['plex:s2e1', 'plex:s2e2'],
      },
      progress: { 'plex:b1': done, 'plex:s1e1': { percent: 6 } },
    });
    const result = await service.run();
    expect(result.picked).toEqual(['plex:S2']);
    expect(saved().items.at(-1)).toEqual({ title: 'Astronomy', play: { contentId: 'plex:S2' }, uid: 'new-uid', auto_picked: '2026-10-29' });
    expect(logger.info).toHaveBeenCalledWith('media.courses.auto_picked', expect.objectContaining({ contentId: 'plex:S2' }));
  });

  it('with two unfinished courses queued it changes nothing and does not save', async () => {
    const { service, saved } = build({
      list: { metadata: { pool: POOL }, items: [course('plex:B', 'Sermon'), course('plex:C', 'Nietzsche')] },
      tree: { 'plex:B': ['plex:b1'], 'plex:C': ['plex:c1'] },
    });
    const result = await service.run();
    expect(result).toMatchObject({ retired: [], picked: [], unfinished: 2 });
    expect(saved()).toBeNull();
  });

  it('already-retired courses are not re-read and do not count as queued', async () => {
    const { service } = build({
      list: { metadata: { pool: POOL }, items: [course('plex:A', 'Econ', { watched: true }), course('plex:B', 'Sermon'), course('plex:C', 'N')] },
      tree: { 'plex:B': ['plex:b1'], 'plex:C': ['plex:c1'] },
    });
    const result = await service.run();
    expect(result.unfinished).toBe(2);
  });

  it('warns when the pool has nothing untouched left', async () => {
    const { service, logger, saved } = build({
      list: { metadata: { pool: POOL }, items: [course('plex:B', 'Sermon')] },
      tree: { 'plex:B': ['plex:b1'], [POOL]: [{ id: 'plex:B', title: 'Sermon' }] },
    });
    const result = await service.run();
    expect(result.picked).toEqual([]);
    expect(saved()).toBeNull();
    expect(logger.warn).toHaveBeenCalledWith('media.courses.pool_empty', expect.objectContaining({ pool: POOL }));
  });

  it('a missing list is a no-op', async () => {
    const { service, saved } = build({ list: null, tree: {} });
    expect(await service.run()).toMatchObject({ retired: [], picked: [], unfinished: 0 });
    expect(saved()).toBeNull();
  });
});
