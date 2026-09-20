// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { validateClient, validateRendition, validateRecoveryLedger } from './contracts.mjs';
import { client, original } from '../../../../../tests/fixtures/adaptive-playback/policyCases.mjs';

describe('playback contracts', () => {
  it('copies accepted normalized facts without mutating their caller-owned values', () => {
    const rendition = validateRendition(original);
    const profile = validateClient(client);
    expect(rendition).toEqual(original);
    expect(rendition).not.toBe(original);
    expect(profile.supportedCodecs).toEqual(['h264', 'aac']);
    expect(profile.supportedCodecs).not.toBe(client.supportedCodecs);
  });

  it('rejects malformed identity and impossible recovery counters', () => {
    expect(() => validateRendition({ ...original, renditionId: '' })).toThrow('renditionId');
    expect(() => validateClient({ ...client, profileKey: null })).toThrow('profileKey');
    expect(() => validateRecoveryLedger({ incidentCount: -1, replacementTimes: [], healthySince: null, lastReplacementAt: null })).toThrow('incidentCount');
  });
});
