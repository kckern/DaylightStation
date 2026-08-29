/**
 * Encode a piano take as a format-0 Standard MIDI File.
 * Raw byte serialization belongs to the persistence adapter layer.
 */
export function encodeMidiFile(events = [], { ppq = 480, bpm = 120, channel = 0 } = {}) {
  const ticksPerMs = (ppq * bpm) / 60000;
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const track = [];
  const usPerQuarter = Math.round(60000000 / bpm);
  pushVarLen(track, 0);
  track.push(0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff);
  let lastTick = 0;
  for (const event of sorted) {
    const tick = Math.max(0, Math.round(event.t * ticksPerMs));
    pushVarLen(track, tick - lastTick);
    lastTick = tick;
    const status = (event.type === 'note_on' ? 0x90 : 0x80) | (channel & 0x0f);
    track.push(status, event.note & 0x7f, (event.type === 'note_on' ? (event.velocity ?? 0) : 0) & 0x7f);
  }
  pushVarLen(track, 0);
  track.push(0xff, 0x2f, 0x00);
  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ppq >> 8) & 0xff, ppq & 0xff];
  const length = track.length;
  const trackHeader = [0x4d, 0x54, 0x72, 0x6b, (length >> 24) & 0xff, (length >> 16) & 0xff, (length >> 8) & 0xff, length & 0xff];
  return Buffer.from([...header, ...trackHeader, ...track]);
}

function pushVarLen(target, value) {
  let remaining = Math.max(0, value | 0);
  const bytes = [remaining & 0x7f];
  remaining >>= 7;
  while (remaining > 0) {
    bytes.unshift((remaining & 0x7f) | 0x80);
    remaining >>= 7;
  }
  target.push(...bytes);
}

export default encodeMidiFile;
