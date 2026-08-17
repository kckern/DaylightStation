// tests/isolated/adapter/persistence/YamlTocCacheDatastore.test.mjs
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { YamlTocCacheDatastore } from '#adapters/persistence/yaml/YamlTocCacheDatastore.mjs';

/**
 * Proves the komga TOC cache resolves under content/komga/toc/ (task 10 of the
 * data/media reorg), NOT household/komga/cache/toc/ — the LLM/vision-extracted
 * TOC is expensive and non-reproducible, so it lives beside the article
 * material it indexes in the top-level content/ tree, not the disposable
 * cache tree and not household-scoped.
 *
 * Two independent code paths read/write this subtree — KomgaFeedAdapter
 * directly, and this datastore (wired at bootstrap.mjs:2685). This test
 * covers the datastore half; tests/isolated/adapter/feed/KomgaFeedAdapter.test.mjs
 * covers the adapter half.
 */
describe('YamlTocCacheDatastore', () => {
  let mockDataService;
  let mockConfigService;
  let datastore;

  beforeEach(() => {
    mockDataService = {
      content: {
        read: vi.fn().mockReturnValue(null),
        write: vi.fn(),
      },
      user: {
        read: vi.fn().mockReturnValue(null),
      },
      household: {
        read: vi.fn().mockReturnValue(null),
      },
    };
    mockConfigService = {
      getHeadOfHousehold: vi.fn().mockReturnValue(null),
    };
    datastore = new YamlTocCacheDatastore({ dataService: mockDataService, configService: mockConfigService });
  });

  test('readCache resolves under content/komga/toc/, not household/komga/cache/toc/', () => {
    datastore.readCache('book-123');
    expect(mockDataService.content.read).toHaveBeenCalledWith('komga/toc/book-123.yml');
    expect(mockDataService.household.read).not.toHaveBeenCalled();
  });

  test('writeCache resolves under content/komga/toc/, not household/komga/cache/toc/', () => {
    const tocData = { bookId: 'book-123', articles: [] };
    datastore.writeCache('book-123', tocData);
    expect(mockDataService.content.write).toHaveBeenCalledWith('komga/toc/book-123.yml', tocData);
  });
});
