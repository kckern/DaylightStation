// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  continueCandidates, continueSettings, isLongFormAudio, judgeContinueGroup, isLegacyRecord,
} from './continueListening.mjs';

const NOW = Date.parse('2026-11-26T12:00:00Z');
const rec = (contentId, over = {}) => ({
  contentId, playhead: 600, duration: 3000, lastPlayed: '2026-11-26T10:00:00Z', listenedSec: 600, ...over,
});
const parts = [1, 2, 3, 4, 5].map((n) => ({ id: `plex:10${n}`, title: `Part ${n}`, duration: 3000 }));
const display = { title: 'Part 2', parentTitle: 'Henry VI Part 3', grandparentTitle: 'William Shakespeare', type: 'track', thumbnail: '/t/2' };
const judge = (over) => judgeContinueGroup({
  groupId: 'plex:100', current: rec('plex:102'), display, parts, parent: { title: 'Henry VI Part 3', thumbnail: '/t/book' },
  groupRecords: [rec('plex:101', { playhead: 3000, listenedSec: 2900 }), rec('plex:102')],
  minListenedSec: 300, kind: 'books', ...over,
});

describe('continue listening — the threshold', () => {
  it('defaults to 5 minutes and 90 days', () => {
    expect(continueSettings(undefined)).toEqual({ minListenedMin: 5, unplayedDays: 90 });
    expect(continueSettings({ minListenedMin: 10 }).minListenedMin).toBe(10);
  });

  it('a seek to the middle with under 5 minutes heard never qualifies', () => {
    const out = judgeContinueGroup({
      groupId: 'plex:200', current: rec('plex:200', { playhead: 4000, duration: 10000, listenedSec: 12 }),
      display: { title: 'Snakes', type: 'track' }, groupRecords: [rec('plex:200', { playhead: 4000, duration: 10000, listenedSec: 12 })],
      minListenedSec: 300,
    });
    expect(out).toEqual({ status: 'out', reason: 'not-listened' });
  });

  it('5 minutes heard in total qualifies, summed across the parts', () => {
    const out = judge({ groupRecords: [rec('plex:101', { playhead: 3000, listenedSec: 200 }), rec('plex:102', { listenedSec: 120 })] });
    expect(out.status).toBe('qualified');
    expect(out.row.listenedSec).toBe(320);
  });
});

describe('continue listening — one row per book', () => {
  it('collapses parts into their book, showing the current part', () => {
    const { row } = judge();
    expect(row).toMatchObject({
      contentId: 'plex:100', playContentId: 'plex:102', title: 'Henry VI Part 3', byline: 'William Shakespeare',
      thumbnail: '/t/book', partTitle: 'Part 2', partIndex: 2, partCount: 5, playhead: 600, duration: 3000, legacy: false,
    });
    // 2400 left in part 2 + three more parts of 3000
    expect(row.remainingSec).toBe(2400 + 9000);
  });

  it('a standalone item is its own row', () => {
    const r = rec('plex:300', { duration: 4000 });
    const { row } = judgeContinueGroup({
      groupId: 'plex:300', current: r, display: { title: 'A talk', parentTitle: 'Series', type: 'audiobook' }, groupRecords: [r], minListenedSec: 300,
    });
    expect(row).toMatchObject({ contentId: 'plex:300', playContentId: 'plex:300', title: 'A talk', partTitle: null, partIndex: null, partCount: null, remainingSec: 3400 });
  });
});

describe('continue listening — leaving', () => {
  it('a book with every part finished leaves', () => {
    const done = parts.map((p) => rec(p.id, { playhead: 3000 }));
    expect(judge({ groupRecords: done }).status).toBe('out');
  });

  it('a book marked finished after its last play leaves at once', () => {
    const marked = rec('plex:100', { playhead: 9000, duration: 9000, completedAt: '2026-11-26T11:00:00Z', lastPlayed: null });
    expect(judge({ groupRecords: [rec('plex:102'), marked] })).toEqual({ status: 'out', reason: 'finished' });
  });

  it('a book removed from Continue leaves; played again after, it comes back', () => {
    expect(judge({ removed: { 'plex:100': { removedAt: '2026-11-26T11:00:00Z' } } }).status).toBe('out');
    expect(judge({ removed: { 'plex:100': { removedAt: '2026-11-26T09:00:00Z' } } }).status).toBe('qualified');
  });

  it('candidates leave out finished, removed and 90-day-old items', () => {
    const records = [
      rec('plex:1'),
      rec('plex:2', { playhead: 3000 }),
      rec('plex:3', { lastPlayed: '2026-08-01T10:00:00Z' }),
      rec('plex:4'),
      rec('plex:5', { playhead: 0 }),
    ];
    const ids = continueCandidates(records, { removed: { 'plex:4': { removedAt: '2026-11-26T11:00:00Z' } }, nowEpoch: NOW }).map((r) => r.contentId);
    expect(ids).toEqual(['plex:1']);
  });
});

describe('continue listening — legacy entries', () => {
  const legacy = (over) => rec('plex:102', { listenedSec: undefined, ...over });

  it('progress with no listened time is legacy; a measured record is not', () => {
    expect(isLegacyRecord(legacy())).toBe(true);
    expect(isLegacyRecord(rec('plex:1'))).toBe(false);
    expect(isLegacyRecord(rec('plex:1', { listenedSec: 30, listenLegacy: true }))).toBe(true);
  });

  it('undecided, a legacy book stays in the answer flagged legacy', () => {
    const out = judge({ current: legacy(), groupRecords: [legacy()] });
    expect(out.status).toBe('legacy');
    expect(out.row.legacy).toBe(true);
  });

  it('Keep makes it a normal entry; Clear takes it out', () => {
    expect(judge({ current: legacy(), groupRecords: [legacy()], decisions: { 'plex:100': { decision: 'keep' } } }).status).toBe('qualified');
    expect(judge({ current: legacy(), groupRecords: [legacy()], decisions: { 'plex:100': { decision: 'clear' } } }))
      .toEqual({ status: 'out', reason: 'cleared' });
  });

  it('a cleared book heard for 5 minutes again comes back on its own', () => {
    const heard = legacy({ listenedSec: 400, listenLegacy: true });
    expect(judge({ current: heard, groupRecords: [heard], decisions: { 'plex:100': { decision: 'clear' } } }).status).toBe('qualified');
  });
});

describe('continue listening — what is long audio', () => {
  it('books and talks always; music never; unknown audio by length', () => {
    expect(isLongFormAudio({ type: 'track', duration: 60 }, 'books')).toBe(true);
    expect(isLongFormAudio({ type: 'track', duration: 3600 }, 'music')).toBe(false);
    expect(isLongFormAudio({ type: 'track', duration: 3600 }, null)).toBe(true);
    expect(isLongFormAudio({ type: 'track', duration: 300 }, null)).toBe(false);
    expect(isLongFormAudio({ type: 'episode', duration: 3600 }, null)).toBe(false);
  });
});
