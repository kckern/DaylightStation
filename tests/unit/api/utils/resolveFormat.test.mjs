// tests/unit/api/utils/resolveFormat.test.mjs
import { describe, it, expect } from 'vitest';
import { resolveFormat } from '#api/v1/utils/resolveFormat.mjs';

describe('resolveFormat', () => {
  it('returns item.metadata.contentFormat when present (highest priority)', () => {
    const item = { metadata: { contentFormat: 'singalong' }, mediaType: 'audio' };
    const adapter = { contentFormat: 'readalong' };
    expect(resolveFormat(item, adapter)).toBe('singalong');
  });

  it('returns adapter.contentFormat when item has no metadata override', () => {
    const item = { metadata: {}, mediaType: 'audio' };
    const adapter = { contentFormat: 'readalong' };
    expect(resolveFormat(item, adapter)).toBe('readalong');
  });

  it('returns item.mediaType when no contentFormat from item or adapter', () => {
    const item = { metadata: {}, mediaType: 'audio' };
    const adapter = {};
    expect(resolveFormat(item, adapter)).toBe('audio');
  });

  it('falls back to video when nothing else is set', () => {
    const item = { metadata: {} };
    expect(resolveFormat(item, {})).toBe('video');
  });

  it('handles null adapter gracefully', () => {
    const item = { mediaType: 'audio' };
    expect(resolveFormat(item, null)).toBe('audio');
  });

  it('handles undefined adapter gracefully', () => {
    const item = { metadata: { contentFormat: 'app' } };
    expect(resolveFormat(item)).toBe('app');
  });

  it('handles item with no metadata property', () => {
    const item = { mediaType: 'video' };
    expect(resolveFormat(item, {})).toBe('video');
  });

  it('prefers metadata over all other sources', () => {
    const item = { metadata: { contentFormat: 'app' }, mediaType: 'video' };
    const adapter = { contentFormat: 'singalong' };
    expect(resolveFormat(item, adapter)).toBe('app');
  });

  it('handles empty item with fallback', () => {
    expect(resolveFormat({}, {})).toBe('video');
  });
});
