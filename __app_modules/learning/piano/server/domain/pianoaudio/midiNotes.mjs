/**
 * midiNotes — pure Standard-MIDI-File note extractor.
 *
 * `parseMidiNotes` walks the SMF, builds a tempo map, and pairs note-on/note-off
 * events into timed notes `{ pitch, startSec, durSec, velocity }` (seconds are
 * tempo-mapped). Used by the piano-roll renderer. Kept separate from
 * `analyzeMidi` (which only counts) so the cheap listPending path never
 * allocates note objects.
 *
 * Layer: DOMAIN (2_domains/pianoaudio). Pure — parses a provided buffer, no I/O.
 * @module domains/pianoaudio/midiNotes
 */

const HEADER_MIN = 14;
const DEFAULT_TEMPO_US = 500000; // 120 BPM

/** Build a tick→seconds converter from a sorted tempo map. */
function makeTickToSec(tempos, ppq) {
  // Precompute cumulative seconds at each tempo boundary.
  const cum = [{ tick: tempos[0].tick, sec: 0, usPerQuarter: tempos[0].usPerQuarter }];
  for (let i = 1; i < tempos.length; i++) {
    const prev = cum[i - 1];
    const ticks = tempos[i].tick - prev.tick;
    const sec = prev.sec + (ticks / ppq) * (prev.usPerQuarter / 1e6);
    cum.push({ tick: tempos[i].tick, sec, usPerQuarter: tempos[i].usPerQuarter });
  }
  return (tick) => {
    // find last boundary at or before tick
    let lo = 0;
    for (let i = cum.length - 1; i >= 0; i--) { if (cum[i].tick <= tick) { lo = i; break; } }
    const base = cum[lo];
    return base.sec + ((tick - base.tick) / ppq) * (base.usPerQuarter / 1e6);
  };
}

/**
 * @param {Buffer|Uint8Array} buffer - raw .mid bytes
 * @returns {{ notes: Array<{pitch:number, startSec:number, durSec:number, velocity:number}>, durationSeconds: number, noteCount: number }}
 * @throws {Error} if the buffer is not a parseable PPQ Standard MIDI File
 */
export function parseMidiNotes(buffer) {
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

  // Pass 1: collect tempo changes + note on/off events (abs tick), find end tick.
  const tempos = [{ tick: 0, usPerQuarter: DEFAULT_TEMPO_US }];
  const events = []; // { tick, on:boolean, key, pitch, velocity }
  let maxTick = 0;

  while (pos + 8 <= buf.length) {
    if (!(buf[pos] === 0x4d && buf[pos + 1] === 0x54 && buf[pos + 2] === 0x72 && buf[pos + 3] === 0x6b)) break;
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
      const chan = status & 0x0f;

      if (status === 0xff) {
        const metaType = buf[p++];
        let len = 0; while (p < trackEnd) { const b = buf[p++]; len = (len << 7) | (b & 0x7f); if (!(b & 0x80)) break; }
        if (metaType === 0x51 && len === 3) {
          tempos.push({ tick: absTick, usPerQuarter: (buf[p] << 16) | (buf[p + 1] << 8) | buf[p + 2] });
        }
        p += len;
      } else if (status === 0xf0 || status === 0xf7) {
        let len = 0; while (p < trackEnd) { const b = buf[p++]; len = (len << 7) | (b & 0x7f); if (!(b & 0x80)) break; }
        p += len;
      } else if (hi === 0x90) {
        const pitch = buf[p]; const vel = buf[p + 1]; p += 2;
        const key = (chan << 8) | pitch;
        if (vel > 0) events.push({ tick: absTick, on: true, key, pitch, velocity: vel });
        else events.push({ tick: absTick, on: false, key, pitch });
      } else if (hi === 0x80) {
        const pitch = buf[p]; p += 2;
        events.push({ tick: absTick, on: false, key: (chan << 8) | pitch, pitch });
      } else {
        p += (hi === 0xc0 || hi === 0xd0) ? 1 : 2;
      }
    }
    if (absTick > maxTick) maxTick = absTick;
    pos = pos + 8 + trackLen;
  }

  tempos.sort((a, b) => a.tick - b.tick);
  const tickToSec = makeTickToSec(tempos, ppq);

  // Pair notes in a single time-ordered pass. Each note-off pops the OLDEST
  // still-sounding note of that key (FIFO among active), so an early note can
  // never grab a far-future off — the failure mode that turned dropped offs into
  // full-width bars. Offs sort before ons at the same tick (an off closes the
  // prior note, not a simultaneous re-strike).
  events.sort((a, b) => (a.tick - b.tick) || ((a.on ? 1 : 0) - (b.on ? 1 : 0)));

  const active = new Map(); // key → queue of { startTick, pitch, velocity }
  const notes = [];
  let noteCount = 0;
  for (const e of events) {
    if (e.on) {
      noteCount += 1;
      if (!active.has(e.key)) active.set(e.key, []);
      active.get(e.key).push({ startTick: e.tick, pitch: e.pitch, velocity: e.velocity });
    } else {
      const q = active.get(e.key);
      if (q && q.length) {
        const on = q.shift();
        const startSec = tickToSec(on.startTick);
        notes.push({ pitch: on.pitch, startSec, durSec: Math.max(0, tickToSec(e.tick) - startSec), velocity: on.velocity });
      }
    }
  }
  // Notes still sounding at end-of-file have no known release — emit them to the
  // end tick (their over-length is bounded for display by the layout's clamp).
  for (const q of active.values()) {
    for (const on of q) {
      const startSec = tickToSec(on.startTick);
      notes.push({ pitch: on.pitch, startSec, durSec: Math.max(0, tickToSec(maxTick) - startSec), velocity: on.velocity });
    }
  }

  return { notes, durationSeconds: tickToSec(maxTick), noteCount };
}

export default { parseMidiNotes };
