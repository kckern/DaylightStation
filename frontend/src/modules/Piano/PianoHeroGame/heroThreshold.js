const positiveModulo = (value, modulus) => ((value % modulus) + modulus) % modulus;

export const HERO_THRESHOLD_FEEDBACK_MS = 260;
export const HERO_THRESHOLD_BEAT_FLASH_MS = 150;

/** Derive short-lived line effects from the same score-aligned beat grid as the click. */
export function heroThresholdState({
  targets = [],
  elapsedMs = 0,
  leadInMs = 0,
  bpm,
  beatsPerBar = 4,
  pulseBeat = false,
}) {
  const effects = targets.flatMap((target) => {
    if (target.state !== 'hit' && target.state !== 'missed') return [];
    if (!Number.isFinite(target.resolvedAt)) return [];
    const ageMs = elapsedMs - target.resolvedAt;
    if (!Number.isFinite(ageMs) || ageMs < 0 || ageMs >= HERO_THRESHOLD_FEEDBACK_MS) return [];
    return (target.pitches || []).map((pitch) => ({
      id: `${target.id}-${pitch}-${target.state}-${target.resolvedAt}`,
      pitch,
      kind: target.state === 'hit' ? 'hit' : 'miss',
    }));
  });

  if (!pulseBeat || !(bpm > 0)) return { effects, beatIndex: null, downbeat: false };
  const periodMs = 60000 / bpm;
  const beatIndex = Math.floor((elapsedMs - leadInMs) / periodMs + 1e-9);
  const beatAtMs = leadInMs + beatIndex * periodMs;
  const beatAgeMs = elapsedMs - beatAtMs;
  const bar = Number.isFinite(beatsPerBar) && beatsPerBar > 0 ? Math.round(beatsPerBar) : 4;
  const flashing = beatAgeMs >= 0 && beatAgeMs < HERO_THRESHOLD_BEAT_FLASH_MS;
  return {
    effects,
    beatIndex: flashing ? beatIndex : null,
    downbeat: flashing && positiveModulo(beatIndex, bar) === 0,
  };
}

export default heroThresholdState;
