import { describe, it, expect } from 'vitest';
import { EntropyFeedAdapter } from '../../../../backend/src/1_adapters/feed/sources/EntropyFeedAdapter.mjs';
import { IFeedSourceAdapter } from '../../../../backend/src/3_applications/feed/ports/IFeedSourceAdapter.mjs';

describe('EntropyFeedAdapter', () => {
  it('implements IFeedSourceAdapter', () => {
    const adapter = new EntropyFeedAdapter({ entropyService: null });
    expect(adapter).toBeInstanceOf(IFeedSourceAdapter);
    expect(adapter.sourceType).toBe('entropy');
    expect(typeof adapter.fetchPage).toBe('function');
  });

  it('returns empty items when entropyService is null', async () => {
    const adapter = new EntropyFeedAdapter({ entropyService: null });
    const result = await adapter.fetchPage({}, 'testuser');
    expect(result).toEqual({ items: [], cursor: null });
  });
});
