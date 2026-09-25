import { describe, it, expect } from 'vitest';
import { buildSuggestionPlayItem } from './buildSuggestionPlayItem.js';

// The resume card that launched with no seek frames and no resume on 2026-09-25.
const resumeCard = {
  type: 'resume',
  action: 'play',
  contentId: 'plex:674290',
  showId: 'plex:603407',
  title: 'Sonic & Sega All Stars Racing',
  showTitle: 'Game Cycling',
  thumbnail: '/api/v1/proxy/plex/library/metadata/674290/thumb/1778967169',
  durationMinutes: 292,
  labels: ['kidsfun', 'resumable', 'sequential'],
  progress: { percent: 22, remaining: '226:59', playhead: 3886 },
  thumbId: 739161,
  parentId: 606444,
  parentTitle: 'Various Racing Games',
  grandparentTitle: 'Game Cycling',
  seasonImage: '/api/v1/proxy/plex/library/metadata/606444/thumb/1',
};

describe('buildSuggestionPlayItem', () => {
  it('carries thumbId so the footer can request timeline frames', () => {
    const item = buildSuggestionPlayItem(resumeCard);
    expect(item.thumbId).toBe(739161);
    expect(item.plex).toBe('674290');
    expect(item.contentId).toBe('plex:674290');
  });

  it('carries the season and show context the show screen would', () => {
    const item = buildSuggestionPlayItem(resumeCard);
    expect(item.parentId).toBe(606444);
    expect(item.season).toBe('Various Racing Games');
    expect(item.grandparentTitle).toBe('Game Cycling');
    expect(item.showId).toBe('603407');
    expect(item.seasonImage).toContain('library/metadata/606444/thumb/1');
  });

  it('resumes from the card playhead under a field the player reads', () => {
    const item = buildSuggestionPlayItem(resumeCard);
    expect(item.seconds).toBe(3886);
    expect(item.watchProgress).toBe(22);
  });

  it('gives the player duration in seconds, not minutes', () => {
    expect(buildSuggestionPlayItem(resumeCard).duration).toBe(292 * 60);
  });

  it('omits resume fields for a card with no progress', () => {
    const { progress, ...nextUp } = resumeCard;
    const item = buildSuggestionPlayItem({ ...nextUp, type: 'next_up' });
    expect(item.seconds).toBeUndefined();
    expect(item.watchSeconds).toBeUndefined();
  });

  it('still launches a card that predates the launch fields', () => {
    const item = buildSuggestionPlayItem({ contentId: 'plex:696316', showId: 'plex:696310', title: 'Back 1', durationMinutes: 38 });
    expect(item.id).toBe('696316');
    expect(item.thumbId).toBeUndefined();
    expect(item.videoUrl).toContain('api/v1/play/plex/696316');
  });
});
