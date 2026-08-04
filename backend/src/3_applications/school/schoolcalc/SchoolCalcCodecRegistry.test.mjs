import { describe, expect, it, vi } from 'vitest';
import { SchoolCalcCodecRegistry } from './SchoolCalcCodecRegistry.mjs';

function codec(platformId, recognizes = false) {
  return {
    platformId,
    describeCapabilities: vi.fn(), encodeDeviceIdentity: vi.fn(),
    recognizesDeviceIdentity: vi.fn(() => recognizes),
    decodeDeviceIdentity: vi.fn(() => ({ deviceId: 'D1', platformId })),
    encodeLearnerRoster: vi.fn(), encodeProgressProjection: vi.fn(),
    projectFollowUpKey: vi.fn(), decodeInteractionRequest: vi.fn(),
    encodeInteractionResponse: vi.fn(), encodeCatalog: vi.fn(),
    decodeDeliveryRequests: vi.fn(), supports: vi.fn(), compile: vi.fn(),
    decodeResult: vi.fn(() => ({ deviceId: 'D1' })),
    recognizesResult: vi.fn(() => recognizes), decodeResultQueue: vi.fn(),
    encodeAcknowledgements: vi.fn(), encodeSyncManifest: vi.fn(),
  };
}

describe('SchoolCalcCodecRegistry', () => {
  it('selects injected codecs by platform without a family branch', () => {
    const registry = new SchoolCalcCodecRegistry({ codecs: [codec('future'), codec('current')] });
    expect(registry.listPlatformIds()).toEqual(['current', 'future']);
    expect(registry.get('future').platformId).toBe('future');
  });

  it('requires exactly one result-record claimant', () => {
    const selected = codec('selected', true);
    expect(new SchoolCalcCodecRegistry({ codecs: [codec('other'), selected] }).decodeResult('record'))
      .toEqual({ codec: selected, result: { deviceId: 'D1' } });
    expect(() => new SchoolCalcCodecRegistry({ codecs: [codec('none')] }).decodeResult('record'))
      .toThrow(/No SchoolCalc codec/);
    expect(() => new SchoolCalcCodecRegistry({ codecs: [codec('a', true), codec('b', true)] }).decodeResult('record'))
      .toThrow(/More than one/);
  });

  it('uses the same exactly-one-claimant rule for opaque device identities', () => {
    const selected = codec('selected', true);
    expect(new SchoolCalcCodecRegistry({ codecs: [codec('other'), selected] })
      .decodeDeviceIdentity(Buffer.from('identity'))).toEqual({
      codec: selected,
      identity: { deviceId: 'D1', platformId: 'selected' },
    });
    expect(() => new SchoolCalcCodecRegistry({ codecs: [codec('none')] })
      .decodeDeviceIdentity(Buffer.from('identity'))).toThrow(/device identity/);
    expect(() => new SchoolCalcCodecRegistry({ codecs: [codec('a', true), codec('b', true)] })
      .decodeDeviceIdentity(Buffer.from('identity'))).toThrow(/More than one/);
  });
});
