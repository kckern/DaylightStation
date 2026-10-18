import { describe, it, expect } from 'vitest';
import { isEligible, selectAmbianceArtwork } from '../../../__app_modules/media/art/server/domain/ambiancePolicy.mjs';

const policy = { excludedSeasons: ['christmas', 'nativity'], maxEnergy: 1, maxIntensity: 2, minScore: 3, fallbackArtIds: ['neutral'] };
const record = (changes = {}) => ({
  themes: ['comfort'], subjects: [], narratives: [], symbols: [], moods: ['contemplative'],
  energy: 0, intensity: 1, seasons: [],
  review: { status: 'approved', profiles: ['quiet'], reviewer: 'curator', reviewedAt: '2026-01-01', confidence: 0.95, reason: 'Reviewed actual asset', evidence: [{ kind: 'visual', path: 'fixture.jpg' }] },
  ...changes,
});
const select = (changes = {}) => selectAmbianceArtwork({
  track: record({ id: 'plex:101' }), artworks: { good: record() }, profileKey: 'quiet', policy,
  random: () => 0, ...changes,
});

describe('ambiance eligibility', () => {
  it('admits a reviewed compatible item', () => expect(isEligible(record(), 'quiet', policy)).toBe(true));
  it.each([
    ['unreviewed', { review: undefined }],
    ['held', { review: { ...record().review, status: 'hold' } }],
    ['excluded', { review: { ...record().review, status: 'excluded' } }],
    ['other profile', { review: { ...record().review, profiles: ['holiday'] } }],
    ['no evidence', { review: { ...record().review, evidence: [] } }],
    ['Christmas in any folder', { seasons: ['Christmas'] }],
    ['Nativity', { seasons: ['nativity'] }],
    ['unknown season', { seasons: undefined }],
    ['high energy', { energy: 3 }],
    ['graphic intensity', { intensity: 3 }],
    ['missing energy', { energy: undefined }],
  ])('rejects %s', (_, changes) => expect(isEligible(record(changes), 'quiet', policy)).toBe(false));
  it('allows restrained sorrow independently of low energy', () => expect(isEligible(record({ moods: ['solemn'], energy: 0, intensity: 2 }), 'quiet', policy)).toBe(true));
});

describe('ambiance matching', () => {
  it.each(['photograph', 'unknown', undefined])('rejects %s when a profile permits only painted or drawn art', (mediumKind) => {
    expect(select({ policy: { ...policy, allowedMedia: ['painting', 'drawing', 'watercolor', 'digital-painting'] }, artworks: { photo: record({ mediumKind }) } })).toBeNull();
  });
  it('allows a reviewed painting while the media rule leaves music eligibility intact', () => {
    expect(select({ policy: { ...policy, allowedMedia: ['painting'] }, artworks: { painted: record({ mediumKind: 'painting' }) } })).toMatchObject({ artId: 'painted' });
  });
  it('selects shared spiritual themes with a reason', () => {
    expect(select()).toMatchObject({ artId: 'good', kind: 'matched' });
    expect(select().reasons).toContain('themes:comfort');
  });
  it('prefers a direct narrative over generic mood', () => {
    const out = select({ track: record({ id: 'plex:101', narratives: ['healing'] }), artworks: { generic: record({ themes: [], moods: ['contemplative'] }), scene: record({ narratives: ['healing'] }) } });
    expect(out.artId).toBe('scene');
  });
  it('rejects an unapproved or seasonal track before art matching', () => {
    expect(select({ track: record({ seasons: ['christmas'] }) })).toBeNull();
    expect(select({ track: record({ review: undefined }) })).toBeNull();
  });
  it('applies recent history only among relevant eligible choices', () => {
    const artworks = { good: record(), alternative: record(), unrelated: record({ themes: ['creation'], moods: [] }) };
    expect(select({ artworks, recentIds: ['good'] }).artId).toBe('alternative');
    expect(select({ artworks: { good: record() }, recentIds: ['good'] }).artId).toBe('good');
  });
  it('uses random variation among good matches', () => expect(select({ artworks: { a: record(), b: record() }, random: () => 0.99 }).artId).toBe('b'));
  it('does not manufacture emotional contrast from theme overlap', () => {
    expect(select({ track: record({ intensity: 0 }), artworks: { heavy: record({ intensity: 2 }) } })).toBeNull();
  });
  it('supports explicit contrast without bypassing eligibility', () => {
    const options = { track: record({ id: 'plex:101', intensity: 0 }), artworks: { heavy: record({ intensity: 2 }) }, overrides: { 'plex:101': ['heavy'] } };
    expect(select(options)).toMatchObject({ artId: 'heavy', kind: 'override' });
    expect(select({ ...options, artworks: { heavy: record({ seasons: ['christmas'] }) } })).toBeNull();
  });
  it('uses only an explicitly approved compatible fallback', () => {
    const artworks = { neutral: record({ themes: [], moods: ['peaceful'] }), unreviewed: record({ review: undefined }) };
    expect(select({ artworks })).toMatchObject({ artId: 'neutral', kind: 'fallback' });
    expect(select({ artworks: { neutral: record({ seasons: ['nativity'] }) } })).toBeNull();
  });
  it('returns neutral when no safe artwork exists', () => expect(select({ artworks: {} })).toBeNull());
});
