// instrumentIcon.js — a decorative emoji glyph for an instrument / voice / GM
// family, chosen by keyword. Placeholder icons (per #12) until real artwork; the
// picker reads far better with a glyph than a wall of names. First match wins, so
// keep the more specific rules above the generic ones.
const RULES = [
  [/pian|grand|clavichord|harpsichord|rhodes|wurl|electric piano|honky/i, '🎹'],
  [/organ|accordion|harmonica|bandoneon/i, '🪗'],
  [/bass/i, '🎸'],
  [/guitar|banjo|sitar|ukulele|mandolin|shamisen|koto/i, '🎸'],
  [/violin|viola|cello|contrabass|fiddle|string|orchestra|pizzicato|harp\b/i, '🎻'],
  [/sax/i, '🎷'],
  [/trumpet|trombone|tuba|cornet|\bhorn\b|brass|fanfare/i, '🎺'],
  [/flute|piccolo|recorder|whistle|\bpipe|clarinet|oboe|bassoon|reed|ocarina|shakuhachi/i, '🪈'],
  [/choir|voice|vocal|\baah|\booh|lead vocal|synth voice/i, '🎤'],
  [/drum|percuss|timpani|\bkit\b|cymbal|\btom\b|taiko|conga|bongo|snare/i, '🥁'],
  [/bell|glocken|celesta|vibraphone|marimba|xylophone|chime|music box|tinkle|kalimba|steel drum/i, '🔔'],
  [/synth|\bpad\b|\bfx\b|\blead\b|saw|square|sci-?fi|atmosphere|sweep|sound track|charang|goblin/i, '🎛️'],
];

/** Emoji glyph for an instrument/voice/family name (falls back to a music note). */
export function instrumentEmoji(name) {
  const s = String(name || '');
  for (const [re, emoji] of RULES) if (re.test(s)) return emoji;
  return '🎵';
}

export default instrumentEmoji;
