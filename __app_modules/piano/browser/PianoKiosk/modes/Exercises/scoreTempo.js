export function scaleScoreTempoMap(entries = [], percent = 100) {
  const factor = Number(percent) / 100;
  if (!(factor > 0)) return entries.map((entry) => ({ ...entry }));
  return entries.map((entry) => ({ ...entry, bpm: entry.bpm * factor }));
}

export function scaledScoreBpm(bpm, percent = 100) {
  const factor = Number(percent) / 100;
  return bpm > 0 && factor > 0 ? bpm * factor : bpm;
}
