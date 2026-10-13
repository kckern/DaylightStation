import { describe, it, expect } from 'vitest';
import { EntropyFeedAdapter } from "../../../../__app_modules/feed/server/adapters/sources/EntropyFeedAdapter.mjs";
import { IFeedSourceAdapter } from "../../../../__app_modules/feed/server/application/ports/IFeedSourceAdapter.mjs";

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
