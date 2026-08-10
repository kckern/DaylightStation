import { GM_PROGRAMS } from './presetManifest.js';
import { VOICE_GROUPS } from '../devices/suzukiMdg400.js';

export const FRIENDLY_VOICE_NAMES = Object.freeze({
  0: 'Grand Piano',
  4: 'E-Piano',
  24: 'Nylon Guitar',
  25: 'Steel Guitar',
  32: 'Acoustic Bass',
  33: 'Fingered Bass',
  48: 'Strings',
  88: 'Synth Pad',
});

export const GM_FAMILY_SECTIONS = Object.freeze(
  VOICE_GROUPS
    .filter((group) => group.voices.every((voice) => voice.bank === 0))
    .map((group) => Object.freeze({
      family: group.group,
      voices: Object.freeze(group.voices.map(({ name, pc }) => Object.freeze({ program: pc, name }))),
    })),
);

const GM_NAME_BY_PROGRAM = new Map(
  GM_FAMILY_SECTIONS.flatMap((section) => section.voices.map((voice) => [voice.program, voice.name])),
);

export function voiceName(program) {
  if (program == null) return 'Drums';
  return FRIENDLY_VOICE_NAMES[program]
    ?? GM_NAME_BY_PROGRAM.get(program)
    ?? `Voice ${program + 1}`;
}

export const BASE_VOICES = Object.freeze(
  GM_PROGRAMS.map((program) => Object.freeze({ program, name: voiceName(program) })),
);
