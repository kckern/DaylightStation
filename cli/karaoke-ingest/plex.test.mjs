import { describe, it, expect } from 'vitest';
import { buildScanUrl } from './plex.mjs';

describe('buildScanUrl', () => {
  it('builds the section refresh URL with the token', () => {
    const url = buildScanUrl({ host: 'http://localhost:32400', sectionId: '3', token: 'TKN' });
    expect(url).toBe('http://localhost:32400/library/sections/3/refresh?X-Plex-Token=TKN');
  });
  it('adds an encoded forcePath when provided', () => {
    const url = buildScanUrl({ host: 'http://localhost:32400', sectionId: '3', token: 'TKN', forcePath: '/media/Slow TV/Karaoke' });
    expect(url).toContain('path=%2Fmedia%2FSlow+TV%2FKaraoke');
  });
});
