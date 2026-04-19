import { describe, it, expect } from 'vitest';
import { resolveDisplayItems } from '#frontend/modules/Admin/ContentLists/contentSearchLogic.js';

describe('resolveDisplayItems', () => {
  const browseItems = [
    { value: 'singalong:hymn/193', title: 'I Stand All Amazed' },
    { value: 'singalong:hymn/194', title: 'There Is a Green Hill Far Away' },
    { value: 'singalong:hymn/195', title: 'How Great Thou Art' },
  ];
  const searchResults = [
    { value: 'singalong:hymn/136', title: 'I Know That My Redeemer Lives' },
  ];

  it('returns browseItems when not actively searching', () => {
    const out = resolveDisplayItems({
      isActiveSearch: false,
      searchQuery: '',
      sourcePrefix: 'singalong',
      browseItems,
      searchResults: [],
    });
    expect(out.items).toBe(browseItems);
    expect(out.mode).toBe('browse');
  });

  it('prefers backend searchResults when available', () => {
    const out = resolveDisplayItems({
      isActiveSearch: true,
      searchQuery: 'singalong:redeemer',
      sourcePrefix: 'singalong',
      browseItems,
      searchResults,
    });
    expect(out.items).toBe(searchResults);
    expect(out.mode).toBe('backend');
  });

  it('falls back to local filter when backend has no results yet', () => {
    const out = resolveDisplayItems({
      isActiveSearch: true,
      searchQuery: 'singalong:amazed',
      sourcePrefix: 'singalong',
      browseItems,
      searchResults: [],
    });
    expect(out.mode).toBe('local');
    expect(out.items).toHaveLength(1);
    expect(out.items[0].title).toBe('I Stand All Amazed');
  });

  it('returns empty list when neither backend nor local match', () => {
    const out = resolveDisplayItems({
      isActiveSearch: true,
      searchQuery: 'singalong:redeemer',
      sourcePrefix: 'singalong',
      browseItems,
      searchResults: [],
    });
    expect(out.items).toEqual([]);
    expect(out.mode).toBe('local');
  });

  it('returns empty array when no query prefix match and backend empty', () => {
    const out = resolveDisplayItems({
      isActiveSearch: true,
      searchQuery: 'redeemer',
      sourcePrefix: 'singalong',
      browseItems,
      searchResults: [],
    });
    expect(out.items).toEqual([]);
    expect(out.mode).toBe('backend');
  });

  it('filters by item number prefix', () => {
    const out = resolveDisplayItems({
      isActiveSearch: true,
      searchQuery: 'singalong:hymn/19',
      sourcePrefix: 'singalong',
      browseItems,
      searchResults: [],
    });
    expect(out.items.map(i => i.value)).toEqual([
      'singalong:hymn/193', 'singalong:hymn/194', 'singalong:hymn/195'
    ]);
  });
});
