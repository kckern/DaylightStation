// tempoSteps.js — the practice-tempo ladder for TempoSheet.jsx (transport),
// split out so Fast Refresh can hot-reload the sheet component on its own.

// The kiosk's canonical practice-tempo ladder (percent of written tempo).
// NOT Producer's absolute-BPM sheet — that stays in producer/ until a later wave.
// Nine steps, laid out as a 3×3 grid (wave-2 T6) rather than one long row.
export const TEMPO_STEPS = [
  { label: '60%', value: 0.6 }, { label: '70%', value: 0.7 }, { label: '80%', value: 0.8 },
  { label: '90%', value: 0.9 }, { label: '100%', value: 1 }, { label: '110%', value: 1.1 },
  { label: '125%', value: 1.25 }, { label: '150%', value: 1.5 }, { label: '175%', value: 1.75 },
];

/** Which step is lit for a current value — the nearest one by amount. */
export const nearestStep = (steps, val) => {
  let best = 0;
  let bestDist = Infinity;
  steps.forEach((s, i) => {
    const d = Math.abs(s.value - val);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return best;
};
