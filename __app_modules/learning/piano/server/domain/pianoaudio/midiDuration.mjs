/**
 * midiDuration — pure Standard-MIDI-File analyzer + junk policy.
 *
 * `analyzeMidi` parses the SMF header + tracks, accumulating absolute ticks,
 * tempo changes, and note-on count, then integrates tempo across the timeline to
 * estimate rendered length in seconds. `isLikelyJunkMidi` applies the junk policy
 * used as a cheap pre-render guardrail: a genuinely stuck note or an aborted/empty
 * recording renders to a multi-GB scratch WAV of silence or a single held tone.
 * A LONG file is NOT junk on its own — real practice sessions run for hours with
 * tens of thousands of notes; only long-AND-sparse (or note-less) files are junk.
 *
 * This is an ESTIMATE for gatekeeping, not a sample-accurate duration.
 *
 * Layer: DOMAIN (2_domains/pianoaudio). Pure — parses a provided buffer, no I/O.
 * @module domains/pianoaudio/midiDuration
 */

const HEADER_MIN = 14;
const DEFAULT_TEMPO_US = 500000; // 120 BPM
const DEFAULT_JUNK_MIN_SECONDS = 1800; // 30 min
const DEFAULT_JUNK_MIN_NOTES = 200;

/**
 * @param {Buffer|Uint8Array} buffer - raw .mid bytes
 * @returns {{ durationSeconds: number, noteCount: number }}
 * @throws {Error} if the buffer is not a parseable PPQ Standard MIDI File
 */
export function analyzeMidi(buffer) {
  const buf = buffer;
  if (!buf || buf.length < HEADER_MIN) throw new Error('not a MIDI file (too short)');
  if (buf[0] !== 0x4d || buf[1] !== 0x54 || buf[2] !== 0x68 || buf[3] !== 0x64) {
    throw new Error('missing MThd header');
  }
  const division = (buf[12] << 8) | buf[13];
  if (division & 0x8000) throw new Error('SMPTE time division unsupported');
  const ppq = division;
  if (ppq <= 0) throw new Error('invalid division');

  const headerLen = (buf[4] << 24) | (buf[5] << 16) | (buf[6] << 8) | buf[7];
  let pos = 8 + headerLen;

  const tempos = [{ tick: 0, usPerQuarter: DEFAULT_TEMPO_US }];
  let maxTick = 0;
  let noteCount = 0;

  while (pos + 8 <= buf.length) {
    if (!(buf[pos] === 0x4d && buf[pos + 1] === 0x54 && buf[pos + 2] === 0x72 && buf[pos + 3] === 0x6b)) {
      break; // not a track chunk — tolerate trailing junk
    }
    const trackLen = (buf[pos + 4] << 24) | (buf[pos + 5] << 16) | (buf[pos + 6] << 8) | buf[pos + 7];
    let p = pos + 8;
    const trackEnd = Math.min(p + trackLen, buf.length);
    let absTick = 0;
    let runningStatus = 0;

    while (p < trackEnd) {
      let delta = 0;
      while (p < trackEnd) { const b = buf[p++]; delta = (delta << 7) | (b & 0x7f); if (!(b & 0x80)) break; }
      absTick += delta;

      let status = buf[p];
      if (status & 0x80) { p++; runningStatus = status; } else { status = runningStatus; }
      const hi = status & 0xf0;

      if (status === 0xff) {
        const metaType = buf[p++];
        let len = 0; while (p < trackEnd) { const b = buf[p++]; len = (len << 7) | (b & 0x7f); if (!(b & 0x80)) break; }
        if (metaType === 0x51 && len === 3) {
          const us = (buf[p] << 16) | (buf[p + 1] << 8) | buf[p + 2];
          tempos.push({ tick: absTick, usPerQuarter: us });
        }
        p += len;
      } else if (status === 0xf0 || status === 0xf7) {
        let len = 0; while (p < trackEnd) { const b = buf[p++]; len = (len << 7) | (b & 0x7f); if (!(b & 0x80)) break; }
        p += len;
      } else if (hi === 0x90) {
        // note-on: velocity 0 is a note-off in disguise — don't count it
        if (buf[p + 1] > 0) noteCount++;
        p += 2;
      } else if (hi === 0x80) {
        p += 2; // note-off
      } else {
        p += (hi === 0xc0 || hi === 0xd0) ? 1 : 2; // program-change / channel-pressure = 1 data byte
      }
    }
    if (absTick > maxTick) maxTick = absTick;
    pos = pos + 8 + trackLen;
  }

  tempos.sort((a, b) => a.tick - b.tick);
  let durationSeconds = 0;
  for (let i = 0; i < tempos.length; i++) {
    const segStart = tempos[i].tick;
    if (segStart >= maxTick) break;
    const segEnd = (i + 1 < tempos.length) ? Math.min(tempos[i + 1].tick, maxTick) : maxTick;
    const ticks = segEnd - segStart;
    if (ticks > 0) durationSeconds += (ticks / ppq) * (tempos[i].usPerQuarter / 1e6);
  }
  return { durationSeconds, noteCount };
}

/**
 * Junk policy: a file is junk if it has NO notes at all, or is both long and
 * sparse (a stuck note / idle recording). A long file dense with notes is a real
 * (if lengthy) performance and is NOT junk.
 * @param {{ durationSeconds: number, noteCount: number }} stats
 * @param {{ minSeconds?: number, minNotes?: number }} [opts]
 * @returns {boolean}
 */
export function isLikelyJunkMidi(
  { durationSeconds, noteCount },
  { minSeconds = DEFAULT_JUNK_MIN_SECONDS, minNotes = DEFAULT_JUNK_MIN_NOTES } = {},
) {
  if (noteCount === 0) return true;
  return durationSeconds > minSeconds && noteCount < minNotes;
}

/** Back-compat convenience: estimated render duration in seconds. */
export function estimateMidiDurationSeconds(buffer) {
  return analyzeMidi(buffer).durationSeconds;
}

export default { analyzeMidi, isLikelyJunkMidi, estimateMidiDurationSeconds };
