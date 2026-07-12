/**
 * midiDuration — pure Standard-MIDI-File duration estimator.
 *
 * Parses the SMF header + track chunks, accumulating absolute ticks and tempo
 * changes, then integrates tempo across the timeline to estimate the rendered
 * length in seconds. Used as a cheap pre-render guardrail: a stuck note or an
 * idle device recording spans hours, and rendering it wastes disk and time.
 * This is an ESTIMATE for gatekeeping (catch the 90-minute monsters), not a
 * sample-accurate duration.
 *
 * Layer: DOMAIN (2_domains/pianoaudio). Pure — parses a provided buffer, no I/O.
 * @module domains/pianoaudio/midiDuration
 */

const HEADER_MIN = 14;
const DEFAULT_TEMPO_US = 500000; // 120 BPM

/**
 * @param {Buffer|Uint8Array} buffer - raw .mid bytes
 * @returns {number} estimated duration in seconds
 * @throws {Error} if the buffer is not a parseable PPQ Standard MIDI File
 */
export function estimateMidiDurationSeconds(buffer) {
  const buf = buffer;
  if (!buf || buf.length < HEADER_MIN) throw new Error('not a MIDI file (too short)');
  // Header chunk: "MThd"
  if (buf[0] !== 0x4d || buf[1] !== 0x54 || buf[2] !== 0x68 || buf[3] !== 0x64) {
    throw new Error('missing MThd header');
  }
  const division = (buf[12] << 8) | buf[13];
  if (division & 0x8000) throw new Error('SMPTE time division unsupported');
  const ppq = division;
  if (ppq <= 0) throw new Error('invalid division');

  // Skip the header chunk using its declared length (bytes 4..7).
  const headerLen = (buf[4] << 24) | (buf[5] << 16) | (buf[6] << 8) | buf[7];
  let pos = 8 + headerLen;

  const tempos = [{ tick: 0, usPerQuarter: DEFAULT_TEMPO_US }];
  let maxTick = 0;

  while (pos + 8 <= buf.length) {
    // Track chunk: "MTrk"
    if (!(buf[pos] === 0x4d && buf[pos + 1] === 0x54 && buf[pos + 2] === 0x72 && buf[pos + 3] === 0x6b)) {
      break; // not a track chunk — stop (tolerant of trailing junk)
    }
    const trackLen = (buf[pos + 4] << 24) | (buf[pos + 5] << 16) | (buf[pos + 6] << 8) | buf[pos + 7];
    let p = pos + 8;
    const trackEnd = Math.min(p + trackLen, buf.length);
    let absTick = 0;
    let runningStatus = 0;

    while (p < trackEnd) {
      // delta-time (variable-length quantity)
      let delta = 0;
      while (p < trackEnd) { const b = buf[p++]; delta = (delta << 7) | (b & 0x7f); if (!(b & 0x80)) break; }
      absTick += delta;

      let status = buf[p];
      if (status & 0x80) { p++; runningStatus = status; } else { status = runningStatus; }

      if (status === 0xff) {
        // meta event: type + length(VLQ) + data
        const metaType = buf[p++];
        let len = 0; while (p < trackEnd) { const b = buf[p++]; len = (len << 7) | (b & 0x7f); if (!(b & 0x80)) break; }
        if (metaType === 0x51 && len === 3) {
          // set-tempo: three data bytes = microseconds per quarter note
          const us = (buf[p] << 16) | (buf[p + 1] << 8) | buf[p + 2];
          tempos.push({ tick: absTick, usPerQuarter: us });
        }
        p += len;
      } else if (status === 0xf0 || status === 0xf7) {
        // sysex: length(VLQ) + data
        let len = 0; while (p < trackEnd) { const b = buf[p++]; len = (len << 7) | (b & 0x7f); if (!(b & 0x80)) break; }
        p += len;
      } else {
        // channel voice: 2 data bytes, except program-change (0xC0) & channel-pressure (0xD0) = 1
        const hi = status & 0xf0;
        p += (hi === 0xc0 || hi === 0xd0) ? 1 : 2;
      }
    }
    if (absTick > maxTick) maxTick = absTick;
    pos = pos + 8 + trackLen;
  }

  // Integrate tempo segments across [0, maxTick].
  tempos.sort((a, b) => a.tick - b.tick);
  let seconds = 0;
  for (let i = 0; i < tempos.length; i++) {
    const segStart = tempos[i].tick;
    if (segStart >= maxTick) break;
    const segEnd = (i + 1 < tempos.length) ? Math.min(tempos[i + 1].tick, maxTick) : maxTick;
    const ticks = segEnd - segStart;
    if (ticks > 0) seconds += (ticks / ppq) * (tempos[i].usPerQuarter / 1e6);
  }
  return seconds;
}

export default { estimateMidiDurationSeconds };
