import { describe, it, expect } from 'vitest';
import { SOURCE_LABELS, sourceLabel, sourceLabelList } from './sourceLabels.js';

describe('sourceLabel', () => {
  it('maps every known source id to a friendly label', () => {
    expect(sourceLabel('plex')).toBe('Movies & TV');
    expect(sourceLabel('abs')).toBe('Audiobooks');
    expect(sourceLabel('singalong')).toBe('Sing-along');
    expect(sourceLabel('files')).toBe('Local files');
    expect(sourceLabel('freshvideo')).toBe('Fresh videos');
    expect(sourceLabel('immich')).toBe('Photos');
    expect(sourceLabel('youtube')).toBe('YouTube');
    expect(sourceLabel('readalong')).toBe('Read-along');
    expect(sourceLabel('retroarch')).toBe('Games');
    expect(sourceLabel('app')).toBe('Apps');
    expect(sourceLabel('canvas-filesystem')).toBe('Art');
    expect(sourceLabel('art')).toBe('Art');
    expect(sourceLabel('list')).toBe('Lists');
    expect(sourceLabel('query')).toBe('Saved searches');
    expect(sourceLabel('local-content')).toBe('Local library');
    expect(sourceLabel('stream')).toBe('Streams');
  });

  it('falls back to the base id for suffixed sources', () => {
    expect(sourceLabel('plex-main')).toBe('Movies & TV');
  });

  it('prettifies unknown ids instead of leaking raw slugs', () => {
    expect(sourceLabel('some-new-source')).toBe('Some new source');
  });

  it('returns null for empty input', () => {
    expect(sourceLabel('')).toBeNull();
    expect(sourceLabel(null)).toBeNull();
  });

  it('has a friendly label for every entry in the map', () => {
    for (const key of Object.keys(SOURCE_LABELS)) {
      expect(sourceLabel(key)).toBe(SOURCE_LABELS[key]);
    }
  });
});

describe('sourceLabelList', () => {
  it('dedupes labels that map to the same friendly name', () => {
    expect(sourceLabelList(['canvas-filesystem', 'art', 'plex'])).toEqual(['Art', 'Movies & TV']);
  });

  it('preserves order and skips empties', () => {
    expect(sourceLabelList(['abs', null, 'plex'])).toEqual(['Audiobooks', 'Movies & TV']);
  });
});
