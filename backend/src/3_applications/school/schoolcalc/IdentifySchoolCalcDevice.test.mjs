import { describe, expect, it, vi } from 'vitest';
import { IdentifySchoolCalcDevice } from './IdentifySchoolCalcDevice.mjs';

describe('IdentifySchoolCalcDevice', () => {
  it('resolves opaque family bytes against the authoritative enrollment', async () => {
    const codec = { platformId: 'future' };
    const codecs = {
      decodeDeviceIdentity: vi.fn(() => ({
        codec, identity: { deviceId: 'CALC001', platformId: 'future' },
      })),
    };
    const devices = {
      getDevice: vi.fn(async () => ({
        deviceId: 'CALC001', platformId: 'future', label: 'Calculator A', revision: 3,
      })),
    };
    const useCase = new IdentifySchoolCalcDevice({ devices, codecs });
    await expect(useCase.execute({ record: Buffer.from('opaque') })).resolves.toEqual({
      deviceId: 'CALC001', platformId: 'future', label: 'Calculator A', revision: 3,
    });
    expect(codecs.decodeDeviceIdentity).toHaveBeenCalledWith(Buffer.from('opaque'));
  });

  it('rejects a provisioned identity whose family disagrees with enrollment', async () => {
    const useCase = new IdentifySchoolCalcDevice({
      codecs: { decodeDeviceIdentity: () => ({
        codec: { platformId: 'future' },
        identity: { deviceId: 'CALC001', platformId: 'future' },
      }) },
      devices: { getDevice: async () => ({ deviceId: 'CALC001', platformId: 'other' }) },
    });
    await expect(useCase.execute({ record: Buffer.from('opaque') })).rejects.toMatchObject({
      code: 'SCHOOLCALC_DEVICE_IDENTITY_PLATFORM_MISMATCH',
    });
  });
});
