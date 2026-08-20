// backend/src/3_applications/content/services/surroundQueuePlan.test.mjs

import { describe, it, expect, vi } from 'vitest';
import { planSurroundQueue } from './surroundQueuePlan.mjs';

// The live shape: season plex:696233 composes three étude episodes, in this
// authored order. `parts` never names the container itself — see
// YamlSurroundStore#indexParts — which is what tells a container's payload
// apart from an ordinary piece's.
const SEASON = {
  id: 'concert-hall',
  piece: { title: 'Études' },
  timeline: {
    totalSounding: 3738,
    parts: [
      { contentId: 'plex:696234', index: 0, sounding: 1800 },
      { contentId: 'plex:696235', index: 1, sounding: 1550 },
      { contentId: 'plex:696236', index: 2, sounding: 388 }
    ]
  }
};

// One media item, one part, naming itself: every sidecar authored before
// containers existed looks like this.
const SOLO = {
  id: 'concert-hall',
  timeline: { totalSounding: 3223, parts: [{ contentId: 'plex:663134', index: 0, sounding: 3223 }] }
};

const makeLogger = () => ({ info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() });
const item = (id) => ({ id, title: id });
const ids = (list) => list.map((i) => i.id);

const plan = ({ payload = SEASON, containerId = 'plex:696233', items, enforceOrder = true, logger }) =>
  planSurroundQueue({
    surroundStore: { lookup: (id) => (id === containerId ? payload : null) },
    containerId,
    items,
    enforceOrder,
    logger
  });

describe('planSurroundQueue', () => {
  const shuffled = [item('plex:696235'), item('plex:696236'), item('plex:696234')];

  it('imposes the authored order over a shuffled queue', () => {
    const logger = makeLogger();
    const result = plan({ items: shuffled, logger });

    expect(ids(result.items)).toEqual(['plex:696234', 'plex:696235', 'plex:696236']);
    const enforced = logger.info.mock.calls.find((c) => c[0] === 'surround.order.enforced');
    expect(enforced).toBeDefined();
    expect(enforced[1]).toMatchObject({
      containerId: 'plex:696233',
      surroundId: 'concert-hall',
      parts: 3,
      queued: 3,
      onRail: 3,
      reordered: true,
      order: ['plex:696234', 'plex:696235', 'plex:696236']
    });
  });

  it('gives every part the container payload and its own part index', () => {
    const result = plan({ items: shuffled, logger: makeLogger() });

    expect(result.surroundFor.get('plex:696234')).toEqual({ payload: SEASON, part: 0 });
    expect(result.surroundFor.get('plex:696235')).toEqual({ payload: SEASON, part: 1 });
    expect(result.surroundFor.get('plex:696236')).toEqual({ payload: SEASON, part: 2 });
  });

  it('reports reordered:false when the queue already arrived in authored order', () => {
    const logger = makeLogger();
    const inOrder = [item('plex:696234'), item('plex:696235'), item('plex:696236')];
    const result = plan({ items: inOrder, logger });

    expect(ids(result.items)).toEqual(['plex:696234', 'plex:696235', 'plex:696236']);
    const enforced = logger.info.mock.calls.find((c) => c[0] === 'surround.order.enforced');
    expect(enforced[1]).toMatchObject({ reordered: false });
  });

  it('keeps items that are not on the rail, after the ones that are', () => {
    const logger = makeLogger();
    const withExtra = [item('plex:999'), item('plex:696236'), item('plex:696234')];
    const result = plan({ items: withExtra, logger });

    expect(ids(result.items)).toEqual(['plex:696234', 'plex:696236', 'plex:999']);
    expect(result.surroundFor.has('plex:999')).toBe(false);
  });

  it('refuses to attach any rail when enforcement is off and the order does not match', () => {
    const logger = makeLogger();
    const result = plan({ items: shuffled, enforceOrder: false, logger });

    // A frame with no rail, never a rail that lies about position.
    expect([...result.surroundFor.keys()]).toEqual([]);
    expect(ids(result.items)).toEqual(['plex:696235', 'plex:696236', 'plex:696234']);
    const mismatch = logger.warn.mock.calls.find((c) => c[0] === 'surround.order.mismatch');
    expect(mismatch).toBeDefined();
    expect(mismatch[1]).toMatchObject({
      containerId: 'plex:696233',
      surroundId: 'concert-hall',
      enforceOrder: false,
      parts: 3,
      authored: ['plex:696234', 'plex:696235', 'plex:696236'],
      queued: ['plex:696235', 'plex:696236', 'plex:696234']
    });
    expect(logger.info).not.toHaveBeenCalledWith('surround.order.enforced', expect.anything());
  });

  it('marks a refusal as such, and distinguishes it from a plan that simply omits an item', () => {
    const refusal = plan({ items: shuffled, enforceOrder: false, logger: makeLogger() });
    expect(refusal.refused).toBe(true);

    // Same empty answer for one item, entirely different meaning: this queue is
    // framed, that item is just not on the rail and keeps its own sidecar.
    const partial = plan({ items: [item('plex:999'), item('plex:696234')], logger: makeLogger() });
    expect(partial.refused).toBe(false);
    expect(partial.surroundFor.has('plex:999')).toBe(false);
  });

  it('does not call a repeated part mis-ordered', () => {
    const logger = makeLogger();
    // Ascending authored rank with a repeat: odd, but it disagrees with nothing.
    const repeated = [item('plex:696234'), item('plex:696234'), item('plex:696235')];
    const result = plan({ items: repeated, enforceOrder: false, logger });

    expect(result.refused).toBe(false);
    expect(result.surroundFor.get('plex:696234')).toEqual({ payload: SEASON, part: 0 });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('attaches without reordering when enforcement is off and the order already matches', () => {
    const logger = makeLogger();
    const inOrder = [item('plex:696234'), item('plex:696235'), item('plex:696236')];
    const result = plan({ items: inOrder, enforceOrder: false, logger });

    expect(result.surroundFor.get('plex:696235')).toEqual({ payload: SEASON, part: 1 });
    expect(logger.warn).not.toHaveBeenCalledWith('surround.order.mismatch', expect.anything());
  });

  it('judges a partial queue on the order of the parts it actually holds', () => {
    const logger = makeLogger();
    const two = [item('plex:696234'), item('plex:696236')];
    const result = plan({ items: two, enforceOrder: false, logger });

    // A missing part is not a mis-ordered one.
    expect(result.surroundFor.get('plex:696236')).toEqual({ payload: SEASON, part: 2 });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('declines a single-piece payload, so standalone queues behave as before', () => {
    const result = plan({ payload: SOLO, containerId: 'plex:663134', items: [item('plex:663134')] });
    expect(result).toBeNull();
  });

  it('declines when no queued item is on the container rail', () => {
    const result = plan({ items: [item('plex:1'), item('plex:2')], logger: makeLogger() });
    expect(result).toBeNull();
  });

  it('declines, and never throws, when the store breaks its never-throw contract', () => {
    const logger = makeLogger();
    const result = planSurroundQueue({
      surroundStore: { lookup: () => { throw new Error('index corrupt'); } },
      containerId: 'plex:696233',
      items: [item('plex:696234')],
      logger
    });

    expect(result).toBeNull();
    const failed = logger.warn.mock.calls.find((c) => c[0] === 'surround.container.failed');
    expect(failed[1]).toMatchObject({ containerId: 'plex:696233', error: 'index corrupt' });
  });

  it('declines when no store is composed at all', () => {
    expect(planSurroundQueue({ containerId: 'plex:696233', items: [item('plex:696234')] })).toBeNull();
  });
});
