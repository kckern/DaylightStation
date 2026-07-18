/**
 * Sessionization, scoring, and budget selection — pure functions over clip
 * metadata. No camera, no NVR, no ffmpeg, no filesystem.
 *
 * This is the part of the system most likely to need tuning, which is exactly
 * why it is kept free of I/O: it can be exercised against captured fixtures.
 */

/**
 * Normalize a Reolink search record into a plain clip.
 *
 * Camera records carry `name` (with trigger bits in the filename); NVR records
 * do not — they carry `PlaybackTime` instead. Callers must tolerate a missing
 * name rather than assuming the camera shape.
 */
export function toClip(record, { date } = {}) {
  const start = reolinkTimeToDate(record.StartTime);
  const end = reolinkTimeToDate(record.EndTime);
  const sizeBytes = Number(record.size);
  const durationSec = Math.max(1, (end - start) / 1000);
  return {
    start,
    end,
    durationSec,
    sizeBytes,
    name: record.name ?? null,
    densityMBPerMin: sizeBytes / 1e6 / (durationSec / 60),
    date: date ?? null,
  };
}

export function reolinkTimeToDate(t) {
  return new Date(t.year, t.mon - 1, t.day, t.hour, t.min, t.sec);
}

/**
 * Cluster clips into activity sessions.
 *
 * Consecutive clips separated by <= maxGapSeconds belong to the same session.
 * Continuous NVR footage arrives as adjacent hour segments and will collapse
 * into one session per day, which is correct — selection for those days is
 * driven by the ledger, not by clip boundaries.
 */
export function sessionize(clips, { maxGapSeconds = 120 } = {}) {
  if (!clips.length) return [];
  const sorted = [...clips].sort((a, b) => a.start - b.start);
  const sessions = [];
  let current = newSession(sorted[0]);

  for (const clip of sorted.slice(1)) {
    const gapSec = (clip.start - current.end) / 1000;
    if (gapSec <= maxGapSeconds) {
      current.clips.push(clip);
      current.end = new Date(Math.max(current.end, clip.end));
      current.sizeBytes += clip.sizeBytes;
    } else {
      sessions.push(finalize(current));
      current = newSession(clip);
    }
  }
  sessions.push(finalize(current));
  return sessions;
}

function newSession(clip) {
  return { start: clip.start, end: clip.end, clips: [clip], sizeBytes: clip.sizeBytes };
}

function finalize(session) {
  const durationSec = Math.max(1, (session.end - session.start) / 1000);
  return {
    ...session,
    durationSec,
    densityMBPerMin: session.sizeBytes / 1e6 / (durationSec / 60),
    labels: [],
  };
}

/**
 * Attach trigger labels from the detection ledger.
 *
 * A session takes the union of labels from ledger records overlapping it. The
 * weakest `source` present is recorded so downstream consumers can tell an HA
 * person-detection from a density guess and re-classify later.
 */
export function labelSessions(sessions, ledgerRecords, { toleranceSeconds = 15 } = {}) {
  const tol = toleranceSeconds * 1000;
  return sessions.map((session) => {
    const labels = new Set();
    const sources = new Set();
    for (const rec of ledgerRecords) {
      const rStart = new Date(rec.ts).getTime();
      const rEnd = new Date(rec.endTs ?? rec.ts).getTime();
      const overlaps = rStart - tol <= session.end.getTime() && rEnd + tol >= session.start.getTime();
      if (!overlaps) continue;
      for (const l of rec.labels ?? []) labels.add(l);
      if (rec.source) sources.add(rec.source);
    }
    return {
      ...session,
      labels: [...labels],
      classificationSource: weakestSource(sources),
    };
  });
}

const SOURCE_STRENGTH = { ha: 3, 'filename-bits': 2, density: 1 };

function weakestSource(sources) {
  if (!sources.size) return 'none';
  return [...sources].sort((a, b) => (SOURCE_STRENGTH[a] ?? 0) - (SOURCE_STRENGTH[b] ?? 0))[0];
}

/**
 * Score a session.
 *
 *   score = duration * trigger_weight * density_gate
 *
 * The density gate is what stops long night-time noise sessions from
 * dominating a duration-ranked list: a static dark scene compresses to almost
 * nothing, so its MB/min collapses while real daytime activity stays high.
 */
export function scoreSession(session, config) {
  const { triggerWeights, densityFloorMBPerMin, densityPenalty } = config;
  const weight = Math.max(
    ...(session.labels.length ? session.labels : ['motion']).map(
      (l) => triggerWeights[l] ?? triggerWeights.motion ?? 1,
    ),
  );
  const gate = isDensityGated(session, config) ? densityPenalty : 1;
  return session.durationSec * weight * gate;
}

/** True when the session's bitrate says it is a static scene (night noise). */
export function isDensityGated(session, config) {
  return session.densityMBPerMin < config.densityFloorMBPerMin;
}

/**
 * Whether a session may be selected at all, independent of budget.
 *
 * A density-gated session is, by the gate's own definition, a static scene —
 * so it should never earn a full-quality clip regardless of how much budget
 * happens to be left. Without this, greedy budget-filling picks up near-zero-
 * score scraps purely because they are small: a 0.5-minute 04:45 session
 * scoring 2 was landing in the archive alongside a 31-minute evening session
 * scoring 1118.
 *
 * A positive trigger label overrides the gate — if HA saw a person, a low
 * bitrate does not matter. Gated sessions still appear in the timelapse.
 */
export function isSelectable(session, config) {
  if (!isDensityGated(session, config)) return true;
  const strong = config.strongLabels ?? ['person', 'visitor', 'pet'];
  return (session.labels ?? []).some((l) => strong.includes(l));
}

/**
 * Rank sessions and select until the projected encoded budget is exhausted.
 *
 * Projection uses a compression ratio rather than the source size, since the
 * output is re-encoded. Unselected sessions are returned too — they still
 * appear in the timelapse and must be recorded in the manifest.
 */
export function selectSessions(sessions, config) {
  const { budgetMB, compressionRatio = 0.6 } = config;
  const scored = sessions
    .map((s) => ({ ...s, score: scoreSession(s, config) }))
    .sort((a, b) => b.score - a.score);

  let spentMB = 0;
  const selected = [];
  const rejected = [];

  for (const session of scored) {
    const projectedMB = (session.sizeBytes / 1e6) * compressionRatio;

    // Eligibility is checked before budget: a static scene is not worth a clip
    // even when there is budget to spare.
    if (!isSelectable(session, config)) {
      rejected.push({ ...session, selected: false, projectedMB, reason: 'density-gated' });
      continue;
    }
    if (spentMB + projectedMB <= budgetMB) {
      spentMB += projectedMB;
      selected.push({ ...session, selected: true, projectedMB });
    } else {
      rejected.push({ ...session, selected: false, projectedMB, reason: 'budget' });
    }
  }

  return {
    selected: selected.sort((a, b) => a.start - b.start),
    rejected: rejected.sort((a, b) => a.start - b.start),
    projectedMB: spentMB,
    budgetMB,
  };
}
