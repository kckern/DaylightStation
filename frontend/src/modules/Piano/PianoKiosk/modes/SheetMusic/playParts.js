// playParts — Play-mode part model. A "part" is a staff of the engraved score;
// each part has a role: 'play' (kiosk performs it through the piano) or 'mute'
// (an inactive staff — never sent to MIDI out, and no longer highlighted as
// "yours" to play along with; the play-along machinery was retired in wave-3 A).
// One role model, every mode: Listen performs the active hands; Learn/Polish
// practice them.

import { buildStepTimeline, buildNoteTimeline } from '../../../../MusicNotation/scoreTimeline.js';

/** Distinct staves present in the extracted notes, default role 'play'. */
export function partsOf(notes) {
  const staves = [...new Set((notes || []).map((n) => n.staff))].sort((a, b) => a - b);
  return staves.map((staff) => ({ staff, role: 'play' }));
}

/**
 * Merged transport timeline: cursor steps ({kind:'step', index}) + note events
 * for audible parts. Steps sort before notes at the same instant so the cursor
 * lands before its notes sound.
 */
export function buildPlayTimeline(events, notes, tempoMap, roles) {
  const steps = buildStepTimeline(events, tempoMap).map((s) => ({ ...s, kind: 'step' }));
  const noteEvts = buildNoteTimeline(notes, tempoMap, { isAudible: (n) => (roles[n.staff] || 'play') === 'play' });
  return [...steps, ...noteEvts].sort((a, b) => a.t - b.t || (a.kind === 'step' ? -1 : b.kind === 'step' ? 1 : 0));
}

export default { partsOf, buildPlayTimeline };
