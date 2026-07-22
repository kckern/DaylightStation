/**
 * Datastore tests, focused on the path guards.
 *
 * Media is addressed by (corpus, seq, language) slug and resolved server-side —
 * a caller never supplies a filename. These assert that the resolvers refuse
 * anything that isn't that shape, so nothing can traverse out of the media
 * tree or mint a directory under an unknown user.
 */
import { describe, it, expect } from 'vitest';
import path from 'path';
import { YamlLanguageStudyDatastore, padSeq } from './YamlLanguageStudyDatastore.mjs';

const DATA = '/data';
const MEDIA = '/media';
const PROFILES = new Set(['kckern', 'elizabeth']);

const configService = {
  getDataDir: () => DATA,
  getMediaDir: () => MEDIA,
  getUserProfile: (id) => (PROFILES.has(id) ? { username: id } : undefined),
  getUserDir: (id) => path.join(DATA, 'users', id),
};

const ds = new YamlLanguageStudyDatastore({ configService });

describe('padSeq', () => {
  it('pads to four digits, matching the source assets', () => {
    expect(padSeq(1)).toBe('0001');
    expect(padSeq(3325)).toBe('3325');
  });
});

describe('constructor', () => {
  it('refuses to build without a configService', () => {
    expect(() => new YamlLanguageStudyDatastore({})).toThrow(/configService/);
  });
});

describe('resolveAudioPath', () => {
  it('builds the expected slug path', () => {
    expect(ds.resolveAudioPath('glossika-korean', 1, 'KR'))
      .toBe(path.join(MEDIA, 'apps/school/language/glossika-korean/0001-KR.mp3'));
  });

  it('upper-cases the language so casing cannot fork the filename', () => {
    expect(ds.resolveAudioPath('glossika-korean', 1, 'kr'))
      .toBe(ds.resolveAudioPath('glossika-korean', 1, 'KR'));
  });

  it('refuses a traversal attempt in any component', () => {
    expect(ds.resolveAudioPath('../../etc', 1, 'KR')).toBeNull();
    expect(ds.resolveAudioPath('glossika-korean', '../../etc/passwd', 'KR')).toBeNull();
    expect(ds.resolveAudioPath('glossika-korean', 1, '../../etc')).toBeNull();
  });

  it('refuses a non-numeric sequence and a malformed language', () => {
    expect(ds.resolveAudioPath('glossika-korean', 'abc', 'KR')).toBeNull();
    expect(ds.resolveAudioPath('glossika-korean', 1, 'K')).toBeNull();
    expect(ds.resolveAudioPath('glossika-korean', 1, 'TOOLONGLANG')).toBeNull();
  });
});

describe('resolveRecordingPath', () => {
  it('scopes a recording to its corpus and learner', () => {
    expect(ds.resolveRecordingPath('glossika-korean', 'kckern', 2, 'KR', 'webm'))
      .toBe(path.join(MEDIA, 'apps/school/language/glossika-korean/recordings/kckern/0002-KR.webm'));
  });

  it('refuses an unknown learner, so a typo cannot mint a directory tree', () => {
    expect(ds.resolveRecordingPath('glossika-korean', 'ghost', 2, 'KR')).toBeNull();
  });

  it('refuses a bogus extension', () => {
    expect(ds.resolveRecordingPath('glossika-korean', 'kckern', 2, 'KR', '../sh')).toBeNull();
    expect(ds.resolveRecordingPath('glossika-korean', 'kckern', 2, 'KR', 'wayoverlong')).toBeNull();
  });
});

describe('per-user paths', () => {
  it('returns nothing for an unknown learner rather than a path', () => {
    // Every per-user read/write funnels through the same guard.
    expect(ds.readProgress('ghost', 'glossika-korean')).toBeNull();
    expect(ds.writeProgress('ghost', 'glossika-korean', {})).toBeNull();
    expect(ds.appendEvent('ghost', 'glossika-korean', { at: '2026-07-21T00:00:00Z' })).toBeNull();
    expect(ds.readAllEvents('ghost', 'glossika-korean')).toEqual([]);
    expect(ds.readEventDay('ghost', 'glossika-korean', '2026-07-21')).toEqual([]);
    expect(ds.listRecordingKeys('glossika-korean', 'ghost').size).toBe(0);
  });

  it('refuses a malformed corpus id even for a real learner', () => {
    expect(ds.readProgress('kckern', '../../escape')).toBeNull();
  });

  it('rejects a malformed day shard instead of reading an arbitrary file', () => {
    expect(ds.readEventDay('kckern', 'glossika-korean', '../../secrets')).toEqual([]);
    expect(ds.readEventDay('kckern', 'glossika-korean', 'nonsense')).toEqual([]);
  });
});

describe('appendEvent', () => {
  it('refuses an event with no usable timestamp rather than guessing a shard', () => {
    // The shard comes from the event's own `at`, never the clock, so a
    // backfilled event lands in the day it actually happened.
    expect(() => ds.appendEvent('kckern', 'glossika-korean', { at: 'not-a-date' }))
      .toThrow(/timestamp/i);
  });
});
