import { describe, expect, it } from 'vitest';
import {
  SOURCE_STATE,
  classifyPlexParts,
  composeSourceUnreadablePush,
  parsePlexRatingKey,
} from './sourceHealth.mjs';
import { findPushTextDefects } from '../notification/push/pushText.mjs';

describe('parsePlexRatingKey', () => {
  it('accepts prefixed and bare rating keys', () => {
    expect(parsePlexRatingKey('plex:696316')).toBe('696316');
    expect(parsePlexRatingKey('696316')).toBe('696316');
  });

  it('rejects anything that is not a Plex rating key', () => {
    expect(parsePlexRatingKey('immich:abc')).toBeNull();
    expect(parsePlexRatingKey('plex:')).toBeNull();
    expect(parsePlexRatingKey(null)).toBeNull();
    expect(parsePlexRatingKey('plex:1/../2')).toBeNull();
  });
});

describe('classifyPlexParts', () => {
  it('reads the 2026-09-28 shape — present but not accessible — as unreadable', () => {
    const part = { id: 762015, file: '/data/media/video/fitness/x.mp4', exists: true, accessible: false };
    expect(classifyPlexParts([part])).toEqual({ state: SOURCE_STATE.unreadable, part });
  });

  it('is readable only when every part is accessible', () => {
    expect(classifyPlexParts([{ exists: true, accessible: true }]).state).toBe(SOURCE_STATE.readable);
    expect(classifyPlexParts([
      { exists: true, accessible: true },
      { exists: true, accessible: false },
    ]).state).toBe(SOURCE_STATE.unreadable);
  });

  it('reports a deleted file as missing, which outranks unreadable', () => {
    expect(classifyPlexParts([
      { exists: true, accessible: false },
      { exists: false, accessible: false },
    ]).state).toBe(SOURCE_STATE.missing);
  });

  it('is unknown when Plex says nothing about accessibility', () => {
    expect(classifyPlexParts([{ id: 1 }]).state).toBe(SOURCE_STATE.unknown);
    expect(classifyPlexParts([]).state).toBe(SOURCE_STATE.unknown);
    expect(classifyPlexParts(undefined).state).toBe(SOURCE_STATE.unknown);
  });
});

describe('composeSourceUnreadablePush', () => {
  it('names the video and the show, in minutes, with no ids', () => {
    const push = composeSourceUnreadablePush({ title: 'Back 1', showTitle: 'Max Built', unreadableMs: 125_000 });
    expect(push.title).toBe('A video won\'t open');
    expect(push.body).toContain('"Back 1" (Max Built)');
    expect(push.body).toContain('for 2 min');
    expect(findPushTextDefects(push.title)).toEqual([]);
    expect(findPushTextDefects(push.body)).toEqual([]);
  });

  it('still reads when the title is unknown', () => {
    const push = composeSourceUnreadablePush({ title: null, unreadableMs: 0 });
    expect(push.body).toContain('read a video from the NAS for 1 min');
    expect(findPushTextDefects(push.body)).toEqual([]);
  });
});
