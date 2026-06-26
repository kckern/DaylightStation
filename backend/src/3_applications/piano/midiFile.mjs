/**
 * encodeMidiFile — turn a take's relative-time events into Standard MIDI File
 * bytes (format 0, single track). Pure; no I/O.
 *
 * @param {Array<{t:number,type:'note_on'|'note_off',note:number,velocity:number}>} events
 *        t = ms from take start.
 * @param {{ ppq?:number, bpm?:number, channel?:number }} [opts]
 * @returns {Buffer}
 */
export function encodeMidiFile(events = [], { ppq = 480, bpm = 120, channel = 0 } = {}) {
  const ticksPerMs = (ppq * bpm) / 60000;
  const sorted = [...events].sort((a, b) => a.t - b.t);

  const track = [];
  // Tempo meta at t=0: FF 51 03 <usPerQuarter>
  const usPerQuarter = Math.round(60000000 / bpm);
  pushVarLen(track, 0);
  track.push(0xff, 0x51, 0x03, (usPerQuarter >> 16) & 0xff, (usPerQuarter >> 8) & 0xff, usPerQuarter & 0xff);

  let lastTick = 0;
  for (const e of sorted) {
    const tick = Math.max(0, Math.round(e.t * ticksPerMs));
    pushVarLen(track, tick - lastTick);
    lastTick = tick;
    const status = (e.type === 'note_on' ? 0x90 : 0x80) | (channel & 0x0f);
    track.push(status, e.note & 0x7f, (e.type === 'note_on' ? (e.velocity ?? 0) : 0) & 0x7f);
  }
  // End of track
  pushVarLen(track, 0);
  track.push(0xff, 0x2f, 0x00);

  const header = [0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (ppq >> 8) & 0xff, ppq & 0xff];
  const trkLen = track.length;
  const trkHeader = [0x4d, 0x54, 0x72, 0x6b, (trkLen >> 24) & 0xff, (trkLen >> 16) & 0xff, (trkLen >> 8) & 0xff, trkLen & 0xff];
  return Buffer.from([...header, ...trkHeader, ...track]);
}

/** Append a MIDI variable-length quantity (big-endian, 7 bits/byte). */
function pushVarLen(arr, value) {
  let v = Math.max(0, value | 0);
  const bytes = [v & 0x7f];
  v >>= 7;
  while (v > 0) { bytes.unshift((v & 0x7f) | 0x80); v >>= 7; }
  for (const b of bytes) arr.push(b);
}

export default encodeMidiFile;
