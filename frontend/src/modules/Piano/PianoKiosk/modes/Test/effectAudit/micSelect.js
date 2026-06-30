// micSelect.js — choose the built-in mic and safe capture constraints.
//
// A connected Bluetooth HFP device (the room's "J2-USB Bluetooth") can hijack
// getUserMedia onto the SCO mic -> silence. We pin the built-in input and turn
// off echoCancellation/noiseSuppression/autoGainControl so the room signal is
// captured faithfully.

const BT_RE = /bluetooth|headset|hands-?free|sco|a2dp|j2-usb/i;
const BUILTIN_RE = /built-?in|internal|speakerphone|microphone|\bmic\b/i;
// 'default'/'communications' are pseudo-devices that FOLLOW system routing — when
// a Bluetooth HFP headset is connected they resolve to its SCO mic (the far,
// wrong mic). We must pin a concrete hardware deviceId instead.
const PSEUDO_IDS = new Set(['default', 'communications']);

/** Pick a concrete built-in audio input deviceId from enumerateDevices() output. */
export function pickBuiltInMic(devices) {
  const inputs = (devices || []).filter((d) => d.kind === 'audioinput');
  if (inputs.length === 0) return null;
  // Real hardware inputs only: drop BT/SCO and the routing pseudo-ids.
  const real = inputs.filter((d) => !BT_RE.test(d.label || '') && !PSEUDO_IDS.has(d.deviceId));
  const builtIn = real.find((d) => BUILTIN_RE.test(d.label || ''));
  return (builtIn || real[0] || null)?.deviceId || null;
}

/** getUserMedia audio constraints pinning a device with processing disabled. */
export function buildMicConstraints(deviceId) {
  const audio = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  };
  if (deviceId) audio.deviceId = { exact: deviceId };
  return { audio };
}
