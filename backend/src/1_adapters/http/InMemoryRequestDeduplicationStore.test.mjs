import { describe, it, expect, vi, afterEach } from 'vitest';
import { InMemoryRequestDeduplicationStore } from './InMemoryRequestDeduplicationStore.mjs';

afterEach(() => vi.restoreAllMocks());

describe('InMemoryRequestDeduplicationStore', () => {
  it('hashes and rejects a repeated identity only inside the TTL', () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1000)
      .mockReturnValueOnce(1010)
      .mockReturnValueOnce(2000);
    const store = new InMemoryRequestDeduplicationStore({ logger: { debug: vi.fn() } });

    expect(store.checkAndRemember(['bot', 'upd:1'], { ttlMs: 100 })).toMatchObject({ duplicate: false });
    expect(store.checkAndRemember(['bot', 'upd:1'], { ttlMs: 100 })).toMatchObject({ duplicate: true, ageMs: 10 });
    expect(store.checkAndRemember(['bot', 'upd:1'], { ttlMs: 100 })).toMatchObject({ duplicate: false });
  });

  it('keeps identities from different webhook paths separate', () => {
    const store = new InMemoryRequestDeduplicationStore();
    expect(store.checkAndRemember(['bot-a', 'upd:1'], { ttlMs: 300000 }).duplicate).toBe(false);
    expect(store.checkAndRemember(['bot-b', 'upd:1'], { ttlMs: 300000 }).duplicate).toBe(false);
    expect(store.size).toBe(2);
  });
});
