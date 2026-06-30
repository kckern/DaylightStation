// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { pickBuiltInMic, buildMicConstraints } from './micSelect.js';

describe('pickBuiltInMic', () => {
  it('prefers a built-in input over a bluetooth one', () => {
    const id = pickBuiltInMic([
      { kind: 'audioinput', deviceId: 'bt', label: 'J2-USB Bluetooth Hands-Free' },
      { kind: 'audioinput', deviceId: 'mic', label: 'Built-in microphone' },
    ]);
    expect(id).toBe('mic');
  });
  it('skips bluetooth even when no obvious built-in label exists', () => {
    const id = pickBuiltInMic([
      { kind: 'audioinput', deviceId: 'bt', label: 'Headset (SCO)' },
      { kind: 'audioinput', deviceId: 'x', label: 'Mic A' },
    ]);
    expect(id).toBe('x');
  });
  it('returns null when there are no audio inputs', () => {
    expect(pickBuiltInMic([{ kind: 'videoinput', deviceId: 'cam', label: 'cam' }])).toBeNull();
  });
  it('avoids the "default" pseudo-device (routes to BT SCO) and pins the concrete built-in', () => {
    // Real Android/WebView enumeration when a BT headset is connected.
    const id = pickBuiltInMic([
      { kind: 'audioinput', deviceId: 'default', label: '' },
      { kind: 'audioinput', deviceId: 'hw-spk', label: 'Speakerphone' },
      { kind: 'audioinput', deviceId: 'hw-bt', label: 'Bluetooth headset' },
    ]);
    expect(id).toBe('hw-spk');
  });
});

describe('buildMicConstraints', () => {
  it('disables EC/NS/AGC and pins the device', () => {
    const c = buildMicConstraints('mic');
    expect(c.audio.echoCancellation).toBe(false);
    expect(c.audio.noiseSuppression).toBe(false);
    expect(c.audio.autoGainControl).toBe(false);
    expect(c.audio.deviceId).toEqual({ exact: 'mic' });
  });
  it('omits deviceId when none given', () => {
    expect(buildMicConstraints(null).audio.deviceId).toBeUndefined();
  });
});
