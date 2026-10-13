// Pure MIDI byte decoder for the settings MIDI monitor. No DOM. Turns a raw
// Web-MIDI message (Uint8Array / number[]) into a compact, displayable record.

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** MIDI note number → scientific pitch name, e.g. 60 → "C4". */
export function noteName(n) {
  if (!Number.isFinite(n)) return '';
  return `${NOTE_NAMES[((n % 12) + 12) % 12]}${Math.floor(n / 12) - 1}`;
}

// A few common CC numbers worth naming in the monitor.
const CC_NAMES = { 1: 'Mod', 7: 'Volume', 10: 'Pan', 64: 'Sustain', 121: 'Reset', 122: 'Local' };

/**
 * Decode one MIDI message.
 * @param {Uint8Array|number[]} bytes
 * @returns {{kind:string, channel:number|null, label:string, detail:string, dir:'in'|'out'}}
 */
export function decodeMidi(bytes) {
  const b = bytes ? Array.from(bytes) : [];
  const status = b[0] ?? 0;
  const hi = status & 0xf0;
  const channel = status >= 0x80 && status < 0xf0 ? (status & 0x0f) + 1 : null;

  switch (hi) {
    case 0x80:
      return mk('note-off', channel, 'Note Off', `${noteName(b[1])}`);
    case 0x90:
      return (b[2] ?? 0) === 0
        ? mk('note-off', channel, 'Note Off', `${noteName(b[1])}`)
        : mk('note-on', channel, 'Note On', `${noteName(b[1])}  v${b[2]}`);
    case 0xa0:
      return mk('aftertouch', channel, 'Aftertouch', `${noteName(b[1])}  ${b[2]}`);
    case 0xb0: {
      const cc = b[1];
      const name = CC_NAMES[cc] ? `${CC_NAMES[cc]} (${cc})` : `CC ${cc}`;
      return mk('cc', channel, 'Control', `${name} = ${b[2]}`);
    }
    case 0xc0:
      return mk('program', channel, 'Program', `#${b[1]}`);
    case 0xd0:
      return mk('aftertouch', channel, 'Ch.Aftertouch', `${b[1]}`);
    case 0xe0: {
      const value = ((b[2] ?? 0) << 7) | (b[1] ?? 0);
      return mk('pitchbend', channel, 'Pitch Bend', `${value - 8192}`);
    }
    default:
      return mk('system', null, 'System', b.map((x) => x.toString(16).padStart(2, '0')).join(' '));
  }
}

function mk(kind, channel, label, detail) {
  return { kind, channel, label, detail, dir: 'in' };
}
