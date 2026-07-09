import { describe, it, expect, afterEach } from 'vitest';
import { createPianoScreenPowerSync, _resetForTests as resetPsas } from '#composition/modules/pianoScreenPowerSync.mjs';
import { createPianoMidiWake, _resetForTests as resetMidi } from '#composition/modules/pianoMidiWake.mjs';
import { getScreenOverrideService, _resetForTests as resetOverride } from '#composition/modules/screenOverride.mjs';

afterEach(() => { resetPsas(); resetMidi(); resetOverride(); });

const fakeDevice = { getStatus: async () => ({ screenOn: true }), setScreen: async () => ({ ok: true }) };
const deviceService = { get: () => fakeDevice };
const haGateway = { getState: async () => ({ state: 'off' }), callService: async () => ({}) };

function configService(block) {
  return { getHouseholdAppConfig: () => block };
}

describe('screen-override composition wiring', () => {
  it('the authority service factory injects the shared override (service constructed)', () => {
    const cfg = configService({ screen_power_sync: { enabled: true, device_id: 'yellow-room-tablet', piano_power_entity: 'binary_sensor.x' } });
    const { pianoScreenAuthorityService } = createPianoScreenPowerSync({ haGateway, deviceService, configService: cfg, logger: { info() {}, warn() {} } });
    expect(pianoScreenAuthorityService).not.toBeNull();
    expect(getScreenOverrideService()).toBeTruthy();
  });

  it('the midi-wake factory injects the shared override', () => {
    const cfg = configService({ midi_wake: { enabled: true, device_id: 'yellow-room-tablet', bridge_url: 'ws://x:8770' } });
    const { pianoMidiWakeService } = createPianoMidiWake({ deviceService, configService: cfg, logger: { info() {}, warn() {} } });
    expect(pianoMidiWakeService).not.toBeNull();
    pianoMidiWakeService.suppressWakeUntil(Date.now() + 30 * 60_000);
    expect(getScreenOverrideService().get('yellow-room-tablet')?.state).toBe('off');
  });
});
