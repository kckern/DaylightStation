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
  GM2_SYSTEM_ON, gmMasterVolume,
  GS_RESET, gsReverbMacro, gsReverbLevel, gsChorusMacro, gsChorusLevel,
  XG_SYSTEM_ON, xgReverbType, xgReverbReturn, xgChorusType, xgChorusReturn,
  gm2ReverbType, gm2ChorusType, isSysex,
} from './sysex.js';

const PIANO = programChange(0); // Acoustic Grand — re-assert after any reset

// An NRPN value-set = three CCs: 99=param MSB, 98=param LSB, 6=Data Entry value.
// The MDG-400 TRANSMITS its EQ as NRPN (MSB 10) and reverb/chorus as CC91/93;
// these candidates test whether SENDING NRPN/CC also SETs them (CC-based => would
// survive the Jamcorder, unlike SysEx).
const nrpn = (msb, lsb, value) => [cc(99, msb), cc(98, lsb), cc(6, value)];

/** Ordered candidate list. groupKind is 'reverb' | 'chorus' | 'control'. */
export function buildCandidates() {
  return [
    // ── Control: does Universal SysEx reach the PIANO at all? ───────────────
    // GM Master Volume moves loudness unambiguously (measured by note PEAK). If
    // wet(127) is much louder than dry(0), SysEx passes the WIDI Master to the
    // piano; if not, the BLE→DIN bridge isn't forwarding SysEx (everything moot).
    { id: 'gm-mastervol', kind: 'control', label: 'GM Master Volume sweep', sysex: true,
      dry: [PIANO, gmMasterVolume(0)], wet: [PIANO, gmMasterVolume(127)] },

    // ── NRPN / CC SET tests (CC-based; survive the Jamcorder if they work) ──
    // EQ band 0 (the unit transmits EQ as NRPN MSB=10). 64=flat -> 127=max boost;
    // a spectral-centroid change ⇒ NRPN SETs the EQ.
    { id: 'eq-nrpn-10-0', kind: 'eq', sysex: false,
      dry: [PIANO, ...nrpn(10, 0, 64)], wet: [PIANO, ...nrpn(10, 0, 127)] },
    { id: 'eq-nrpn-10-9', kind: 'eq', sysex: false,
      dry: [PIANO, ...nrpn(10, 9, 64)], wet: [PIANO, ...nrpn(10, 9, 127)] },
    // The two unknown NRPN params seen during the reverb/chorus panel test.
    { id: 'nrpn-3-0', kind: 'reverb', sysex: false,
      dry: [PIANO, ...nrpn(3, 0, 0)], wet: [PIANO, ...nrpn(3, 0, 127)] },
    { id: 'nrpn-4-0', kind: 'chorus', sysex: false,
      dry: [PIANO, ...nrpn(4, 0, 0)], wet: [PIANO, ...nrpn(4, 0, 127)] },

    // ── Reverb ────────────────────────────────────────────────────────────
    // Channel-CC reverb (CC80/91) was rigorously disproven by the effect-audit
    // level sweep — omitted here. We test only the SysEx dialects, replicated.

    // Roland GS: reset, set a Hall reverb macro + level (the macro also sets
    //    the per-part send), vs reset + zero level.
    { id: 'rv-gs', kind: 'reverb', label: 'GS reset + reverb macro/level', sysex: true,
      dry: [GS_RESET, PIANO, gsReverbLevel(0)],
      wet: [GS_RESET, PIANO, gsReverbMacro(4), gsReverbLevel(127), cc(91, 127)] },

    // GM2 Global Parameter Control reverb type + CC91 send.
    { id: 'rv-gm2', kind: 'reverb', label: 'GM2 reverb type + CC91', sysex: true,
      dry: [GM2_SYSTEM_ON, PIANO, cc(91, 0)],
      wet: [GM2_SYSTEM_ON, PIANO, gm2ReverbType(4), cc(91, 127)] },

    // ── Chorus ────────────────────────────────────────────────────────────
    { id: 'ch-gs', kind: 'chorus', label: 'GS reset + chorus macro/level', sysex: true,
      dry: [GS_RESET, PIANO, gsChorusLevel(0)],
      wet: [GS_RESET, PIANO, gsChorusMacro(2), gsChorusLevel(127), cc(93, 127)] },

    { id: 'ch-gm2', kind: 'chorus', label: 'GM2 chorus type + CC93', sysex: true,
      dry: [GM2_SYSTEM_ON, PIANO, cc(93, 0)],
      wet: [GM2_SYSTEM_ON, PIANO, gm2ChorusType(2), cc(93, 127)] },
  ];
}

/** Whether a candidate uses any SysEx message (drives the skip-if-no-sysex gate). */
export function candidateNeedsSysex(c) {
  return c.sysex === true || [...c.dry, ...c.wet].some(isSysex);
}
