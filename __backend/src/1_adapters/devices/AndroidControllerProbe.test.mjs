import { describe, it, expect } from 'vitest';
import { AndroidControllerProbe } from './AndroidControllerProbe.mjs';

// Shapes taken verbatim from the living-room device's `dumpsys input`.
const REMOTE = `  Device 10: shield-ask-remote
    Sources: 0x00000701
    KeyboardType: 1
`;
const AIR_MOUSE = `  Device 8: wireless wireless 2.4G Mouse
    Sources: 0x01002313
    Motion Ranges:
      X: source=0x00002002, min=0.000, max=1919.000
      Y: source=0x00002002, min=0.000, max=1079.000
      GENERIC_1: source=0x01000010, min=0.000, max=1.000
`;
const GAMEPAD = `  Device 20: Xbox Wireless Controller
    Sources: 0x01000511
    Motion Ranges:
      X: source=0x01000010, min=-1.000, max=1.000
      Y: source=0x01000010, min=-1.000, max=1.000
      RZ: source=0x01000010, min=0.000, max=1.000
`;

const probe = (output, ok = true) => new AndroidControllerProbe({
  adbAdapter: { shell: async () => (ok ? { ok: true, output } : { ok: false, error: 'offline' }) },
  logger: { debug() {} },
});

describe('AndroidControllerProbe — census counts players, not remotes', () => {
  it('does not count the TV remote', async () => {
    // The Shield remote reports input class GAMEPAD and source SOURCE_GAMEPAD.
    // Anything keying on either would seat it at the table.
    expect(await probe(REMOTE).census()).toEqual({ connected: 0, names: [] });
  });

  it('does not count the air-mouse, despite its joystick-sourced axis', async () => {
    // Its one joystick-sourced axis is GENERIC_1, not a stick.
    expect(await probe(AIR_MOUSE).census()).toEqual({ connected: 0, names: [] });
  });

  it('counts a real controller', async () => {
    const c = await probe(GAMEPAD).census();
    expect(c.connected).toBe(1);
    expect(c.names).toEqual(['Xbox Wireless Controller']);
  });

  it('counts only the controllers in a mixed device list', async () => {
    const c = await probe(REMOTE + AIR_MOUSE + GAMEPAD).census();
    expect(c).toEqual({ connected: 1, names: ['Xbox Wireless Controller'] });
  });

  it('counts two controllers for two players', async () => {
    const second = GAMEPAD.replace('Device 20: Xbox Wireless Controller', 'Device 21: 8BitDo Pro 2');
    const c = await probe(REMOTE + GAMEPAD + second).census();
    expect(c.connected).toBe(2);
  });

  it('returns null when the device cannot be asked — which is not zero', async () => {
    // "No answer" and "no controllers" must never collapse into each other.
    expect(await probe('', false).census()).toBeNull();
  });
});

describe('AndroidControllerProbe — activity is a separate question', () => {
  const STREAM = `add device 1: /dev/input/event5
  name:     "Xbox Wireless Controller"
add device 2: /dev/input/event3
  name:     "shield-ask-remote"
/dev/input/event5: 0001 0130 00000001
/dev/input/event5: 0000 0000 00000000
`;

  it('reports which devices actually produced events', async () => {
    const a = await probe(STREAM).sampleActivity({ windowMs: 3000 });
    expect(a.active).toBe(1);
    expect(a.names).toEqual(['Xbox Wireless Controller']);
  });

  it('a quiet window means nobody pressed anything, not that nothing is attached', async () => {
    const quiet = `add device 1: /dev/input/event5
  name:     "Xbox Wireless Controller"
`;
    const a = await probe(quiet).sampleActivity({ windowMs: 2000 });
    expect(a.active).toBe(0);
    // The pad is still attached — census is what answers that.
    expect(await probe(GAMEPAD).census()).toMatchObject({ connected: 1 });
  });

  it('reports the window it actually sampled', async () => {
    expect((await probe(STREAM).sampleActivity({ windowMs: 2500 })).windowMs).toBe(3000);
  });

  it('returns null when the device cannot be asked', async () => {
    expect(await probe('', false).sampleActivity()).toBeNull();
  });
});
