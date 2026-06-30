import { describe, it, expect } from 'vitest';
import { excludeReferenceUnits, isRecent, rankAndCapUsers } from './courseProgress.mjs';

describe('excludeReferenceUnits', () => {
  const items = [
    { plex: '1', parentId: '10', parentTitle: 'Unit 1', label: 'Lesson A' },
    { plex: '2', parentId: '99', parentTitle: 'Practice Guide', label: 'Drill' },
    { plex: '3', parentId: '10', parentTitle: 'Unit 1', label: '30-Day Challenge intro' },
  ];

  it('returns items unchanged when no rule matches the course', () => {
    expect(excludeReferenceUnits(items, 'plex:777', [{ courseId: 'plex:000', titlePatterns: ['Practice'] }]))
      .toHaveLength(3);
  });

  it('drops items whose parentTitle/label matches a titlePattern (case-insensitive)', () => {
    const refs = [{ courseId: 'plex:777', titlePatterns: ['Practice Guide', '30-Day Challenge'] }];
    const kept = excludeReferenceUnits(items, '777', refs); // courseId matched ignoring plex: prefix
    expect(kept.map((i) => i.plex)).toEqual(['1']);
  });

  it('drops items whose parentId is in unitIds', () => {
    const refs = [{ courseId: 'plex:777', unitIds: ['99'] }];
    const kept = excludeReferenceUnits(items, 'plex:777', refs);
    expect(kept.map((i) => i.plex)).toEqual(['1', '3']);
  });
});

describe('isRecent', () => {
  const now = new Date('2026-06-30T12:00:00Z');
  it('true when lastPlayed is within the window', () => {
    expect(isRecent('2026-06-28T00:00:00Z', 7, now)).toBe(true);
  });
  it('false when lastPlayed is older than the window', () => {
    expect(isRecent('2026-06-01T00:00:00Z', 7, now)).toBe(false);
  });
  it('false for a null/absent timestamp', () => {
    expect(isRecent(null, 7, now)).toBe(false);
  });
});

describe('rankAndCapUsers', () => {
  it('sorts by completed desc, then most-recent, and caps the count', () => {
    const users = [
      { id: 'a', completed: 3, lastPlayedAt: '2026-06-20' },
      { id: 'b', completed: 8, lastPlayedAt: '2026-06-10' },
      { id: 'c', completed: 8, lastPlayedAt: '2026-06-29' },
      { id: 'd', completed: 1, lastPlayedAt: '2026-06-28' },
    ];
    const ranked = rankAndCapUsers(users, 3);
    expect(ranked.map((u) => u.id)).toEqual(['c', 'b', 'a']); // c & b tie on 8 → c more recent; d capped out
  });
});
