/**
 * gmSynthTier — VoiceRouter tier 2: the browser gmSynth (design §2 / Task 3.2).
 *
 * The GUARANTEED tier: supports() is always true, so every channel the higher
 * tiers decline lands here. Deliberately a pure method-name mapping — gmSynth
 * already logs, clamps, and drops safely on its side (never throws
 * mid-performance), so adding try/catch or logging here would just duplicate
 * it. Channel convention matches throughout: 0-indexed, drums on 9.
 */

/**
 * @param {object} opts
 * @param {object} opts.synth - a createGmSynth() instance.
 * @returns VoiceRouter tier adapter (id 'gm-synth').
 */
export function createGmSynthTier({ synth }) {
  return {
    id: 'gm-synth',
    supports: () => true,
    noteOn: (channel, note, velocity) => synth.noteOn(channel, note, velocity),
    noteOff: (channel, note) => synth.noteOff(channel, note),
    setProgram: (channel, program) => synth.setChannelProgram(channel, program),
    setGain: (channel, gain) => synth.setChannelGain(channel, gain),
    allNotesOff: (channel) => synth.allNotesOff(channel),
  };
}

export default createGmSynthTier;
