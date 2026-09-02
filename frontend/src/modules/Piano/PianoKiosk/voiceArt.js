// voiceArt.js — which licensed instrument illustration (media/img/music/
// instruments/<name>.svg, 720×720 colour SVG) pictures a voice, by keyword.
// Same shape as instrumentIcon.js: first match wins, so the specific rules sit
// above the generic ones. A voice the pack cannot picture returns null and the
// tile falls back to its house icon — a wrong picture is worse than a glyph,
// so the sound-effect voices, the choirs and the zithers stay null on purpose.
// Near neighbours are used where a child would accept the likeness: reed
// woodwinds share the clarinet, the erhu family the rebab, synth patches the
// keyboard. `voiceArt.test.js` proves every name here exists in the pack.
const RULES = [
  // Keyboards first: Bass + Lead and the electric pianos would otherwise be caught below.
  [/bass \+ lead/i, 'keyboard-1'],
  [/electric piano/i, 'keyboard-1'],
  [/harpsichord|clavichord|celesta|organ/i, 'keyboard-2'],
  [/pian|grand|\bbright\b|honky/i, 'upright-piano'],
  [/tango accordion/i, 'accordion-2'],
  [/accordion/i, 'accordion-1'],
  [/harmonica/i, 'harmonica'],
  [/melodica/i, 'melodica'],
  [/glocken|music box|tinkle/i, 'glockenspiel'],
  [/marimba/i, 'marimba'],
  [/vibraphone/i, 'xylophone-2'],
  [/xylophone/i, 'xylophone-1'],
  // Guitars and basses.
  [/ukulele/i, 'ukulele'],
  [/nylon|fret noise/i, 'acoustic-guitar-1'],
  [/steel guitar|acoustic guitar/i, 'acoustic-guitar-2'],
  [/overdriv|distortion/i, 'electric-guitar-2'],
  [/jazz guitar|harmonics/i, 'electric-guitar-3'],
  [/guitar/i, 'electric-guitar-1'],
  [/\bbass\b/i, 'bass-guitar'],
  [/mandolin/i, 'mandolin'],
  [/shamisen|banjo/i, 'banjo-1'],
  // Bowed and plucked strings.
  [/\bviola\b|tremolo|pizzicato/i, 'violin-2'],
  [/cello|contrabass/i, 'violin-3'],
  [/violin|fiddle|string/i, 'violin-1'],
  [/harp\b/i, 'harp-1'],
  [/erhu|banhu/i, 'rebab'],
  [/sitar|pipa|\boud\b/i, 'oud'],
  [/lyre/i, 'lyre'],
  [/timpani|melodic tom|\btom\b/i, 'tom-drum'],
  // Brass.
  [/muted trumpet/i, 'trumpet-2'],
  [/brass section/i, 'trumpet-3'],
  [/synth brass|suona/i, 'trumpet-4'],
  [/trumpet|bugle|cornet/i, 'trumpet-1'],
  [/french horn|flugel/i, 'flugelhorn'],
  [/trombone/i, 'trombone'],
  [/tuba/i, 'tuba'],
  // Woodwinds. The pack has no oboe or bassoon; the clarinet stands in for the reed family.
  [/soprano sax/i, 'saxophone-2'],
  [/tenor sax/i, 'saxophone-3'],
  [/baritone sax/i, 'saxophone-4'],
  [/sax/i, 'saxophone-1'],
  [/clarinet|oboe|english horn|bassoon|shanai/i, 'clarinet'],
  [/pan flute/i, 'pan-flute-1'],
  [/bottle/i, 'pan-flute-2'],
  [/flute|piccolo|dizi/i, 'flute'],
  [/recorder/i, 'recorder-1'],
  [/shakuhachi|whistle/i, 'recorder-2'],
  // Drums and small percussion.
  [/\bkit\b|synth drum|drums?\b/i, 'drum-kit'],
  [/snare/i, 'snare-drum-1'],
  [/taiko/i, 'tabor-drum'],
  [/djembe/i, 'djembe-1'],
  [/conga/i, 'conga'],
  [/bongo/i, 'bongos-1'],
  [/tambourine/i, 'tambourine-1'],
  [/triangle/i, 'triangle-1'],
  [/maraca/i, 'maracas-1'],
  [/cabasa/i, 'cabasa'],
  [/gong/i, 'gong'],
  [/cymbal/i, 'cymbal'],
  [/woodblock|wood block/i, 'wood-block'],
  // Synth patches last: anything played from a synth keyboard. Voice Lead and
  // Choir Pad belong to the Voices family and are excluded (no art for voices).
  [/voice|choir|vocal|\baah|\booh/i, null],
  [/synth|\blead\b|\bpad\b|rain|sound track|crystal|atmosphere|brightness|goblin|echoes|sci-?fi/i, 'keyboard-1'],
];

const FAMILY_ART = Object.freeze({
  pianos: 'upright-piano',
  keys: 'accordion-1',
  guitars: 'acoustic-guitar-1',
  strings: 'violin-1',
  voices: null,
  winds: 'trumpet-1',
  synths: 'keyboard-1',
  world: 'oud',
  fun: 'drum-kit',
});

/** Every illustration basename this module can return. */
export const ART_NAMES = Object.freeze(new Set([
  ...RULES.map(([, name]) => name).filter(Boolean),
  ...Object.values(FAMILY_ART).filter(Boolean),
]));

/** Illustration basename (no ".svg") for a voice name, or null when the pack has none. */
export function voiceArt(name) {
  const s = String(name || '');
  if (!s) return null;
  for (const [re, art] of RULES) if (re.test(s)) return art;
  return null;
}

/** One representative illustration per rail family, or null (Voices, Mine). */
export function familyArt(familyId) {
  return FAMILY_ART[familyId] ?? null;
}

export default voiceArt;
