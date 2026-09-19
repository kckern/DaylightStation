import { describe, it, expect } from 'vitest';
import { KioskArcadeGameSpeaker } from './KioskArcadeGameSpeaker.mjs';

const quiet = { warn() {} };

describe('KioskArcadeGameSpeaker', () => {
  it('speaks through the kiosk', async () => {
    const said = [];
    const s = new KioskArcadeGameSpeaker({
      clientsByDevice: new Map([['tv', { command: async (c, p) => { said.push([c, p.text]); return { ok: true }; } }]]),
      logger: quiet,
    });
    expect(await s.say('tv', 'five minutes left')).toBe(true);
    expect(said).toEqual([['textToSpeech', 'five minutes left']]);
  });

  it('is a no-op for an unknown device or empty text', async () => {
    const s = new KioskArcadeGameSpeaker({ clientsByDevice: new Map(), logger: quiet });
    expect(await s.say('nope', 'hello')).toBe(false);
  });

  it('never throws when the device will not speak', async () => {
    const s = new KioskArcadeGameSpeaker({
      clientsByDevice: new Map([['tv', { command: async () => { throw new Error('offline'); } }]]),
      logger: quiet,
    });
    expect(await s.say('tv', 'hello')).toBe(false);
  });
});
