// Read-only projections of a timed attempt's recorded verdicts. Renderers
// paint from these; they never judge timing themselves.

const median = (values) => {
  if (!values.length) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const withDrift = (verdict, driftMs) => (Number.isFinite(driftMs) ? { ...verdict, driftMs } : verdict);

/**
 * timedVerdicts(snapshot) -> Map<eventIndex, Map<midi, NoteVerdict>>
 *
 * NoteVerdict = { state: 'hit'|'early'|'late'|'lapsed'|'miss', driftMs? }
 *             | { state: 'wrong', midi, driftMs? }   // keyed by the played midi
 *
 * Precedence for an expected note: a claim (hit/early/late) beats a final
 * miss, which beats lapsed. Notes still open inside their window have no
 * entry. A wrong pitch never overwrites an expected note's verdict at the
 * same midi.
 */
export function assessmentVerdicts(snapshot) {
  const verdicts = new Map();
  const events = snapshot?.expectation?.events || [];
  const hits = snapshot?.hits || {};
  const misses = new Set(snapshot?.misses || []);
  const lapsed = new Set(snapshot?.lapsed || []);
  const indexById = new Map();
  events.forEach((event, index) => {
    indexById.set(event.id, index);
    const byMidi = new Map();
    for (const note of event.notes) {
      const hit = hits[note.id];
      let verdict = null;
      if (hit) verdict = withDrift({ state: hit.offbeat || 'hit' }, hit.driftMs);
      else if (misses.has(note.id)) verdict = { state: 'miss' };
      else if (lapsed.has(note.id)) verdict = { state: 'lapsed' };
      if (verdict && !byMidi.has(note.midi)) byMidi.set(note.midi, verdict);
    }
    if (byMidi.size) verdicts.set(index, byMidi);
  });
  for (const wrong of snapshot?.wrong || []) {
    const index = indexById.get(wrong.eventId);
    if (index == null || !Number.isFinite(wrong.midi)) continue;
    const byMidi = verdicts.get(index) || new Map();
    if (!byMidi.has(wrong.midi)) byMidi.set(wrong.midi, withDrift({ state: 'wrong', midi: wrong.midi }, wrong.driftMs));
    verdicts.set(index, byMidi);
  }
  return verdicts;
}

// Compatibility name for callers that specifically describe a timed run.
export const timedVerdicts = assessmentVerdicts;

/** One truthful count projection for live UI, results, and telemetry. */
export function verdictSummary(snapshot) {
  const hits = Object.values(snapshot?.hits || {});
  const wrongPitches = (snapshot?.wrong || [])
    .map(({ midi }) => midi)
    .filter(Number.isFinite);
  return {
    right: hits.length,
    wrong: wrongPitches.length,
    missed: (snapshot?.misses || []).length,
    early: hits.filter(({ offbeat }) => offbeat === 'early').length,
    late: hits.filter(({ offbeat }) => offbeat === 'late').length,
    wrongPitches,
  };
}

/**
 * timedRunSummary(result, snapshot) ->
 *   { kind: 'passed'|'timing'|'notes', offbeat, late, early, medianDriftMs }
 *
 * 'timing': the run failed, every expected note was claimed with the right
 * pitch (on the beat or off it), cleanliness did not fail, and the failure is
 * about time (placement failed or some notes were off the beat).
 * 'notes': any other failure.
 */
export function timedRunSummary(result, snapshot) {
  const notes = (snapshot?.expectation?.events || []).flatMap((event) => event.notes);
  const hits = snapshot?.hits || {};
  const claims = notes.map((note) => hits[note.id]).filter(Boolean);
  const early = claims.filter((hit) => hit.offbeat === 'early').length;
  const late = claims.filter((hit) => hit.offbeat === 'late').length;
  const offbeat = early + late;
  const medianDriftMs = median(claims.map((hit) => hit.driftMs).filter(Number.isFinite)) ?? null;
  const base = { offbeat, late, early, medianDriftMs };
  if (result?.verdict?.passed) return { kind: 'passed', ...base };
  const failed = result?.verdict?.failed_criteria || [];
  const allClaimed = notes.length > 0 && claims.length === notes.length;
  const timing = allClaimed && !failed.includes('cleanliness') && (failed.includes('placement') || offbeat > 0);
  return { kind: timing ? 'timing' : 'notes', ...base };
}
