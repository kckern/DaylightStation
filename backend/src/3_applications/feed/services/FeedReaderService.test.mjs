import { describe, expect, it, vi } from 'vitest';
import { FeedReaderService } from './FeedReaderService.mjs';

describe('FeedReaderService', () => {
  it('routes durable dismissals by source and reports partial failures exactly', async () => {
    const reddit = { sourceType: 'reddit', supportsMarkRead: true, markRead: vi.fn().mockResolvedValue() };
    const broken = { sourceType: 'broken', supportsMarkRead: true, markRead: vi.fn().mockRejectedValue(new Error('down')) };
    const store = { add: vi.fn() };
    const service = new FeedReaderService({ readerGateway: {}, sourceAdapters: [reddit, broken], dismissedItemsStore: store, logger: { warn: vi.fn() } });
    const result = await service.dismiss(['reddit:1', 'broken:2', 'plain'], 'alice');
    expect(reddit.markRead).toHaveBeenCalledWith(['reddit:1'], 'alice');
    expect(store.add).toHaveBeenCalledWith(['plain']);
    expect(result).toEqual({ dismissed: 2, failed: ['broken:2'] });
  });

  it('keeps adapters with inherited no-op markRead out of dismissal routing', async () => {
    const source = { sourceType: 'noop', supportsMarkRead: false, markRead: vi.fn() };
    const store = { add: vi.fn() };
    const service = new FeedReaderService({ readerGateway: {}, sourceAdapters: [source], dismissedItemsStore: store });
    await expect(service.dismiss(['noop:1'], 'alice')).resolves.toEqual({ dismissed: 1, failed: [] });
    expect(source.markRead).not.toHaveBeenCalled();
    expect(store.add).toHaveBeenCalledWith(['noop:1']);
  });
});
