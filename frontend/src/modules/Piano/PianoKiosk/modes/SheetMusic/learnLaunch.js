const sameParts = (a = [], b = []) => a.length === b.length
  && [...a].sort().every((part, index) => part === [...b].sort()[index]);

export function freshRunRung(rung) {
  return {
    ...rung,
    passCount: 0,
    state: 'current',
    achievementPassCount: rung.passCount ?? 0,
    achievementComplete: rung.state === 'complete',
  };
}

export function buildRungLaunch(segment, rung, source = 'recommended') {
  return {
    source,
    segmentId: segment.id,
    rungId: rung.id,
    parts: [...(rung.effectiveParts ?? [])],
    mode: rung.mode,
    tempoPercent: rung.tempoPercent ?? null,
    tempoStage: null,
    rung: source === 'recommended' ? rung : freshRunRung(rung),
  };
}

export function buildCustomLaunch(segment, choice) {
  const parts = [...new Set(choice.parts ?? [])];
  if (!parts.length || parts.some((part) => !(segment.playableParts ?? []).includes(part))) {
    throw new Error('Selected hands are unavailable for this segment');
  }
  const tempoPercent = choice.mode === 'free' ? null : choice.tempoPercent;
  return {
    source: 'custom', segmentId: segment.id, rungId: null, parts,
    mode: choice.mode, tempoPercent,
    tempoStage: choice.mode === 'free' ? null : choice.tempoStage,
    sets: 1, reps: 1,
    rung: {
      id: 'custom', label: 'Custom practice', effectiveParts: parts, mode: choice.mode,
      tempoPercent, sets: 1, reps: 1, required: 1, passCount: 0, state: 'current',
      criteria: choice.mode === 'cued'
        ? { completeness: 1, cleanliness: 0.8, placement: 0.8 }
        : { completeness: 1, cleanliness: 0.8 },
    },
  };
}

export function creditEligibleRung(segment, launch) {
  return (segment.rungs ?? []).find((rung) => rung.state !== 'locked' && rung.state !== 'complete'
    && sameParts(rung.effectiveParts, launch.parts)
    && rung.mode === launch.mode
    && (rung.mode === 'free' || Number(rung.tempoPercent) === Number(launch.tempoPercent))) ?? null;
}

export function learnLaunchpadProjection(segment) {
  const normal = (segment.rungs ?? []).filter((rung) => rung.id !== 'test-out');
  return {
    recommended: normal.find((rung) => rung.state !== 'locked' && rung.state !== 'complete') ?? null,
    review: normal.filter((rung) => rung.state !== 'locked'),
    testOut: (segment.rungs ?? []).find((rung) => rung.id === 'test-out' && rung.state !== 'locked') ?? null,
  };
}

export default { buildCustomLaunch, buildRungLaunch, creditEligibleRung, freshRunRung, learnLaunchpadProjection };
