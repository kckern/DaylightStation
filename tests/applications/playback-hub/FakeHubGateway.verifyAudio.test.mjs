import { describe, it, expect, beforeEach } from 'vitest';
import { FakeHubGateway } from '../../../backend/src/3_applications/playback-hub/test/FakeHubGateway.mjs';

describe('FakeHubGateway.verifyAudio', () => {
  let gateway;
  beforeEach(() => { gateway = new FakeHubGateway(); });

  it('returns the seeded result and records the call', async () => {
    gateway.setNextVerifyResult({
      color: 'white',
      sink: 'bluez_output.9C_0C_35_75_B7_75.1',
      peak_dbfs: -3.2,
      audio_flowing: true,
      sampled_ms: 500,
      bt_connected: true,
    });
    const result = await gateway.verifyAudio('white');
    expect(result.audio_flowing).toBe(true);
    expect(result.peak_dbfs).toBe(-3.2);
    expect(gateway.verifyCalls).toEqual([{ color: 'white' }]);
  });

  it('returns a default audio_flowing=false payload when not seeded', async () => {
    const result = await gateway.verifyAudio('red');
    expect(result).toEqual({
      color: 'red', sink: '', peak_dbfs: null, audio_flowing: false,
      sampled_ms: 0, bt_connected: false,
    });
  });

  it('throws the seeded error and clears it (single-shot)', async () => {
    gateway.setVerifyError(new Error('hub down'));
    await expect(gateway.verifyAudio('red')).rejects.toThrow('hub down');
    // Next call: default payload, no longer errors.
    const result = await gateway.verifyAudio('red');
    expect(result.audio_flowing).toBe(false);
  });
});
