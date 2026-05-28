import { describe, it, expect, beforeEach } from 'vitest';
import { VerifyAudioFlowing } from '../../../backend/src/3_applications/playback-hub/usecases/VerifyAudioFlowing.mjs';
import { FakeHubGateway } from '../../../backend/src/3_applications/playback-hub/test/FakeHubGateway.mjs';
import { ValidationError } from '../../../backend/src/2_domains/core/errors/ValidationError.mjs';
import { InfrastructureError } from '../../../backend/src/0_system/utils/errors/InfrastructureError.mjs';

describe('VerifyAudioFlowing', () => {
  let gateway, useCase;
  beforeEach(() => {
    gateway = new FakeHubGateway();
    useCase = new VerifyAudioFlowing({ gateway });
  });

  it('returns the gateway response as-is on success', async () => {
    gateway.setNextVerifyResult({
      color: 'white',
      sink: 'bluez_output.9C_0C_35_75_B7_75.1',
      peak_dbfs: -3.2,
      audio_flowing: true,
      sampled_ms: 500,
      bt_connected: true,
    });
    const result = await useCase.execute({ color: 'white' });
    expect(result.audio_flowing).toBe(true);
    expect(result.peak_dbfs).toBe(-3.2);
    expect(gateway.verifyCalls).toEqual([{ color: 'white' }]);
  });

  it('rejects empty color with ValidationError (no gateway call)', async () => {
    await expect(useCase.execute({ color: '' })).rejects.toThrow(ValidationError);
    expect(gateway.verifyCalls).toEqual([]);
  });

  it('rejects non-string color with ValidationError', async () => {
    await expect(useCase.execute({ color: null })).rejects.toThrow(ValidationError);
    await expect(useCase.execute({ color: 42 })).rejects.toThrow(ValidationError);
    expect(gateway.verifyCalls).toEqual([]);
  });

  it('lets InfrastructureError bubble (caller maps to 502/504)', async () => {
    gateway.setVerifyError(new InfrastructureError('hub timeout', { code: 'HUB_TIMEOUT' }));
    await expect(useCase.execute({ color: 'red' })).rejects.toThrow(InfrastructureError);
  });

  it('throws when constructed without a gateway', () => {
    expect(() => new VerifyAudioFlowing({})).toThrow(/gateway/);
  });
});
