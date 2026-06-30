// candidates.js — pure list of reverb/chorus control candidates to probe.
//
// Each candidate carries a `dry` and `wet` list of MIDI messages (byte arrays).
// The harness applies dry → records a clip → applies wet → records a clip, with
// the SAME note. The analyzer flags the candidate whose WET tail beats its DRY
// tail: that message sequence is the one the MDG-400 actually honors.
//
// `sysex: true` candidates need a SysEx-capable MIDI access; if unavailable the
// harness skips them and records nothing for that candidate.

import {
  cc, programChange,
  GM2_SYSTEM_ON,
  GS_RESET, gsReverbMacro, gsReverbLevel, gsChorusMacro, gsChorusLevel,
  XG_SYSTEM_ON, xgReverbType, xgReverbReturn, xgChorusType, xgChorusReturn,
  gm2ReverbType, gm2ChorusType, isSysex,
} from './sysex.js';

const PIANO = programChange(0); // Acoustic Grand — re-assert after any reset

/** Ordered candidate list. groupKind is 'reverb' | 'chorus'. */
export function buildCandidates() {
  return [
    // ── Reverb ────────────────────────────────────────────────────────────
    // Channel-CC reverb (CC80/91) was rigorously disproven by the effect-audit
    // level sweep — omitted here. We test only the SysEx dialects, replicated.

    // Roland GS: reset, set a Hall reverb macro + level (the macro also sets
    //    the per-part send), vs reset + zero level.
    { id: 'rv-gs', kind: 'reverb', label: 'GS reset + reverb macro/level', sysex: true,
      dry: [GS_RESET, PIANO, gsReverbLevel(0)],
      wet: [GS_RESET, PIANO, gsReverbMacro(4), gsReverbLevel(127), cc(91, 127)] },

    // 4. Yamaha XG: system-on, reverb type Hall1 + return, vs return 0.
    { id: 'rv-xg', kind: 'reverb', label: 'XG on + reverb type/return', sysex: true,
      dry: [XG_SYSTEM_ON, PIANO, xgReverbReturn(0)],
      wet: [XG_SYSTEM_ON, PIANO, xgReverbType(1, 0), xgReverbReturn(127), cc(91, 127)] },

    // 5. GM2 Global Parameter Control reverb type + CC91 send.
    { id: 'rv-gm2', kind: 'reverb', label: 'GM2 reverb type + CC91', sysex: true,
      dry: [GM2_SYSTEM_ON, PIANO, cc(91, 0)],
      wet: [GM2_SYSTEM_ON, PIANO, gm2ReverbType(4), cc(91, 127)] },

    // ── Chorus ────────────────────────────────────────────────────────────
    { id: 'ch-gs', kind: 'chorus', label: 'GS reset + chorus macro/level', sysex: true,
      dry: [GS_RESET, PIANO, gsChorusLevel(0)],
      wet: [GS_RESET, PIANO, gsChorusMacro(2), gsChorusLevel(127), cc(93, 127)] },

    { id: 'ch-xg', kind: 'chorus', label: 'XG on + chorus type/return', sysex: true,
      dry: [XG_SYSTEM_ON, PIANO, xgChorusReturn(0)],
      wet: [XG_SYSTEM_ON, PIANO, xgChorusType(0x41, 0), xgChorusReturn(127), cc(93, 127)] },

    { id: 'ch-gm2', kind: 'chorus', label: 'GM2 chorus type + CC93', sysex: true,
      dry: [GM2_SYSTEM_ON, PIANO, cc(93, 0)],
      wet: [GM2_SYSTEM_ON, PIANO, gm2ChorusType(2), cc(93, 127)] },
  ];
}

/** Whether a candidate uses any SysEx message (drives the skip-if-no-sysex gate). */
export function candidateNeedsSysex(c) {
  return c.sysex === true || [...c.dry, ...c.wet].some(isSysex);
}
