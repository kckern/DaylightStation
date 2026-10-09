// The single judge for timed (cued) assessment onsets.
//
// Two policies share one entry point:
//  - fixed (policy.windowFraction absent): ±policy.matchWindowMs around the
//    target; anything else is `wrong`, charged to the nearest pending event.
//    This is the historical matcher used by Sheet Music, Piano Hero and
//    Space Invaders and must not change.
//  - fraction (policy.windowFraction set): each event's window is a fraction
//    of the gap to its nearest non-empty neighbour, clamped to
//    [windowMinMs, windowMaxMs]. A right pitch outside the window but within
//    the event's reach (the gap) is recorded on its OWN event as early/late,
//    so a steady lag never cascades onto the next beat.
//
// All functions are pure: they read an attempt and return plain data.

const DEFAULT_WINDOW_MIN_MS = 80;
const DEFAULT_WINDOW_MAX_MS = 400;

export function quarterToMs(map, quarter) {
  let ms = 0;
  let prior = map[0];
  if (!prior) return null;
  for (let i = 1; i < map.length && map[i].onsetQuarter < quarter; i += 1) {
    const next = map[i];
    ms += (next.onsetQuarter - prior.onsetQuarter) * 60000 / prior.bpm;
    prior = next;
  }
  return ms + (quarter - prior.onsetQuarter) * 60000 / prior.bpm;
}

/** Absolute target time (attempt clock, ms) of an expectation event. */
export function timedTarget(attempt, event) {
  const offset = quarterToMs(attempt.expectation.tempoMap, event.onsetQuarter)
    - quarterToMs(attempt.expectation.tempoMap, attempt.originQuarter);
  return attempt.startedAt + attempt.leadInMs + offset;
}

/** True when the attempt uses the gap-relative (fraction) window policy. */
export function isFractionPolicy(policy) {
  const fraction = Number(policy?.windowFraction);
  return policy?.windowFraction != null && Number.isFinite(fraction) && fraction > 0;
}

function windowBounds(policy) {
  const min = Number.isFinite(Number(policy.windowMinMs)) ? Number(policy.windowMinMs) : DEFAULT_WINDOW_MIN_MS;
  const max = Number.isFinite(Number(policy.windowMaxMs)) ? Number(policy.windowMaxMs) : DEFAULT_WINDOW_MAX_MS;
  return { min, max: Math.max(min, max) };
}

/**
 * Distance (ms) from event `eventIndex` to the nearest previous/next NON-EMPTY
 * event onset, or null when it has no non-empty neighbour.
 */
export function timedGapMs(attempt, eventIndex) {
  const { events, tempoMap } = attempt.expectation;
  const event = events[eventIndex];
  if (!event) return null;
  const own = quarterToMs(tempoMap, event.onsetQuarter);
  let gap = null;
  for (let i = eventIndex - 1; i >= 0; i -= 1) {
    if (!events[i].notes.length) continue;
    gap = Math.abs(own - quarterToMs(tempoMap, events[i].onsetQuarter));
    break;
  }
  for (let i = eventIndex + 1; i < events.length; i += 1) {
    if (!events[i].notes.length) continue;
    const next = Math.abs(quarterToMs(tempoMap, events[i].onsetQuarter) - own);
    gap = gap == null ? next : Math.min(gap, next);
    break;
  }
  return gap;
}

/** Per-event hit window, ms. Fixed policy: policy.matchWindowMs. */
export function timedWindowMs(attempt, eventIndex) {
  const { policy } = attempt;
  if (!isFractionPolicy(policy)) return policy.matchWindowMs;
  const { min, max } = windowBounds(policy);
  const gap = timedGapMs(attempt, eventIndex);
  if (gap == null) return max;
  return Math.max(min, Math.min(max, Number(policy.windowFraction) * gap));
}

/**
 * Per-event reach, ms: how far from its target a right pitch can still be
 * claimed (as early/late) by this event. It is the gap to the nearest
 * neighbour, never smaller than the window. Fixed policy: the window.
 */
export function timedReachMs(attempt, eventIndex) {
  const window = timedWindowMs(attempt, eventIndex);
  if (!isFractionPolicy(attempt.policy)) return window;
  const gap = timedGapMs(attempt, eventIndex);
  return Math.max(window, gap ?? window);
}

function isOpen(attempt, note) {
  return !attempt.hits[note.id] && !attempt.misses.includes(note.id);
}

/**
 * Judge one timed onset. Does not mutate the attempt.
 *
 * @returns
 *   { verdict: 'hit', eventId, noteIds, driftMs, windowMs }
 * | { verdict: 'early'|'late', eventId, noteIds, driftMs, windowMs }  (fraction only)
 * | { verdict: 'wrong', eventId|null, midi, driftMs|null }
 */
export function judgeTimedOnset(attempt, { midi, time }) {
  const fraction = isFractionPolicy(attempt.policy);
  const events = attempt.expectation.events;
  let hit = null;
  let offbeat = null;
  const nearestOf = (current, candidate) => (!current || Math.abs(candidate.drift) < Math.abs(current.drift) ? candidate : current);
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!event.notes.some((note) => note.midi === midi && isOpen(attempt, note))) continue;
    const drift = time - timedTarget(attempt, event);
    const windowMs = timedWindowMs(attempt, index);
    if (Math.abs(drift) <= windowMs) {
      hit = nearestOf(hit, { event, drift, windowMs });
    } else if (fraction && Math.abs(drift) <= timedReachMs(attempt, index)) {
      offbeat = nearestOf(offbeat, { event, drift, windowMs });
    }
  }
  const claim = hit || offbeat;
  if (claim) {
    const noteIds = claim.event.notes.filter((note) => note.midi === midi && isOpen(attempt, note)).map((note) => note.id);
    const verdict = hit ? 'hit' : claim.drift < 0 ? 'early' : 'late';
    return { verdict, eventId: claim.event.id, noteIds, driftMs: claim.drift, windowMs: claim.windowMs };
  }
  let nearest = null;
  if (fraction) {
    // Nearest non-empty event by time, whatever its state: a wrong pitch is
    // charged to the beat the child was on, never to one further along.
    for (const event of events) {
      if (!event.notes.length) continue;
      const drift = time - timedTarget(attempt, event);
      if (!nearest || Math.abs(drift) < Math.abs(nearest.drift)) nearest = { event, drift };
    }
  } else {
    // Historical behaviour: nearest pending note of any pitch.
    for (const event of events) {
      for (const note of event.notes) {
        if (!isOpen(attempt, note)) continue;
        const drift = time - timedTarget(attempt, event);
        if (!nearest || Math.abs(drift) < Math.abs(nearest.drift)) nearest = { event, drift };
      }
    }
  }
  return { verdict: 'wrong', eventId: nearest?.event.id ?? null, midi, driftMs: nearest ? nearest.drift : null };
}
