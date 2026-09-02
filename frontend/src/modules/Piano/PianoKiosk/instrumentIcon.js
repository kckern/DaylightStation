// instrumentIcon.js — the house SVG icon name for an instrument / voice / GM
// family, chosen by keyword. Tiles in the Sound sheet read by family glyph
// (see voiceFamilies.js for the rail's own icons). First match wins, so keep
// the more specific rules above the generic ones.
const RULES = [
  [/pian|grand|clavichord|harpsichord|rhodes|wurl|honky/i, 'piano'],
  [/organ|accordion|harmonica|bandoneon|celesta|glocken|vibraphone|marimba|xylophone|bell|music box|dulcimer|chime/i, 'family-keys'],
  [/bass|guitar|banjo|ukulele|mandolin/i, 'family-guitar'],
  [/violin|viola|cello|contrabass|fiddle|string|orchestra|pizzicato|harp\b|timpani/i, 'family-strings'],
  [/sax|trumpet|trombone|tuba|cornet|\bhorn\b|brass|fanfare|flute|piccolo|recorder|whistle|\bpipe|clarinet|oboe|bassoon|reed|ocarina|shakuhachi|bottle/i, 'family-winds'],
  [/choir|voice|vocal|\baah|\booh/i, 'studio'],
  [/sitar|shamisen|koto|kalimba|bagpipe|shanai|yangqin|pipa|zheng|erhu|banhu|suona|sheng|dizi/i, 'family-world'],
  [/drum|percuss|\bkit\b|cymbal|\btom\b|taiko|conga|bongo|snare|agogo|woodblock|tinkle|steel|noise|seashore|bird|telephone|helicopter|applause|gunshot/i, 'family-fun'],
  [/synth|\bpad\b|\bfx\b|\blead\b|saw|square|sci-?fi|atmosphere|sweep|sound track|charang|goblin|rain|crystal|brightness|echoes|calliope|chiff|fifth/i, 'family-synths'],
];

/** House icon name for an instrument/voice/family name (falls back to the music note). */
export function instrumentIcon(name) {
  const s = String(name || '');
  for (const [re, icon] of RULES) if (re.test(s)) return icon;
  return 'music';
}

export default instrumentIcon;
