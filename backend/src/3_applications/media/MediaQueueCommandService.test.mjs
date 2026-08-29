import { describe, expect, it, vi } from 'vitest';
import { MediaQueue } from '#domains/media/entities/MediaQueue.mjs';
import { MediaQueueCommandService } from './MediaQueueCommandService.mjs';

function harness(items = [{ queueId: 'old', contentId: 'old' }]) {
  let queue = new MediaQueue({ items, position: 0 });
  const changed = vi.fn();
  let sequence = 0;
  const service = new MediaQueueCommandService({
    queues: {
      load: async () => queue,
      replace: async (next) => { queue = next; },
      clear: async () => { queue.clear(); return queue; },
    },
    publications: { changed },
    createQueueId: () => `q${++sequence}`,
  });
  return { service, changed, queue: () => queue };
}

describe('MediaQueueCommandService', () => {
  it.each([
    ['add', ['old', 'new'], 0],
    ['next', ['old', 'new'], 0],
    ['play', ['old', 'new'], 1],
    ['queue', ['new'], 0],
  ])('preserves the legacy %s mutation and media:queue payload shape', async (action, ids, position) => {
    const { service, changed, queue } = harness();
    await service.execute({ action, contentId: 'new', householdId: 'h' });
    expect(queue().items.map((item) => item.contentId)).toEqual(ids);
    expect(queue().position).toBe(position);
    expect(changed).toHaveBeenCalledWith({
      position,
      shuffle: false,
      repeat: 'off',
      volume: 1,
      items: queue().items,
      shuffleOrder: [],
    });
  });

  it('clears and republishes, while unknown actions do neither', async () => {
    const { service, changed, queue } = harness();
    await expect(service.execute({ action: 'bogus' })).resolves.toEqual({ kind: 'unknown_action' });
    expect(changed).not.toHaveBeenCalled();
    await service.execute({ action: 'clear' });
    expect(queue().items).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
