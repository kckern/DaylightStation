// matrix.js — pure builders for the effect-audit sweep. No React, no MIDI I/O.
//
// The harness consumes buildAuditMatrix(effects) for the ordered permutation
// list and buildStimulus() for the fixed note events. `effects` is the device
// profile's `effects` object (suzukiMdg400.js): reverb/chorus {typeCC,levelCC,types}.

// Fixed stimulus: one staccato C4 (MIDI 60). The clean release isolates the
// effect tail from the struck note.
export const STIMULUS = {
  note: 60,
  velocity: 96,
  onMs: 0,
  offMs: 300,         // note_off 300ms after note_on
  recordLeadMs: 100,  // start recorder this long before note_on
  recordTailMs: 3300, // keep recording this long after note_off
};

export function buildStimulus() {
  return [
    { t: STIMULUS.onMs, type: 'note_on', note: STIMULUS.note, velocity: STIMULUS.velocity },
    { t: STIMULUS.offMs, type: 'note_off', note: STIMULUS.note, velocity: 0 },
  ];
}

export function recordTotalMs() {
  return STIMULUS.recordLeadMs + STIMULUS.offMs + STIMULUS.recordTailMs;
}

// Voices for the instrument control clips (GM program number = pc).
export const VOICE_PIANO = { name: 'Ac. Grand', pc: 0, bank: 0 };
export const VOICE_STRINGS = { name: 'Strings', pc: 48, bank: 0 };

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/**
 * Ordered permutation list. Each item:
 *   { label, group, voice:{name,pc,bank}, cc:[{controller,value}] }
 * The harness sends sendVoice(voice.pc, voice.bank), then every cc as a
 * Control Change, then plays the stimulus and records.
 */
export function buildAuditMatrix(effects) {
  const rv = effects.reverb;
  const ch = effects.chorus;
  const m = [];
  let n = 0;
  const pad = () => String(n++).padStart(2, '0');
  const allOff = () => [
    { controller: rv.levelCC, value: 0 },
    { controller: ch.levelCC, value: 0 },
  ];

  // Control: everything off.
  m.push({ label: `${pad()}-control`, group: 'control', voice: VOICE_PIANO, cc: allOff() });

  // Reverb depth sweep @ Hall(4), chorus off.
  for (const level of [0, 32, 64, 100, 127]) {
    m.push({
      label: `${pad()}-reverb-hall-l${String(level).padStart(3, '0')}`,
      group: 'reverb-depth', voice: VOICE_PIANO,
      cc: [
        { controller: ch.levelCC, value: 0 },
        { controller: rv.typeCC, value: 4 },
        { controller: rv.levelCC, value: level },
      ],
    });
  }

  // Reverb type sweep @ level 100, chorus off.
  for (const type of rv.types) {
    m.push({
      label: `${pad()}-reverb-type-${slug(type.label)}`,
      group: 'reverb-type', voice: VOICE_PIANO,
      cc: [
        { controller: ch.levelCC, value: 0 },
        { controller: rv.typeCC, value: type.value },
        { controller: rv.levelCC, value: 100 },
      ],
    });
  }

  // Chorus depth sweep @ Chorus-3(2), reverb off.
  for (const level of [0, 64, 127]) {
    m.push({
      label: `${pad()}-chorus-l${String(level).padStart(3, '0')}`,
      group: 'chorus-depth', voice: VOICE_PIANO,
      cc: [
        { controller: rv.levelCC, value: 0 },
        { controller: ch.typeCC, value: 2 },
        { controller: ch.levelCC, value: level },
      ],
    });
  }

  // Instrument control (rig sanity): PC is known-good, so an audible timbre
  // change here proves the capture+analysis chain can detect a real difference.
  for (const voice of [VOICE_PIANO, VOICE_STRINGS, VOICE_PIANO]) {
    m.push({
      label: `${pad()}-instrument-${slug(voice.name)}`,
      group: 'instrument', voice, cc: allOff(),
    });
  }

  return m;
}
