import { describe, it, expect } from 'vitest';
import { displayTitle, resultSubtitle, formatDuration } from './resultPresentation.js';

describe('resultSubtitle', () => {
  it('renders library section + type + duration for a music album', () => {
    const row = {
      id: 'plex:1', type: 'album', mediaType: 'audio', duration: 47 * 60,
      metadata: { librarySectionTitle: 'Music' },
    };
    expect(resultSubtitle(row)).toBe('Music · Album · 47 min');
  });

  it('renders singular section + episode count for a TV show', () => {
    const row = {
      id: 'plex:2', type: 'show', mediaType: 'video', childCount: 155,
      metadata: { librarySectionTitle: 'TV Shows' },
    };
    expect(resultSubtitle(row)).toBe('TV Show · 155 episodes');
  });

  it('collapses "Audiobooks" section + album type to just "Audiobook"', () => {
    const row = {
      id: 'plex:3', type: 'album', mediaType: 'audio',
      metadata: { librarySectionTitle: 'Audiobooks' },
    };
    expect(resultSubtitle(row)).toBe('Audiobook');
  });

  it('never contains the raw source id or raw slug separators', () => {
    const row = { id: 'plex:556671', type: 'album', source: 'plex', mediaType: 'audio' };
    const subtitle = resultSubtitle(row);
    expect(subtitle).not.toMatch(/plex/i);
    expect(subtitle).not.toContain('•');
  });

  it('falls back to a friendly source label when nothing else is known', () => {
    expect(resultSubtitle({ id: 'abs:99', source: 'abs' })).toBe('Audiobooks');
    expect(resultSubtitle({ id: 'plex:99' })).toBe('Movies & TV'); // derived from id prefix
  });

  it('formats hour-scale durations readably', () => {
    const row = { id: 'abs:1', type: 'audiobook', duration: 5 * 3600 + 12 * 60 };
    expect(resultSubtitle(row)).toBe('Audiobook · 5 hr 12 min');
  });
});

describe('displayTitle', () => {
  it('keeps human titles as-is', () => {
    expect(displayTitle({ title: 'Bluey (2018)' })).toBe('Bluey (2018)');
  });

  it('de-uglifies machine filenames (extension stripped, separators to spaces)', () => {
    expect(displayTitle({ title: '20240115_garage_workout-take2.mp4' }))
      .toBe('20240115 garage workout take2');
  });

  it('de-uglifies long space-less names', () => {
    expect(displayTitle({ title: 'some_really_long_machine_generated_name.mkv' }))
      .toBe('some really long machine generated name');
  });
});

describe('formatDuration', () => {
  it('handles minutes, hours, and invalid input', () => {
    expect(formatDuration(47 * 60)).toBe('47 min');
    expect(formatDuration(2 * 3600)).toBe('2 hr');
    expect(formatDuration(3600 + 60)).toBe('1 hr 1 min');
    expect(formatDuration(20)).toBe('1 min');
    expect(formatDuration(0)).toBeNull();
    expect(formatDuration(null)).toBeNull();
  });
});
