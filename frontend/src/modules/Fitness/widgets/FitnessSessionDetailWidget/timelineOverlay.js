// Pure geometry helpers for overlaying race bands + seams on the tick-based timeline axis.
export function msToTickX(ms, { intervalMs, effectiveTicks, plotWidth, marginLeft = 0 }) {
  if (!(effectiveTicks > 1)) return marginLeft;
  const tick = intervalMs > 0 ? ms / intervalMs : 0;
  return marginLeft + (tick / (effectiveTicks - 1)) * plotWidth;
}

function clampX(x, { marginLeft = 0, plotWidth }) {
  return Math.min(marginLeft + plotWidth, Math.max(marginLeft, x));
}

export function computeRaceBands(activities, opts) {
  if (!Array.isArray(activities) || !activities.length) return [];
  const bands = [];
  for (const act of activities) {
    for (const it of act.items || []) {
      if (!Number.isFinite(it.axisStartMs) || !Number.isFinite(it.axisEndMs)) continue;
      const x = clampX(msToTickX(it.axisStartMs, opts), opts);
      const xEnd = clampX(msToTickX(it.axisEndMs, opts), opts);
      bands.push({ x, width: Math.max(0, xEnd - x), winnerId: it.meta?.winnerId ?? null, raceId: it.meta?.raceId ?? null });
    }
  }
  return bands;
}

export function computeSeamLines(seams, opts) {
  if (!Array.isArray(seams) || !seams.length) return [];
  return seams.map((s) => ({ x: clampX(msToTickX(s.atMs, opts), opts), gapMs: s.gapMs }));
}
