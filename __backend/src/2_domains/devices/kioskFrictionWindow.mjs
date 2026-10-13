/**
 * Per-device rolling friction window — pure, no clock, no I/O. State Gates
 * itself has no "N events in the last M minutes for one subject" primitive
 * (its `count` expression counts across a set of subjects sharing one
 * period, a different shape); this is the small piece that does that
 * arithmetic, so State Gates can be asked only to compare a number against
 * a policy threshold.
 */
export function recordFrictionPing(events, { at, windowMs }) {
  const pruned = events.filter((event) => at - event.at <= windowMs);
  return [...pruned, { at }];
}

export function frictionScore(events, { at, windowMs }) {
  return events.filter((event) => at - event.at <= windowMs).length;
}
