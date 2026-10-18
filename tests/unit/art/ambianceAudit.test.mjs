import { describe, it, expect } from 'vitest';
import { auditAmbiance } from '../../../__app_modules/media/art/cli/ambianceAudit.mjs';

const reviewed = (extra = {}) => ({
  themes: ['peace'], energy: 1, intensity: 1, seasons: [], mediumKind: 'painting',
  review: { status: 'approved', profiles: ['quiet'], reviewer: 'curator', reviewedAt: '2026-01-01', reason: 'Reviewed', evidence: [{ kind: 'visual', path: 'evidence' }] }, ...extra,
});
const catalog = () => ({ version: 1, profiles: { quiet: { maxEnergy: 1, maxIntensity: 2, excludedSeasons: ['christmas'], allowedMedia: ['painting'], fallbackArtIds: ['sacred/peace'] } }, tracks: { 'plex:101': reviewed() }, artworks: { 'sacred/peace': reviewed() }, pairings: {} });

describe('ambiance publication audit', () => {
  it('reports semantic coverage for individually approved playlist recordings', () => {
    const result = auditAmbiance({ catalog: catalog(), profile: 'quiet', trackIds: ['plex:101'], artIds: ['sacred/peace'] });
    expect(result.ok).toBe(true);
    expect(result.coverage).toEqual([{ trackId: 'plex:101', kind: 'semantic', artId: 'sacred/peace' }]);
  });
  it('rejects playlist drift and reports approved recordings absent from the playlist', () => {
    const result = auditAmbiance({ catalog: catalog(), profile: 'quiet', trackIds: ['plex:999'], artIds: ['sacred/peace'] });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'unapproved-track', id: 'plex:999' }),
      expect.objectContaining({ kind: 'missing-track', id: 'plex:101' }),
    ]));
  });
  it('reports missing art and neutral coverage without widening the pool', () => {
    const result = auditAmbiance({ catalog: catalog(), profile: 'quiet', trackIds: ['plex:101'], artIds: [] });
    expect(result.ok).toBe(false);
    expect(result.issues).toContainEqual({ kind: 'missing-art', id: 'sacred/peace' });
    expect(result.coverage).toEqual([{ trackId: 'plex:101', kind: 'neutral', artId: null }]);
  });
  it('rejects seasonal contamination even when the review says approved', () => {
    const data = catalog();
    data.tracks['plex:101'].seasons = ['Christmas'];
    data.artworks['sacred/peace'].seasons = ['christmas'];
    const result = auditAmbiance({ catalog: data, profile: 'quiet', trackIds: ['plex:101'], artIds: ['sacred/peace'] });
    expect(result.ok).toBe(false);
    expect(result.issues).toEqual(expect.arrayContaining([
      { kind: 'ineligible-approval', type: 'track', id: 'plex:101' },
      { kind: 'ineligible-approval', type: 'artwork', id: 'sacred/peace' },
    ]));
  });
  it('distinguishes a safe fallback from a meaningful match', () => {
    const data = catalog();
    data.tracks['plex:101'].themes = ['hope'];
    const result = auditAmbiance({ catalog: data, profile: 'quiet', trackIds: ['plex:101'], artIds: ['sacred/peace'] });
    expect(result.ok).toBe(true);
    expect(result.coverage[0].kind).toBe('fallback');
  });
  it('fails closed for an unknown profile or unsupported catalog', () => {
    expect(() => auditAmbiance({ catalog: { ...catalog(), version: 2 }, profile: 'quiet', trackIds: [], artIds: [] })).toThrow(/catalog/i);
    expect(() => auditAmbiance({ catalog: catalog(), profile: 'absent', trackIds: [], artIds: [] })).toThrow(/profile/i);
  });
});
