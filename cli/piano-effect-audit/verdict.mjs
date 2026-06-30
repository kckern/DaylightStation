// verdict.mjs — turn per-clip metrics into effective/ignored verdicts.
// Input clips: [{ label, group, metrics:{ tailDb, decayMs, centroid, spread } }]

const byGroup = (clips, g) => clips.filter((c) => c.group === g);
const round = (x) => Math.round(x * 10) / 10;

export function verdict(clips) {
  const depth = byGroup(clips, 'reverb-depth');
  const types = byGroup(clips, 'reverb-type');
  const chorus = byGroup(clips, 'chorus-depth');
  const inst = byGroup(clips, 'instrument');

  const tail = (c) => c?.metrics?.tailDb ?? -120;
  const decay = (c) => c?.metrics?.decayMs ?? 0;
  const centroid = (c) => c?.metrics?.centroid ?? 0;
  const spread = (c) => c?.metrics?.spread ?? 0;

  // Reverb depth: loudest-reverb vs reverb-off tail energy.
  const rOff = depth.find((c) => /l000$/.test(c.label));
  const rMax = depth.find((c) => /l127$/.test(c.label));
  const reverbDepthDeltaDb = tail(rMax) - tail(rOff);
  const reverbDepthEffective = reverbDepthDeltaDb >= 3; // >=3 dB more tail = audible

  // Reverb type: spread of decay times (hall should ring longer than plate/room).
  const typeDecays = types.map(decay).filter((x) => x > 0);
  const reverbTypeSpreadMs = typeDecays.length ? Math.max(...typeDecays) - Math.min(...typeDecays) : 0;
  const reverbTypeEffective = reverbTypeSpreadMs >= 120; // >=120 ms spread = distinguishable

  // Chorus: tail energy or spectral-spread change off->max.
  const cOff = chorus.find((c) => /l000$/.test(c.label));
  const cMax = chorus.find((c) => /l127$/.test(c.label));
  const chorusDeltaDb = tail(cMax) - tail(cOff);
  const chorusSpreadHz = Math.abs(spread(cMax) - spread(cOff));
  const chorusEffective = chorusDeltaDb >= 3 || chorusSpreadHz >= 20;

  // Instrument control (rig sanity): centroid must change piano->strings.
  const instCentroids = inst.map(centroid);
  const instCentroidSpread = instCentroids.length ? Math.max(...instCentroids) - Math.min(...instCentroids) : 0;
  const instrumentDetectable = instCentroidSpread >= 150;

  const rec = [];
  rec.push(reverbDepthEffective
    ? 'KEEP reverb depth slider — measurable tail-energy change.'
    : 'REMOVE/REVIEW reverb depth slider — no measurable tail change (CC 91 likely ignored).');
  rec.push(reverbTypeEffective
    ? 'KEEP reverb type selector — types produce distinguishable decay.'
    : 'REMOVE/REVIEW reverb type selector — types indistinguishable (CC 80 likely ignored).');
  rec.push(chorusEffective
    ? 'KEEP chorus controls — measurable modulation/energy change.'
    : 'REMOVE/REVIEW chorus controls — no measurable change (CC 93 likely ignored).');
  if (!instrumentDetectable) {
    rec.push('WARNING: instrument control clips show no timbre change — the capture/analysis rig may be faulty; treat "ignored" verdicts with suspicion.');
  }

  return {
    reverbOnOff: { effective: reverbDepthEffective, deltaDb: round(reverbDepthDeltaDb) },
    reverbDepth: { effective: reverbDepthEffective, deltaDb: round(reverbDepthDeltaDb) },
    reverbType: { effective: reverbTypeEffective, spreadMs: round(reverbTypeSpreadMs) },
    chorus: { effective: chorusEffective, deltaDb: round(chorusDeltaDb), spreadHz: round(chorusSpreadHz) },
    instrument: { detectable: instrumentDetectable, centroidSpreadHz: round(instCentroidSpread) },
    recommendations: rec,
  };
}
