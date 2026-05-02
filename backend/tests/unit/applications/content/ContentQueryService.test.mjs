import { describe, it } from 'node:test';
import assert from 'node:assert';
import { ContentQueryService } from '../../../../src/3_applications/content/ContentQueryService.mjs';

const silentLogger = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };

/**
 * Build a fake ContentSourceRegistry that returns a single fake adapter
 * yielding the provided items for any text search.
 */
function makeServiceWith(items) {
  const fakeAdapter = {
    source: 'fake',
    getSearchCapabilities: () => ({ canonical: ['text'], specific: [] }),
    getQueryMappings: () => ({}),
    search: async () => ({ items, total: items.length }),
  };
  const registry = {
    get: (name) => (name === 'fake' ? fakeAdapter : null),
    resolveSource: () => [fakeAdapter],
  };
  return new ContentQueryService({ registry, logger: silentLogger });
}

const ITEMS = [
  { id: 'fake:1', source: 'fake', title: 'A song', mediaType: 'track',
    metadata: { type: 'audio', userRating: 8, viewCount: 50 } },
  { id: 'fake:2', source: 'fake', title: 'A photo', mediaType: 'image',
    metadata: { type: 'image' } },
  { id: 'fake:3', source: 'fake', title: 'A movie', mediaType: 'video',
    metadata: { type: 'video' } },
  { id: 'fake:4', source: 'fake', title: 'Another track', mediaType: 'track',
    metadata: { type: 'audio', userRating: 2, viewCount: 200 } },
];

describe('ContentQueryService — excludeMediaTypes', () => {
  it('drops items whose mediaType is in the blocklist', async () => {
    const cqs = makeServiceWith(ITEMS);
    const r = await cqs.search({ text: 'a', excludeMediaTypes: ['image', 'video'] });
    const types = r.items.map(i => i.mediaType);
    assert.deepStrictEqual(types.sort(), ['track', 'track']);
  });

  it('checks both mediaType and metadata.type', async () => {
    const items = [
      { id: 'fake:1', source: 'fake', title: 'X', mediaType: 'track', metadata: { type: 'image' } },
    ];
    const cqs = makeServiceWith(items);
    const r = await cqs.search({ text: 'x', excludeMediaTypes: ['image'] });
    // metadata.type='image' should trigger the block even though mediaType='track'
    assert.strictEqual(r.items.length, 0);
  });

  it('is case-insensitive', async () => {
    const items = [{ id: 'fake:1', source: 'fake', title: 'X', mediaType: 'IMAGE' }];
    const cqs = makeServiceWith(items);
    const r = await cqs.search({ text: 'x', excludeMediaTypes: ['image'] });
    assert.strictEqual(r.items.length, 0);
  });

  it('passes through unchanged when not provided', async () => {
    const cqs = makeServiceWith(ITEMS);
    const r = await cqs.search({ text: 'a' });
    assert.strictEqual(r.items.length, 4);
  });
});

describe('ContentQueryService — includeMediaTypes', () => {
  it('keeps only items in the allowlist', async () => {
    const cqs = makeServiceWith(ITEMS);
    const r = await cqs.search({ text: 'a', includeMediaTypes: ['track'] });
    assert.strictEqual(r.items.length, 2);
    assert.ok(r.items.every(i => i.mediaType === 'track'));
  });

  it('drops items with no typed field when allowlist is set', async () => {
    const items = [
      { id: 'fake:1', source: 'fake', title: 'typed', mediaType: 'track' },
      { id: 'fake:2', source: 'fake', title: 'untyped' },
    ];
    const cqs = makeServiceWith(items);
    const r = await cqs.search({ text: 'a', includeMediaTypes: ['track'] });
    assert.strictEqual(r.items.length, 1);
    assert.strictEqual(r.items[0].id, 'fake:1');
  });
});

describe('ContentQueryService — rank.factors', () => {
  it('reorders items by weighted factor descending', async () => {
    const cqs = makeServiceWith(ITEMS);
    const r = await cqs.search({
      text: 'a',
      excludeMediaTypes: ['image', 'video'],
      rank: {
        factors: [
          { field: 'metadata.userRating', weight: 1.0, normalize: 'div:10' },
        ],
      },
    });
    // userRating: A song=8, Another track=2 → A song should rank first
    assert.strictEqual(r.items[0].title, 'A song');
    assert.strictEqual(r.items[1].title, 'Another track');
  });

  it('combines multiple factors with weights', async () => {
    const cqs = makeServiceWith(ITEMS);
    const r = await cqs.search({
      text: 'a',
      excludeMediaTypes: ['image', 'video'],
      rank: {
        factors: [
          { field: 'metadata.userRating', weight: 0.7, normalize: 'div:10' },
          { field: 'metadata.viewCount',  weight: 0.3, normalize: 'log10:1000' },
        ],
      },
    });
    // A song: 0.7*0.8 + 0.3*log10(51)/log10(1001) ≈ 0.56 + 0.3*0.246 ≈ 0.634
    // Another track: 0.7*0.2 + 0.3*log10(201)/log10(1001) ≈ 0.14 + 0.3*0.766 ≈ 0.370
    assert.strictEqual(r.items[0].title, 'A song');
  });

  it('preserves original order for items with equal scores (stable)', async () => {
    const items = [
      { id: 'fake:1', source: 'fake', title: 'first', mediaType: 'track', metadata: {} },
      { id: 'fake:2', source: 'fake', title: 'second', mediaType: 'track', metadata: {} },
    ];
    const cqs = makeServiceWith(items);
    const r = await cqs.search({
      text: 'a',
      rank: { factors: [{ field: 'metadata.userRating', weight: 1, normalize: 'div:10' }] },
    });
    // Both have score 0 — should keep original order
    assert.strictEqual(r.items[0].title, 'first');
    assert.strictEqual(r.items[1].title, 'second');
  });

  it('treats missing fields as 0 contribution (does not crash)', async () => {
    const items = [
      { id: 'fake:1', source: 'fake', title: 'rated', mediaType: 'track', metadata: { userRating: 9 } },
      { id: 'fake:2', source: 'fake', title: 'unrated', mediaType: 'track' },
    ];
    const cqs = makeServiceWith(items);
    const r = await cqs.search({
      text: 'a',
      rank: { factors: [{ field: 'metadata.userRating', weight: 1, normalize: 'div:10' }] },
    });
    assert.strictEqual(r.items[0].title, 'rated');
  });

  it('is a no-op when factors is empty', async () => {
    const cqs = makeServiceWith(ITEMS);
    const r = await cqs.search({ text: 'a', rank: { factors: [] } });
    assert.strictEqual(r.items.length, 4);
  });
});
