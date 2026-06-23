// Suzuki MDG-400 Micro Grand — device profile (from the owner's manual).
//
// 128 GM voices (display No. = MIDI Program + 1) + 10 Asian-folk voices reached
// via Bank Select + Program Change. Effects + the MIDI-IN map come straight from
// the manual's MIDI Implementation Chart (p.45): the keyboard RECOGNISES Program
// Change (voice), CC80 (Reverb program/type), CC81 (Chorus program/type) and
// CC91 (Reverb/Chorus send level). Bank Select (CC0) is transmit-only per the
// chart, so the folk voices are best-effort over MIDI IN.
//
// This module is the single source of truth; the YAML mirror in the data tree
// (data/household/apps/piano/devices/suzuki-mdg-400.yml) is generated from it.

/** The 16 GM voice families in order, each with its 8 voice names (manual spelling). */
const GM_FAMILIES = [
  ['Piano', ['Acoustic Grand', 'Bright Acoustic', 'Electric Grand', 'Honky-Tonk', 'Electric Piano 1', 'Electric Piano 2', 'Harpsichord', 'Clavichord']],
  ['Chromatic Percussion', ['Celesta', 'Glockenspiel', 'Music Box', 'Vibraphone', 'Marimba', 'Xylophone', 'Tubular Bells', 'Dulcimer']],
  ['Organ', ['Drawbar Organ', 'Percussive Organ', 'Rock Organ', 'Church Organ', 'Reed Organ', 'Accordion', 'Harmonica', 'Tango Accordion']],
  ['Guitar', ['Nylon Guitar', 'Steel Guitar', 'Jazz Guitar', 'Clean Guitar', 'Muted Guitar', 'Overdriven Guitar', 'Distortion Guitar', 'Guitar Harmonics']],
  ['Bass', ['Acoustic Bass', 'Finger Bass', 'Pick Bass', 'Fretless Bass', 'Slap Bass 1', 'Slap Bass 2', 'Synth Bass 1', 'Synth Bass 2']],
  ['Strings', ['Violin', 'Viola', 'Cello', 'Contrabass', 'Tremolo Strings', 'Pizzicato Strings', 'Orchestral Harp', 'Timpani']],
  ['Ensemble', ['String Ensemble 1', 'String Ensemble 2', 'Synth Strings 1', 'Synth Strings 2', 'Choir Aahs', 'Voice Oohs', 'Synth Voice', 'Orchestra Hit']],
  ['Brass', ['Trumpet', 'Trombone', 'Tuba', 'Muted Trumpet', 'French Horn', 'Brass Section', 'Synth Brass 1', 'Synth Brass 2']],
  ['Reed', ['Soprano Sax', 'Alto Sax', 'Tenor Sax', 'Baritone Sax', 'Oboe', 'English Horn', 'Bassoon', 'Clarinet']],
  ['Pipe', ['Piccolo', 'Flute', 'Recorder', 'Pan Flute', 'Bottle Blow', 'Shakuhachi', 'Whistle', 'Ocarina']],
  ['Synth Lead', ['Square Lead', 'Sawtooth Lead', 'Calliope Lead', 'Chiff Lead', 'Charang Lead', 'Voice Lead', 'Fifth Lead', 'Bass + Lead']],
  ['Synth Pad', ['New Age Pad', 'Warm Pad', 'PolySynth Pad', 'Choir Pad', 'Bowed Pad', 'Metallic Pad', 'Halo Pad', 'Sweep Pad']],
  ['Synth Effect', ['Rain', 'Sound Track', 'Crystal', 'Atmosphere', 'Brightness', 'Goblins', 'Echoes', 'Sci-Fi']],
  ['Ethnic', ['Sitar', 'Banjo', 'Shamisen', 'Koto', 'Kalimba', 'Bagpipe', 'Fiddle', 'Shanai']],
  ['Percussive', ['Tinkle Bell', 'Agogo', 'Steel Drums', 'Woodblock', 'Taiko Drum', 'Melodic Tom', 'Synth Drum', 'Reverse Cymbal']],
  ['Sound Effect', ['Guitar Fret Noise', 'Breath Noise', 'Seashore', 'Bird Tweet', 'Telephone Ring', 'Helicopter', 'Applause', 'Gunshot']],
];

// 10 Asian-folk voices (manual p.48): Bank 1 + the listed Program Change.
const FOLK_VOICES = [
  { name: 'Yangqin', pc: 15, bank: 1 },
  { name: 'Pipa', pc: 106, bank: 1 },
  { name: 'Zheng', pc: 107, bank: 1 },
  { name: 'Erhu', pc: 110, bank: 1 },
  { name: 'Banhu', pc: 0, bank: 1 },
  { name: 'Suona', pc: 1, bank: 1 },
  { name: 'Sheng', pc: 2, bank: 1 },
  { name: 'Dizi', pc: 3, bank: 1 },
  { name: 'Erhu + Yangqin', pc: 7, bank: 1 },
  { name: 'Dizi + Zheng', pc: 11, bank: 1 },
];

/** Grouped voice list: [{ group, voices: [{ no, name, pc, bank }] }]. */
export const VOICE_GROUPS = (() => {
  const groups = [];
  let no = 1;
  for (const [group, names] of GM_FAMILIES) {
    groups.push({ group, voices: names.map((name) => ({ no: no, name, pc: no++ - 1, bank: 0 })) });
  }
  groups.push({ group: 'Asian Folk', voices: FOLK_VOICES.map((v) => ({ no: no++, name: v.name, pc: v.pc, bank: v.bank })) });
  return groups;
})();

/** Flat lookup of every voice. */
export const ALL_VOICES = VOICE_GROUPS.flatMap((g) => g.voices);

// Reverb/Chorus over MIDI IN: CC80/CC81 pick the program (type), CC91 the send
// level. The unit's panel only exposes on/off + level; type select is the GM2
// algorithm number (best-effort — labels are conventional GM2 names).
export const EFFECTS = {
  reverb: {
    label: 'Reverb',
    typeCC: 80,
    levelCC: 91,
    defaultType: 4, // Hall
    types: [
      { value: 0, label: 'Room' },
      { value: 2, label: 'Large Room' },
      { value: 4, label: 'Hall' },
      { value: 5, label: 'Large Hall' },
      { value: 8, label: 'Plate' },
    ],
  },
  chorus: {
    label: 'Chorus',
    typeCC: 81,
    levelCC: 93, // GM-standard chorus send (chart lists only 91; 93 is best-effort)
    defaultType: 2,
    types: [
      { value: 0, label: 'Chorus 1' },
      { value: 1, label: 'Chorus 2' },
      { value: 2, label: 'Chorus 3' },
      { value: 4, label: 'FB Chorus' },
      { value: 5, label: 'Flanger' },
    ],
  },
};

export const SUZUKI_MDG_400 = {
  id: 'suzuki-mdg-400',
  name: 'Suzuki MDG-400',
  voiceGroups: VOICE_GROUPS,
  effects: EFFECTS,
};

/** Registry so config `device:` ids resolve to a profile. */
const DEVICES = { 'suzuki-mdg-400': SUZUKI_MDG_400 };
export function getDeviceProfile(id) {
  return id ? DEVICES[id] || null : null;
}

export default SUZUKI_MDG_400;
