// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { normalizeActiveRenditionId, validateCapacity, validateClient, validateEvidence, validateObservation, validateRendition, validateRecoveryLedger } from './contracts.mjs';
import { client, observation, original } from '../../../../../tests/fixtures/adaptive-playback/policyCases.mjs';

describe('playback contracts', () => {
  it('copies accepted normalized facts without mutating their caller-owned values', () => {
    const rendition = validateRendition(original);
    const profile = validateClient(client);
    expect(rendition).toEqual(original);
    expect(rendition).not.toBe(original);
    expect(profile.supportedCodecs.map(item => item.codec)).toEqual(['h264', 'aac']);
    expect(profile.supportedCodecs).not.toBe(client.supportedCodecs);
  });

  it('rejects malformed identity and impossible recovery counters', () => {
    expect(() => validateRendition({ ...original, renditionId: '' })).toThrow('renditionId');
    expect(() => validateClient({ ...client, profileKey: null })).toThrow('profileKey');
    expect(() => validateRecoveryLedger({ incidentCount: -1, replacementTimes: [], healthySince: null, lastReplacementAt: null })).toThrow('incidentCount');
  });

  it('rejects missing contract fields and provider-shaped extras at every boundary', () => {
    expect(() => validateClient({ ...client, renderer: undefined })).toThrow('renderer');
    expect(() => validateClient({ ...client, supportedProfiles: { h264: ['high'] } })).toThrow('unsupported field');
    expect(() => validateRendition({ ...original, trackSelection: undefined })).toThrow('trackSelection');
    expect(() => validateRendition({ ...original, providerPath: '/private/media' })).toThrow('unsupported field');
    expect(() => validateEvidence({ readiness: [{ renditionId: 'original-h264', sourceRevision: 'revision-1', profileKey: 'living-room-browser', status: 'validated', observedAt: 'now' }] })).toThrow('observedAt');
    expect(() => validateCapacity({ availableUnits: 1, probeAvailable: true, providerQuota: 1 })).toThrow('unsupported field');
    expect(() => validateObservation({ ...observation(), cpuPercent: 100 })).toThrow('unsupported field');
  });

  it('normalizes only a non-empty provider-neutral active rendition identity', () => {
    expect(normalizeActiveRenditionId('active-h264')).toBe('active-h264');
    expect(normalizeActiveRenditionId('')).toBeNull();
    expect(normalizeActiveRenditionId({ renditionId: 'active-h264' })).toBeNull();
  });
});
