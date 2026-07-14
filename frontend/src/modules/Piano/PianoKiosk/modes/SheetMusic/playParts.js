// playParts — Play-mode part model. A "part" is a staff of the engraved score;
// each part has a role: 'play' (kiosk performs it through the piano) or 'you'
// (the user's part — engraved + highlighted, never sent to MIDI out). Both-play =
// pure playback; melody-'you' = hybrid practice (the user plays along).

import { buildStepTimeline, buildNoteTimeline } from '../../../../MusicNotation/scoreTimeline.js';

/** Distinct staves present in the extracted notes, default role 'play'. */
export function partsOf(notes) {
  const staves = [...new Set((notes || []).map((n) => n.staff))].sort((a, b) => a - b);
  return staves.map((staff) => ({ staff, role: 'play' }));
}

// Two states only: the kiosk plays it ('play') or you do ('you'). Muting every
// staff is just Learn; a dedicated 'mute' role was dropped as redundant (A4).
const CYCLE = { play: 'you', you: 'play' };
export function cyclePart(role) { return CYCLE[role] || 'play'; }

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

/** Pitches of 'you' parts at an exact onset, or null when no you-part is set. */
export function youMidisAt(notes, roles, onsetQuarter) {
  if (!Object.values(roles).includes('you')) return null;
  const set = new Set(
    (notes || [])
      .filter((n) => (roles[n.staff] || 'play') === 'you' && n.onsetQuarter === onsetQuarter)
      .map((n) => n.midi),
  );
  return set.size ? set : null;
}

export default { partsOf, cyclePart, buildPlayTimeline, youMidisAt };
