// Pure planner: turn a sound Bundle into the ordered list of re-assert ops.
// Order matters — voice (PC/bank) first, then reverb, chorus, volume — so a
// full re-assert always lands the same way regardless of what triggered it.
export function planBundleOps(bundle) {
  if (!bundle || typeof bundle !== 'object') return [];
  const ops = [];
  if (bundle.voice && bundle.voice.pc != null) {
    ops.push({ kind: 'voice', pc: bundle.voice.pc, bank: bundle.voice.bank || 0 });
  }
  if (bundle.reverb && bundle.reverb.type != null) {
    ops.push({ kind: 'reverb', type: bundle.reverb.type, level: bundle.reverb.level || 0, on: !!bundle.reverb.on });
  }
  if (bundle.chorus && bundle.chorus.type != null) {
    ops.push({ kind: 'chorus', type: bundle.chorus.type, level: bundle.chorus.level || 0, on: !!bundle.chorus.on });
  }
  if (bundle.volume != null) {
    ops.push({ kind: 'volume', value: bundle.volume });
  }
  return ops;
}
