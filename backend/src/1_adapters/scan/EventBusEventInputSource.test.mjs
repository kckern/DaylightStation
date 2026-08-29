import { describe, expect, it, vi } from 'vitest';
import { EventBusEventInputSource, resolveOmrInputTopics } from './EventBusEventInputSource.mjs';

describe('EventBusEventInputSource', () => {
  it('preserves default and reader-specific OMR topics without duplicates', () => {
    expect(resolveOmrInputTopics({
      scanners: { a: { topic: 'omr:a' }, b: { topic: 'omr:a' }, c: {} },
    })).toEqual(['omr', 'omr:a']);
  });

  it('subscribes and disposes every configured topic', () => {
    const offA = vi.fn();
    const offB = vi.fn();
    const eventBus = { subscribe: vi.fn().mockReturnValueOnce(offA).mockReturnValueOnce(offB) };
    const source = new EventBusEventInputSource({ eventBus, topics: ['omr', 'omr:study'] });
    const handler = vi.fn();
    const dispose = source.observe(handler);
    expect(eventBus.subscribe.mock.calls).toEqual([['omr', handler], ['omr:study', handler]]);
    dispose();
    expect(offA).toHaveBeenCalledTimes(1);
    expect(offB).toHaveBeenCalledTimes(1);
  });
});
